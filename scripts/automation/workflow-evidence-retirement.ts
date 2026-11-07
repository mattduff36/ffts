import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { WorkflowProtocolRecord, WorkflowReviewState } from './types';
import {
  getWorkflowPaths, loadWorkflowReviewStateStrict, withWorkflowLock, writeJsonAtomic,
} from './workflow-events';
import {
  assertSafeOpaqueId, pathHasExistingSymlinkComponent,
} from './workflow-plan-contract';
import {
  assertBoundRehomeSecurityFields, canonicalizeEvidence, computeGitPatchSha256,
  computeGitProductTreeFingerprint, computeRouteEvidenceHash, hashBoundRehomeSecurityObject,
  hashCanonicalEvidence, inspectCommitAncestry, lineageBudgetExhausted,
  listOrderedImplementationCommits, parsePredecessorReleaseContext,
  REHOME_EVIDENCE_CANON_VERSION,
} from './workflow-v24-disposition';
import {
  latestLegalFinalDiffAttempt, validateCurrentV24ProtocolRecord,
  validateWorkflowProtocolRecordStructure,
} from './workflow-v24-protocol-validator';
import {
  evidenceGit, inspectWorkflowEvidencePins, pinWorkflowEvidence,
} from './workflow-git-evidence';

export const WORKFLOW_RETIREMENT_REF_PREFIX = 'refs/ffts/workflow-retirements/';
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

interface RetirementChain {
  records: Array<{ workstreamId: string; fingerprint: string }>;
  terminalWorkstreamId: string;
  terminalHeadCommit: string;
  terminalReviewToken: string;
  terminalFinaliseFingerprint: string;
}

export interface WorkflowEvidenceRetirementReceipt {
  schemaVersion: '1';
  command: 'retire-evidence';
  workstreamId: string;
  missingCommit: string;
  ownerAuthorisedRetirement: true;
  authorisationMarker: 'owner-authorised-retirement';
  reason: string;
  recordedAt: string;
  currentHead: string;
  chain: RetirementChain;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeId(id: string): string {
  const checked = assertSafeOpaqueId(id, 'workstreamId');
  if (!checked.ok) throw new Error(checked.error);
  return checked.value;
}

function safePath(filePath: string): string {
  requireCondition(!pathHasExistingSymlinkComponent(filePath), `unsafe workflow evidence path: ${filePath}`);
  return filePath;
}

function retirementDirectory(repoRoot: string): string {
  return safePath(path.join(getWorkflowPaths(repoRoot).automationRoot, 'evidence-retirements'));
}

export function getWorkflowRetirementPath(repoRoot: string, workstreamId: string): string {
  return safePath(path.join(retirementDirectory(repoRoot), `${safeId(workstreamId)}.json`));
}

/** Require exact semantic disk/state agreement, including attempts and provenance, not just phases. */
export function loadWorkflowEvidenceInventory(repoRoot: string): {
  state: WorkflowReviewState;
  records: Map<string, WorkflowProtocolRecord>;
} {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewStateStrict(safePath(paths.statePath));
  const root = safePath(path.join(paths.automationRoot, 'workstreams'));
  const ids = new Set(Object.keys(state.protocolRecords ?? {}).map(safeId));
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      safePath(path.join(root, safeId(entry.name)));
      if (existsSync(path.join(root, entry.name, 'protocol.json'))) ids.add(entry.name);
    }
  }
  const records = new Map<string, WorkflowProtocolRecord>();
  for (const id of ids) {
    const filePath = safePath(path.join(root, id, 'protocol.json'));
    requireCondition(existsSync(filePath), `workflow protocol missing on disk: ${id}`);
    const record: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const parsed = validateWorkflowProtocolRecordStructure(record);
    requireCondition(parsed.ok, parsed.ok ? '' : parsed.message);
    requireCondition(parsed.record.workstreamId === id, `workflow protocol identity mismatch: ${id}`);
    const stateRecord = state.protocolRecords?.[id];
    requireCondition(!stateRecord || hashCanonicalEvidence(stateRecord) === hashCanonicalEvidence(record),
      `workflow protocol disk/state fingerprint divergence: ${id}`);
    records.set(id, parsed.record);
  }
  return { state, records };
}

function requireAncestor(repoRoot: string, ancestor: string, descendant: string, label: string): void {
  const result = inspectCommitAncestry(repoRoot, ancestor, descendant);
  requireCondition(result.status === 'ancestor',
    result.status === 'error' ? result.message : `${label}: ancestry mismatch`);
}

