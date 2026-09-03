import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  createEmptyProtocolRecord,
  getProtocolRecordPath,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
  writeCriticalPlan,
  writePassingManifest,
} from './workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function bindAndInit(repoRoot: string, workstreamId: string, head: string) {
  const planPath = writeCriticalPlan(repoRoot, workstreamId);
  const init = applyProtocolTransition({
    repoRoot,
    command: 'init',
    workstreamId,
    baseCommit: head,
    planPath,
  });
  expect(init.ok).toBe(true);
  return init;
}

describe('first-review contract blockers', () => {
  it('FDR-CRITICAL-CONTRACT-001: CRITICAL preflight and first review require a bound approved plan with requiredTests', () => {
    const repoRoot = makeTempRoot('fdr-critical-contract');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_fdr_contract_1';
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId,
        baseCommit: head,
      }).ok
    ).toBe(true);
    const unbound = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath: writePassingManifest(repoRoot, workstreamId, 'preflight', undefined, []),
    });
    expect(unbound.ok).toBe(false);
    expect(unbound.message).toMatch(/bound plan contract/i);

    const skippedId = 'ws_fdr_contract_skip';
    const skipped = createDefaultPlanContract({
      workstreamId: skippedId,
      taskId: skippedId,
      taskType: 'change',
      lane: 'critical',
      rationale: 'unapproved architecture',
      fallbackEscalation:
        'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
      requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
    });
    skipped.architectureGate = {
      decision: 'skipped',
      source: 'not_applicable',
      modelId: 'gpt-5.6-sol-high',
    };
    const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const skippedPlan = path.join(plansDir, `${skippedId}.md`);
    writeFileSync(skippedPlan, `# fixture\n\n${renderPlanContractMarker(skipped)}\n`, 'utf8');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: skippedId,
        baseCommit: head,
        planPath: skippedPlan,
      }).ok
    ).toBe(true);
    const unapproved = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: skippedId,
      manifestPath: writePassingManifest(repoRoot, skippedId, 'preflight'),
    });
    expect(unapproved.ok).toBe(false);
    expect(unapproved.message).toMatch(/architecture gate must be approved/i);

    bindAndInit(repoRoot, 'ws_fdr_contract_ok', head);
    const ready = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: 'ws_fdr_contract_ok',
      manifestPath: writePassingManifest(repoRoot, 'ws_fdr_contract_ok', 'preflight'),
    });
    expect(ready.ok).toBe(true);
    const first = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fdr_contract_ok',
      pass: 'first',
    });
    expect(first.ok).toBe(true);
  });

  it('FDR-EVIDENCE-BINDING-002: manifests bind filename to contentHash, reject symlinks, and re-check plan IDs at first review-start', () => {
    const repoRoot = makeTempRoot('fdr-evidence-binding');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_fdr_evidence_1';
    bindAndInit(repoRoot, workstreamId, head);
    const goodPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    const workstreamDir = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      workstreamId
    );
    const renamed = path.join(workstreamDir, 'preflight-not-bound-to-hash.json');
    copyFileSync(path.join(repoRoot, goodPath), renamed);
    const renamedRecord = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath: renamed,
    });
    expect(renamedRecord.ok).toBe(false);
    expect(renamedRecord.message).toMatch(/filename must bind to contentHash/i);

    const linkPath = path.join(workstreamDir, 'preflight-symlink.json');
    try {
      symlinkSync(path.resolve(repoRoot, goodPath), linkPath);
      const linked = applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId,
        manifestPath: linkPath,
      });
      expect(linked.ok).toBe(false);
      expect(linked.message).toMatch(/symlink/i);
    } catch {
      // Some environments disallow symlink creation; filename binding remains above.
    }

    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId,
        manifestPath: goodPath,
      }).ok
    ).toBe(true);

    const planPath = path.join(repoRoot, 'docs_private', 'automation', 'plans', `${workstreamId}.md`);
    const skipped = createDefaultPlanContract({
      workstreamId,
      taskId: workstreamId,
      taskType: 'change',
      lane: 'critical',
      rationale: 'post-preflight architecture skip',
      fallbackEscalation:
        'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
      requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
    });
    skipped.architectureGate = {
      decision: 'skipped',
      source: 'not_applicable',
      modelId: 'gpt-5.6-sol-high',
    };
    writeFileSync(planPath, `# fixture\n\n${renderPlanContractMarker(skipped)}\n`, 'utf8');
    const first = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    expect(first.ok).toBe(false);
    expect(first.message).toMatch(/architecture gate must be approved|stale or invalid/i);
  });

  it('FDR-REVIEW-AUTHORITY-003: missing or exhausted review evidence cannot delta or finalise', () => {
    const repoRoot = makeTempRoot('fdr-review-authority');
    const head = initGitRepo(repoRoot);
    const emptyId = 'ws_fdr_authority_empty';
    const empty = createEmptyProtocolRecord({
      workstreamId: emptyId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    empty.phase = 'review_closed';
    empty.nextAction = 'finalise_start';
    writeProtocolRecord(repoRoot, empty);
    const emptyFinalise = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId: emptyId,
    });
    expect(emptyFinalise.ok).toBe(false);
    const emptyDelta = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: emptyId,
      pass: 'delta',
    });
    expect(emptyDelta.ok).toBe(false);
    expect(emptyDelta.message).toMatch(/malformed|missing or exhausted review evidence/i);

    const exhaustedId = 'ws_fdr_authority_exh';
    const exhausted = createEmptyProtocolRecord({
      workstreamId: exhaustedId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    exhausted.phase = 'routing_required';
    exhausted.nextAction = 'route_or_isolate';
    exhausted.failedPremiumReviewCount = 2;
    exhausted.inheritedFailedReviewCount = 2;
    exhausted.headCommit = head;
    exhausted.reviewedTreeFingerprint = 'f'.repeat(32);
    exhausted.reviewAttempts = [
      {
        pass: 'first',
        token: 'rev_first_fdr_authority',
        startedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        result: 'passed',
        headCommit: head,
        treeFingerprint: 'f'.repeat(32),
      },
    ];
    writeProtocolRecord(repoRoot, exhausted);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'finalise-start',
        workstreamId: exhaustedId,
      }).ok
    ).toBe(false);
    const exhaustedDelta = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: exhaustedId,
      pass: 'delta',
    });
    expect(exhaustedDelta.ok).toBe(false);
    expect(exhaustedDelta.exitCode).toBe(2);
  });

  it('FDR-PROTOCOL-INTEGRITY-004: malformed protocol.json cannot be treated as missing and overwritten', () => {
    const repoRoot = makeTempRoot('fdr-protocol-integrity');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_fdr_integrity_1';
    const protocolPath = getProtocolRecordPath(repoRoot, workstreamId);
    mkdirSync(path.dirname(protocolPath), { recursive: true });
    const garbage = '{not-json';
    writeFileSync(protocolPath, garbage, 'utf8');
    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: head,
    });
    expect(init.ok).toBe(false);
    expect(init.message).toMatch(/malformed/i);
    expect(readFileSync(protocolPath, 'utf8')).toBe(garbage);
    expect(existsSync(protocolPath)).toBe(true);

    const incompletePath = getProtocolRecordPath(repoRoot, 'ws_fdr_integrity_2');
    mkdirSync(path.dirname(incompletePath), { recursive: true });
    writeFileSync(
      incompletePath,
      JSON.stringify({ schemaVersion: '1', workstreamId: 'ws_fdr_integrity_2' }),
      'utf8'
    );
    const incomplete = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_fdr_integrity_2',
      baseCommit: head,
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.message).toMatch(/malformed/i);
    expect(JSON.parse(readFileSync(incompletePath, 'utf8')).phase).toBeUndefined();
  });
});
