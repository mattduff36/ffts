import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
  unlinkSync,
} from 'fs';
import path from 'path';
import type {
  WorkflowReviewState,
  WorkflowStopEvent,
  WorkflowWorkstreamRecord,
} from './types';

export const WORKFLOW_SCRIPT_NAME = 'workflow-review' as const;
export const WORKFLOW_REVIEW_THRESHOLD = 25;
const LOCK_STALE_MS = 30_000;

export interface WorkflowPaths {
  repoRoot: string;
  automationRoot: string;
  eventsDirectory: string;
  statePath: string;
  lockPath: string;
  reviewsDirectory: string;
  knowledgeDirectory: string;
  followUpsDirectory: string;
}

export function getWorkflowPaths(repoRoot = process.cwd()): WorkflowPaths {
  const automationRoot = path.join(repoRoot, 'docs_private', 'automation');
  return {
    repoRoot,
    automationRoot,
    eventsDirectory: path.join(automationRoot, 'workflow-events'),
    statePath: path.join(automationRoot, 'knowledge', 'workflow-review-state.json'),
    lockPath: path.join(automationRoot, 'knowledge', 'workflow-review.lock'),
    reviewsDirectory: path.join(automationRoot, 'reviews'),
    knowledgeDirectory: path.join(automationRoot, 'knowledge'),
    followUpsDirectory: path.join(automationRoot, 'follow-ups'),
  };
}

export function createEmptyWorkflowReviewState(): WorkflowReviewState {
  return {
    schemaVersion: '2',
    scriptName: WORKFLOW_SCRIPT_NAME,
    updatedAt: new Date(0).toISOString(),
    lastReviewAt: null,
    lastReviewWindowId: null,
    lastReviewedEventId: null,
    unreviewedEventIds: [],
    pendingFollowUpPath: null,
    processedGenerationHashes: [],
    reviewWindowByEventId: {},
    workstreams: {},
    protocolRecords: {},
    activeFinaliseContext: null,
    pendingAnomalySignals: [],
  };
}

export function isWorkflowReviewState(value: unknown): value is WorkflowReviewState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowReviewState>;
  return (
    (candidate.schemaVersion === '1' || candidate.schemaVersion === '2') &&
    candidate.scriptName === WORKFLOW_SCRIPT_NAME &&
    Array.isArray(candidate.unreviewedEventIds) &&
    Array.isArray(candidate.processedGenerationHashes)
  );
}

export function loadWorkflowReviewState(statePath: string): WorkflowReviewState {
  if (!existsSync(statePath)) return createEmptyWorkflowReviewState();
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    if (isWorkflowReviewState(parsed)) {
      const defaults = createEmptyWorkflowReviewState();
      return {
        ...defaults,
        ...parsed,
        schemaVersion: '2',
        reviewWindowByEventId:
          parsed.reviewWindowByEventId &&
          typeof parsed.reviewWindowByEventId === 'object' &&
          !Array.isArray(parsed.reviewWindowByEventId)
            ? parsed.reviewWindowByEventId
            : {},
        workstreams:
          parsed.workstreams &&
          typeof parsed.workstreams === 'object' &&
          !Array.isArray(parsed.workstreams)
            ? parsed.workstreams
            : {},
        protocolRecords:
          parsed.protocolRecords &&
          typeof parsed.protocolRecords === 'object' &&
          !Array.isArray(parsed.protocolRecords)
            ? parsed.protocolRecords
            : {},
        activeFinaliseContext:
          parsed.activeFinaliseContext &&
          typeof parsed.activeFinaliseContext === 'object' &&
          !Array.isArray(parsed.activeFinaliseContext)
            ? parsed.activeFinaliseContext
            : null,
        pendingAnomalySignals: Array.isArray(parsed.pendingAnomalySignals)
          ? parsed.pendingAnomalySignals
          : [],
      };
    }
  } catch {
    // Keep collector fail-open when state is human-edited or corrupted.
  }
  return createEmptyWorkflowReviewState();
}

