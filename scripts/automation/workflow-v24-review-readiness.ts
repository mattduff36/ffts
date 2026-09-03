import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { WorkflowProtocolRecord, WorkflowProtocolReviewPass } from './types';
import {
  extractPlanContractMarker,
  getArchitectureGateDecision,
  isCriticalPlanContract,
  resolveRequiredTestIdsForWorkstream,
} from './workflow-plan-contract';
import {
  assertManifestLintCoverage,
  assertCandidateTypecheckLintEvidence,
  getCurrentTreeFingerprint,
  recomputeManifestProvenIds,
  type EvidenceCommandResult,
} from './workflow-evidence-manifest';
import {
  assertReviewCandidateFrozen,
  inspectCandidateGitScope,
} from './workflow-verification-ledger';
import { computeWorkingTreeProductFingerprint } from './workflow-v24-disposition';
import {
  resolveCanonicalReviewRequiredIds,
  assertCanonicalRequiredIdsProven,
} from './workflow-v24-required-id-set';
import { validateCurrentV24ProtocolRecord } from './workflow-v24-protocol-validator';

export interface ReviewReadinessOk {
  ok: true;
  headCommit: string;
  productTreeFingerprint: string;
  requiredIds: string[];
}

export interface ReviewReadinessFail {
  ok: false;
  message: string;
}

function boundPlanRequiredIds(
  repoRoot: string,
  record: WorkflowProtocolRecord
): { ok: true; planIds: string[] } | { ok: false; message: string } {
  if (!record.planPath) {
    return { ok: false, message: 'review-readiness requires a bound plan contract' };
  }
  const absolutePlanPath = path.isAbsolute(record.planPath)
    ? record.planPath
    : path.resolve(repoRoot, record.planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: false, message: `CRITICAL plan missing or unreadable: ${record.planPath}` };
  }
  const parsed = extractPlanContractMarker(readFileSync(absolutePlanPath, 'utf8'));
  if (parsed.status !== 'present' || !parsed.contract) {
    return {
      ok: false,
      message: `CRITICAL plan contract ${parsed.status}: ${parsed.errors.join('; ') || 'malformed'}`,
    };
  }
  if (!isCriticalPlanContract(parsed.contract)) {
    return { ok: false, message: 'bound plan is not a CRITICAL contract' };
  }
  const decision = getArchitectureGateDecision(parsed.contract.architectureGate);
  if (decision !== 'approved' && decision !== 'approved_with_conditions') {
    return { ok: false, message: 'architecture conditions are not satisfied' };
  }
  return {
    ok: true,
    planIds: resolveRequiredTestIdsForWorkstream(parsed.contract, record.workstreamId).filter(
      (id) => !id.startsWith('WF-PAY-')
    ),
  };
}

function evidenceIdentity(
  parsed: Record<string, unknown>,
  expectedHead: string,
  expectedFingerprint: string
): { ok: true } | { ok: false; message: string } {
  if (parsed.headCommit !== expectedHead) {
    return { ok: false, message: 'evidence headCommit does not match candidate HEAD' };
  }
  if (
    typeof parsed.productTreeFingerprint === 'string' &&
    parsed.productTreeFingerprint !== expectedFingerprint
  ) {
    return { ok: false, message: 'evidence productTreeFingerprint does not match candidate' };
  }
  return { ok: true };
}

/**
 * Lightweight review-start gate. Refuses when any required proof is missing or stale.
 * Not a second authority/state machine.
 */
export function assertReviewReadiness(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
  pass: WorkflowProtocolReviewPass;
}): ReviewReadinessOk | ReviewReadinessFail {
  const protocol = validateCurrentV24ProtocolRecord(params.record);
  if (!protocol.ok) return protocol;

  const frozen = assertReviewCandidateFrozen(params.repoRoot);
  if (!frozen.ok) return frozen;

  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const product = computeWorkingTreeProductFingerprint(params.repoRoot);
  if (typeof product === 'object') {
    return { ok: false, message: product.error };
  }
  if (!tree.headCommit) {
    return { ok: false, message: 'candidate HEAD is unknown' };
  }

  const plan = boundPlanRequiredIds(params.repoRoot, params.record);
  if (!plan.ok) return plan;
  const requiredIds = resolveCanonicalReviewRequiredIds(plan.planIds);
  if (requiredIds.length === 0) {
    return { ok: false, message: 'required-ID set is empty' };
  }

  const scoped = inspectCandidateGitScope(params.repoRoot, params.record.baseCommit || tree.headCommit);
  if (!scoped.ok) return scoped;

  if (params.pass === 'delta') {
    return {
      ok: true,
      headCommit: tree.headCommit,
      productTreeFingerprint: product,
      requiredIds,
    };
  }

  const manifestPath =
    params.pass === 'closure'
      ? params.record.fixDeltaManifestPath
      : params.record.evidenceManifestPath;
  if (!manifestPath) {
    return { ok: false, message: `${params.pass} review requires current evidence` };
  }
  if (params.pass === 'closure' && !params.record.fixDeltaManifestPath) {
    return { ok: false, message: 'closure review requires current fix-delta evidence' };
  }

  if (manifestPath) {
    const absolutePath = path.isAbsolute(manifestPath)
      ? manifestPath
      : path.join(params.repoRoot, manifestPath);
    if (!existsSync(absolutePath)) {
      return { ok: false, message: `evidence manifest missing: ${manifestPath}` };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return { ok: false, message: 'evidence manifest is unreadable' };
    }
    const identity = evidenceIdentity(parsed, tree.headCommit, product);
    if (!identity.ok) return identity;
    if (parsed.headCommit !== tree.headCommit || parsed.inputFingerprint !== tree.inputFingerprint) {
      return { ok: false, message: 'trusted suite evidence is stale vs current HEAD/fingerprint' };
    }
    const commands = Array.isArray(parsed.commands)
      ? (parsed.commands as EvidenceCommandResult[])
      : [];
    const typecheckLint = assertCandidateTypecheckLintEvidence({
      repoRoot: params.repoRoot,
      baseCommit: String(parsed.baseCommit ?? params.record.baseCommit),
      headCommit: tree.headCommit,
      productTreeFingerprint: product,
      commands,
    });
    if (!typecheckLint.ok) return typecheckLint;
    const lintCoverage = assertManifestLintCoverage({
      repoRoot: params.repoRoot,
      baseCommit: String(parsed.baseCommit ?? params.record.baseCommit),
      commands,
    });
    if (!lintCoverage.ok) return lintCoverage;
    const proven = recomputeManifestProvenIds({
      repoRoot: params.repoRoot,
      workstreamId: params.record.workstreamId,
      parsed,
      extraRequiredIds: requiredIds,
    });
    if (!proven.ok) return proven;
    const complete = assertCanonicalRequiredIdsProven({
      provenIds: [...proven.executedIds],
      planRequiredIds: plan.planIds,
    });
    if (!complete.ok) return complete;
  } else {
    return { ok: false, message: 'required evidence is missing' };
  }

  return {
    ok: true,
    headCommit: tree.headCommit,
    productTreeFingerprint: product,
    requiredIds,
  };
}
