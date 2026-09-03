import { createHash } from 'crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowRehomeProvenance,
  WorkflowRouteDisposition,
  WorkflowRouteDispositionTarget,
  WorkflowRouteGitEvidence,
} from './types';
import { assertSafeOpaqueId, pathHasSymlinkComponent } from './workflow-plan-contract';

export const WORKFLOW_NON_RELEASE_PHASES = [
  'removed_from_release',
  'reverted',
  'superseded',
  'rehomed',
] as const;

const INPUT_COMMIT_ID_RE = /^[0-9a-f]{7,64}$/i;
const FULL_COMMIT_SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/;
const GIT_SAFETY_TIMEOUT_MS = 30_000;

export function lineageFailedPremiumReviewCount(record: {
  failedPremiumReviewCount: number;
  inheritedFailedReviewCount: number;
}): number {
  return Math.max(record.failedPremiumReviewCount, record.inheritedFailedReviewCount);
}

export function lineageBudgetExhausted(record: WorkflowProtocolRecord): boolean {
  return lineageFailedPremiumReviewCount(record) >= 2;
}

export function lineageFirstConsumed(record: WorkflowProtocolRecord): boolean {
  return (
    record.inheritedFailedReviewCount >= 1 ||
    record.failedPremiumReviewCount >= 1 ||
    record.reviewAttempts.some((attempt) => attempt.pass === 'first')
  );
}

export function isApprovalValidReviewEvidence(
  attempt: WorkflowProtocolReviewAttempt,
  record: WorkflowProtocolRecord
): boolean {
  if (attempt.result !== 'passed') return false;
  if (!attempt.token || !attempt.startedAt || !attempt.recordedAt) return false;
  if (!attempt.headCommit || !attempt.treeFingerprint) return false;
  if (lineageBudgetExhausted(record)) return false;
  if (record.phase === 'routing_required') return false;
  if (attempt.pass === 'delta') {
    return record.reviewAttempts.some(
      (prior) =>
        prior.token !== attempt.token &&
        prior.result === 'passed' &&
        (prior.pass === 'first' || prior.pass === 'closure')
    );
  }
  return attempt.pass === 'first' || attempt.pass === 'closure';
}

export function isNonReleaseDispositionPhase(
  phase: WorkflowProtocolRecord['phase']
): boolean {
  return (WORKFLOW_NON_RELEASE_PHASES as readonly string[]).includes(phase);
}

const FOREIGN_PROTOCOL_PHASES = new Set<WorkflowProtocolPhase>([
  'initialized',
  'preflight_ready',
  'first_review',
  'fix_sweep_required',
  'fix_recorded',
  'closure_review',
  'delta_review',
  'review_closed',
  'routing_required',
  'split',
  'finalise_ready',
  'finalised',
  'removed_from_release',
  'reverted',
  'superseded',
  'rehomed',
]);

function isProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowProtocolRecord>;
  if (
    candidate.schemaVersion !== '1' ||
    typeof candidate.workstreamId !== 'string' ||
    candidate.identityStatus !== 'present' ||
    typeof candidate.baseCommit !== 'string' ||
    typeof candidate.phase !== 'string' ||
    !FOREIGN_PROTOCOL_PHASES.has(candidate.phase as WorkflowProtocolPhase) ||
    typeof candidate.nextAction !== 'string' ||
    typeof candidate.failedPremiumReviewCount !== 'number' ||
    !Number.isInteger(candidate.failedPremiumReviewCount) ||
    candidate.failedPremiumReviewCount < 0 ||
    !Array.isArray(candidate.reviewAttempts) ||
    !Array.isArray(candidate.blockerFamilies) ||
    !Array.isArray(candidate.openBlockerIds)
  ) {
    return false;
  }
  return assertSafeOpaqueId(candidate.workstreamId, 'workstreamId').ok;
}

export function readForeignProtocolRecord(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const protocolPath = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'protocol.json'
  );
  if (!existsSync(protocolPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(protocolPath, 'utf8')) as unknown;
    return isProtocolRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type LegalReviewCandidateResolution =
  | {
      ok: true;
      headCommit: string;
      pass: 'first' | 'closure';
      token: string;
      legalAttempts: WorkflowProtocolReviewAttempt[];
    }
  | { ok: false; message: string };

function collectLineageReviewAttempts(
  repoRoot: string,
  record: WorkflowProtocolRecord,
  seen: Set<string>
): WorkflowProtocolReviewAttempt[] | { error: string } {
  if (seen.has(record.workstreamId)) {
    return { error: 'cyclic split lineage while resolving review candidates' };
  }
  seen.add(record.workstreamId);
  const parentIds = record.sourceWorkstreamIds ?? [];
  if (new Set(parentIds).size !== parentIds.length) {
    return { error: 'ambiguous split lineage while resolving review candidates' };
  }
  let prefix: WorkflowProtocolReviewAttempt[] = [];
  const parentId = parentIds[0];
  if (parentId) {
    const parent = readForeignProtocolRecord(repoRoot, parentId);
    if (!parent) {
      return { error: `split parent protocol missing: ${parentId}` };
    }
    const declaredRest = parentIds.slice(1);
    const parentChain = parent.sourceWorkstreamIds ?? [];
    if (
      declaredRest.length > 0 &&
      (declaredRest.length !== parentChain.length ||
        declaredRest.some((id, index) => id !== parentChain[index]))
    ) {
      return { error: 'ambiguous split lineage while resolving review candidates' };
    }
    const nested = collectLineageReviewAttempts(repoRoot, parent, seen);
    if ('error' in nested) return nested;
    prefix = nested;
  }
  return [...prefix, ...record.reviewAttempts];
}

function classifyLegalPremiumAttempts(
  attempts: WorkflowProtocolReviewAttempt[]
): { ok: true; legal: WorkflowProtocolReviewAttempt[] } | { ok: false; message: string } {
  const tokens = new Set<string>();
  const legal: WorkflowProtocolReviewAttempt[] = [];
  for (const attempt of attempts) {
    if (!attempt.token || tokens.has(attempt.token)) {
      return { ok: false, message: 'review history has missing or duplicate review tokens' };
    }
    tokens.add(attempt.token);
    if (attempt.pass === 'delta') continue;
    if (attempt.pass !== 'first' && attempt.pass !== 'closure') {
      return { ok: false, message: 'review history contains an unrecognised pass' };
    }
    if (attempt.result !== 'passed' && attempt.result !== 'failed') {
      return {
        ok: false,
        message: 'review history is incomplete; latest legal review candidate cannot be determined',
      };
    }
    if (legal.length >= 2) {
      continue;
    }
    if (attempt.pass === 'first') {
      if (legal.length !== 0) {
        return { ok: false, message: 'review history has an out-of-order or duplicate first attempt' };
      }
      legal.push(attempt);
      continue;
    }
    if (legal.length !== 1 || legal[0]?.pass !== 'first') {
      return { ok: false, message: 'review history has an out-of-order closure attempt' };
    }
    legal.push(attempt);
  }
  if (legal.length === 0) {
    return { ok: false, message: 'latest legal review attempt cannot be determined' };
  }
  return { ok: true, legal };
}

export function resolveLatestLegalReviewCandidateHead(
  repoRoot: string,
  record: WorkflowProtocolRecord
): LegalReviewCandidateResolution {
  const attempts = collectLineageReviewAttempts(repoRoot, record, new Set());
  if ('error' in attempts) return { ok: false, message: attempts.error };
  const classified = classifyLegalPremiumAttempts(attempts);
  if (!classified.ok) return classified;
  const latest = classified.legal[classified.legal.length - 1];
  if (!latest || (latest.pass !== 'first' && latest.pass !== 'closure')) {
    return { ok: false, message: 'latest legal review attempt cannot be determined' };
  }
  if (!latest.headCommit) {
    return { ok: false, message: 'legal review attempt is missing its candidate HEAD' };
  }
  const candidate = resolveCommitObject(repoRoot, latest.headCommit);
  if (!candidate) {
    return { ok: false, message: 'latest legal review candidate HEAD does not exist as a git commit object' };
  }
  const baseline = resolveCommitObject(repoRoot, record.baseCommit);
  if (!baseline) {
    return { ok: false, message: 'source baseline does not exist as a git commit object' };
  }
  if (candidate !== baseline) {
    const owned = requireCommitAncestor(
      repoRoot,
      baseline,
      candidate,
      'latest legal review candidate HEAD is outside owned ancestry'
    );
    if (!owned.ok) return owned;
  }
  if (classified.legal.length === 2) {
    const firstHead = classified.legal[0]?.headCommit
      ? resolveCommitObject(repoRoot, classified.legal[0].headCommit)
      : null;
    if (!firstHead) {
      return { ok: false, message: 'first-review candidate HEAD does not exist as a git commit object' };
    }
    if (candidate !== firstHead) {
      const descendant = requireCommitAncestor(
        repoRoot,
        firstHead,
        candidate,
        'closure candidate is not a descendant of the first-review candidate'
      );
      if (!descendant.ok) return descendant;
    }
  }
  return {
    ok: true,
    headCommit: candidate,
    pass: latest.pass,
    token: latest.token,
    legalAttempts: classified.legal,
  };
}

export type HeadDriftRejection =
  | { ok: true }
  | { ok: false; kind: 'git-error' | 'unreviewed-implementation'; message: string };

export function rejectUnreviewedHeadDrift(
  repoRoot: string,
  candidateHead: string,
  currentHead: string | null,
  git: GitCommandRunner = defaultGitCommandRunner
): HeadDriftRejection {
  if (!currentHead) {
    return {
      ok: false,
      kind: 'git-error',
      message: 'unable to read current HEAD for drift inspection',
    };
  }
  const ancestry = inspectCommitAncestry(repoRoot, candidateHead, currentHead, git);
  if (ancestry.status === 'error') {
    return { ok: false, kind: 'git-error', message: ancestry.message };
  }
  if (ancestry.status === 'not_ancestor') return { ok: true };
  const extras = listOrderedImplementationCommits(repoRoot, candidateHead, currentHead, git);
  if (typeof extras === 'object' && 'error' in extras) {
    return { ok: false, kind: 'git-error', message: extras.error };
  }
  if (extras.length > 0) {
    return {
      ok: false,
      kind: 'unreviewed-implementation',
      message:
        'unreviewed implementation after the latest legal review candidate; refuse to enlarge the routed range',
    };
  }
  return { ok: true };
}

export interface GitCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
}

