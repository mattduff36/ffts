import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOpaqueId,
  createDefaultPlanContract,
  createWorkflowWorkstreamId,
  extractPlanContractMarker,
  pathHasSymlinkComponent,
  renderPlanContractMarker,
  resolvePlanPath,
  resolveRequiredTestIdsForWorkstream,
  validatePlanFile,
  validatePlanMarkdown,
} from '@/scripts/automation/workflow-plan-contract';
import { WORKFLOW_MODEL_TIER_REGISTRY_VERSION } from '@/scripts/automation/workflow-model-tier';
import { runWorkflowPlanValidate } from '@/scripts/workflow-plan-validate';

function validPlanMarkdown(
  contract = createDefaultPlanContract({
    taskId: 'plan-demo',
    taskType: 'change',
    lane: 'critical',
    initialParentTier: 'economical',
    routingDecision: 'economical_default',
    rationale: 'Critical persistence change needs economical build with premium gates.',
    fallbackEscalation: 'Escalate if verification fails twice.',
    requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
    independentReviewReasons: ['persistence'],
  })
): string {
  return [
    '---',
    'name: demo',
    'overview: demo',
    'todos: []',
    'isProject: false',
    '---',
    '',
    renderPlanContractMarker(contract),
    '',
    '# Demo plan',
    '',
    '## Classification',
    '',
    `- lane: ${contract.lane}`,
    `- routingDecision: ${contract.routingDecision}`,
    '',
    '## Recommended build model',
    '',
    `- Implementation: Cursor Grok ${contract.models?.implementation.tier} economical-default`,
    '- Exact model IDs for planning, architecture, final review, and fix routing',
    '',
    '## Architecture gate',
    '',
    '- independent architecture-gate before edits',
    '',
    '## Implementation contract',
    '',
    '- invariants and rollback',
    '',
    '## Required tests',
    '',
    ...contract.requiredTests.map((test) => `- ${test.id}`),
    '',
    '## Final review',
    '',
    '- independent final-diff-reviewer',
    '',
    '## Commit and handoff',
    '',
    '- local commit and marker',
    '',
  ].join('\n');
}