function requireLocalContext(repoRoot: string, context: string): void {
  const parsed = parsePredecessorReleaseContext(context);
  requireCondition(parsed.ok, parsed.ok ? '' : parsed.message);
  requireLocalPath(repoRoot, parsed.repoPath);
}

function requireLocalPath(repoRoot: string, recorded: string | undefined): void {
  requireCondition(recorded, 'missing immutable repository identity');
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  requireCondition(normalize(recorded) === normalize(repoRoot),
    'retirement requires a repository-local immutable successor chain');
}

function legalCandidate(record: WorkflowProtocolRecord): string {
  const latest = latestLegalFinalDiffAttempt(record);
  requireCondition(latest.ok && latest.attempt?.headCommit,
    `missing legal review candidate: ${record.workstreamId}`);
  return latest.attempt.headCommit;
}

function validateRetirementChain(
  repoRoot: string,
  records: Map<string, WorkflowProtocolRecord>,
  state: WorkflowReviewState,
  workstreamId: string,
  missingCommit: string,
  currentHead: string
): RetirementChain {
  requireCondition(FULL_SHA.test(missingCommit), 'retirement requires an exact full missing commit SHA');
  let current = records.get(safeId(workstreamId));
  requireCondition(current?.phase === 'rehomed', 'retirement requires a non-release rehomed historical record');
  requireCondition(legalCandidate(current) === missingCommit,
    'missing commit is not the original legal review candidate');
  const chain: WorkflowProtocolRecord[] = [];
  const seen = new Set<string>();
  while (current) {
    requireCondition(!seen.has(current.workstreamId), 'cyclic retirement successor lineage');
    seen.add(current.workstreamId);
    const valid = validateCurrentV24ProtocolRecord(current);
    requireCondition(valid.ok, valid.ok ? '' : valid.message);
    requireCondition(!(current.sourceWorkstreamIds?.length), 'split lineage cannot be retired as an independent rehome');
    requireCondition(current.reviewAttempts.every((attempt) => attempt.result && attempt.recordedAt),
      'incomplete successor review history');
    chain.push(current);
    requireCondition(state.protocolRecords?.[current.workstreamId] &&
      hashCanonicalEvidence(state.protocolRecords[current.workstreamId]) === hashCanonicalEvidence(current),
    'missing or divergent successor state history');
    if (current.phase === 'finalised') break;
    requireCondition(current.phase === 'rehomed' && lineageBudgetExhausted(current),
      'unfinished or non-rehome retirement successor');
    requireCondition(current.nextAction === 'non_release_disposition' && !current.activeCheckpointId,
      'historical disposition has unfinished authority');
    const route = current.routeDisposition;
    requireCondition(route?.schemaVersion === '1' && route.command === 'route' &&
      route.target === 'rehomed' && route.reason.trim() && Number.isFinite(Date.parse(route.recordedAt)),
    'missing or malformed historical route');
    const evidence = route.gitEvidence;
    const candidate = legalCandidate(current);
    requireCondition(evidence.kind === 'isolated_successor' &&
      evidence.canonVersion === REHOME_EVIDENCE_CANON_VERSION &&
      evidence.baselineCommit === current.baseCommit &&
      evidence.predecessorHead === candidate &&
      evidence.latestLegalReviewCandidateHead === candidate &&
      evidence.predecessorHeadIsAncestor === false &&
      evidence.implementationCommits.length > 0,
    'invalid immutable route candidate binding');
    requireLocalPath(repoRoot, evidence.successorRepoCanonicalPath);
    requireCondition(computeRouteEvidenceHash({
      target: route.target, baseline: evidence.baselineCommit,
      releaseHead: evidence.releaseHeadCommit, implementationCommits: evidence.implementationCommits,
      latestLegalReviewCandidateHead: candidate, successorRepo: evidence.successorRepoCanonicalPath,
      successorBranch: evidence.successorBranch, successorBaseline: evidence.successorBaseline,
      predecessorHead: evidence.predecessorHead,
    }) === evidence.evidenceHash, 'historical route evidence hash mismatch');
    const successors = [...records.values()].filter((record) =>
      record.rehomeProvenance?.sourceReviewWorkstreamId === current!.workstreamId ||
      record.rehomeProvenance?.predecessorDescendantWorkstreamId === current!.workstreamId
    );
    requireCondition(successors.length === 1, 'missing or ambiguous immutable rehome successor');
    const next = successors[0];
    const provenance = next.rehomeProvenance!;
    const bound = assertBoundRehomeSecurityFields(provenance);
    requireCondition(bound.ok, bound.ok ? '' : bound.message);
    requireCondition(hashBoundRehomeSecurityObject(provenance) === provenance.evidence!.evidenceHash,
      'successor provenance evidence hash mismatch');
    requireLocalPath(repoRoot, provenance.successorWorktreeCanonicalPath);
    requireLocalContext(repoRoot, provenance.predecessorReleaseContext);
    requireLocalContext(repoRoot, provenance.sourceReleaseContext!);
    requireCondition(
      provenance.predecessorRootWorkstreamId === current.workstreamId &&
      provenance.predecessorDescendantWorkstreamId === current.workstreamId &&
      provenance.sourceReviewWorkstreamId === current.workstreamId &&
      provenance.predecessorHeadCommit === candidate &&
      provenance.sourceHeadCommit === candidate &&
      provenance.sourceBaselineCommit === current.baseCommit &&
      provenance.successorBranchName === next.branchName &&
      evidence.successorBranch === next.branchName &&
      evidence.successorBaseline === next.baseCommit &&
      provenance.successorBaselineCommit === next.baseCommit &&
      evidence.releaseHeadCommit === provenance.evidence!.currentHead &&
      hashCanonicalEvidence(provenance.sourceImplementationCommits) === hashCanonicalEvidence(evidence.implementationCommits),
      'unrelated or cross-bound immutable successor lineage'
    );
    const imported = provenance.evidence!.currentHead;
    requireAncestor(repoRoot, next.baseCommit, imported, 'successor import baseline');
    requireAncestor(repoRoot, imported, next.phase === 'finalised' ? next.headCommit! : legalCandidate(next),
      'successor import/review');
    requireCondition(computeGitProductTreeFingerprint(repoRoot, imported) === provenance.sourceProductTreeFingerprint,
      'successor imported product fingerprint mismatch');
    const available = inspectWorkflowEvidencePins(repoRoot, current);
    if (!available.missing.includes(candidate)) {
      requireAncestor(repoRoot, current.baseCommit, candidate, 'source review baseline');
      const implementation = listOrderedImplementationCommits(repoRoot, current.baseCommit, candidate);
      requireCondition(Array.isArray(implementation) &&
        hashCanonicalEvidence(implementation) === hashCanonicalEvidence(evidence.implementationCommits),
      'source implementation range mismatch');
      requireCondition(computeGitPatchSha256(repoRoot, current.baseCommit, candidate) === provenance.sourcePatchSha256 &&
        computeGitProductTreeFingerprint(repoRoot, candidate) === provenance.sourceProductTreeFingerprint,
      'source patch/product evidence mismatch');
      const isolated = inspectCommitAncestry(repoRoot, candidate, imported);
      requireCondition(isolated.status === 'not_ancestor', 'successor import is not isolated from failed candidate');
    } else {
      requireCondition(candidate === missingCommit && current.workstreamId === workstreamId,
        'unrelated missing successor evidence');
    }
    // Only the genuinely finalised terminal must be incorporated. Intermediate imports may be discarded.
    for (const sha of evidence.implementationCommits) {
      if (sha === missingCommit && available.missing.includes(sha)) continue;
      const isolated = inspectCommitAncestry(repoRoot, sha, currentHead);
      requireCondition(isolated.status === 'not_ancestor',
        'failed historical implementation is present in current release ancestry');
    }
    current = next;
  }
  const terminal = chain[chain.length - 1];
  requireCondition(terminal?.phase === 'finalised' && terminal.openBlockerIds.length === 0 &&
    terminal.nextAction === 'done' && !terminal.activeCheckpointId,
  'terminal successor is not genuinely finalised without blockers');
  const lastReview = terminal.reviewAttempts[terminal.reviewAttempts.length - 1];
  requireCondition(lastReview?.result === 'passed' && lastReview.headCommit === terminal.headCommit,
    'terminal successor lacks a passed final candidate');
  requireAncestor(repoRoot, terminal.headCommit!, currentHead, 'finalised terminal incorporation');
  const finalise = state.workstreams?.[terminal.workstreamId];
  requireCondition(finalise?.status === 'finalised' && finalise.finaliseOutcome === 'passed' &&
    finalise.finaliseRunId && finalise.finaliseCommit,
  'terminal successor lacks passed finalise correlation history');
  requireAncestor(repoRoot, terminal.headCommit!, finalise.finaliseCommit, 'finalise reviewed candidate');
  requireAncestor(repoRoot, finalise.finaliseCommit, currentHead, 'finalise result incorporation');
  const audit = inspectWorkflowEvidencePins(repoRoot, chain);
  requireCondition(audit.missing.every((sha) => sha === missingCommit), 'missing terminal or successor Git evidence');
  return {
    records: chain.map((record) => ({
      workstreamId: record.workstreamId, fingerprint: hashCanonicalEvidence(record),
    })),
    terminalWorkstreamId: terminal.workstreamId,
    terminalHeadCommit: terminal.headCommit!,
    terminalReviewToken: lastReview.token,
    terminalFinaliseFingerprint: hashCanonicalEvidence(finalise),
  };
}