export type GitCommandRunner = (repoRoot: string, args: string[]) => GitCommandResult;

function isTimeoutError(error?: Error): boolean {
  if (!error) return false;
  return (error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
}

export function defaultGitCommandRunner(repoRoot: string, args: string[]): GitCommandResult {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: GIT_SAFETY_TIMEOUT_MS,
  });
  const timedOut = isTimeoutError(result.error);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
    signal: result.signal,
    timedOut,
  };
}

function runGit(
  repoRoot: string,
  args: string[],
  git: GitCommandRunner = defaultGitCommandRunner
): { status: number; stdout: string; error?: string } {
  try {
    const result = git(repoRoot, args);
    if (result.error) {
      return { status: 1, stdout: '', error: result.error.message };
    }
    return {
      status: result.status ?? 1,
      stdout: (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, ''),
      error: undefined,
    };
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      error: error instanceof Error ? error.message : 'git command threw',
    };
  }
}

export type AncestryInspection =
  | { status: 'ancestor' }
  | { status: 'not_ancestor' }
  | { status: 'error'; message: string };

export type CommitResolution = { ok: true; sha: string } | { ok: false; message: string };

function normalizeGitStdout(stdout: string): string {
  return stdout.replace(/(?:\r?\n)+\s*$/u, '');
}

function gitProcessDidNotComplete(result: GitCommandResult, label: string): string | null {
  if (result.timedOut || isTimeoutError(result.error)) {
    return `${label} timed out`;
  }
  if (result.error) {
    return result.error.message || `${label} spawn failed`;
  }
  if (result.signal) {
    return `${label} terminated by signal ${result.signal}`;
  }
  if (result.status === null) {
    return `${label} returned no status`;
  }
  return null;
}

function diagnosticGitText(result: GitCommandResult, fallback: string): string {
  const text = (result.stderr ?? '').trim() || (result.stdout ?? '').trim();
  return text || fallback;
}

export function resolveExactCommitObject(
  repoRoot: string,
  value: string,
  git: GitCommandRunner = defaultGitCommandRunner
): CommitResolution {
  const trimmed = value.trim();
  if (!INPUT_COMMIT_ID_RE.test(trimmed)) {
    return { ok: false, message: 'malformed commit identity' };
  }
  let result: GitCommandResult;
  try {
    result = git(repoRoot, ['rev-parse', '--verify', `${trimmed}^{commit}`]);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'git commit resolution threw',
    };
  }
  const incomplete = gitProcessDidNotComplete(result, 'git commit resolution');
  if (incomplete) return { ok: false, message: incomplete };
  if (result.status !== 0) {
    return { ok: false, message: 'commit object is not uniquely resolvable' };
  }
  const sha = normalizeGitStdout(result.stdout ?? '').toLowerCase();
  if (!FULL_COMMIT_SHA_RE.test(sha)) {
    return { ok: false, message: 'git commit resolution did not return a full commit SHA' };
  }
  return { ok: true, sha };
}

const ISOLATION_FETCH_REF_PREFIX = 'refs/tee-v24/isolation/';

export function importCommitObjectForIsolation(params: {
  repoRoot: string;
  sha: string;
  sourceRepoRoot: string;
  git?: GitCommandRunner;
  allowIsolationImport?: boolean;
}): { ok: true; sha: string } | { ok: false; message: string } {
  const git = params.git ?? defaultGitCommandRunner;
  const source = resolveExactCommitObject(params.sourceRepoRoot, params.sha, git);
  if (!source.ok) {
    return { ok: false, message: 'source commit object is not uniquely resolvable' };
  }
  const local = resolveExactCommitObject(params.repoRoot, source.sha, git);
  if (local.ok) return local;
  if (params.allowIsolationImport === false) {
    return {
      ok: false,
      message:
        'isolation commit is not present locally; read-only validation refuses to fetch or write refs',
    };
  }
  const sourcePath = params.sourceRepoRoot.replace(/\\/g, '/');
  const ref = `${ISOLATION_FETCH_REF_PREFIX}${source.sha}`;
  let fetched: GitCommandResult;
  try {
    fetched = git(params.repoRoot, [
      'fetch',
      '--no-tags',
      '--force',
      sourcePath,
      `${source.sha}:${ref}`,
    ]);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'git fetch of isolation commit threw',
    };
  }
  const incomplete = gitProcessDidNotComplete(fetched, 'git fetch of isolation commit');
  if (incomplete) return { ok: false, message: incomplete };
  if (fetched.status !== 0) {
    return { ok: false, message: 'unable to import commit object for isolation proof' };
  }
  const again = resolveExactCommitObject(params.repoRoot, source.sha, git);
  if (!again.ok) {
    return { ok: false, message: 'commit object missing after isolation import' };
  }
  return again;
}

export function inspectCommitAncestry(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  git: GitCommandRunner = defaultGitCommandRunner
): AncestryInspection {
  const predecessor = resolveExactCommitObject(repoRoot, maybeAncestor, git);
  const descendantResolved = resolveExactCommitObject(repoRoot, descendant, git);
  if (!predecessor.ok || !descendantResolved.ok) {
    const message = [
      predecessor.ok ? null : predecessor.message,
      descendantResolved.ok ? null : descendantResolved.message,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join('; ');
    return { status: 'error', message: message || 'commit object validation failed' };
  }
  let result: GitCommandResult;
  try {
    result = git(repoRoot, [
      'merge-base',
      '--is-ancestor',
      predecessor.sha,
      descendantResolved.sha,
    ]);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'git ancestry inspection threw',
    };
  }
  const incomplete = gitProcessDidNotComplete(result, 'git ancestry inspection');
  if (incomplete) return { status: 'error', message: incomplete };
  if (result.status === 0) return { status: 'ancestor' };
  if (result.status === 1) return { status: 'not_ancestor' };
  return {
    status: 'error',
    message: diagnosticGitText(
      result,
      `git merge-base --is-ancestor failed (status ${String(result.status)})`
    ),
  };
}

export function requireCommitAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  failMessage: string,
  git?: GitCommandRunner
): { ok: true } | { ok: false; message: string } {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'ancestor') return { ok: true };
  if (inspection.status === 'error') return { ok: false, message: inspection.message };
  return { ok: false, message: failMessage };
}

export function requireCommitNotAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  failMessage: string,
  git?: GitCommandRunner
): { ok: true } | { ok: false; message: string } {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'not_ancestor') return { ok: true };
  if (inspection.status === 'ancestor') return { ok: false, message: failMessage };
  return { ok: false, message: inspection.message };
}

export function filterAncestorCommits(
  repoRoot: string,
  commits: string[],
  descendant: string,
  git?: GitCommandRunner
): { ok: true; ancestors: string[] } | { ok: false; message: string } {
  const ancestors: string[] = [];
  for (const commit of commits) {
    const inspection = inspectCommitAncestry(repoRoot, commit, descendant, git);
    if (inspection.status === 'error') return { ok: false, message: inspection.message };
    if (inspection.status === 'ancestor') ancestors.push(commit);
  }
  return { ok: true, ancestors };
}

export function gitHeadCommit(
  repoRoot: string,
  git: GitCommandRunner = defaultGitCommandRunner
): string | null {
  const result = runGit(repoRoot, ['rev-parse', 'HEAD'], git);
  if (result.error || result.status !== 0) return null;
  return FULL_COMMIT_SHA_RE.test(result.stdout) ? result.stdout.toLowerCase() : null;
}

export function gitBranchName(
  repoRoot: string,
  git: GitCommandRunner = defaultGitCommandRunner
): string | null {
  const result = runGit(repoRoot, ['branch', '--show-current'], git);
  if (result.error || result.status !== 0) return null;
  return result.stdout ? result.stdout : null;
}

export function isCommitAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  git?: GitCommandRunner
): boolean {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'error') {
    throw new Error(inspection.message);
  }
  return inspection.status === 'ancestor';
}

export function resolveCanonicalExistingPath(candidate: string): {
  ok: true;
  canonical: string;
} | { ok: false; message: string } {
  if (!candidate.trim()) return { ok: false, message: 'path required' };
  if (candidate.includes('\0') || candidate.includes('\n')) {
    return { ok: false, message: 'path contains illegal characters' };
  }
  const absolute = path.resolve(candidate);
  if (pathHasSymlinkComponent(absolute)) {
    return { ok: false, message: `refusing symlink path ${absolute}` };
  }
  if (!existsSync(absolute)) {
    return { ok: false, message: `path does not exist: ${absolute}` };
  }
  return { ok: true, canonical: absolute.replace(/\\/g, '/') };
}

function requireResolvedCommit(
  repoRoot: string,
  value: string | undefined,
  label: string,
  git?: GitCommandRunner
): string | { error: string } {
  const trimmed = value?.trim() ?? '';
  if (!INPUT_COMMIT_ID_RE.test(trimmed)) return { error: `${label} must be a git commit hash` };
  const resolved = resolveExactCommitObject(repoRoot, trimmed, git);
  if (!resolved.ok) return { error: `${label}: ${resolved.message}` };
  return resolved.sha;
}

