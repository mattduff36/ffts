import { existsSync, readFileSync, renameSync, rmSync } from 'fs';
import path from 'path';
import type { FinaliseTaskKey } from '../finalise-recent-tasks';
import {
  type FinaliseModeKey,
  getFinaliseRepairSafetyFingerprint,
  getFinaliseTaskFingerprint,
} from './finalise-checkpoint';
import { writeJsonAtomic } from './workflow-events';

export interface FinaliseFailureArtifact {
  schemaVersion: '1';
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey | 'other';
  command: string;
  inputFingerprint: string;
  safetyFingerprint: string;
  workstreamId: string | null;
  checkpointId: string | null;
  createdAt: string;
  repairAttemptCount: number;
}

/** Durable evidence that targeted repair succeeded and original finalise closure is required. */
export interface FinaliseRepairCompleteArtifact {
  schemaVersion: '1';
  status: 'awaiting_finalise_closure';
  repairedAt: string;
  repairedStep: FinaliseTaskKey | 'other';
  command: string;
  originalMode: FinaliseModeKey;
  workstreamId: string | null;
  checkpointId?: string | null;
  originalFailure: FinaliseFailureArtifact;
}

interface FinaliseRepairHistory {
  schemaVersion: '1';
  attempts: Array<{
    safetyFingerprint: string;
    originalMode: FinaliseModeKey;
    failedStep: FinaliseTaskKey;
    attemptedAt: string;
  }>;
}

/** Deterministic steps eligible for targeted repair. Migrations/db/commit/push/unknown are excluded. */
export const FINALISE_REPAIRABLE_STEPS = new Set<FinaliseTaskKey>([
  'build',
  'test-run',
  'testsuite',
]);

export function getFinaliseFailurePath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-last-failure.json');
}

export function getFinaliseRepairCompletePath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-repair-complete.json');
}

function getFinaliseRepairHistoryPath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-repair-history.json');
}

export function isRepairableFinaliseStep(step: string): step is FinaliseTaskKey {
  return FINALISE_REPAIRABLE_STEPS.has(step as FinaliseTaskKey);
}

export function writeFinaliseFailureArtifact(params: {
  repoRoot: string;
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey;
  command: string;
  workstreamId?: string | null;
  checkpointId?: string | null;
}): FinaliseFailureArtifact {
  const artifact: FinaliseFailureArtifact = {
    schemaVersion: '1',
    originalMode: params.originalMode,
    failedStep: params.failedStep,
    command: params.command,
    inputFingerprint: getFinaliseTaskFingerprint({
      repoRoot: params.repoRoot,
      task: params.failedStep,
      mode: params.originalMode,
      command: params.command,
    }),
    safetyFingerprint: getFinaliseRepairSafetyFingerprint({
      repoRoot: params.repoRoot,
      task: params.failedStep,
      mode: params.originalMode,
      command: params.command,
    }),
    workstreamId: params.workstreamId ?? null,
    checkpointId: params.checkpointId ?? null,
    createdAt: new Date().toISOString(),
    repairAttemptCount: 0,
  };
  writeJsonAtomic(getFinaliseFailurePath(params.repoRoot), artifact);
  return artifact;
}

export function readFinaliseFailureArtifact(repoRoot: string): FinaliseFailureArtifact | null {
  const filePath = getFinaliseFailurePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as FinaliseFailureArtifact;
    if (
      parsed.schemaVersion !== '1' ||
      !['finalise', 'finalise-full', 'fap', 'ffap'].includes(parsed.originalMode) ||
      typeof parsed.failedStep !== 'string' ||
      typeof parsed.command !== 'string' ||
      typeof parsed.inputFingerprint !== 'string' ||
      typeof parsed.safetyFingerprint !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      (parsed.repairAttemptCount !== undefined &&
        (!Number.isInteger(parsed.repairAttemptCount) || parsed.repairAttemptCount < 0))
    ) {
      return null;
    }
    return {
      ...parsed,
      workstreamId: parsed.workstreamId ?? null,
      checkpointId: parsed.checkpointId ?? null,
      repairAttemptCount: parsed.repairAttemptCount ?? 0,
    };
  } catch {
    return null;
  }
}

export function incrementFinaliseRepairAttempt(
  repoRoot: string
): FinaliseFailureArtifact | null {
  const artifact = readFinaliseFailureArtifact(repoRoot);
  if (!artifact) return null;
  const next = {
    ...artifact,
    repairAttemptCount: artifact.repairAttemptCount + 1,
  };
  writeJsonAtomic(getFinaliseFailurePath(repoRoot), next);
  return next;
}

export function recordFinaliseRepairHistory(
  repoRoot: string,
  artifact: FinaliseFailureArtifact
): number {
  const historyPath = getFinaliseRepairHistoryPath(repoRoot);
  let history: FinaliseRepairHistory = { schemaVersion: '1', attempts: [] };
  if (existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8')) as FinaliseRepairHistory;
      if (parsed.schemaVersion === '1' && Array.isArray(parsed.attempts)) {
        history = parsed;
      }
    } catch {
      history = { schemaVersion: '1', attempts: [] };
    }
  }
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const attempts = history.attempts
    .filter((attempt) => Number.isFinite(Date.parse(attempt.attemptedAt)))
    .filter((attempt) => Date.parse(attempt.attemptedAt) >= cutoff)
    .slice(-99);
  attempts.push({
    safetyFingerprint: artifact.safetyFingerprint,
    originalMode: artifact.originalMode,
    failedStep: artifact.failedStep as FinaliseTaskKey,
    attemptedAt: new Date(now).toISOString(),
  });
  writeJsonAtomic(historyPath, { schemaVersion: '1', attempts } satisfies FinaliseRepairHistory);
  return attempts.filter(
    (attempt) =>
      attempt.safetyFingerprint === artifact.safetyFingerprint &&
      attempt.originalMode === artifact.originalMode &&
      attempt.failedStep === artifact.failedStep
  ).length;
}