export function upsertWorkstreamRecord(
  state: WorkflowReviewState,
  record: WorkflowWorkstreamRecord
): WorkflowReviewState {
  const workstreams = state.workstreams ?? {};
  const existing = workstreams[record.workstreamId];
  return {
    ...state,
    schemaVersion: '2',
    workstreams: {
      ...workstreams,
      [record.workstreamId]: existing
        ? {
            ...existing,
            ...record,
            branchName: record.branchName ?? existing.branchName,
            headCommit: record.headCommit ?? existing.headCommit,
            taskIds: [...new Set([...existing.taskIds, ...record.taskIds])],
            eventIds: [...new Set([...existing.eventIds, ...record.eventIds])],
            sourceWorkstreamIds:
              existing.sourceWorkstreamIds || record.sourceWorkstreamIds
                ? [
                    ...new Set([
                      ...(existing.sourceWorkstreamIds ?? []),
                      ...(record.sourceWorkstreamIds ?? []),
                    ]),
                  ]
                : undefined,
          }
        : record,
    },
  };
}

export function attachEventToReviewWindow(
  state: WorkflowReviewState,
  eventId: string,
  reviewWindowId: string
): WorkflowReviewState {
  return {
    ...state,
    schemaVersion: '2',
    reviewWindowByEventId: {
      ...(state.reviewWindowByEventId ?? {}),
      [eventId]: reviewWindowId,
    },
  };
}

export function listOpenWorkstreamsForBranch(
  state: WorkflowReviewState,
  branchName: string
): WorkflowWorkstreamRecord[] {
  return Object.values(state.workstreams ?? {})
    .filter(
      (record) =>
        record.status === 'open' &&
        record.branchName !== null &&
        record.branchName === branchName
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tempPath, filePath);
}

export function saveWorkflowReviewState(statePath: string, state: WorkflowReviewState): void {
  writeJsonAtomic(statePath, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function appendWorkflowAnomalySignal(params: {
  repoRoot: string;
  eventId: string;
  flags: string[];
  recordedAt?: string;
}): void {
  if (params.flags.length === 0) return;
  const paths = getWorkflowPaths(params.repoRoot);
  withWorkflowLock(paths.lockPath, () => {
    const state = loadWorkflowReviewState(paths.statePath);
    if (state.pendingAnomalySignals?.some((signal) => signal.eventId === params.eventId)) {
      return;
    }
    saveWorkflowReviewState(paths.statePath, {
      ...state,
      pendingAnomalySignals: [
        ...(state.pendingAnomalySignals ?? []),
        {
          eventId: params.eventId,
          recordedAt: params.recordedAt ?? new Date().toISOString(),
          flags: [...new Set(params.flags)],
        },
      ].slice(-100),
    });
  });
}

const SAFE_GENERATION_HASH = /^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/u;

export function getEventPath(eventsDirectory: string, generationHash: string): string {
  if (
    !SAFE_GENERATION_HASH.test(generationHash) ||
    generationHash.includes('..') ||
    generationHash.includes('/') ||
    generationHash.includes('\\')
  ) {
    throw new Error('generationHash is not a path-safe opaque identifier');
  }
  return path.join(eventsDirectory, `${generationHash}.json`);
}

export function writeWorkflowEvent(eventsDirectory: string, event: WorkflowStopEvent): {
  path: string;
  created: boolean;
} {
  mkdirSync(eventsDirectory, { recursive: true });
  const eventPath = getEventPath(eventsDirectory, event.generationHash);
  if (existsSync(eventPath)) {
    return { path: eventPath, created: false };
  }
  writeJsonAtomic(eventPath, event);
  return { path: eventPath, created: true };
}

export function readWorkflowEvent(filePath: string): WorkflowStopEvent | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as WorkflowStopEvent;
  } catch {
    return null;
  }
}