export function parsePredecessorReleaseContext(value: string):
  | { ok: true; repoPath: string; branchName: string }
  | { ok: false; message: string } {
  const trimmed = value.trim();
  const hashAt = trimmed.lastIndexOf('#');
  if (hashAt <= 0 || hashAt === trimmed.length - 1) {
    return { ok: false, message: 'predecessorReleaseContext must be path#branch' };
  }
  return {
    ok: true,
    repoPath: trimmed.slice(0, hashAt),
    branchName: trimmed.slice(hashAt + 1),
  };
}

export const REHOME_EVIDENCE_CANON_VERSION = 'tee-v24-rehome-evidence-v2' as const;

export const BOUND_REHOME_SECURITY_FIELD_PATHS = [
  'schemaVersion',
  'canonVersion',
  'status',
  'predecessorRootWorkstreamId',
  'predecessorDescendantWorkstreamId',
  'sourceReviewWorkstreamId',
  'predecessorHeadCommit',
  'predecessorReleaseContext',
  'predecessorBranchResolvedSha',
  'successorBranchName',
  'successorBaselineCommit',
  'successorWorktreeCanonicalPath',
  'sourceReleaseContext',
  'sourceBranchName',
  'sourceHeadCommit',
  'sourceBaselineCommit',
  'sourceImplementationCommits',
  'sourcePatchSha256',
  'sourceProductTreeFingerprint',
  'predecessorHeadIsAncestor',
  'predecessorPassedReview',
  'isolationDecision',
  'predecessorExhausted',
  'currentHead',
  'currentBranch',
  'implementationCommits',
  'latestLegalReviewCandidateHead',
  'mergeBaseCheck',
  'evidenceHash',
] as const;

function isWorkflowAutomationPath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  return (
    normalized === 'docs_private/automation' ||
    normalized.startsWith('docs_private/automation/')
  );
}

export function canonicalizeEvidence(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalizeEvidence(entry));
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (input[key] === undefined) continue;
    output[key] = canonicalizeEvidence(input[key]);
  }
  return output;
}

export function hashCanonicalEvidence(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeEvidence(value)))
    .digest('hex');
}

function hashLegacyEvidence(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function resolveCommitObject(
  repoRoot: string,
  sha: string,
  git: GitCommandRunner = defaultGitCommandRunner
): string | null {
  const resolved = resolveExactCommitObject(repoRoot, sha, git);
  return resolved.ok ? resolved.sha : null;
}

export function gitCommitExists(
  repoRoot: string,
  sha: string,
  git: GitCommandRunner = defaultGitCommandRunner
): boolean {
  return resolveCommitObject(repoRoot, sha, git) !== null;
}

export function resolveBranchCommit(
  repoRoot: string,
  branchName: string
): { ok: true; sha: string } | { ok: false; message: string } {
  if (!BRANCH_RE.test(branchName)) {
    return { ok: false, message: `predecessor branch name is invalid: ${branchName}` };
  }
  const result = runGit(repoRoot, ['rev-parse', '--verify', `refs/heads/${branchName}`]);
  if (result.status !== 0 || !FULL_COMMIT_SHA_RE.test(result.stdout)) {
    return { ok: false, message: `predecessor branch does not exist: ${branchName}` };
  }
  const sha = resolveCommitObject(repoRoot, result.stdout);
  if (!sha) {
    return { ok: false, message: `predecessor branch ${branchName} does not resolve to a commit` };
  }
  return { ok: true, sha };
}

export function requireOrderedCommitObjects(
  repoRoot: string,
  values: string[] | undefined,
  git?: GitCommandRunner
): string[] | { error: string } {
  if (!values || values.length === 0) {
    return { error: 'disposition requires implementation commit evidence' };
  }
  const resolved: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value !== value.trim() || !INPUT_COMMIT_ID_RE.test(value)) {
      return { error: `implementation commit is not a canonical git commit hash: ${String(value)}` };
    }
    const full = resolveCommitObject(repoRoot, value, git);
    if (!full) {
      return { error: `implementation commit is not a git commit object: ${value}` };
    }
    resolved.push(full);
  }
  return resolved;
}

export function requireGitDerivedImplementationCommits(params: {
  repoRoot: string;
  baselineCommit: string;
  headCommit: string;
  claimed?: string[];
}): string[] | { error: string } {
  const derived = listOrderedImplementationCommits(
    params.repoRoot,
    params.baselineCommit,
    params.headCommit
  );
  if (typeof derived === 'object' && 'error' in derived) return derived;
  if (derived.length === 0) {
    return { error: 'disposition requires implementation commit evidence' };
  }
  const claimed = requireOrderedCommitObjects(params.repoRoot, params.claimed);
  if (typeof claimed === 'object' && 'error' in claimed) return claimed;
  if (new Set(claimed).size !== claimed.length) {
    return { error: 'implementation commits must not contain duplicates' };
  }
  if (claimed.length !== derived.length || claimed.some((sha, index) => sha !== derived[index])) {
    return { error: 'implementation commits do not match the git-derived base..HEAD range' };
  }
  return derived;
}

export function listOrderedImplementationCommits(
  repoRoot: string,
  baselineCommit: string,
  headCommit: string,
  git?: GitCommandRunner
): string[] | { error: string } {
  const baseline = resolveCommitObject(repoRoot, baselineCommit, git);
  const head = resolveCommitObject(repoRoot, headCommit, git);
  if (!baseline) return { error: 'source baseline does not exist as a git commit object' };
  if (!head) return { error: 'source HEAD does not exist as a git commit object' };
  const result = runGit(repoRoot, ['rev-list', '--reverse', `${baseline}..${head}`], git);
  if (result.status !== 0 || result.error) {
    return { error: result.error ?? 'unable to derive source implementation commits from git' };
  }
  const commits = result.stdout ? result.stdout.split(/\n/u).filter(Boolean) : [];
  if (commits.length === 0) return [];
  return requireOrderedCommitObjects(repoRoot, commits, git);
}

const GIT_BINARY_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function gitSpawnBuffer(repoRoot: string, args: string[]): { status: number; stdout: Buffer; error?: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    error: result.error?.message,
  };
}

const GIT_CAT_FILE_BATCH_CHUNK = 16;

