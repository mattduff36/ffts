import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import { buildWorkflowFindings } from '@/scripts/automation/workflow-findings';
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  readProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { buildWorkflowStopEvent } from '@/scripts/automation/workflow-review';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';

const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = path.join(
    tmpdir(),
    `workflow-protocol-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function writePassingManifest(
  repoRoot: string,
  workstreamId: string,
  kind: 'preflight' | 'fix-delta',
  closedBlockerIds?: string[]
): string {
  const built = buildEvidenceManifest({
    repoRoot,
    workstreamId,
    kind,
    baseCommit: 'abc1234deadbeef',
    requiredTestIds: [],
    runChecks: false,
    closedBlockerIds,
    blockerEvidence: closedBlockerIds?.map((blockerId) => ({
      blockerId,
      evidenceLabel: `targeted:${blockerId}`,
      commandName: 'fixture',
    })),
    commandResults: [
      {
        name: 'fixture',
        status: 'passed',
        exitCode: 0,
        durationMs: 1,
        summary: 'ok',
      },
    ],
  });
  expect(built.manifest.status).toBe('passed');
  return built.relativePath;
}

describe('workflow review protocol', () => {
  it('TEE-EVID-001: rejects a review token when recorded evidence no longer matches the tree', () => {
    const repoRoot = makeTempRoot('stale-review-start');
    const workstreamId = 'ws_stale_review_start';
    writeFileSync(path.join(repoRoot, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    writeFileSync(path.join(repoRoot, '.gitignore'), 'docs_private/\n', 'utf8');
    spawnSync('git', ['init'], { cwd: repoRoot });
    spawnSync('git', ['add', '.'], { cwd: repoRoot });
    spawnSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: repoRoot }
    );
    applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: 'abc1234deadbeef',
    });
    const manifestPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId,
        manifestPath,
      }).ok
    ).toBe(true);

    writeFileSync(path.join(repoRoot, 'changed-after-preflight.ts'), 'export {};\n', 'utf8');
    const started = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    expect(started.ok).toBe(false);
    expect(started.message).toContain('stale');
  });

  it('TEE-PROTO-001: two-pass budget, one-use tokens, routing, and finalise readiness', () => {
    const repoRoot = makeTempRoot('route');
    const workstreamId = 'ws_protocol_route_1';

    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: 'abc1234deadbeef',
    });
    expect(init.ok).toBe(true);
    expect(init.record?.phase).toBe('initialized');

    const manifestPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    const preflight = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath,
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.record?.phase).toBe('preflight_ready');

    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    expect(firstStart.ok).toBe(true);
    expect(firstStart.reviewToken).toBeTruthy();

    const firstFail = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth-boundary'],
      blockerIds: ['BLK-1'],
      siblingSurfaces: ['reports-stats'],
    });
    expect(firstFail.ok).toBe(true);
    expect(firstFail.record?.phase).toBe('fix_sweep_required');

    const reused = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'passed',
    });
    expect(reused.ok).toBe(false);

    const fixPath = writePassingManifest(repoRoot, workstreamId, 'fix-delta', ['BLK-1']);
    const fix = applyProtocolTransition({
      repoRoot,
      command: 'fix-record',
      workstreamId,
      manifestPath: fixPath,
      closedBlockerIds: ['BLK-1'],
    });
    expect(fix.ok).toBe(true);
    expect(fix.record?.phase).toBe('fix_recorded');

    const closureStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'closure',
    });
    expect(closureStart.ok).toBe(true);

    const secondFail = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: closureStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth-boundary'],
      blockerIds: ['BLK-2'],
      siblingSurfaces: ['ownership-pivot'],
    });
    expect(secondFail.ok).toBe(false);
    expect(secondFail.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
    expect(secondFail.record?.phase).toBe('routing_required');

    const thirdStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'closure',
    });
    expect(thirdStart.ok).toBe(false);
    expect(thirdStart.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);

    const split = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId,
      newWorkstreamId: 'ws_protocol_route_child',
    });
    expect(split.ok).toBe(true);
    expect(split.splitWorkstreamId).toBe('ws_protocol_route_child');
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('split');
  });

  it('TEE-PROTO-001: successful closure reaches finalise_ready', () => {
    const repoRoot = makeTempRoot('finalise-ready');
    const workstreamId = 'ws_finalise_ready_1';
    applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: 'abc1234deadbeef',
    });
    const preflight = writePassingManifest(repoRoot, workstreamId, 'preflight');
    applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath: preflight,
    });
    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'passed',
    });
    const closed = readProtocolRecord(repoRoot, workstreamId);
    expect(closed?.phase).toBe('review_closed');

    const finaliseStart = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(finaliseStart.ok).toBe(true);
    expect(finaliseStart.record?.phase).toBe('finalise_ready');
    expect(finaliseStart.checkpointId).toBeTruthy();

    const restart = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(restart.ok).toBe(true);
    expect(restart.checkpointId).toBe(finaliseStart.checkpointId);
    expect(readProtocolRecord(repoRoot, workstreamId)?.activeCheckpointId).toBe(
      finaliseStart.checkpointId
    );
  });

  it('TEE-PROTO-001: null transcript remains unknown without inferred identity', async () => {
    const repoRoot = makeTempRoot('telemetry');
    const event = await buildWorkflowStopEvent(
      {
        conversation_id: 'conv-1',
        generation_id: 'gen-1',
        status: 'completed',
        loop_count: 0,
        transcript_path: null,
        model: 'cursor-grok-4.5-high-fast',
      },
      { repoRoot }
    );
    expect(event.transcriptStatus).toBe('null');
    expect(event.identityStatus).toBe('missing');
    expect(event.workstreamId).toBeUndefined();
    expect(event.findings.some((finding) => finding.id === 'missing-transcript')).toBe(true);
  });

  it('TEE-PROTO-001: default critical plan contract includes two-pass-v1', () => {
    const contract = createDefaultPlanContract({
      taskId: 'task-protocol',
      taskType: 'change',
      lane: 'critical',
      rationale: 'test',
      fallbackEscalation: 'escalate',
      requiredTests: [{ id: 'TEE-PROTO-001', status: 'unresolved' }],
      independentReviewReasons: ['broad-regression'],
    });
    expect(contract.reviewClosureProtocol).toBe('two-pass-v1');
    const rendered = renderPlanContractMarker(contract);
    expect(rendered).toContain('plan-contract-marker:v2');
    expect(rendered).toContain('two-pass-v1');
  });

  it('TEE-PROTO-001: review-loop finding fires at two failures', () => {
    const findings = buildWorkflowFindings({
      marker: null,
      markerStatus: 'missing',
      transcriptSignals: null,
      transcriptStatus: 'parsed',
      identityStatus: 'present',
      protocolPhase: 'routing_required',
      failedPremiumReviewCount: 2,
    });
    expect(findings.some((finding) => finding.id === 'review-loop-unbounded')).toBe(true);
  });

  it('TEE-PRIV-001 / TEE-EVID-001: evidence manifests mark redaction and omit secrets', () => {
    const repoRoot = makeTempRoot('privacy');
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_privacy_1',
      kind: 'preflight',
      baseCommit: 'abc1234',
      runChecks: false,
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(built.manifest.status).toBe('passed');
    expect(built.manifest.privacy.redacted).toBe(true);
    expect(JSON.stringify(built.manifest)).not.toMatch(/POSTGRES_URL|password|secret/iu);
  });

  it('TEE-PATH-001: unsafe workstream IDs are rejected before filesystem use', () => {
    const repoRoot = makeTempRoot('unsafe-id');
    const result = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: '../evil',
      baseCommit: 'abc1234',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/path-safe|opaque|traversal|separator/i);
  });

  it('TEE-PATH-001 / TEE-PRIV-001: manifests must stay in the workstream directory and sanitize hostile command output', () => {
    const repoRoot = makeTempRoot('manifest-containment');
    writeFileSync(path.join(repoRoot, 'package.json'), '{"name":"tmp"}', 'utf8');
    writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}', 'utf8');
    applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_manifest_1',
      baseCommit: 'abc1234deadbeef',
    });

    const hostile = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_manifest_1',
      kind: 'preflight',
      baseCommit: 'abc1234deadbeef',
      runChecks: false,
      commandResults: [
        {
          name: 'fixture',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'token=supersecretvalue123 Bearer abcdefghijkl',
          command: 'echo C:\\Users\\example\\docs_private\\secret.json',
        },
      ],
    });
    expect(hostile.manifest.status).toBe('passed');
    expect(JSON.stringify(hostile.manifest.commands)).not.toMatch(/supersecretvalue123|Bearer abcdefghijkl/i);
    expect(JSON.stringify(hostile.manifest.commands)).not.toMatch(/C:\\\\Users\\\\example/i);

    const outside = path.join(repoRoot, 'outside-manifest.json');
    writeFileSync(outside, readFileSync(path.join(repoRoot, hostile.relativePath), 'utf8'), 'utf8');
    const rejected = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: 'ws_manifest_1',
      manifestPath: outside,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/workstream protocol directory|escapes repository/i);
  });

  it('TEE-PATH-001 / TEE-PRIV-001: protocol init persists repo-relative planPath only', () => {
    const repoRoot = makeTempRoot('relative-plan');
    const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const contract = createDefaultPlanContract({
      workstreamId: 'ws_relative_plan_1',
      taskId: 'relative-plan',
      taskType: 'change',
      lane: 'critical',
      rationale: 'relative plan path',
      fallbackEscalation: 'route',
      requiredTests: [{ id: 'TEE-PATH-001', status: 'unresolved' }],
      independentReviewReasons: ['broad-regression'],
    });
    const absolutePlanPath = path.join(plansDir, 'relative-plan.md');
    writeFileSync(
      absolutePlanPath,
      `# Plan\n\n## Required tests\n\n- TEE-PATH-001\n\n${renderPlanContractMarker(contract)}\n`,
      'utf8'
    );

    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_relative_plan_1',
      planPath: absolutePlanPath,
      baseCommit: 'abc1234deadbeef',
    });
    expect(init.ok).toBe(true);
    expect(init.record?.planPath).toBe('docs_private/automation/plans/relative-plan.md');
    expect(init.record?.planPath).not.toMatch(/^[A-Za-z]:\\/u);
    expect(init.record?.planPath).not.toMatch(/^\/(?:Users|home)\//u);
    expect(path.isAbsolute(init.record?.planPath ?? '')).toBe(false);
  });

  it('TEE-EVID-001: preflight binds child-owned requiredTestIds, not only master requiredTests', () => {
    const repoRoot = makeTempRoot('child-bind');
    const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
    const testsDir = path.join(repoRoot, 'tests', 'unit');
    mkdirSync(plansDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      path.join(testsDir, 'child-bind.test.ts'),
      "import { it } from 'vitest';\nit('TEE-PLAN-001 child');\nit('TEE-PATH-001 child');\nit('TEE-PROTO-001 child');\n",
      'utf8'
    );

    const master = createDefaultPlanContract({
      workstreamId: 'ws_master_bind_1',
      taskId: 'master-bind',
      taskType: 'change',
      lane: 'critical',
      rationale: 'child binding',
      fallbackEscalation: 'route',
      requiredTests: [
        { id: 'TEE-FINALISE-001', status: 'unresolved' },
        { id: 'TEE-PLAN-001', status: 'unresolved' },
      ],
      independentReviewReasons: ['broad-regression'],
    });
    const childId = 'ws_child_bind_1';
    master.childWorkstreams = [
      {
        workstreamId: childId,
        scope: 'core',
        status: 'pending',
        requiredTestIds: ['TEE-PLAN-001', 'TEE-PATH-001', 'TEE-PROTO-001'],
        finalReview: { required: true, source: 'independent_subagent', status: 'pending' },
        commit: { status: 'pending' },
        handoff: { status: 'pending' },
      },
    ];
    const planPath = path.join(plansDir, 'master-bind.md');
    writeFileSync(
      planPath,
      `# Plan\n\n## Required tests\n\n- TEE-FINALISE-001\n- TEE-PLAN-001\n\n${renderPlanContractMarker(master)}\n`,
      'utf8'
    );

    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: childId,
        planPath,
        baseCommit: 'abc1234deadbeef',
      }).ok
    ).toBe(true);

    const emptyManifest = writePassingManifest(repoRoot, childId, 'preflight');
    const missingChild = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: childId,
      manifestPath: emptyManifest,
    });
    expect(missingChild.ok).toBe(false);
    expect(missingChild.message).toMatch(/preflight missing plan requiredTests/i);
    expect(missingChild.message).toMatch(/TEE-PLAN-001/);
    expect(missingChild.message).not.toMatch(/TEE-FINALISE-001/);

    const childManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId: childId,
      kind: 'preflight',
      baseCommit: 'abc1234deadbeef',
      requiredTestIds: ['TEE-PLAN-001', 'TEE-PATH-001', 'TEE-PROTO-001'],
      executedTestIds: ['TEE-PLAN-001', 'TEE-PATH-001', 'TEE-PROTO-001'],
      runChecks: false,
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    const bound = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: childId,
      manifestPath: childManifest.relativePath,
    });
    expect(bound.ok).toBe(true);
    expect(bound.record?.phase).toBe('preflight_ready');
  });

  it('TEE-EVID-001: preflight fails closed when the bound plan is malformed', () => {
    const repoRoot = makeTempRoot('fail-closed-plan');
    const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const contract = createDefaultPlanContract({
      workstreamId: 'ws_fail_closed_1',
      taskId: 'fail-closed',
      taskType: 'change',
      lane: 'critical',
      rationale: 'fail closed',
      fallbackEscalation: 'route',
      requiredTests: [{ id: 'TEE-EVID-001', status: 'unresolved' }],
      independentReviewReasons: ['broad-regression'],
    });
    const planPath = path.join(plansDir, 'fail-closed.md');
    writeFileSync(
      planPath,
      `# Plan\n\n## Required tests\n\n- TEE-EVID-001\n\n${renderPlanContractMarker(contract)}\n`,
      'utf8'
    );
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'init',
        workstreamId: 'ws_fail_closed_1',
        planPath,
        baseCommit: 'abc1234deadbeef',
      }).ok
    ).toBe(true);

    writeFileSync(planPath, '# corrupted\n<!-- plan-contract-marker:v2\n{not-json\n-->\n', 'utf8');
    const manifestPath = writePassingManifest(repoRoot, 'ws_fail_closed_1', 'preflight');
    const result = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: 'ws_fail_closed_1',
      manifestPath,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/preflight plan contract|malformed|unreadable/i);
  });

  it('TEE-PRIV-001: evidence manifests reject secrets and absolute private paths in blocker fields', () => {
    const repoRoot = makeTempRoot('manifest-privacy');

    expect(() =>
      buildEvidenceManifest({
        repoRoot,
        workstreamId: 'ws_manifest_privacy_1',
        kind: 'fix-delta',
        baseCommit: 'abc1234deadbeef',
        runChecks: false,
        closedBlockerIds: ['C:\\Users\\example\\secret-blocker'],
        blockerEvidence: [
          {
            blockerId: 'C:\\Users\\example\\secret-blocker',
            evidenceLabel: 'targeted:/Users/example/private/note.txt',
            commandName: 'fixture',
          },
        ],
        commandResults: [
          { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        ],
      })
    ).toThrow(/privacy violations|absolute private path/i);

    expect(() =>
      buildEvidenceManifest({
        repoRoot,
        workstreamId: 'ws_manifest_privacy_2',
        kind: 'fix-delta',
        baseCommit: 'abc1234deadbeef',
        runChecks: false,
        closedBlockerIds: ['BLK-EMAIL'],
        blockerEvidence: [
          {
            blockerId: 'BLK-EMAIL',
            evidenceLabel: 'contact leak@example.com',
            commandName: 'fixture',
          },
        ],
        commandResults: [
          { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        ],
      })
    ).toThrow(/privacy violations|email/i);

    const clean = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_manifest_privacy_3',
      kind: 'fix-delta',
      baseCommit: 'abc1234deadbeef',
      runChecks: false,
      closedBlockerIds: ['BLK-1'],
      blockerEvidence: [
        {
          blockerId: 'BLK-1',
          evidenceLabel: 'targeted:BLK-1',
          commandName: 'fixture',
        },
      ],
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(clean.manifest.status).toBe('passed');
    expect(clean.manifest.privacy.redacted).toBe(true);
  });
});