function receiptRef(workstreamId: string): string {
  return `${WORKFLOW_RETIREMENT_REF_PREFIX}${safeId(workstreamId)}`;
}

function retirementRefs(repoRoot: string): Set<string> {
  if (!existsSync(path.join(repoRoot, '.git'))) return new Set();
  const output = evidenceGit(repoRoot, [
    'for-each-ref', '--format=%(refname) %(symref)', WORKFLOW_RETIREMENT_REF_PREFIX,
  ]);
  return new Set(output.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [ref, symbolic] = line.split(' ');
    requireCondition(!symbolic, `symbolic retirement seal is unsafe: ${ref}`);
    safeId(ref.slice(WORKFLOW_RETIREMENT_REF_PREFIX.length));
    return ref;
  }));
}

function receiptText(receipt: WorkflowEvidenceRetirementReceipt): string {
  return JSON.stringify(canonicalizeEvidence(receipt), null, 2);
}

function validateReceipt(
  repoRoot: string,
  records: Map<string, WorkflowProtocolRecord>,
  state: WorkflowReviewState,
  receipt: WorkflowEvidenceRetirementReceipt,
  workstreamId: string
): void {
  requireCondition(receipt.schemaVersion === '1' && receipt.command === 'retire-evidence' &&
    receipt.workstreamId === workstreamId && receipt.ownerAuthorisedRetirement === true &&
    receipt.authorisationMarker === 'owner-authorised-retirement' &&
    typeof receipt.reason === 'string' && receipt.reason.trim() &&
    typeof receipt.recordedAt === 'string' && Number.isFinite(Date.parse(receipt.recordedAt)) &&
    Date.parse(receipt.recordedAt) <= Date.now() && FULL_SHA.test(receipt.currentHead),
  'malformed or unauthorised retirement receipt');
  const currentHead = evidenceGit(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  requireAncestor(repoRoot, receipt.currentHead, currentHead, 'retirement authorising HEAD');
  const chain = validateRetirementChain(repoRoot, records, state, workstreamId, receipt.missingCommit, currentHead);
  requireCondition(hashCanonicalEvidence(chain) === hashCanonicalEvidence(receipt.chain),
    'retirement original/chain fingerprint drift');
  requireAncestor(repoRoot, chain.terminalHeadCommit, receipt.currentHead, 'original retirement incorporation');
  for (const row of chain.records) {
    requireCondition(Date.parse(records.get(row.workstreamId)!.updatedAt) <= Date.parse(receipt.recordedAt),
      'retirement receipt predates its evidence');
  }
}

export function inspectWorkflowRetirements(repoRoot: string): {
  retired: Set<string>;
  errors: Array<{ workstreamId: string; message: string }>;
} {
  const retired = new Set<string>();
  const errors: Array<{ workstreamId: string; message: string }> = [];
  try {
    const root = retirementDirectory(repoRoot);
    const files = existsSync(root) ? readdirSync(root) : [];
    const refs = retirementRefs(repoRoot);
    const ids = new Set<string>();
    for (const file of files) {
      requireCondition(file.endsWith('.json'), 'incomplete or unexpected retirement audit artifact');
      ids.add(safeId(file.slice(0, -5)));
    }
    for (const ref of refs) {
      ids.add(safeId(ref.slice(WORKFLOW_RETIREMENT_REF_PREFIX.length)));
    }
    if (ids.size === 0) return { retired, errors };
    const { records, state } = loadWorkflowEvidenceInventory(repoRoot);
    for (const id of ids) {
      try {
        const filePath = getWorkflowRetirementPath(repoRoot, id);
        requireCondition(existsSync(filePath), 'incomplete retirement: sealed receipt has no audit file; rerun authorised retire-evidence');
        const text = readFileSync(filePath, 'utf8');
        const sealed = evidenceGit(repoRoot, ['cat-file', 'blob', receiptRef(id)]);
        requireCondition(text.trim() === sealed, 'retirement receipt tampering or incomplete seal');
        const receipt = JSON.parse(text) as WorkflowEvidenceRetirementReceipt;
        requireCondition(text === receiptText(receipt), 'noncanonical retirement audit receipt');
        validateReceipt(repoRoot, records, state, receipt, id);
        retired.add(id);
      } catch (error) {
        errors.push({ workstreamId: id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    errors.push({ workstreamId: 'evidence-retirements', message: error instanceof Error ? error.message : String(error) });
  }
  return { retired, errors };
}

export function retireWorkflowEvidence(params: {
  repoRoot: string;
  workstreamId: string;
  missingCommit: string;
  reason: string;
  ownerAuthorisedRetirement: boolean;
  dryRun: boolean;
}): { dryRun: boolean; receipt: WorkflowEvidenceRetirementReceipt; alreadyRecorded: boolean } {
  requireCondition(params.ownerAuthorisedRetirement, 'retire-evidence requires --owner-authorised-retirement');
  requireCondition(params.reason.trim(), 'retire-evidence requires an explicit reason');
  const run = () => {
    const { state, records } = loadWorkflowEvidenceInventory(params.repoRoot);
    const paths = getWorkflowPaths(params.repoRoot);
    for (const pending of ['successor-commit.pending.json', 'finalise-passed-commit.pending.json']) {
      requireCondition(!existsSync(path.join(paths.knowledgeDirectory, pending)), 'incomplete workflow transaction blocks retirement');
    }
    requireCondition(!state.activeFinaliseContext, 'active finalise blocks historical retirement');
    const id = safeId(params.workstreamId);
    const filePath = getWorkflowRetirementPath(params.repoRoot, id);
    const hasSeal = retirementRefs(params.repoRoot).has(receiptRef(id));
    requireCondition(!existsSync(filePath) || hasSeal, 'unsealed retirement audit file; refuse to overwrite');
    let receipt: WorkflowEvidenceRetirementReceipt;
    if (hasSeal) {
      receipt = JSON.parse(evidenceGit(params.repoRoot, ['cat-file', 'blob', receiptRef(id)])) as WorkflowEvidenceRetirementReceipt;
      requireCondition(receipt.missingCommit === params.missingCommit && receipt.reason === params.reason.trim(),
        'retirement replay conflicts with immutable receipt');
      if (existsSync(filePath)) {
        requireCondition(readFileSync(filePath, 'utf8') === receiptText(receipt), 'retirement receipt tampering');
      }
      validateReceipt(params.repoRoot, records, state, receipt, id);
    } else {
      const audit = inspectWorkflowEvidencePins(params.repoRoot, records.get(id));
      requireCondition(audit.missing.includes(params.missingCommit), 'nominated retirement commit is not missing');
      const head = evidenceGit(params.repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
      receipt = {
        schemaVersion: '1', command: 'retire-evidence', workstreamId: id,
        missingCommit: params.missingCommit, ownerAuthorisedRetirement: true,
        authorisationMarker: 'owner-authorised-retirement', reason: params.reason.trim(),
        recordedAt: new Date().toISOString(), currentHead: head,
        chain: validateRetirementChain(params.repoRoot, records, state, id, params.missingCommit, head),
      };
      validateReceipt(params.repoRoot, records, state, receipt, id);
    }
    if (!params.dryRun) {
      pinWorkflowEvidence(params.repoRoot, { state, records: [...records.values()], receipt });
      if (!hasSeal) {
        const blob = evidenceGit(params.repoRoot, ['hash-object', '-w', '--stdin'], receiptText(receipt));
        // CAS creation seals the receipt first. A crash before its audit mirror is fail-closed and replayable.
        evidenceGit(params.repoRoot, ['update-ref', '--stdin'],
          `start\noption no-deref\ncreate ${receiptRef(id)} ${blob}\nprepare\ncommit\n`);
      }
      if (!existsSync(filePath)) {
        mkdirSync(retirementDirectory(params.repoRoot), { recursive: true });
        writeJsonAtomic(filePath, canonicalizeEvidence(receipt));
      }
    }
    return { dryRun: params.dryRun, receipt, alreadyRecorded: hasSeal };
  };
  return params.dryRun ? run() : withWorkflowLock(safePath(getWorkflowPaths(params.repoRoot).lockPath), run);
}

export function auditWorkflowEvidence(params: { repoRoot: string; dryRun: boolean }) {
  const run = () => {
    const { state, records } = loadWorkflowEvidenceInventory(params.repoRoot);
    const value = { state, records: [...records.values()] };
    return {
      dryRun: params.dryRun,
      ...(params.dryRun ? inspectWorkflowEvidencePins(params.repoRoot, value) : pinWorkflowEvidence(params.repoRoot, value)),
    };
  };
  return params.dryRun ? run() : withWorkflowLock(safePath(getWorkflowPaths(params.repoRoot).lockPath), run);
}