function parseLsTreeEntries(stdout: Buffer): Array<{ sha: string; path: string }> {
  const entries: Array<{ sha: string; path: string }> = [];
  let offset = 0;
  while (offset < stdout.length) {
    const nul = stdout.indexOf(0, offset);
    const end = nul === -1 ? stdout.length : nul;
    const record = stdout.subarray(offset, end).toString('utf8');
    offset = nul === -1 ? stdout.length : nul + 1;
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const meta = record.slice(0, tab);
    const relative = record.slice(tab + 1).replace(/\\/g, '/');
    const parts = meta.split(' ');
    const sha = parts[2];
    const type = parts[1];
    if (type !== 'blob' || !sha || !relative || isWorkflowAutomationPath(relative)) continue;
    entries.push({ sha, path: relative });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function parseCatFileBatch(stdout: Buffer, expectedCount: number): Buffer[] | { error: string } {
  const blobs: Buffer[] = [];
  let offset = 0;
  while (blobs.length < expectedCount) {
    const nl = stdout.indexOf(0x0a, offset);
    if (nl === -1) return { error: 'truncated git cat-file batch header' };
    const header = stdout.subarray(offset, nl).toString('utf8');
    const parts = header.split(' ');
    if (parts[1] === 'missing' || parts.length < 3) {
      return { error: `git object missing from cat-file batch: ${header}` };
    }
    const size = Number(parts[2]);
    if (!Number.isInteger(size) || size < 0) return { error: `invalid git cat-file size: ${header}` };
    const start = nl + 1;
    const end = start + size;
    if (end > stdout.length) return { error: 'truncated git cat-file batch content' };
    blobs.push(stdout.subarray(start, end));
    if (end < stdout.length && stdout[end] === 0x0a) {
      offset = end + 1;
    } else if (end === stdout.length && blobs.length === expectedCount) {
      offset = end;
    } else {
      return { error: 'git cat-file batch framing mismatch' };
    }
  }
  return blobs;
}

function gitCatFileBatch(repoRoot: string, shas: string[]): Buffer[] | { error: string } {
  if (shas.length === 0) return [];
  const dir = mkdtempSync(path.join(tmpdir(), 'tee-git-batch-'));
  const listPath = path.join(dir, 'shas.txt');
  writeFileSync(listPath, `${shas.join('\n')}\n`);
  let fd: number | undefined;
  try {
    fd = openSync(listPath, 'r');
    const result = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
      shell: false,
      windowsHide: true,
      stdio: [fd, 'pipe', 'pipe'],
    });
    if ((result.status ?? 1) !== 0) {
      return { error: result.error?.message ?? 'git cat-file --batch failed' };
    }
    return parseCatFileBatch(result.stdout ?? Buffer.alloc(0), shas.length);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(listPath);
    } catch {
      /* ignore */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function hashProductTreeAt(
  repoRoot: string,
  treeish: string
): string | { error: string } {
  const listed = gitSpawnBuffer(repoRoot, ['ls-tree', '-r', '-z', treeish]);
  if (listed.status !== 0) {
    return { error: listed.error ?? 'unable to list git tree for fingerprint' };
  }
  const files = parseLsTreeEntries(listed.stdout);
  const hash = createHash('sha256');
  for (let index = 0; index < files.length; index += GIT_CAT_FILE_BATCH_CHUNK) {
    const chunk = files.slice(index, index + GIT_CAT_FILE_BATCH_CHUNK);
    const blobs = gitCatFileBatch(
      repoRoot,
      chunk.map((entry) => entry.sha)
    );
    if ('error' in blobs) return blobs;
    for (let blobIndex = 0; blobIndex < chunk.length; blobIndex += 1) {
      hash.update(chunk[blobIndex].path);
      hash.update('\0');
      hash.update(blobs[blobIndex]);
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

export function computeGitProductTreeFingerprint(
  repoRoot: string,
  commitSha: string
): string | { error: string } {
  // Hash git blob bytes, not the checked-out working tree, so CRLF/smudge
  // checkout differences cannot substitute for object identity.
  const commit = resolveCommitObject(repoRoot, commitSha);
  if (!commit) return { error: 'fingerprint commit does not exist as a git commit object' };
  return hashProductTreeAt(repoRoot, commit);
}

function computeIndexProductTreeFingerprint(repoRoot: string): string | { error: string } {
  const written = spawnSync('git', ['write-tree'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  const tree = (written.stdout ?? '').trim();
  if (written.status !== 0 || !tree) {
    return { error: written.stderr?.toString() || 'unable to write successor index tree for fingerprint' };
  }
  return hashProductTreeAt(repoRoot, tree);
}

export function computeWorkingTreeProductFingerprint(
  repoRoot: string,
  git?: GitCommandRunner
): string | { error: string } {
  const headCommit = gitHeadCommit(repoRoot, git);
  if (!headCommit) {
    return { error: 'unable to read git HEAD for working-tree fingerprint' };
  }
  const base = computeGitProductTreeFingerprint(repoRoot, headCommit);
  if (typeof base === 'object') return base;

  const cached = spawnSync('git', ['diff', '--cached', '--name-only', '-z', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
  });
  const unstaged = spawnSync('git', ['diff', '--name-only', '-z', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
  });
  const others = runGit(repoRoot, ['ls-files', '-z', '--others', '--exclude-standard'], git);
  if (
    others.status !== 0 ||
    others.error ||
    (cached.status !== 0 && cached.status !== 1) ||
    (unstaged.status !== 0 && unstaged.status !== 1)
  ) {
    return {
      error:
        others.error ??
        'unable to list successor index/working tree for fingerprint',
    };
  }

  const dirty = [
    ...normalizeNulNames(cached.stdout ?? ''),
    ...normalizeNulNames(unstaged.stdout ?? ''),
    ...normalizeNulNames(others.stdout),
  ].filter((relative) => relative && !isWorkflowAutomationPath(relative));
  if (dirty.length === 0) {
    return base;
  }

  const hash = createHash('sha256');
  hash.update(base);
  hash.update('\n');
  for (const relative of [...new Set(dirty)].sort()) {
    hash.update(relative);
    hash.update('\0');
    const absolute = path.join(repoRoot, relative);
    if (existsSync(absolute)) {
      hash.update(readFileSync(absolute));
    } else {
      hash.update('missing');
    }
    hash.update('\0');
  }
  hash.update('cached-names:');
  hash.update(cached.stdout ?? '');
  return hash.digest('hex');
}

function normalizeNulNames(output: string): string[] {
  return output
    .split('\0')
    .map((entry) => entry.replace(/\\/g, '/').trim())
    .filter(Boolean);
}

export function computeGitPatchSha256(
  repoRoot: string,
  fromCommit: string,
  toCommit: string
): string | { error: string } {
  const from = resolveCommitObject(repoRoot, fromCommit);
  const to = resolveCommitObject(repoRoot, toCommit);
  if (!from) return { error: 'source baseline does not exist as a git commit object' };
  if (!to) return { error: 'source HEAD does not exist as a git commit object' };
  const result = spawnSync(
    'git',
    [
      'diff',
      '--binary',
      '--no-ext-diff',
      from,
      to,
      '--',
      '.',
      ':(exclude)docs_private/automation',
      ':(exclude)docs_private/automation/**',
    ],
    {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
      shell: false,
      windowsHide: true,
    }
  );
  if ((result.status ?? 1) !== 0 && result.status !== 1) {
    return { error: 'unable to derive source patch from git' };
  }
  return createHash('sha256')
    .update(result.stdout ?? Buffer.alloc(0))
    .digest('hex');
}

function gitParentCount(repoRoot: string, sha: string): number {
  const result = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', sha]);
  if (result.status !== 0 || !result.stdout) return 0;
  return Math.max(0, result.stdout.split(/\s+/u).length - 1);
}

function gitDiffText(repoRoot: string, a: string, b: string): string | null {
  const result = spawnSync('git', ['diff', '--no-ext-diff', '--text', a, b], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0 && result.status !== 1) return null;
  return result.stdout ?? '';
}

export function revertInvertsImplementation(
  repoRoot: string,
  implementationCommit: string,
  revertCommit: string
): boolean {
  if (!gitCommitExists(repoRoot, implementationCommit) || !gitCommitExists(repoRoot, revertCommit)) {
    return false;
  }
  if (gitParentCount(repoRoot, implementationCommit) !== 1) return false;
  if (gitParentCount(repoRoot, revertCommit) !== 1) return false;
  const forward = gitDiffText(repoRoot, `${implementationCommit}^`, implementationCommit);
  const undone = gitDiffText(repoRoot, revertCommit, `${revertCommit}^`);
  return Boolean(forward && undone && forward === undone);
}

export function revertInvertsImplementationRange(
  repoRoot: string,
  fromCommit: string,
  toCommit: string,
  revertCommit: string
): boolean {
  if (
    !gitCommitExists(repoRoot, fromCommit) ||
    !gitCommitExists(repoRoot, toCommit) ||
    !gitCommitExists(repoRoot, revertCommit)
  ) {
    return false;
  }
  if (gitParentCount(repoRoot, revertCommit) !== 1) return false;
  const forward = gitDiffText(repoRoot, fromCommit, toCommit);
  const undone = gitDiffText(repoRoot, revertCommit, `${revertCommit}^`);
  if (forward && undone && forward === undone) return true;
  const baseFingerprint = computeGitProductTreeFingerprint(repoRoot, fromCommit);
  const revertFingerprint = computeGitProductTreeFingerprint(repoRoot, revertCommit);
  return (
    typeof baseFingerprint === 'string' &&
    typeof revertFingerprint === 'string' &&
    baseFingerprint === revertFingerprint
  );
}

function routeEvidenceHashPayload(params: {
  target: WorkflowRouteDispositionTarget;
  baseline: string;
  releaseHead: string;
  implementationCommits: string[];
  latestLegalReviewCandidateHead?: string;
  revertCommit?: string | null;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
}): unknown {
  if (params.target === 'removed_from_release') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
    };
  }
  if (params.target === 'reverted') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
      revertCommit: params.revertCommit,
    };
  }
  if (params.target === 'superseded') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
      supersedeCommit: params.supersedeCommit,
      revertCommit: params.revertCommit ?? null,
    };
  }
  return {
    canonVersion: REHOME_EVIDENCE_CANON_VERSION,
    target: params.target,
    baseline: params.baseline,
    releaseHead: params.releaseHead,
    implementationCommits: params.implementationCommits,
    latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
    successorRepo: params.successorRepo,
    successorBranch: params.successorBranch,
    successorBaseline: params.successorBaseline,
    predecessorHead: params.predecessorHead,
  };
}

export function computeRouteEvidenceHash(params: Parameters<typeof routeEvidenceHashPayload>[0]): string {
  const payload = routeEvidenceHashPayload(params);
  if (params.target === 'rehomed') {
    return hashCanonicalEvidence(payload);
  }
  return hashLegacyEvidence(payload);
}

function readForeignLineageBudget(
  repoRoot: string,
  workstreamId: string
): { failedPremiumReviewCount: number; inheritedFailedReviewCount: number } | null {
  const protocolPath = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'protocol.json'
  );
  if (!existsSync(protocolPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(protocolPath, 'utf8')) as Partial<WorkflowProtocolRecord>;
    if (
      typeof parsed.failedPremiumReviewCount !== 'number' ||
      typeof parsed.inheritedFailedReviewCount !== 'number'
    ) {
      return null;
    }
    return {
      failedPremiumReviewCount: parsed.failedPremiumReviewCount,
      inheritedFailedReviewCount: parsed.inheritedFailedReviewCount,
    };
  } catch {
    return null;
  }
}

export function provePredecessorExhaustion(params: {
  predecessorReleaseContext: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
}): { ok: true } | { ok: false; message: string } {
  const context = parsePredecessorReleaseContext(params.predecessorReleaseContext);
  if (!context.ok) return context;
  const repo = resolveCanonicalExistingPath(context.repoPath);
  if (!repo.ok) {
    return { ok: false, message: `predecessor release context is not a readable Git repo: ${repo.message}` };
  }
  if (!gitCommitExists(repo.canonical, params.predecessorHeadCommit)) {
    return { ok: false, message: 'predecessor HEAD does not exist in the predecessor release context' };
  }
  const descendant = readForeignLineageBudget(repo.canonical, params.predecessorDescendantWorkstreamId);
  if (!descendant) {
    return {
      ok: false,
      message:
        'predecessor descendant protocol is missing; new ID or path labels cannot prove exhaustion',
    };
  }
  if (lineageFailedPremiumReviewCount(descendant) < 2) {
    return { ok: false, message: 'predecessor lineage is not review-exhausted' };
  }
  return { ok: true };
}

export function planRequiresBoundRehome(record: WorkflowProtocolRecord): boolean {
  return Boolean(record.rehomeProvenance);
}