export function clearFinaliseFailureArtifact(repoRoot: string): void {
  rmSync(getFinaliseFailurePath(repoRoot), { force: true });
}

export function readFinaliseRepairCompleteArtifact(
  repoRoot: string
): FinaliseRepairCompleteArtifact | null {
  const filePath = getFinaliseRepairCompletePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as FinaliseRepairCompleteArtifact;
    if (
      parsed.schemaVersion !== '1' ||
      parsed.status !== 'awaiting_finalise_closure' ||
      typeof parsed.repairedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.repairedAt)) ||
      typeof parsed.command !== 'string' ||
      !parsed.originalFailure
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Preserve failure evidence under a repair-complete marker and remove the active
 * failure artifact so repair cannot be re-entered until original finalise closure.
 */
export function markFinaliseRepairComplete(
  repoRoot: string,
  artifact: FinaliseFailureArtifact,
  options?: { checkpointId?: string | null }
): FinaliseRepairCompleteArtifact {
  const complete: FinaliseRepairCompleteArtifact = {
    schemaVersion: '1',
    status: 'awaiting_finalise_closure',
    repairedAt: new Date().toISOString(),
    repairedStep: artifact.failedStep,
    command: artifact.command,
    originalMode: artifact.originalMode,
    workstreamId: artifact.workstreamId,
    checkpointId: options?.checkpointId ?? artifact.checkpointId ?? null,
    originalFailure: artifact,
  };
  writeJsonAtomic(getFinaliseRepairCompletePath(repoRoot), complete);
  const failurePath = getFinaliseFailurePath(repoRoot);
  if (existsSync(failurePath)) {
    const archivePath = path.join(
      path.dirname(failurePath),
      `finalise-last-failure.repaired-${Date.now()}.json`
    );
    try {
      renameSync(failurePath, archivePath);
    } catch {
      rmSync(failurePath, { force: true });
    }
  }
  return complete;
}

export function clearFinaliseRepairCompleteArtifact(repoRoot: string): void {
  rmSync(getFinaliseRepairCompletePath(repoRoot), { force: true });
}

function assertIdentityMatchesStored(params: {
  label: string;
  storedMode: FinaliseModeKey;
  storedWorkstreamId: string | null;
  storedCheckpointId: string | null;
  mode: FinaliseModeKey;
  workstreamId: string | null;
  checkpointId?: string | null;
}): void {
  if (params.storedMode !== params.mode) {
    throw new Error(
      `${params.label} mode mismatch: stored=${params.storedMode} current=${params.mode}; refuse clearing closure gate`
    );
  }
  if ((params.storedWorkstreamId ?? null) !== (params.workstreamId ?? null)) {
    throw new Error(
      `${params.label} workstream mismatch: stored=${params.storedWorkstreamId ?? 'none'} current=${params.workstreamId ?? 'none'}; refuse clearing closure gate`
    );
  }
  const storedCheckpoint = params.storedCheckpointId ?? null;
  const currentCheckpoint = params.checkpointId ?? null;
  if (storedCheckpoint !== null || currentCheckpoint !== null) {
    if (storedCheckpoint !== currentCheckpoint) {
      throw new Error(
        `${params.label} checkpoint mismatch: stored=${storedCheckpoint ?? 'none'} current=${currentCheckpoint ?? 'none'}; refuse clearing closure gate`
      );
    }
  }
}

/**
 * Validate that an awaiting repair-complete gate matches the closing finalise run.
 * No-op when no repair-complete artifact exists.
 */
export function assertRepairClosureClearanceAllowed(params: {
  repoRoot: string;
  mode: FinaliseModeKey;
  workstreamId: string | null;
  checkpointId?: string | null;
}): void {
  const complete = readFinaliseRepairCompleteArtifact(params.repoRoot);
  if (!complete) return;
  assertIdentityMatchesStored({
    label: 'repair-complete',
    storedMode: complete.originalMode,
    storedWorkstreamId: complete.workstreamId ?? null,
    storedCheckpointId: complete.checkpointId ?? null,
    mode: params.mode,
    workstreamId: params.workstreamId,
    checkpointId: params.checkpointId,
  });
}

/**
 * Clear repair/failure gates only when mode/workstream/checkpoint match the stored
 * repair-complete marker, or (when no repair-complete exists) the active failure artifact.
 */
export function clearFinaliseRepairClosureArtifacts(params: {
  repoRoot: string;
  mode: FinaliseModeKey;
  workstreamId: string | null;
  checkpointId?: string | null;
}): void {
  const complete = readFinaliseRepairCompleteArtifact(params.repoRoot);
  if (complete) {
    assertRepairClosureClearanceAllowed(params);
  } else {
    const failure = readFinaliseFailureArtifact(params.repoRoot);
    if (failure) {
      assertIdentityMatchesStored({
        label: 'finalise-failure',
        storedMode: failure.originalMode,
        storedWorkstreamId: failure.workstreamId ?? null,
        storedCheckpointId: failure.checkpointId ?? null,
        mode: params.mode,
        workstreamId: params.workstreamId,
        checkpointId: params.checkpointId,
      });
    }
  }
  clearFinaliseFailureArtifact(params.repoRoot);
  clearFinaliseRepairCompleteArtifact(params.repoRoot);
}