describe('workflow plan contract', () => {
  it('TEE-PLAN-001: validates native V2.2 lanes, headings, exact model IDs, invariants, rollback, risks, and stable tests', () => {
    const contract = createDefaultPlanContract({
      sourceWorkstreamIds: ['ws_source_a', 'ws_source_b'],
      taskId: 'plan-demo',
      taskType: 'change',
      lane: 'critical',
      initialParentTier: 'economical',
      routingDecision: 'economical_default',
      rationale: 'Critical persistence change needs economical build with premium gates.',
      fallbackEscalation: 'Escalate if verification fails twice.',
      requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
      independentReviewReasons: ['persistence'],
    });
    const markdown = validPlanMarkdown(contract);
    const parsed = validatePlanMarkdown(markdown);
    expect(parsed.status).toBe('present');
    expect(parsed.contract?.schemaVersion).toBe('2');
    expect(parsed.contract?.registryVersion).toBe(WORKFLOW_MODEL_TIER_REGISTRY_VERSION);
    expect(parsed.contract?.lane).toBe('critical');
    expect(parsed.contract?.models?.implementation.modelId).toBe('cursor-grok-4.5-high-fast');
    expect(parsed.contract?.models?.architecture.modelId).toBe('gpt-5.6-sol-high');
    expect(parsed.contract?.implementationContract?.rollback).toBeTruthy();
    expect(parsed.contract?.reviewClosureProtocol).toBe('two-pass-v1');
    expect(parsed.contract?.sourceWorkstreamIds).toEqual(['ws_source_a', 'ws_source_b']);
    expect(extractPlanContractMarker(markdown).status).toBe('present');
  });

  it('TEE-PLAN-001: missing marker, duplicate test IDs, critical contract gaps, and heading gaps fail validation', () => {
    const missing = validatePlanMarkdown('# No contract\n');
    expect(missing.status).toBe('missing');

    const contract = createDefaultPlanContract({
      taskId: 'broken',
      taskType: 'change',
      lane: 'critical',
      rationale: 'x',
      fallbackEscalation: 'y',
      requiredTests: [
        { id: 'TEE-PLAN-001', status: 'unresolved' },
        { id: 'TEE-PLAN-001', status: 'unresolved' },
      ],
    });
    // Force duplicate through raw marker
    const raw = {
      ...contract,
      requiredTests: [
        { id: 'TEE-PLAN-001', status: 'unresolved' },
        { id: 'TEE-PLAN-001', status: 'unresolved' },
      ],
      implementationContract: { invariantsDefined: false, boundariesDefined: false, rollbackDefined: false },
    };
    const duplicate = validatePlanMarkdown(
      `${'<!-- plan-contract-marker:v2'}\n${JSON.stringify(raw, null, 2)}\n-->\n\n## Classification\n`
    );
    expect(duplicate.status).toBe('malformed');
    expect(duplicate.errors.some((error) => /duplicate/i.test(error))).toBe(true);

    const noHeadings = validatePlanMarkdown(
      renderPlanContractMarker(
        createDefaultPlanContract({
          taskId: 'no-headings',
          taskType: 'change',
          lane: 'critical',
          rationale: 'x',
          fallbackEscalation: 'y',
          requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
        })
      )
    );
    expect(noHeadings.status).toBe('malformed');
    expect(noHeadings.errors.some((error) => /missing required headings/i.test(error))).toBe(true);
  });

  it('TEE-PATH-001: rejects traversal, symlinks, sibling repositories, unsafe IDs, and unauthorized external plan roots', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'ffts-plan-path-'));
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation', 'plans'), { recursive: true });
    const planPath = path.join(repoRoot, 'docs_private', 'automation', 'plans', 'ok.md');
    writeFileSync(planPath, validPlanMarkdown(), 'utf8');

    const traversal = resolvePlanPath({
      candidatePath: '../outside.md',
      repoRoot,
    });
    expect(traversal.status).toBe('rejected');

    const siblingRoot = mkdtempSync(path.join(path.dirname(repoRoot), 'sibling-repo-'));
    const siblingPlan = path.join(siblingRoot, 'plan.md');
    writeFileSync(siblingPlan, validPlanMarkdown(), 'utf8');
    const sibling = resolvePlanPath({
      candidatePath: siblingPlan,
      repoRoot,
    });
    expect(sibling.status).toBe('rejected');
    expect(sibling.errors.some((error) => /sibling|external/i.test(error))).toBe(true);

    const external = resolvePlanPath({
      candidatePath: path.join(tmpdir(), `external-plan-${Date.now()}.md`),
      repoRoot,
    });
    expect(external.status).toBe('rejected');

    if (process.platform !== 'win32') {
      const linkPath = path.join(repoRoot, 'docs_private', 'automation', 'plans', 'link.md');
      try {
        symlinkSync(planPath, linkPath);
        expect(pathHasSymlinkComponent(linkPath)).toBe(true);
        const linked = resolvePlanPath({ candidatePath: linkPath, repoRoot });
        expect(linked.status).toBe('rejected');
      } catch {
        // Some environments disallow symlinks; path rejection coverage remains above.
      }
    }

    expect(assertSafeOpaqueId('../evil', 'workstreamId').ok).toBe(false);
    expect(assertSafeOpaqueId('ws_abcdef0123456789', 'workstreamId').ok).toBe(true);
    expect(createWorkflowWorkstreamId()).toMatch(/^ws_[a-f0-9]{16}$/);
  });

  it('TEE-EVID-001: child workstreams resolve their own requiredTestIds from a master plan', () => {
    const contract = createDefaultPlanContract({
      workstreamId: 'ws_master_plan_1',
      taskId: 'master',
      taskType: 'change',
      lane: 'critical',
      rationale: 'master',
      fallbackEscalation: 'route',
      requiredTests: [
        { id: 'TEE-FINALISE-001', status: 'unresolved' },
        { id: 'TEE-PLAN-001', status: 'unresolved' },
      ],
    });
    contract.childWorkstreams = [
      {
        workstreamId: 'ws_8670b5ee93738ff1',
        scope: 'tee-core-enforcement',
        status: 'pending',
        requiredTestIds: ['TEE-PLAN-001', 'TEE-PATH-001', 'TEE-PROTO-001'],
        finalReview: { required: true, source: 'independent_subagent', status: 'pending' },
        commit: { status: 'pending' },
        handoff: { status: 'pending' },
      },
    ];
    expect(resolveRequiredTestIdsForWorkstream(contract, 'ws_8670b5ee93738ff1')).toEqual([
      'TEE-PLAN-001',
      'TEE-PATH-001',
      'TEE-PROTO-001',
    ]);
    expect(resolveRequiredTestIdsForWorkstream(contract, 'ws_8670b5ee93738ff1')).not.toContain(
      'TEE-FINALISE-001'
    );
  });

  it('TEE-MODEL-001: verifies exact model roles, IDs, tiers, routing coherence, and switch timing', () => {
    const contract = createDefaultPlanContract({
      taskId: 'model-demo',
      taskType: 'change',
      lane: 'critical',
      rationale: 'model roles',
      fallbackEscalation: 'route',
      requiredTests: [{ id: 'TEE-MODEL-001', status: 'unresolved' }],
    });
    expect(contract.models?.planning.role).toBe('premium-planning');
    expect(contract.models?.implementation.modelId).toBe('cursor-grok-4.5-high-fast');
    expect(contract.models?.implementation.switchTiming).toBe(
      'after-plan-and-architecture-approval'
    );
    expect(contract.models?.finalReview.tier).toBe('premium');
    expect(contract.models?.fixRouting.role).toBe('premium-fix-routing');
    expect(WORKFLOW_MODEL_TIER_REGISTRY_VERSION).toBe('ffts-tee-model-registry-v1');
  });

  it('CLI-PLAN-001: exported CLI runner returns deterministic 0/1/2 JSON diagnostics', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'ffts-plan-cli-'));
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation', 'plans'), { recursive: true });
    const planPath = path.join(repoRoot, 'docs_private', 'automation', 'plans', 'cli.md');
    writeFileSync(planPath, validPlanMarkdown(), 'utf8');

    const ok = runWorkflowPlanValidate([planPath, '--json'], repoRoot);
    expect(ok.exitCode).toBe(0);
    expect(ok.payload.ok).toBe(true);
    expect(ok.payload.registryVersion).toBe(WORKFLOW_MODEL_TIER_REGISTRY_VERSION);

    const usage = runWorkflowPlanValidate([], repoRoot);
    expect(usage.exitCode).toBe(2);

    const bad = runWorkflowPlanValidate([path.join(repoRoot, 'missing.md'), '--json'], repoRoot);
    expect(bad.exitCode).toBe(1);
    expect(bad.payload.ok).toBe(false);

    const fileResult = validatePlanFile({
      candidatePath: planPath,
      repoRoot,
    });
    expect(fileResult.status).toBe('present');
  });
});