export function buildBoundRehomeProvenance(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
  declared: WorkflowRehomeProvenance;
  predecessorRootWorkstreamId: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
  predecessorReleaseContext: string;
  successorBaselineCommit: string;
  successorBranchName: string;
  sourcePatchSha256: string;
  sourceProductTreeFingerprint: string;
  sourceReleaseContext: string;
  sourceHeadCommit: string;
  sourceBaselineCommit: string;
  sourceReviewWorkstreamId?: string;
  nowIso: string;
}): { ok: true; provenance: WorkflowRehomeProvenance } | { ok: false; message: string } {
  if ((params.record.sourceWorkstreamIds ?? []).length > 0) {
    return { ok: false, message: 'split child cannot qualify as an independent re-home successor' };
  }
  const currentHead = gitHeadCommit(params.repoRoot);
  const currentBranch = gitBranchName(params.repoRoot);
  if (!currentHead || !currentBranch) {
    return { ok: false, message: 'rehome-bind requires a named branch and readable HEAD' };
  }
  if (currentBranch !== params.successorBranchName || currentBranch !== params.declared.successorBranchName) {
    return {
      ok: false,
      message: `successor branch ${currentBranch} does not match declared ${params.declared.successorBranchName}`,
    };
  }
  if (params.successorBaselineCommit !== params.declared.successorBaselineCommit) {
    return { ok: false, message: 'successor baseline does not match declared re-home baseline' };
  }
  if (!resolveCommitObject(params.repoRoot, params.successorBaselineCommit)) {
    return { ok: false, message: 'successor baseline does not exist as a git commit object' };
  }
  const successorBaselineOk = requireCommitAncestor(
    params.repoRoot,
    params.successorBaselineCommit,
    currentHead,
    'successor baseline is not an ancestor of current HEAD'
  );
  if (!successorBaselineOk.ok) return successorBaselineOk;
  if (params.predecessorHeadCommit !== params.declared.predecessorHeadCommit) {
    return { ok: false, message: 'predecessor HEAD does not match declared provenance' };
  }
  if (params.predecessorRootWorkstreamId !== params.declared.predecessorRootWorkstreamId) {
    return { ok: false, message: 'predecessor root does not match declared provenance' };
  }
  if (params.predecessorDescendantWorkstreamId !== params.declared.predecessorDescendantWorkstreamId) {
    return { ok: false, message: 'predecessor descendant does not match declared provenance' };
  }
  if (params.predecessorReleaseContext !== params.declared.predecessorReleaseContext) {
    return { ok: false, message: 'predecessor release context does not match declared provenance' };
  }
  if (
    params.declared.sourceReleaseContext &&
    params.sourceReleaseContext !== params.declared.sourceReleaseContext
  ) {
    return { ok: false, message: 'source release context does not match declared provenance' };
  }
  if (params.declared.sourceHeadCommit && params.sourceHeadCommit !== params.declared.sourceHeadCommit) {
    return { ok: false, message: 'source HEAD does not match declared provenance' };
  }
  if (
    params.declared.sourceBaselineCommit &&
    params.sourceBaselineCommit !== params.declared.sourceBaselineCommit
  ) {
    return { ok: false, message: 'source baseline does not match declared provenance' };
  }
  const sourceReviewWorkstreamId = params.declared.sourceReviewWorkstreamId?.trim() || '';
  if (!sourceReviewWorkstreamId) {
    return {
      ok: false,
      message: 'rehome-bind requires plan-bound sourceReviewWorkstreamId',
    };
  }
  if (
    params.sourceReviewWorkstreamId &&
    params.sourceReviewWorkstreamId.trim() !== sourceReviewWorkstreamId
  ) {
    return { ok: false, message: 'sourceReviewWorkstreamId does not match declared provenance' };
  }

  const predecessorContext = parsePredecessorReleaseContext(params.predecessorReleaseContext);
  if (!predecessorContext.ok) return predecessorContext;
  const predecessorRepo = resolveCanonicalExistingPath(predecessorContext.repoPath);
  if (!predecessorRepo.ok) {
    return {
      ok: false,
      message: `predecessor release context is not a readable Git repo: ${predecessorRepo.message}`,
    };
  }
  const predecessorResolved = resolveBranchCommit(
    predecessorRepo.canonical,
    predecessorContext.branchName
  );
  if (!predecessorResolved.ok) return predecessorResolved;
  if (predecessorResolved.sha !== params.predecessorHeadCommit) {
    return {
      ok: false,
      message: `predecessor branch ${predecessorContext.branchName} resolves to ${predecessorResolved.sha}, not ${params.predecessorHeadCommit}`,
    };
  }
  if (!resolveCommitObject(predecessorRepo.canonical, params.predecessorHeadCommit)) {
    return { ok: false, message: 'predecessor HEAD does not exist as a git commit object' };
  }
  const importedPredecessor = importCommitObjectForIsolation({
    repoRoot: params.repoRoot,
    sha: params.predecessorHeadCommit,
    sourceRepoRoot: predecessorRepo.canonical,
  });
  if (!importedPredecessor.ok) return importedPredecessor;
  const predecessorIsolated = requireCommitNotAncestor(
    params.repoRoot,
    importedPredecessor.sha,
    currentHead,
    'predecessor HEAD is an ancestor of the successor; independent Git context required'
  );
  if (!predecessorIsolated.ok) return predecessorIsolated;

  const sourceContext = parsePredecessorReleaseContext(params.sourceReleaseContext);
  if (!sourceContext.ok) {
    return { ok: false, message: 'sourceReleaseContext must be path#branch' };
  }
  const sourceRepo = resolveCanonicalExistingPath(sourceContext.repoPath);
  if (!sourceRepo.ok) {
    return { ok: false, message: `source release context is not a readable Git repo: ${sourceRepo.message}` };
  }
  const sourceResolved = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolved.ok) {
    return { ok: false, message: `source branch does not exist: ${sourceContext.branchName}` };
  }
  const sourceProtocol = readForeignProtocolRecord(sourceRepo.canonical, sourceReviewWorkstreamId);
  if (!sourceProtocol) {
    return {
      ok: false,
      message: `source review protocol ${sourceReviewWorkstreamId} is missing or unreadable`,
    };
  }
  const candidate = resolveLatestLegalReviewCandidateHead(sourceRepo.canonical, sourceProtocol);
  if (!candidate.ok) return candidate;
  if (params.sourceHeadCommit !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source HEAD does not match the latest legal review-attempt candidate; operator cannot nominate a different HEAD',
    };
  }
  if (sourceResolved.sha !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source branch HEAD has drifted from the latest legal review candidate; refuse to enlarge the sourced range',
    };
  }
  const sourceResolvedAgain = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolvedAgain.ok) return sourceResolvedAgain;
  if (sourceResolvedAgain.sha !== sourceResolved.sha) {
    return { ok: false, message: 'source branch HEAD moved during rehome-bind' };
  }
  if (!resolveCommitObject(sourceRepo.canonical, params.sourceBaselineCommit)) {
    return { ok: false, message: 'source baseline does not exist as a git commit object' };
  }
  if (params.sourceBaselineCommit !== sourceProtocol.baseCommit) {
    return { ok: false, message: 'source baseline does not match the source protocol baseCommit' };
  }
  const sourceOwned = requireCommitAncestor(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    candidate.headCommit,
    'source baseline is not an ancestor of source HEAD'
  );
  if (!sourceOwned.ok) return sourceOwned;

  const implementationCommits = listOrderedImplementationCommits(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    candidate.headCommit
  );
  if (typeof implementationCommits === 'object' && 'error' in implementationCommits) {
    return { ok: false, message: implementationCommits.error };
  }
  if (implementationCommits.length === 0) {
    return { ok: false, message: 'source implementation commit range is empty' };
  }

  const patchSha = computeGitPatchSha256(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    params.sourceHeadCommit
  );
  if (typeof patchSha === 'object') return { ok: false, message: patchSha.error };
  const sourceFingerprint = computeGitProductTreeFingerprint(
    sourceRepo.canonical,
    params.sourceHeadCommit
  );
  if (typeof sourceFingerprint === 'object') return { ok: false, message: sourceFingerprint.error };
  if (!SHA256_RE.test(params.sourcePatchSha256) || !SHA256_RE.test(params.declared.sourcePatchSha256)) {
    return { ok: false, message: 'source patch hash must be a sha256 hex digest' };
  }
  if (
    !SHA256_RE.test(params.sourceProductTreeFingerprint) ||
    !SHA256_RE.test(params.declared.sourceProductTreeFingerprint)
  ) {
    return { ok: false, message: 'source fingerprint must be a sha256 hex digest' };
  }
  if (params.sourcePatchSha256 !== params.declared.sourcePatchSha256) {
    return { ok: false, message: 'source patch hash does not match declared provenance' };
  }
  if (params.sourceProductTreeFingerprint !== params.declared.sourceProductTreeFingerprint) {
    return { ok: false, message: 'source fingerprint does not match declared provenance' };
  }
  if (patchSha !== params.sourcePatchSha256) {
    return { ok: false, message: 'source patch hash does not match git-derived patch evidence' };
  }
  if (sourceFingerprint !== params.sourceProductTreeFingerprint) {
    return { ok: false, message: 'source fingerprint does not match git-derived tree evidence' };
  }

  const extraSuccessorCommits = listOrderedImplementationCommits(
    params.repoRoot,
    params.successorBaselineCommit,
    currentHead
  );
  if (typeof extraSuccessorCommits === 'object' && 'error' in extraSuccessorCommits) {
    return { ok: false, message: extraSuccessorCommits.error };
  }
  const successorFingerprint =
    extraSuccessorCommits.length === 0
      ? computeIndexProductTreeFingerprint(params.repoRoot)
      : computeGitProductTreeFingerprint(params.repoRoot, currentHead);
  if (typeof successorFingerprint === 'object') {
    return { ok: false, message: successorFingerprint.error };
  }
  if (successorFingerprint !== sourceFingerprint) {
    return {
      ok: false,
      message: 'successor product tree does not match source fingerprint',
    };
  }

  const exhaustion = provePredecessorExhaustion({
    predecessorReleaseContext: params.predecessorReleaseContext,
    predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
    predecessorHeadCommit: params.predecessorHeadCommit,
  });
  if (!exhaustion.ok) return exhaustion;
  const worktree = resolveCanonicalExistingPath(params.repoRoot);
  if (!worktree.ok) return worktree;

  const evidenceBody = {
    canonVersion: REHOME_EVIDENCE_CANON_VERSION,
    currentHead,
    currentBranch,
    successorBaseline: params.successorBaselineCommit,
    successorBranchName: currentBranch,
    predecessorHead: importedPredecessor.sha,
    predecessorBranchResolvedSha: predecessorResolved.sha,
    predecessorRootWorkstreamId: params.predecessorRootWorkstreamId,
    predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
    sourceHeadCommit: candidate.headCommit,
    sourceBaselineCommit: params.sourceBaselineCommit,
    sourceBranchName: sourceContext.branchName,
    sourceReleaseContext: params.sourceReleaseContext,
    sourceReviewWorkstreamId,
    sourcePatchSha256: patchSha,
    sourceProductTreeFingerprint: sourceFingerprint,
    implementationCommits,
    latestLegalReviewCandidateHead: candidate.headCommit,
    mergeBaseCheck: 'predecessor_head_not_ancestor' as const,
    isolationDecision: 'predecessor_head_not_ancestor' as const,
    predecessorHeadIsAncestor: false as const,
    predecessorExhausted: true as const,
  };
  const sourceResolvedPersist = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolvedPersist.ok) return sourceResolvedPersist;
  if (sourceResolvedPersist.sha !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source branch HEAD moved before rehome evidence persistence; refuse to enlarge the sourced range',
    };
  }
  const provenance: WorkflowRehomeProvenance = {
    ...params.declared,
    status: 'bound',
    predecessorHeadIsAncestor: false,
    predecessorPassedReview: false,
    successorWorktreeCanonicalPath: worktree.canonical,
    sourceReleaseContext: params.sourceReleaseContext,
    sourceHeadCommit: candidate.headCommit,
    sourceBaselineCommit: params.sourceBaselineCommit,
    sourceReviewWorkstreamId,
    sourceImplementationCommits: implementationCommits,
    predecessorBranchResolvedSha: predecessorResolved.sha,
    sourcePatchSha256: patchSha,
    sourceProductTreeFingerprint: sourceFingerprint,
    boundAt: params.nowIso,
    evidence: {
      ...evidenceBody,
      evidenceHash: '',
    },
  };
  provenance.evidence!.evidenceHash = hashBoundRehomeSecurityObject(provenance);
  return {
    ok: true,
    provenance,
  };
}

