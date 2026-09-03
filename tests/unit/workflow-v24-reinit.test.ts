import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  cleanupWorkflowV24Fixtures,
  declaredRehome,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writeCriticalPlan,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function initFromPlan(
  repoRoot: string,
  workstreamId: string,
  baseCommit: string,
  planPath: string
) {
  return applyProtocolTransition({
    repoRoot,
    command: 'init',
    workstreamId,
    planPath,
    baseCommit,
  });
}

describe('TEE V2.4 re-init security bindings', () => {
  it('TEE-V24-REINIT-PLANPATH-001: initialized record keeps planPath on re-init', () => {
    const repoRoot = makeTempRoot('reinit-plan');
    const base = initGitRepo(repoRoot);
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_plan', {});
    expect(initFromPlan(repoRoot, 'ws_reinit_plan', base, planPath).ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_plan')?.planPath).toBe(
      'docs_private/automation/plans/ws_reinit_plan.md'
    );
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_plan',
        baseCommit: base,
      }).ok
    ).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_plan')?.planPath).toBe(
      'docs_private/automation/plans/ws_reinit_plan.md'
    );
  });

  it('TEE-V24-REINIT-REHOME-002: bound rehomeProvenance survives re-init without a plan', () => {
    const repoRoot = makeTempRoot('reinit-rehome');
    const base = initGitRepo(repoRoot);
    const rehome = declaredRehome(base, 'main');
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_rehome', { rehome });
    expect(initFromPlan(repoRoot, 'ws_reinit_rehome', base, planPath).ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_rehome')?.rehomeProvenance?.status).toBe(
      'declared'
    );
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_rehome',
        baseCommit: base,
      }).ok
    ).toBe(true);
    const record = readProtocolRecord(repoRoot, 'ws_reinit_rehome')!;
    expect(record.rehomeProvenance?.predecessorRootWorkstreamId).toBe('ws_ffts_pred_root');
    expect(record.rehomeProvenance?.sourcePatchSha256).toBe(rehome.sourcePatchSha256);
  });

  it('TEE-V24-REINIT-BOTH-003: planPath and rehomeProvenance are both retained', () => {
    const repoRoot = makeTempRoot('reinit-both');
    const base = initGitRepo(repoRoot);
    const rehome = declaredRehome(base, 'main');
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_both', { rehome });
    expect(initFromPlan(repoRoot, 'ws_reinit_both', base, planPath).ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_both',
        baseCommit: base,
      }).ok
    ).toBe(true);
    const record = readProtocolRecord(repoRoot, 'ws_reinit_both')!;
    expect(record.planPath).toBe('docs_private/automation/plans/ws_reinit_both.md');
    expect(record.rehomeProvenance?.predecessorDescendantWorkstreamId).toBe('ws_ffts_pred_leaf');
  });

  it('TEE-V24-REINIT-COUNTS-004: failed and inherited premium counts are retained', () => {
    const repoRoot = makeTempRoot('reinit-counts');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_reinit_counts', base);
    const existing = readProtocolRecord(repoRoot, 'ws_reinit_counts')!;
    existing.inheritedFailedReviewCount = 2;
    existing.failedPremiumReviewCount = 2;
    writeProtocolRecord(repoRoot, existing);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_counts',
        baseCommit: base,
      }).ok
    ).toBe(true);
    const record = readProtocolRecord(repoRoot, 'ws_reinit_counts')!;
    expect(record.inheritedFailedReviewCount).toBe(2);
    expect(record.failedPremiumReviewCount).toBe(2);
  });

  it('TEE-V24-REINIT-CONFLICT-PLAN-005: conflicting plan path fails closed', () => {
    const repoRoot = makeTempRoot('reinit-conflict-plan');
    const base = initGitRepo(repoRoot);
    const first = writeCriticalPlan(repoRoot, 'ws_reinit_conflict_a');
    expect(initFromPlan(repoRoot, 'ws_reinit_conflict_a', base, first).ok).toBe(true);
    const second = writeCriticalPlan(repoRoot, 'ws_reinit_conflict_a', {
      fileName: 'ws_reinit_conflict_a-other.md',
    });
    const again = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_reinit_conflict_a',
      planPath: second,
      baseCommit: base,
    });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/planPath conflict/i);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_conflict_a')?.planPath).toBe(
      'docs_private/automation/plans/ws_reinit_conflict_a.md'
    );
  });

  it('TEE-V24-REINIT-CONFLICT-REHOME-006: conflicting re-home provenance fails closed', () => {
    const repoRoot = makeTempRoot('reinit-conflict-rehome');
    const base = initGitRepo(repoRoot);
    const first = writeCriticalPlan(repoRoot, 'ws_reinit_rh_a', {
      rehome: declaredRehome(base, 'main'),
    });
    expect(initFromPlan(repoRoot, 'ws_reinit_rh_a', base, first).ok).toBe(true);
    const other = declaredRehome(base, 'main', 'cccccccccccccccccccccccccccccccccccccccc');
    other.predecessorRootWorkstreamId = 'ws_other_root';
    const secondPath = writeCriticalPlan(repoRoot, 'ws_reinit_rh_a', { rehome: other });
    const again = initFromPlan(repoRoot, 'ws_reinit_rh_a', base, secondPath);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/rehome provenance conflicts|cannot replace bound security field/i);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_rh_a')?.rehomeProvenance?.predecessorRootWorkstreamId).toBe(
      'ws_ffts_pred_root'
    );
  });

  it('TEE-V24-REINIT-NO-UNBIND-007: re-init cannot convert re-homed state into an unbound continuation', () => {
    const repoRoot = makeTempRoot('reinit-unbind');
    const base = initGitRepo(repoRoot);
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_unbind', {
      rehome: declaredRehome(base, 'main'),
    });
    expect(initFromPlan(repoRoot, 'ws_reinit_unbind', base, planPath).ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_unbind',
        baseCommit: base,
      }).ok
    ).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_reinit_unbind')?.rehomeProvenance).toBeTruthy();
  });

  it('TEE-V24-REINIT-NO-MINT-008: re-init cannot create new first-review entitlement', () => {
    const repoRoot = makeTempRoot('reinit-mint');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_reinit_mint', base);
    const existing = readProtocolRecord(repoRoot, 'ws_reinit_mint')!;
    existing.inheritedFailedReviewCount = 2;
    existing.failedPremiumReviewCount = 2;
    writeProtocolRecord(repoRoot, existing);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_reinit_mint',
        baseCommit: base,
      }).ok
    ).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_reinit_mint',
        pass: 'first',
      }).ok
    ).toBe(false);
  });

  it('TEE-V24-REINIT-IDEMPOTENT-009: repeated identical init is idempotent', () => {
    const repoRoot = makeTempRoot('reinit-idem');
    const base = initGitRepo(repoRoot);
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_idem', {
      rehome: declaredRehome(base, 'main'),
    });
    expect(initFromPlan(repoRoot, 'ws_reinit_idem', base, planPath).ok).toBe(true);
    const first = readProtocolRecord(repoRoot, 'ws_reinit_idem')!;
    expect(initFromPlan(repoRoot, 'ws_reinit_idem', base, planPath).ok).toBe(true);
    const second = readProtocolRecord(repoRoot, 'ws_reinit_idem')!;
    expect(second.planPath).toBe(first.planPath);
    expect(second.rehomeProvenance?.predecessorHeadCommit).toBe(
      first.rehomeProvenance?.predecessorHeadCommit
    );
    expect(second.failedPremiumReviewCount).toBe(first.failedPremiumReviewCount);
    expect(second.baseCommit).toBe(first.baseCommit);
    expect(second.branchName).toBe(first.branchName);
  });

  it('TEE-V24-REINIT-MALFORMED-010: malformed existing provenance fails closed rather than being erased', () => {
    const repoRoot = makeTempRoot('reinit-malformed');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_reinit_bad', base);
    const existing = readProtocolRecord(repoRoot, 'ws_reinit_bad')!;
    existing.rehomeProvenance = { schemaVersion: '1', status: 'declared' } as never;
    writeProtocolRecord(repoRoot, existing);
    const again = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_reinit_bad',
      baseCommit: base,
    });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/malformed/i);
    const stored = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'docs_private', 'automation', 'workstreams', 'ws_reinit_bad', 'protocol.json'),
        'utf8'
      )
    ) as { rehomeProvenance?: unknown };
    expect(stored.rehomeProvenance).toEqual({ schemaVersion: '1', status: 'declared' });
  });

  it('FD-LINEAGE-BOUND-MALFORMED-002: bound provenance missing evidence fails closed on re-init', () => {
    const repoRoot = makeTempRoot('reinit-bound-malformed');
    const base = initGitRepo(repoRoot);
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_bound_bad', {
      rehome: declaredRehome(base, 'main'),
    });
    expect(initFromPlan(repoRoot, 'ws_reinit_bound_bad', base, planPath).ok).toBe(true);
    const existing = readProtocolRecord(repoRoot, 'ws_reinit_bound_bad')!;
    existing.rehomeProvenance = {
      ...existing.rehomeProvenance!,
      status: 'bound',
      boundAt: new Date().toISOString(),
    };
    writeProtocolRecord(repoRoot, existing);
    const again = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_reinit_bound_bad',
      baseCommit: base,
    });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/malformed|evidence|refuse to erase/i);
    const stored = readProtocolRecord(repoRoot, 'ws_reinit_bound_bad')!;
    expect(stored.rehomeProvenance?.status).toBe('bound');
    expect(stored.rehomeProvenance?.evidence).toBeUndefined();
  });

  it('TEE-V24-REINIT-DECLARED-011: plan-declared rehome cannot disappear through canonical init', () => {
    const repoRoot = makeTempRoot('reinit-plan-rehome');
    const base = initGitRepo(repoRoot);
    const planPath = writeCriticalPlan(repoRoot, 'ws_reinit_declared', {
      rehome: declaredRehome(base, 'main'),
    });
    const init = initFromPlan(repoRoot, 'ws_reinit_declared', base, planPath);
    expect(init.ok, init.message).toBe(true);
    expect(init.record?.rehomeProvenance?.status).toBe('declared');
    expect(init.record?.planPath).toBe('docs_private/automation/plans/ws_reinit_declared.md');
  });
});
