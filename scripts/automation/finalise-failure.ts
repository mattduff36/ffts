import { existsSync, readFileSync, renameSync, rmSync } from 'fs';
import path from 'path';
import type { FinaliseTaskKey } from '../finalise-recent-tasks';
import {
  FINALISE_TASK_COMMANDS,
  type FinaliseModeKey,
  getFinaliseRepairSafetyFingerprint,
  getFinaliseTaskFingerprint,
} from './finalise-checkpoint';
import { assertSafeOpaqueId } from './workflow-plan-contract';
import { withWorkflowLock, writeJsonAtomic } from './workflow-events';

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

function getFinaliseGateMutationLockPath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-gate-mutation.lock');
}

function withFinaliseGateMutationLock<T>(repoRoot: string, action: () => T): T {
  return withWorkflowLock(getFinaliseGateMutationLockPath(repoRoot), action);
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
  return withFinaliseGateMutationLock(params.repoRoot, () => {
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
  });
}

function isValidNullableFinaliseId(value: unknown, fieldName: string): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && assertSafeOpaqueId(value, fieldName).ok)
  );
}

function parseFinaliseFailureArtifact(value: unknown): FinaliseFailureArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<FinaliseFailureArtifact>;
  const knownStep =
    parsed.failedStep === 'other' ||
    (typeof parsed.failedStep === 'string' &&
      Object.prototype.hasOwnProperty.call(FINALISE_TASK_COMMANDS, parsed.failedStep));
  const canonicalCommand =
    parsed.failedStep === 'other'
      ? typeof parsed.command === 'string' && parsed.command.length > 0
      : knownStep &&
        parsed.command === FINALISE_TASK_COMMANDS[parsed.failedStep as FinaliseTaskKey];
  const workstreamId = parsed.workstreamId ?? null;
  const checkpointId = parsed.checkpointId ?? null;
  if (
    parsed.schemaVersion !== '1' ||
    typeof parsed.originalMode !== 'string' ||
    !['finalise', 'finalise-full', 'fap', 'ffap'].includes(parsed.originalMode) ||
    !knownStep ||
    !canonicalCommand ||
    typeof parsed.inputFingerprint !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(parsed.inputFingerprint) ||
    typeof parsed.safetyFingerprint !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(parsed.safetyFingerprint) ||
    !isValidNullableFinaliseId(workstreamId, 'workstreamId') ||
    !isValidNullableFinaliseId(checkpointId, 'checkpointId') ||
    (workstreamId === null) !== (checkpointId === null) ||
    typeof parsed.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.createdAt)) ||
    (parsed.repairAttemptCount !== undefined &&
      (!Number.isInteger(parsed.repairAttemptCount) || parsed.repairAttemptCount < 0))
  ) {
    return null;
  }
  return {
    schemaVersion: '1',
    originalMode: parsed.originalMode as FinaliseModeKey,
    failedStep: parsed.failedStep as FinaliseTaskKey | 'other',
    command: parsed.command as string,
    inputFingerprint: parsed.inputFingerprint,
    safetyFingerprint: parsed.safetyFingerprint,
    workstreamId,
    checkpointId,
    createdAt: parsed.createdAt,
    repairAttemptCount: parsed.repairAttemptCount ?? 0,
  };
}

function sameFinaliseFailureIdentity(
  left: FinaliseFailureArtifact,
  right: FinaliseFailureArtifact
): boolean {
  return (
    left.originalMode === right.originalMode &&
    left.failedStep === right.failedStep &&
    left.command === right.command &&
    left.inputFingerprint === right.inputFingerprint &&
    left.safetyFingerprint === right.safetyFingerprint &&
    left.workstreamId === right.workstreamId &&
    left.checkpointId === right.checkpointId &&
    left.createdAt === right.createdAt
  );
}