export function buildRouteDisposition(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
  target: WorkflowRouteDispositionTarget;
  reason: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  nowIso: string;
  allowIsolationImport?: boolean;
}): { ok: true; disposition: WorkflowRouteDisposition } | { ok: false; message: string } {
  if (params.record.phase !== 'routing_required') {
    return { ok: false, message: `route requires routing_required (have ${params.record.phase})` };
  }
  if (lineageBudgetExhausted(params.record) === false) {
    return { ok: false, message: 'route is only valid after premium review budget exhaustion' };
  }
  const reason = params.reason.trim();
  if (!reason) return { ok: false, message: 'route requires a reason' };

  const releaseHead = gitHeadCommit(params.repoRoot);
  if (!releaseHead) return { ok: false, message: 'unable to read release HEAD for route evidence' };
  const candidate = resolveLatestLegalReviewCandidateHead(params.repoRoot, params.record);
  if (!candidate.ok) return candidate;
  const drift = rejectUnreviewedHeadDrift(params.repoRoot, candidate.headCommit, releaseHead);
  // Extra commits after the candidate are expected for revert/supersede/remove.
  // Git-list failures still fail closed for every target.
  if (!drift.ok && (drift.kind === 'git-error' || params.target === 'rehomed')) {
    return drift;
  }
  const implementationCommits = requireGitDerivedImplementationCommits({
    repoRoot: params.repoRoot,
    baselineCommit: params.record.baseCommit,
    headCommit: candidate.headCommit,
    claimed: params.implementationCommits,
  });
  if (typeof implementationCommits === 'object' && 'error' in implementationCommits) {
    return { ok: false, message: implementationCommits.error };
  }
  const baseline = params.record.baseCommit;

  let gitEvidence: WorkflowRouteGitEvidence;
  if (params.target === 'removed_from_release') {
    const stillPresent = filterAncestorCommits(params.repoRoot, implementationCommits, releaseHead);
    if (!stillPresent.ok) return stillPresent;
    if (stillPresent.ancestors.length > 0) {
      return {
        ok: false,
        message: `implementation still present in release history: ${stillPresent.ancestors.join(', ')}`,
      };
    }
    gitEvidence = {
      kind: 'absent_from_release_range',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
      }),
    };
  } else if (params.target === 'reverted') {
    const revertCommit = requireResolvedCommit(params.repoRoot, params.revertCommit, 'revertCommit');
    if (typeof revertCommit === 'object') return { ok: false, message: revertCommit.error };
    const revertInHistory = requireCommitAncestor(
      params.repoRoot,
      revertCommit,
      releaseHead,
      'revert commit is not in the current release history'
    );
    if (!revertInHistory.ok) return revertInHistory;
    const rangeInverted = revertInvertsImplementationRange(
      params.repoRoot,
      baseline,
      candidate.headCommit,
      revertCommit
    );
    const notInverted = implementationCommits.filter(
      (commit) => !revertInvertsImplementation(params.repoRoot, commit, revertCommit)
    );
    if (!rangeInverted && notInverted.length > 0) {
      return {
        ok: false,
        message: `revert commit does not invert implementation: ${notInverted.join(', ')}`,
      };
    }
    gitEvidence = {
      kind: 'full_revert',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      revertCommit,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        revertCommit,
      }),
    };
  } else if (params.target === 'superseded') {
    const supersedeCommit = requireResolvedCommit(
      params.repoRoot,
      params.supersedeCommit,
      'supersedeCommit'
    );
    if (typeof supersedeCommit === 'object') return { ok: false, message: supersedeCommit.error };
    const supersedeInHistory = requireCommitAncestor(
      params.repoRoot,
      supersedeCommit,
      releaseHead,
      'supersede commit is not in the current release history'
    );
    if (!supersedeInHistory.ok) return supersedeInHistory;
    if (implementationCommits.includes(supersedeCommit)) {
      return { ok: false, message: 'supersede commit cannot be one of the failed implementation commits' };
    }
    const stillIndependent = filterAncestorCommits(params.repoRoot, implementationCommits, releaseHead);
    if (!stillIndependent.ok) return stillIndependent;
    if (stillIndependent.ancestors.length > 0) {
      const revertCommit = requireResolvedCommit(params.repoRoot, params.revertCommit, 'revertCommit');
      if (typeof revertCommit === 'object') {
        return {
          ok: false,
          message:
            'safe supersede requires Git proof the failed implementation is no longer independently shipped',
        };
      }
      const rangeInverted = revertInvertsImplementationRange(
        params.repoRoot,
        baseline,
        candidate.headCommit,
        revertCommit
      );
      const notInverted = stillIndependent.ancestors.filter(
        (commit) => !revertInvertsImplementation(params.repoRoot, commit, revertCommit)
      );
      if (!rangeInverted && notInverted.length > 0) {
        return {
          ok: false,
          message: `supersede revert does not invert remaining implementation: ${notInverted.join(', ')}`,
        };
      }
    }
    gitEvidence = {
      kind: 'safe_supersede',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      supersedeCommit,
      revertCommit: params.revertCommit,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        supersedeCommit,
        revertCommit: params.revertCommit ?? null,
      }),
    };
  } else {
    if (!params.successorRepo || !params.successorBranch) {
      return { ok: false, message: 'rehome route requires successor repo, branch, and baseline' };
    }
    const successorRepo = resolveCanonicalExistingPath(params.successorRepo);
    if (!successorRepo.ok) return successorRepo;
    const predecessorHead = requireResolvedCommit(
      params.repoRoot,
      params.predecessorHead,
      'predecessorHead'
    );
    const successorBaseline = requireResolvedCommit(
      successorRepo.canonical,
      params.successorBaseline,
      'successorBaseline'
    );
    if (typeof predecessorHead === 'object') return { ok: false, message: predecessorHead.error };
    if (typeof successorBaseline === 'object') return { ok: false, message: successorBaseline.error };
    if (predecessorHead !== candidate.headCommit) {
      return {
        ok: false,
        message: 'predecessorHead must equal the latest legal review candidate HEAD',
      };
    }
    if (!BRANCH_RE.test(params.successorBranch)) {
      return { ok: false, message: 'successor branch name is invalid' };
    }
    const successorHead = gitHeadCommit(successorRepo.canonical);
    const successorBranch = gitBranchName(successorRepo.canonical);
    if (!successorHead || !successorBranch) {
      return { ok: false, message: 'unable to read successor HEAD/branch' };
    }
    if (successorBranch !== params.successorBranch) {
      return {
        ok: false,
        message: `successor worktree is on ${successorBranch}, not ${params.successorBranch}`,
      };
    }
    const successorOwned = requireCommitAncestor(
      successorRepo.canonical,
      successorBaseline,
      successorHead,
      'successor baseline is not an ancestor of successor HEAD'
    );
    if (!successorOwned.ok) return successorOwned;
    const importedPredecessor = importCommitObjectForIsolation({
      repoRoot: successorRepo.canonical,
      sha: predecessorHead,
      sourceRepoRoot: params.repoRoot,
      allowIsolationImport: params.allowIsolationImport,
    });
    if (!importedPredecessor.ok) return importedPredecessor;
    const successorIsolated = requireCommitNotAncestor(
      successorRepo.canonical,
      importedPredecessor.sha,
      successorHead,
      'successor ancestry contains the blocked predecessor HEAD'
    );
    if (!successorIsolated.ok) return successorIsolated;
    gitEvidence = {
      kind: 'isolated_successor',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      successorBranch: params.successorBranch,
      successorBaseline,
      successorRepoCanonicalPath: successorRepo.canonical,
      predecessorHead: importedPredecessor.sha,
      predecessorHeadIsAncestor: false,
      latestLegalReviewCandidateHead: candidate.headCommit,
      canonVersion: REHOME_EVIDENCE_CANON_VERSION,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        successorRepo: successorRepo.canonical,
        successorBranch: params.successorBranch,
        successorBaseline,
        predecessorHead: importedPredecessor.sha,
      }),
    };
  }

  return {
    ok: true,
    disposition: {
      schemaVersion: '1',
      command: 'route',
      recordedAt: params.nowIso,
      target: params.target,
      reason,
      gitEvidence,
    },
  };
}