export function listWorkflowEvents(eventsDirectory: string): WorkflowStopEvent[] {
  if (!existsSync(eventsDirectory)) return [];
  return readdirSync(eventsDirectory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readWorkflowEvent(path.join(eventsDirectory, name)))
    .filter((event): event is WorkflowStopEvent => Boolean(event))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

function sleepSync(ms: number, now: () => number): void {
  const waitUntil = now() + ms;
  while (now() < waitUntil) {
    // Short spin wait; avoid shell-based sleep in the locked collector path.
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface WorkflowLockOwner {
  pid?: number;
  token?: string;
  createdAt?: string;
}

function readLockOwner(lockPath: string): WorkflowLockOwner | null {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as WorkflowLockOwner;
  } catch {
    return null;
  }
}

/** Exported for focused tests of the stale-takeover restore branch. */
export function recoverStaleWorkflowLock(params: {
  lockPath: string;
  expectedOwner: WorkflowLockOwner;
  now?: () => number;
}): 'removed-stale' | 'restored-replacement' | 'failed' {
  if (!params.expectedOwner.token) return 'failed';
  const now = params.now ?? Date.now;
  const stalePath = `${params.lockPath}.stale.${params.expectedOwner.token}.${process.pid}.${now()}`;
  try {
    renameSync(params.lockPath, stalePath);
  } catch {
    return 'failed';
  }

  const moved = readLockOwner(stalePath);
  if (moved?.token === params.expectedOwner.token) {
    rmSync(stalePath, { force: true });
    return 'removed-stale';
  }

  // Restore anything that is not the confirmed stale owner, including unreadable/partial writes.
  try {
    renameSync(stalePath, params.lockPath);
    return 'restored-replacement';
  } catch {
    return 'failed';
  }
}

export function withWorkflowLock<T>(
  lockPath: string,
  fn: () => T,
  options?: { staleMs?: number; now?: () => number }
): T {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const staleMs = options?.staleMs ?? LOCK_STALE_MS;
  const now = options?.now ?? Date.now;
  const started = now();
  const token = `${process.pid}-${now()}-${Math.random().toString(16).slice(2)}`;
  let lockFd: number | null = null;

  while (lockFd === null) {
    try {
      lockFd = openSync(lockPath, 'wx');
      writeSync(
        lockFd,
        Buffer.from(
          JSON.stringify({
            pid: process.pid,
            token,
            createdAt: new Date(now()).toISOString(),
          }),
          'utf8'
        )
      );
    } catch {
      if (!existsSync(lockPath)) {
        if (now() - started > staleMs) {
          throw new Error('Unable to acquire workflow-review lock');
        }
        sleepSync(25, now);
        continue;
      }

      const owner = readLockOwner(lockPath);
      if (!owner) {
        // Another process may still be writing lock metadata; wait briefly.
        if (now() - started > staleMs) {
          // Only remove truly empty/corrupt locks after timeout.
          const stillEmpty = !readLockOwner(lockPath);
          if (stillEmpty) rmSync(lockPath, { force: true });
        } else {
          sleepSync(25, now);
        }
        continue;
      }

      const ownerPid = typeof owner.pid === 'number' ? owner.pid : -1;
      const createdAt = owner.createdAt ? Date.parse(owner.createdAt) : Number.NaN;
      const isStaleAge = Number.isFinite(createdAt) && now() - createdAt > staleMs;
      const ownerAlive = isPidAlive(ownerPid);
      if (isStaleAge && !ownerAlive && owner.token) {
        recoverStaleWorkflowLock({
          lockPath,
          expectedOwner: owner,
          now,
        });
        continue;
      }

      if (now() - started > staleMs) {
        throw new Error('Timed out waiting for workflow-review lock');
      }
      sleepSync(25, now);
    }
  }

  try {
    return fn();
  } finally {
    try {
      if (lockFd !== null) closeSync(lockFd);
    } catch {
      // ignore
    }
    try {
      const owner = readLockOwner(lockPath);
      if (owner?.token === token) {
        unlinkSync(lockPath);
      }
    } catch {
      // Lock cleanup is best-effort and must not remove another owner's lock.
    }
  }
}
