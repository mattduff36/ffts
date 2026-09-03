import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationRun } from '@/scripts/automation/logger';
import {
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import * as workflowEvents from '@/scripts/automation/workflow-events';
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWorkflowV24Fixtures();
});

function saveC9State(
  repoRoot: string,
  head: string,
  extras: {
    omitActivatedHead?: boolean;
    checkpointId?: string;
    workstreamId?: string;
    activatedBranchName?: string;
    ownedCommits?: string[];
    malformedCheckpoint?: boolean;
    extraWorkstream?: { workstreamId: string; checkpointId: string };
  } = {}
) {
  const workstreamId = extras.workstreamId ?? 'ws_c9';
  const checkpointId = extras.checkpointId ?? 'ckpt_c9';
  const ready = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: head,
    branchName: 'main',
    headCommit: head,
  });
  ready.phase = 'finalise_ready';
  ready.nextAction = 'run_finalise';
  ready.activeCheckpointId = checkpointId;
  const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
  ready.reviewedTreeFingerprint = treeFingerprint;
  ready.reviewAttempts = [
    {
      pass: 'first',
      token: `rev_first_${workstreamId}_atom`,
      startedAt: ready.updatedAt,
      recordedAt: ready.updatedAt,
      result: 'passed',
      headCommit: head,
      treeFingerprint,
    },
  ];
  writeProtocolRecord(repoRoot, ready);
  const protocolRecords: Record<string, typeof ready> = { [workstreamId]: ready };
  if (extras.extraWorkstream) {
    const extra = createEmptyProtocolRecord({
      workstreamId: extras.extraWorkstream.workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    extra.phase = 'finalise_ready';
    extra.nextAction = 'run_finalise';
    extra.activeCheckpointId = extras.extraWorkstream.checkpointId;
    extra.reviewedTreeFingerprint = treeFingerprint;
    extra.reviewAttempts = [
      {
        pass: 'first',
        token: `rev_first_${extra.workstreamId}_atom`,
        startedAt: extra.updatedAt,
        recordedAt: extra.updatedAt,
        result: 'passed',
        headCommit: head,
        treeFingerprint,
      },
    ];
    writeProtocolRecord(repoRoot, extra);
    protocolRecords[extra.workstreamId] = extra;
  }
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  const activeFinaliseContext = extras.malformedCheckpoint
    ? ({
        workstreamId,
        checkpointId: 12,
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: head,
        activatedBranchName: extras.activatedBranchName ?? 'main',
        ownedCommits: extras.ownedCommits ?? [head],
      } as never)
    : {
        workstreamId,
        checkpointId,
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: extras.omitActivatedHead ? undefined : head,
        activatedBranchName: extras.activatedBranchName ?? 'main',
        ownedCommits: extras.ownedCommits ?? [head],
      };
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords,
    activeFinaliseContext,
  });
}

function createProtectedRun(repoRoot: string) {
  return new AutomationRun({
    scriptName: 'finalise',
    mode: 'run',
    args: [],
    persist: true,
    repoRoot,
  });
}

function protocolPhase(repoRoot: string, workstreamId = 'ws_c9') {
  return readProtocolRecord(repoRoot, workstreamId)?.phase ?? null;
}

function activeContext(repoRoot: string) {
  const paths = getWorkflowPaths(repoRoot);
  return loadWorkflowReviewStateStrict(paths.statePath).activeFinaliseContext ?? null;
}