export function revalidateRouteDisposition(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
}): { ok: true } | { ok: false; message: string } {
  const disposition = params.record.routeDisposition;
  if (!disposition || disposition.schemaVersion !== '1') {
    return { ok: false, message: 'non-release disposition is missing or unrecognised' };
  }
  if (!disposition.gitEvidence?.evidenceHash || !disposition.gitEvidence.kind) {
    return { ok: false, message: 'disposition Git evidence is incomplete' };
  }
  if (
    disposition.target === 'rehomed' &&
    disposition.gitEvidence.canonVersion !== REHOME_EVIDENCE_CANON_VERSION
  ) {
    return { ok: false, message: 'rehome disposition evidence is incomplete or unversioned' };
  }
  if (
    disposition.target === 'rehomed' &&
    (!disposition.gitEvidence.implementationCommits ||
      disposition.gitEvidence.implementationCommits.length === 0)
  ) {
    return { ok: false, message: 'rehome disposition omits implementation commit evidence' };
  }
  const expectedHash = computeRouteEvidenceHash({
    target: disposition.target,
    baseline: disposition.gitEvidence.baselineCommit,
    releaseHead: disposition.gitEvidence.releaseHeadCommit,
    implementationCommits: disposition.gitEvidence.implementationCommits,
    latestLegalReviewCandidateHead: disposition.gitEvidence.latestLegalReviewCandidateHead,
    revertCommit: disposition.gitEvidence.revertCommit,
    supersedeCommit: disposition.gitEvidence.supersedeCommit,
    successorRepo: disposition.gitEvidence.successorRepoCanonicalPath,
    successorBranch: disposition.gitEvidence.successorBranch,
    successorBaseline: disposition.gitEvidence.successorBaseline,
    predecessorHead: disposition.gitEvidence.predecessorHead,
  });
  if (expectedHash !== disposition.gitEvidence.evidenceHash) {
    return { ok: false, message: 'disposition evidence hash does not match recorded Git evidence' };
  }
  const rebuilt = buildRouteDisposition({
    repoRoot: params.repoRoot,
    record: { ...params.record, phase: 'routing_required' },
    target: disposition.target,
    reason: disposition.reason,
    implementationCommits: disposition.gitEvidence.implementationCommits,
    revertCommit: disposition.gitEvidence.revertCommit,
    supersedeCommit: disposition.gitEvidence.supersedeCommit,
    successorRepo: disposition.gitEvidence.successorRepoCanonicalPath,
    successorBranch: disposition.gitEvidence.successorBranch,
    successorBaseline: disposition.gitEvidence.successorBaseline,
    predecessorHead: disposition.gitEvidence.predecessorHead,
    nowIso: disposition.recordedAt,
    allowIsolationImport: false,
  });
  if (!rebuilt.ok) {
    return { ok: false, message: `disposition no longer holds: ${rebuilt.message}` };
  }
  if (
    rebuilt.disposition.gitEvidence.latestLegalReviewCandidateHead !==
    disposition.gitEvidence.latestLegalReviewCandidateHead
  ) {
    return {
      ok: false,
      message: 'latest legal review candidate HEAD does not match git-derived evidence',
    };
  }
  const releaseHead = gitHeadCommit(params.repoRoot);
  if (!releaseHead) return { ok: false, message: 'unable to revalidate disposition HEAD' };
  if (disposition.target === 'rehomed') {
    const stillPresent = filterAncestorCommits(
      params.repoRoot,
      disposition.gitEvidence.implementationCommits ?? [],
      releaseHead
    );
    if (!stillPresent.ok) return stillPresent;
    if (stillPresent.ancestors.length > 0) {
      return {
        ok: false,
        message:
          'rehomed does not unblock a release context that still contains the failed implementation',
      };
    }
  }
  return { ok: true };
}

export function canonicalBoundRehomeSecurityBody(
  provenance: WorkflowRehomeProvenance
): Record<string, unknown> {
  const evidence = provenance.evidence;
  const sourceContext = provenance.sourceReleaseContext
    ? parsePredecessorReleaseContext(provenance.sourceReleaseContext)
    : null;
  return {
    schemaVersion: provenance.schemaVersion,
    canonVersion: evidence?.canonVersion,
    status: provenance.status,
    predecessorRootWorkstreamId: provenance.predecessorRootWorkstreamId,
    predecessorDescendantWorkstreamId: provenance.predecessorDescendantWorkstreamId,
    sourceReviewWorkstreamId:
      provenance.sourceReviewWorkstreamId ?? evidence?.sourceReviewWorkstreamId,
    predecessorHeadCommit: provenance.predecessorHeadCommit,
    predecessorReleaseContext: provenance.predecessorReleaseContext,
    predecessorBranchResolvedSha: provenance.predecessorBranchResolvedSha,
    successorBranchName: provenance.successorBranchName,
    successorBaselineCommit: provenance.successorBaselineCommit,
    successorWorktreeCanonicalPath: provenance.successorWorktreeCanonicalPath,
    sourceReleaseContext: provenance.sourceReleaseContext,
    sourceBranchName:
      evidence?.sourceBranchName ??
      (sourceContext && sourceContext.ok ? sourceContext.branchName : undefined),
    sourceHeadCommit: provenance.sourceHeadCommit,
    sourceBaselineCommit: provenance.sourceBaselineCommit,
    sourceImplementationCommits: provenance.sourceImplementationCommits,
    sourcePatchSha256: provenance.sourcePatchSha256,
    sourceProductTreeFingerprint: provenance.sourceProductTreeFingerprint,
    predecessorHeadIsAncestor: provenance.predecessorHeadIsAncestor,
    predecessorPassedReview: provenance.predecessorPassedReview,
    isolationDecision: evidence?.isolationDecision ?? evidence?.mergeBaseCheck,
    predecessorExhausted: evidence?.predecessorExhausted,
    currentHead: evidence?.currentHead,
    currentBranch: evidence?.currentBranch,
    evidenceSuccessorBaseline: evidence?.successorBaseline,
    evidencePredecessorHead: evidence?.predecessorHead,
    evidencePredecessorBranchResolvedSha: evidence?.predecessorBranchResolvedSha,
    evidenceSourceHeadCommit: evidence?.sourceHeadCommit,
    evidenceSourceBaselineCommit: evidence?.sourceBaselineCommit,
    evidenceImplementationCommits: evidence?.implementationCommits,
    latestLegalReviewCandidateHead: evidence?.latestLegalReviewCandidateHead,
    mergeBaseCheck: evidence?.mergeBaseCheck,
  };
}

export function hashBoundRehomeSecurityObject(provenance: WorkflowRehomeProvenance): string {
  return hashCanonicalEvidence(canonicalBoundRehomeSecurityBody(provenance));
}

function sameCommitList(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right || left.length === 0 || left.length !== right.length) return false;
  return left.every((commit, index) => commit === right[index]);
}

export function assertBoundRehomeSecurityFields(
  provenance: WorkflowRehomeProvenance
): { ok: true } | { ok: false; message: string } {
  if (provenance.schemaVersion !== '1' || provenance.status !== 'bound') {
    return { ok: false, message: 'rehome provenance is not bound' };
  }
  if (provenance.predecessorPassedReview !== false) {
    return { ok: false, message: 'rehome provenance illegally claims predecessor passed review' };
  }
  if (provenance.predecessorHeadIsAncestor !== false) {
    return {
      ok: false,
      message: 'rehome provenance predecessorHeadIsAncestor must be exactly false',
    };
  }
  const evidence = provenance.evidence;
  if (!evidence || evidence.canonVersion !== REHOME_EVIDENCE_CANON_VERSION) {
    return { ok: false, message: 'rehome evidence is incomplete or unversioned' };
  }
  if (
    evidence.predecessorHeadIsAncestor !== false ||
    evidence.mergeBaseCheck !== 'predecessor_head_not_ancestor' ||
    (evidence.isolationDecision != null &&
      evidence.isolationDecision !== 'predecessor_head_not_ancestor')
  ) {
    return { ok: false, message: 'bound isolation decision is missing or illegal' };
  }
  if (
    !SHA256_RE.test(provenance.sourcePatchSha256) ||
    !SHA256_RE.test(provenance.sourceProductTreeFingerprint) ||
    evidence.sourcePatchSha256 !== provenance.sourcePatchSha256 ||
    evidence.sourceProductTreeFingerprint !== provenance.sourceProductTreeFingerprint
  ) {
    return { ok: false, message: 'rehome source hashes are not bound git evidence' };
  }
  if (!sameCommitList(provenance.sourceImplementationCommits, evidence.implementationCommits)) {
    return { ok: false, message: 'rehome implementation commits are missing or do not match bound evidence' };
  }
  if (
    !provenance.predecessorBranchResolvedSha ||
    !evidence.predecessorBranchResolvedSha ||
    evidence.predecessorBranchResolvedSha !== provenance.predecessorHeadCommit ||
    evidence.predecessorHead !== provenance.predecessorHeadCommit ||
    provenance.predecessorBranchResolvedSha !== provenance.predecessorHeadCommit
  ) {
    return { ok: false, message: 'bound predecessor SHA does not match declared predecessor HEAD' };
  }
  if (evidence.predecessorExhausted !== true) {
    return { ok: false, message: 'bound rehome evidence does not record predecessor exhaustion' };
  }
  if (!evidence.sourceReviewWorkstreamId || !evidence.latestLegalReviewCandidateHead) {
    return { ok: false, message: 'bound rehome evidence omits the source review candidate identity' };
  }
  if (evidence.sourceReviewWorkstreamId !== provenance.sourceReviewWorkstreamId) {
    return { ok: false, message: 'bound source review workstream does not match provenance' };
  }
  if (evidence.latestLegalReviewCandidateHead !== evidence.sourceHeadCommit) {
    return {
      ok: false,
      message: 'bound source HEAD does not match the latest legal review-attempt candidate',
    };
  }
  if (!provenance.sourceHeadCommit || evidence.sourceHeadCommit !== provenance.sourceHeadCommit) {
    return { ok: false, message: 'bound source HEAD does not match provenance source HEAD' };
  }
  if (
    !provenance.sourceBaselineCommit ||
    evidence.sourceBaselineCommit !== provenance.sourceBaselineCommit
  ) {
    return { ok: false, message: 'bound source baseline does not match provenance source baseline' };
  }
  if (evidence.successorBaseline !== provenance.successorBaselineCommit) {
    return { ok: false, message: 'bound successor baseline does not match provenance baseline' };
  }
  if (evidence.currentBranch !== provenance.successorBranchName) {
    return { ok: false, message: 'bound successor branch does not match provenance branch' };
  }
  if (evidence.successorBranchName && evidence.successorBranchName !== provenance.successorBranchName) {
    return { ok: false, message: 'bound successor branch identity is cross-bound inconsistently' };
  }
  if (
    evidence.predecessorRootWorkstreamId &&
    evidence.predecessorRootWorkstreamId !== provenance.predecessorRootWorkstreamId
  ) {
    return { ok: false, message: 'bound predecessor root workstream is cross-bound inconsistently' };
  }
  if (
    evidence.predecessorDescendantWorkstreamId &&
    evidence.predecessorDescendantWorkstreamId !== provenance.predecessorDescendantWorkstreamId
  ) {
    return { ok: false, message: 'bound predecessor descendant workstream is cross-bound inconsistently' };
  }
  if (
    !provenance.sourceReleaseContext ||
    !evidence.sourceReleaseContext ||
    evidence.sourceReleaseContext !== provenance.sourceReleaseContext
  ) {
    return { ok: false, message: 'bound source release context is missing or cross-bound inconsistently' };
  }
  if (typeof evidence.evidenceHash !== 'string' || !SHA256_RE.test(evidence.evidenceHash)) {
    return { ok: false, message: 'rehome evidence hash is missing' };
  }
  if (hashBoundRehomeSecurityObject(provenance) !== evidence.evidenceHash) {
    return { ok: false, message: 'rehome evidence hash does not match bound provenance' };
  }
  return { ok: true };
}