export function readFinaliseFailureArtifact(repoRoot: string): FinaliseFailureArtifact | null {
  const filePath = getFinaliseFailurePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    return parseFinaliseFailureArtifact(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export function archiveSupersededFinaliseFailureArtifact(repoRoot: string): {
  archived: boolean;
  archivePath?: string;
  reason: string;
} {
  return withFinaliseGateMutationLock(repoRoot, () => {
    const artifact = readFinaliseFailureArtifact(repoRoot);
    if (!artifact) {
      return { archived: false, reason: 'missing-or-malformed' };
    }
    if (!isRepairableFinaliseStep(artifact.failedStep)) {
      return { archived: false, reason: 'non-repairable-step' };
    }
    const currentFingerprint = getFinaliseTaskFingerprint({
      repoRoot,
      task: artifact.failedStep,
      mode: artifact.originalMode,
      command: artifact.command,
    });
    if (currentFingerprint === artifact.inputFingerprint) {
      return { archived: false, reason: 'same-candidate' };
    }

    const failurePath = getFinaliseFailurePath(repoRoot);
    const archivePath = path.join(
      path.dirname(failurePath),
      `finalise-last-failure.superseded-${Date.now()}.json`
    );
    renameSync(failurePath, archivePath);
    return { archived: true, archivePath, reason: 'candidate-changed' };
  });
}

export function incrementFinaliseRepairAttempt(
  repoRoot: string,
  expectedArtifact?: FinaliseFailureArtifact
): FinaliseFailureArtifact | null {
  return withFinaliseGateMutationLock(repoRoot, () => {
    const artifact = readFinaliseFailureArtifact(repoRoot);
    if (!artifact) return null;
    if (expectedArtifact && !sameFinaliseFailureIdentity(artifact, expectedArtifact)) {
      throw new Error('finalise failure artifact changed before targeted repair claim');
    }
    const next = {
      ...artifact,
      repairAttemptCount: artifact.repairAttemptCount + 1,
    };
    writeJsonAtomic(getFinaliseFailurePath(repoRoot), next);
    return next;
  });
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
  withFinaliseGateMutationLock(repoRoot, () => {
    rmSync(getFinaliseFailurePath(repoRoot), { force: true });
  });
}

export function readFinaliseRepairCompleteArtifact(
  repoRoot: string
): FinaliseRepairCompleteArtifact | null {
  const filePath = getFinaliseRepairCompletePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Partial<FinaliseRepairCompleteArtifact>;
    const originalFailure = parseFinaliseFailureArtifact(parsed.originalFailure);
    const workstreamId = parsed.workstreamId ?? null;
    const checkpointId = parsed.checkpointId ?? null;
    if (
      parsed.schemaVersion !== '1' ||
      parsed.status !== 'awaiting_finalise_closure' ||
      typeof parsed.repairedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.repairedAt)) ||
      !originalFailure ||
      parsed.repairedStep !== originalFailure.failedStep ||
      parsed.command !== originalFailure.command ||
      parsed.originalMode !== originalFailure.originalMode ||
      workstreamId !== originalFailure.workstreamId ||
      checkpointId !== originalFailure.checkpointId ||
      !isValidNullableFinaliseId(workstreamId, 'workstreamId') ||
      !isValidNullableFinaliseId(checkpointId, 'checkpointId') ||
      (workstreamId === null) !== (checkpointId === null)
    ) {
      return null;
    }
    return {
      schemaVersion: '1',
      status: 'awaiting_finalise_closure',
      repairedAt: parsed.repairedAt,
      repairedStep: originalFailure.failedStep,
      command: originalFailure.command,
      originalMode: originalFailure.originalMode,
      workstreamId,
      checkpointId,
      originalFailure,
    };
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
  return withFinaliseGateMutationLock(repoRoot, () => {
    const current = readFinaliseFailureArtifact(repoRoot);
    if (!current || !sameFinaliseFailureIdentity(current, artifact)) {
      throw new Error('finalise failure artifact changed during targeted repair');
    }
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
      renameSync(failurePath, archivePath);
    }
    return complete;
  });
}

export function clearFinaliseRepairCompleteArtifact(repoRoot: string): void {
  withFinaliseGateMutationLock(repoRoot, () => {
    rmSync(getFinaliseRepairCompletePath(repoRoot), { force: true });
  });
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
  const repairCompletePath = getFinaliseRepairCompletePath(params.repoRoot);
  const complete = readFinaliseRepairCompleteArtifact(params.repoRoot);
  if (existsSync(repairCompletePath) && !complete) {
    throw new Error('repair-complete closure gate is malformed; refuse finalise');
  }
  if (complete) {
    assertIdentityMatchesStored({
      label: 'repair-complete',
      storedMode: complete.originalMode,
      storedWorkstreamId: complete.workstreamId ?? null,
      storedCheckpointId: complete.checkpointId ?? null,
      mode: params.mode,
      workstreamId: params.workstreamId,
      checkpointId: params.checkpointId,
    });
    return;
  }

  const failurePath = getFinaliseFailurePath(params.repoRoot);
  const failure = readFinaliseFailureArtifact(params.repoRoot);
  if (existsSync(failurePath) && !failure) {
    throw new Error('finalise-failure closure gate is malformed; refuse finalise');
  }
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
  withFinaliseGateMutationLock(params.repoRoot, () => {
    const repairCompletePath = getFinaliseRepairCompletePath(params.repoRoot);
    const complete = readFinaliseRepairCompleteArtifact(params.repoRoot);
    if (existsSync(repairCompletePath) && !complete) {
      throw new Error('repair-complete closure gate is malformed; refuse clearing');
    }
    if (complete) {
      assertRepairClosureClearanceAllowed(params);
    } else {
      const failurePath = getFinaliseFailurePath(params.repoRoot);
      const failure = readFinaliseFailureArtifact(params.repoRoot);
      if (existsSync(failurePath) && !failure) {
        throw new Error('finalise-failure closure gate is malformed; refuse clearing');
      }
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
    rmSync(getFinaliseFailurePath(params.repoRoot), { force: true });
    rmSync(getFinaliseRepairCompletePath(params.repoRoot), { force: true });
  });
}