function listRunLogs(repoRoot: string): Array<{ status?: string; path: string; body: string }> {
  const dir = path.join(repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.c9-identity.json'))
    .map((name) => {
      const filePath = path.join(dir, name);
      const body = readFileSync(filePath, 'utf8');
      let status: string | undefined;
      try {
        status = (JSON.parse(body) as { status?: string }).status;
      } catch {
        status = undefined;
      }
      return { status, path: filePath, body };
    });
}

async function expectFinishRejectedAndNotFinalised(
  repoRoot: string,
  pattern: RegExp,
  workstreamId = 'ws_c9'
) {
  await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(pattern);
  expect(protocolPhase(repoRoot, workstreamId)).toBe('finalise_ready');
  expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  const markdown = listRunLogs(repoRoot).flatMap((log) => {
    const md = log.path.replace(/\.json$/u, '.md');
    return existsSync(md) ? [readFileSync(md, 'utf8')] : [];
  });
  expect(markdown.some((text) => /Status:\s*passed/i.test(text))).toBe(false);
}

describe('TEE V2.4 finish atomicity', () => {
  it('TEE-V24-FINISH-ATOMIC-VALID-001 / FD-C9-FINISH-ATOMICITY-004: valid protected run finalises after C9 validation', async () => {
    const repoRoot = makeTempRoot('atomic-valid');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(activeContext(repoRoot)).toBeNull();
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(true);
  });

  it('TEE-V24-FINISH-ATOMIC-MISSING-002: missing C9 identity throws and protocol stays non-finalised', async () => {
    const repoRoot = makeTempRoot('atomic-missing');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expectFinishRejectedAndNotFinalised(repoRoot, /identityStatus=missing|missing/i);
  });

  it('TEE-V24-FINISH-ATOMIC-CORRUPT-003: corrupted C9 identity throws and protocol stays non-finalised', async () => {
    const repoRoot = makeTempRoot('atomic-corrupt');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    writeFileSync(run.protectedC9IdentityPath, '{not-json', 'utf8');
    await expect(run.finish('passed')).rejects.toThrow(/malformed|missing/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  });

  it('TEE-V24-FINISH-ATOMIC-BRANCH-004: wrong branch writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-branch');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { activatedBranchName: 'other' });
    await expectFinishRejectedAndNotFinalised(repoRoot, /branch/i);
  });

  it('TEE-V24-FINISH-ATOMIC-HEAD-005: wrong HEAD writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-head');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    commitFile(repoRoot, 'extra.ts', 'unexpected head');
    await expectFinishRejectedAndNotFinalised(repoRoot, /HEAD|owned-chain/i);
  });

  it('TEE-V24-FINISH-ATOMIC-WS-006: wrong workstream writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-ws');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, {
      extraWorkstream: { workstreamId: 'ws_other', checkpointId: 'ckpt_other' },
    });
    const run = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    state.activeFinaliseContext.workstreamId = 'ws_other';
    state.activeFinaliseContext.checkpointId = 'ckpt_other';
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    await expect(run.finish('passed')).rejects.toThrow(/mismatch|missing|workstream/i);
    expect(protocolPhase(repoRoot, 'ws_c9')).toBe('finalise_ready');
    expect(protocolPhase(repoRoot, 'ws_other')).toBe('finalise_ready');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  });

  it('TEE-V24-FINISH-ATOMIC-OWNED-007: owned-chain violation writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-owned');
    const head = initGitRepo(repoRoot);
    const extra = commitFile(repoRoot, 'product.ts', 'unreviewed product');
    saveC9State(repoRoot, extra, { ownedCommits: [head] });
    await expectFinishRejectedAndNotFinalised(repoRoot, /owned-chain|HEAD/i);
  });

  it('TEE-V24-FINISH-ATOMIC-GIT-008: Git verification error writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-git');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    rmSync(path.join(repoRoot, '.git'), { recursive: true, force: true });
    await expectFinishRejectedAndNotFinalised(repoRoot, /git identity cannot be verified/i);
  });

  it('TEE-V24-FINISH-ATOMIC-CORR-009: correlation mismatch writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-corr');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expectFinishRejectedAndNotFinalised(repoRoot, /identityStatus=missing|missing/i);
  });

  it('TEE-V24-FINISH-ATOMIC-C9-AFTER-MEM-010: C9 throw after in-memory prepare writes no success state', async () => {
    const repoRoot = makeTempRoot('atomic-after-mem');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    rmSync(run.protectedC9IdentityPath, { force: true });
    await expect(run.finish('passed')).rejects.toThrow(/missing|malformed|refuse finish/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(activeContext(repoRoot)?.workstreamId).toBe('ws_c9');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  });

  it('TEE-V24-FINISH-ATOMIC-PROTO-FAIL-011: protocol persist failure cannot leave correlation claiming success', async () => {
    const repoRoot = makeTempRoot('atomic-proto-fail');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const actual = workflowEvents.writeJsonAtomic;
    let protocolWrites = 0;
    vi.spyOn(workflowEvents, 'writeJsonAtomic').mockImplementation((filePath, value) => {
      if (String(filePath).replace(/\\/g, '/').endsWith('/protocol.json')) {
        protocolWrites += 1;
        if (protocolWrites === 1) {
          throw new Error('injected protocol persist failure');
        }
      }
      actual(filePath, value);
    });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(
      /injected protocol persist failure/i
    );
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  });

  it('TEE-V24-FINISH-ATOMIC-STATE-FAIL-012: correlation persist failure cannot leave protocol finalised', async () => {
    const repoRoot = makeTempRoot('atomic-state-fail');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    vi.spyOn(workflowEvents, 'saveWorkflowReviewState').mockImplementation(() => {
      throw new Error('injected state persist failure');
    });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(
      /injected state persist failure/i
    );
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  });

  it('TEE-V24-FINISH-ATOMIC-RUN-013 / TEE-V24-FINISH-ATOMIC-MARKER-014: failed C9 cannot claim passed run or finalised marker', async () => {
    const repoRoot = makeTempRoot('atomic-run');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expectFinishRejectedAndNotFinalised(repoRoot, /refuse finish\(passed\)|missing/i);
  });

  it('TEE-V24-FINISH-ATOMIC-DIAG-015: failure path can record diagnostics without granting success', async () => {
    const repoRoot = makeTempRoot('atomic-diag');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    const run = createProtectedRun(repoRoot);
    await expect(run.finish('passed')).rejects.toThrow(/refuse finish\(passed\)|missing/i);
    await expect(run.finish('failed', new Error('c9 rejected'))).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
    expect(listRunLogs(repoRoot).some((log) => log.status === 'failed')).toBe(true);
  });

  it('TEE-V24-FINISH-ATOMIC-CLEAR-016: successful path clears live context after validation', async () => {
    const repoRoot = makeTempRoot('atomic-clear');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    await run.finish('passed');
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(activeContext(repoRoot)).toBeNull();
    expect(run.loadCapturedC9Identity().ok).toBe(true);
  });

  it('TEE-V24-FINISH-ATOMIC-RETRY-017: retry after failed validation starts from truthful non-finalised state', async () => {
    const repoRoot = makeTempRoot('atomic-retry');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/missing/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    saveC9State(repoRoot, head);
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
  });
});