function resolveBoundPredecessorSha(params: {
  repoRoot: string;
  provenance: WorkflowRehomeProvenance;
}): { ok: true; sha: string } | { ok: false; message: string } {
  const expected = params.provenance.predecessorHeadCommit;
  const localPredecessor = resolveExactCommitObject(params.repoRoot, expected);
  if (localPredecessor.ok) {
    if (localPredecessor.sha !== expected) {
      return { ok: false, message: 'resolved predecessor SHA does not match bound predecessor HEAD' };
    }
    return { ok: true, sha: localPredecessor.sha };
  }
  const predecessorContext = parsePredecessorReleaseContext(
    params.provenance.predecessorReleaseContext
  );
  if (!predecessorContext.ok) return predecessorContext;
  const predecessorRepo = resolveCanonicalExistingPath(predecessorContext.repoPath);
  if (!predecessorRepo.ok) {
    return {
      ok: false,
      message:
        'predecessor commit object is missing from the successor repository; cannot prove isolation',
    };
  }
  const importedPredecessor = importCommitObjectForIsolation({
    repoRoot: params.repoRoot,
    sha: expected,
    sourceRepoRoot: predecessorRepo.canonical,
    allowIsolationImport: false,
  });
  if (!importedPredecessor.ok) return importedPredecessor;
  if (importedPredecessor.sha !== expected) {
    return { ok: false, message: 'imported predecessor SHA does not match bound predecessor HEAD' };
  }
  return { ok: true, sha: importedPredecessor.sha };
}

function revalidateLiveBoundSourceFacts(params: {
  provenance: WorkflowRehomeProvenance;
}): { ok: true } | { ok: false; message: string } {
  const evidence = params.provenance.evidence;
  if (!evidence || !params.provenance.sourceReleaseContext) {
    return { ok: false, message: 'bound source release context is missing' };
  }
  const sourceContext = parsePredecessorReleaseContext(params.provenance.sourceReleaseContext);
  if (!sourceContext.ok) return sourceContext;
  const sourceRepo = resolveCanonicalExistingPath(sourceContext.repoPath);
  if (!sourceRepo.ok) {
    // Bound evidence remains valid after the source worktree is removed.
    // Live source cross-bind runs only while the source repository still exists.
    return { ok: true };
  }
  const sourceResolved = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolved.ok) return sourceResolved;
  if (sourceResolved.sha !== evidence.sourceHeadCommit || sourceResolved.sha !== params.provenance.sourceHeadCommit) {
    return { ok: false, message: 'source branch does not resolve to the bound source HEAD' };
  }
  if (!evidence.sourceBranchName || evidence.sourceBranchName !== sourceContext.branchName) {
    return { ok: false, message: 'source branch identity does not match bound evidence' };
  }
  if (!params.provenance.sourceBaselineCommit) {
    return { ok: false, message: 'bound source baseline is missing' };
  }
  const range = listOrderedImplementationCommits(
    sourceRepo.canonical,
    params.provenance.sourceBaselineCommit,
    evidence.sourceHeadCommit
  );
  if (typeof range === 'object' && 'error' in range) {
    return { ok: false, message: range.error };
  }
  if (!sameCommitList(range, evidence.implementationCommits)) {
    return { ok: false, message: 'implementation commits do not match the git-derived source range' };
  }
  const fingerprint = computeGitProductTreeFingerprint(sourceRepo.canonical, evidence.sourceHeadCommit);
  if (typeof fingerprint === 'object') return { ok: false, message: fingerprint.error };
  if (fingerprint !== evidence.sourceProductTreeFingerprint) {
    return { ok: false, message: 'source product fingerprint does not match git-derived tree evidence' };
  }
  return { ok: true };
}

export function revalidateBoundRehomeProvenance(params: {
  repoRoot: string;
  provenance: WorkflowRehomeProvenance;
}): { ok: true } | { ok: false; message: string } {
  const fields = assertBoundRehomeSecurityFields(params.provenance);
  if (!fields.ok) return fields;
  const evidence = params.provenance.evidence;
  if (!evidence) {
    return { ok: false, message: 'rehome evidence is incomplete or unversioned' };
  }
  const currentHead = gitHeadCommit(params.repoRoot);
  const currentBranch = gitBranchName(params.repoRoot);
  if (!currentHead) return { ok: false, message: 'unable to revalidate successor HEAD' };
  if (!currentBranch) return { ok: false, message: 'unable to revalidate successor branch' };
  if (currentBranch !== params.provenance.successorBranchName || currentBranch !== evidence.currentBranch) {
    return { ok: false, message: 'successor branch does not match bound successor identity' };
  }
  const liveBranch = resolveBranchCommit(params.repoRoot, currentBranch);
  if (!liveBranch.ok) return liveBranch;
  if (liveBranch.sha !== currentHead) {
    return { ok: false, message: 'successor branch does not resolve to the current HEAD' };
  }
  if (!resolveCommitObject(params.repoRoot, evidence.currentHead)) {
    return { ok: false, message: 'bound successor HEAD is not a git commit object' };
  }
  if (evidence.currentHead !== currentHead) {
    const bindHeadStillOwned = requireCommitAncestor(
      params.repoRoot,
      evidence.currentHead,
      currentHead,
      'bound successor HEAD is not an ancestor of the current HEAD'
    );
    if (!bindHeadStillOwned.ok) return bindHeadStillOwned;
  }
  if (evidence.successorBaseline !== params.provenance.successorBaselineCommit) {
    return { ok: false, message: 'bound successor baseline does not match provenance baseline' };
  }
  if (!resolveCommitObject(params.repoRoot, params.provenance.successorBaselineCommit)) {
    return { ok: false, message: 'successor baseline is not a git commit object' };
  }
  const successorStillOwned = requireCommitAncestor(
    params.repoRoot,
    params.provenance.successorBaselineCommit,
    currentHead,
    'successor baseline is no longer an ancestor of HEAD'
  );
  if (!successorStillOwned.ok) return successorStillOwned;
  const bindRange = listOrderedImplementationCommits(
    params.repoRoot,
    params.provenance.successorBaselineCommit,
    evidence.currentHead
  );
  if (typeof bindRange === 'object' && 'error' in bindRange) {
    return { ok: false, message: bindRange.error };
  }
  const predecessor = resolveBoundPredecessorSha({
    repoRoot: params.repoRoot,
    provenance: params.provenance,
  });
  if (!predecessor.ok) return predecessor;
  if (
    predecessor.sha !== evidence.predecessorHead ||
    predecessor.sha !== params.provenance.predecessorHeadCommit
  ) {
    return {
      ok: false,
      message: 'predecessor HEAD used in ancestry proof does not match bound predecessor HEAD',
    };
  }
  const ancestry = inspectCommitAncestry(params.repoRoot, predecessor.sha, currentHead);
  if (ancestry.status === 'error') {
    return { ok: false, message: ancestry.message };
  }
  if (ancestry.status === 'ancestor') {
    return { ok: false, message: 'predecessor HEAD became an ancestor of the successor' };
  }
  if (params.provenance.predecessorHeadIsAncestor !== false || evidence.predecessorHeadIsAncestor !== false) {
    return { ok: false, message: 'rehome provenance predecessorHeadIsAncestor must be exactly false' };
  }
  const sourceFacts = revalidateLiveBoundSourceFacts({ provenance: params.provenance });
  if (!sourceFacts.ok) return sourceFacts;
  return { ok: true };
}
