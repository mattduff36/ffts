import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
  applyProtocolTransition,
  createEmptyProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  validateCurrentV24ProtocolRecord,
  validateHistoricProtocolRecordForAudit,
} from '@/scripts/automation/workflow-v24-protocol-validator';
import {
  ARCHITECTURE_REQUIRED_IDS,
  CLOSURE_REQUIRED_IDS,
  FIRST_REVIEW_BLOCKER_IDS,
  FIX_SWEEP_REQUIRED_IDS,
  resolveCanonicalReviewRequiredIds,
} from '@/scripts/automation/workflow-v24-required-id-set';
import { assertReviewReadiness } from '@/scripts/automation/workflow-v24-review-readiness';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  initGitRepo,
  makeTempRoot,
  persistFixtureLedger,
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

describe('closure required-ID and review-readiness blockers', () => {
  it('FDR-CLOSURE-REQUIRED-IDS-001: omitted architecture, first-review, fix-sweep, or closure IDs cannot start review', { timeout: 120_000 }, () => {
    const required = resolveCanonicalReviewRequiredIds(['TEE-PLAN-001']);
    expect(required).toEqual(expect.arrayContaining([...ARCHITECTURE_REQUIRED_IDS]));
    expect(required).toEqual(expect.arrayContaining([...FIRST_REVIEW_BLOCKER_IDS]));
    expect(required).toEqual(expect.arrayContaining([...FIX_SWEEP_REQUIRED_IDS]));
    expect(required).toEqual(expect.arrayContaining([...CLOSURE_REQUIRED_IDS]));

    const families = {
      architecture: ARCHITECTURE_REQUIRED_IDS[0],
      firstReview: FIRST_REVIEW_BLOCKER_IDS[0],
      fixSweep: FIX_SWEEP_REQUIRED_IDS[1],
      closure: CLOSURE_REQUIRED_IDS[0],
    };
    for (const [family, omitted] of Object.entries(families)) {
      const repoRoot = makeTempRoot(`closure-ids-${family}`);
      const head = initGitRepo(repoRoot);
      const workstreamId = `ws_fdr_closure_${family}`;
      bindAndInit(repoRoot, workstreamId, head);
      const weaker = required.filter((id) => id !== omitted);
      const weakerManifest = buildEvidenceManifest({
        repoRoot,
        workstreamId,
        kind: 'preflight',
        baseCommit: head,
        requiredTestIds: [],
        runChecks: false,
        verificationLedgerRefs: [persistFixtureLedger(repoRoot, workstreamId, weaker)],
        commandResults: [
          {
            name: 'typecheck',
            status: 'passed',
            exitCode: 0,
            durationMs: 1,
            summary: 'ok',
            command: 'npm run typecheck',
          },
          {
            name: 'oxlint-changed',
            status: 'skipped',
            exitCode: null,
            durationMs: 1,
            summary: 'no changed lintable files',
            command: 'npx oxlint --',
            files: [],
          },
          {
            name: 'eslint-changed',
            status: 'skipped',
            exitCode: null,
            durationMs: 1,
            summary: 'no changed lintable files',
            command: 'npx eslint --',
            files: [],
          },
        ],
      });
      const recorded = applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId,
        manifestPath: weakerManifest.relativePath,
      });
      expect(recorded.ok, `${family} omission must fail preflight/review`).toBe(false);
      expect(recorded.message).toMatch(/missing proven|required-ID set incomplete|requiredTests/i);
    }

    const fixRoot = makeTempRoot('closure-ids-fix-delta');
    const fixHead = initGitRepo(fixRoot);
    const fixWorkstream = 'ws_fdr_closure_fix_delta';
    bindAndInit(fixRoot, fixWorkstream, fixHead);
    expect(
      applyProtocolTransition({
        repoRoot: fixRoot,
        command: 'preflight-record',
        workstreamId: fixWorkstream,
        manifestPath: writePassingManifest(fixRoot, fixWorkstream, 'preflight'),
      }).ok
    ).toBe(true);
    const first = applyProtocolTransition({
      repoRoot: fixRoot,
      command: 'review-start',
      workstreamId: fixWorkstream,
      pass: 'first',
    });
    expect(first.ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot: fixRoot,
        command: 'review-record',
        workstreamId: fixWorkstream,
        token: first.reviewToken!,
        result: 'failed',
        blockerFamilies: ['evidence-binding'],
        blockerIds: ['A'],
        siblingSurfaces: ['preflight'],
      }).ok
    ).toBe(true);
    for (const [family, omitted] of Object.entries(families)) {
      const weaker = required.filter((id) => id !== omitted);
      const weakerFix = writePassingManifest(
        fixRoot,
        fixWorkstream,
        'fix-delta',
        ['A'],
        weaker
      );
      const recorded = applyProtocolTransition({
        repoRoot: fixRoot,
        command: 'fix-record',
        workstreamId: fixWorkstream,
        manifestPath: weakerFix,
        closedBlockerIds: ['A'],
      });
      expect(recorded.ok, `${family} omission must fail fix-delta/closure`).toBe(false);
      expect(recorded.message).toMatch(/missing proven|required-ID set incomplete|required IDs/i);
    }
  });

  it('FDR-PROTOCOL-RECORD-VALIDATION-002: current V2.4 records reject structural and semantic mutations', () => {
    const repoRoot = makeTempRoot('protocol-mutations');
    const head = initGitRepo(repoRoot);
    const valid = createEmptyProtocolRecord({
      workstreamId: 'ws_protocol_valid',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    expect(validateCurrentV24ProtocolRecord(valid).ok).toBe(true);

    const mutations: Array<[string, unknown]> = [
      ['unsupported schema', { ...valid, schemaVersion: '9' }],
      ['invalid phase', { ...valid, phase: 'minted_first' }],
      ['negative failure count', { ...valid, failedPremiumReviewCount: -1 }],
      ['non-integer inherited count', { ...valid, inheritedFailedReviewCount: 1.5 }],
      [
        'closure before first',
        {
          ...valid,
          reviewAttempts: [
            {
              pass: 'closure',
              token: 'rev_closure_aaaa',
              startedAt: valid.updatedAt,
              recordedAt: valid.updatedAt,
              result: 'failed',
              blockerFamilies: ['x'],
              blockerIds: ['y'],
              siblingSurfaces: ['z'],
              headCommit: head,
              treeFingerprint: 'a'.repeat(32),
            },
          ],
          failedPremiumReviewCount: 1,
        },
      ],
      [
        'active token without active phase',
        { ...valid, activeReviewToken: 'rev_first_bbbb', activeReviewPass: 'first' },
      ],
      [
        'routing claiming success',
        {
          ...valid,
          phase: 'review_closed',
          nextAction: 'finalise_start',
          failedPremiumReviewCount: 2,
          inheritedFailedReviewCount: 2,
          headCommit: head,
          reviewedTreeFingerprint: 'b'.repeat(32),
          reviewAttempts: [
            {
              pass: 'first',
              token: 'rev_first_cccc',
              startedAt: valid.updatedAt,
              recordedAt: valid.updatedAt,
              result: 'passed',
              headCommit: head,
              treeFingerprint: 'b'.repeat(32),
            },
          ],
        },
      ],
      [
        'malformed rehome',
        {
          ...valid,
          rehomeProvenance: {
            schemaVersion: '1',
            status: 'bound',
            predecessorPassedReview: true,
            predecessorHeadIsAncestor: true,
          },
        },
      ],
      [
        'inconsistent reviewed HEAD',
        {
          ...valid,
          phase: 'review_closed',
          nextAction: 'finalise_start',
          headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          reviewedTreeFingerprint: 'c'.repeat(32),
          reviewAttempts: [
            {
              pass: 'first',
              token: 'rev_first_dddd',
              startedAt: valid.updatedAt,
              recordedAt: valid.updatedAt,
              result: 'passed',
              headCommit: head,
              treeFingerprint: 'c'.repeat(32),
            },
          ],
        },
      ],
      [
        'inconsistent finalise state',
        {
          ...valid,
          phase: 'finalised',
          nextAction: 'done',
          activeCheckpointId: 'ckpt_still_active',
          headCommit: head,
          reviewedTreeFingerprint: 'd'.repeat(32),
          reviewAttempts: [
            {
              pass: 'first',
              token: 'rev_first_eeee',
              startedAt: valid.updatedAt,
              recordedAt: valid.updatedAt,
              result: 'passed',
              headCommit: head,
              treeFingerprint: 'd'.repeat(32),
            },
          ],
        },
      ],
    ];

    for (const [label, mutated] of mutations) {
      const result = validateCurrentV24ProtocolRecord(mutated);
      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/malformed|unsupported|invalid|inconsistent|impossible/i);
      }
    }

    const historic = validateHistoricProtocolRecordForAudit({
      schemaVersion: '1',
      workstreamId: 'ws_historic_audit',
      identityStatus: 'present',
      baseCommit: head,
      phase: 'initialized',
      nextAction: 'run_preflight',
      failedPremiumReviewCount: 0,
      reviewAttempts: [],
      blockerFamilies: [],
      openBlockerIds: [],
    });
    expect(historic.ok).toBe(true);
    expect(validateCurrentV24ProtocolRecord(historic.ok ? historic.record : null).ok).toBe(false);

    const planted = {
      ...valid,
      workstreamId: 'ws_protocol_planted',
      activeReviewToken: 'rev_first_plantedtoken',
      activeReviewPass: 'first' as const,
    };
    writeProtocolRecord(repoRoot, planted);
    const start = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: planted.workstreamId,
      pass: 'first',
    });
    expect(start.ok).toBe(false);
    expect(start.message).toMatch(/malformed|inconsistent|invalid/i);

    const record = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId: planted.workstreamId,
      token: 'rev_first_plantedtoken',
      result: 'passed',
    });
    expect(record.ok).toBe(false);
    expect(record.message).toMatch(/malformed|inconsistent|invalid/i);

    const finalise = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId: planted.workstreamId,
    });
    expect(finalise.ok).toBe(false);
    expect(finalise.message).toMatch(/malformed|inconsistent|invalid/i);

    const historicWorkstream = 'ws_historic_no_authority';
    const historicDir = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      historicWorkstream
    );
    mkdirSync(historicDir, { recursive: true });
    writeFileSync(
      path.join(historicDir, 'protocol.json'),
      JSON.stringify({
        schemaVersion: '1',
        workstreamId: historicWorkstream,
        identityStatus: 'present',
        baseCommit: head,
        phase: 'review_closed',
        nextAction: 'finalise_start',
        failedPremiumReviewCount: 0,
        reviewAttempts: [{ pass: 'first', result: 'passed' }],
        blockerFamilies: [],
        openBlockerIds: [],
      }),
      'utf8'
    );
    const historicFinalise = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId: historicWorkstream,
    });
    expect(historicFinalise.ok).toBe(false);
    expect(historicFinalise.message).toMatch(/malformed/i);
  });

  it('FDR-VERIFY-TYPECHECK-LINT-003: missing or stale typecheck/lint cannot start review', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('typecheck-lint');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_fdr_typecheck';
    bindAndInit(repoRoot, workstreamId, head);
    const weakerManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId,
      kind: 'preflight',
      baseCommit: head,
      requiredTestIds: [],
      runChecks: false,
      verificationLedgerRefs: [
        persistFixtureLedger(repoRoot, workstreamId, resolveCanonicalReviewRequiredIds(['TEE-PLAN-001'])),
      ],
      commandResults: [
        {
          name: 'fix-sweep',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'synthetic only',
        },
      ],
    });
    const missing = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath: weakerManifest.relativePath,
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toMatch(/typecheck|lint/i);

    const staleRoot = makeTempRoot('typecheck-lint-stale');
    const staleHead = initGitRepo(staleRoot);
    const staleWorkstream = 'ws_fdr_typecheck_stale';
    bindAndInit(staleRoot, staleWorkstream, staleHead);
    const boundManifest = writePassingManifest(staleRoot, staleWorkstream, 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot: staleRoot,
        command: 'preflight-record',
        workstreamId: staleWorkstream,
        manifestPath: boundManifest,
      }).ok
    ).toBe(true);
    commitFile(staleRoot, 'stale-after-typecheck.ts', 'product commit after typecheck/lint');
    const staleStart = applyProtocolTransition({
      repoRoot: staleRoot,
      command: 'review-start',
      workstreamId: staleWorkstream,
      pass: 'first',
    });
    expect(staleStart.ok).toBe(false);
    expect(staleStart.message).toMatch(/stale|typecheck|lint|HEAD|fingerprint/i);

    const producerRoot = makeTempRoot('typecheck-lint-producer');
    const producerHead = initGitRepo(producerRoot);
    const produced = buildEvidenceManifest({
      repoRoot: producerRoot,
      workstreamId: 'ws_fdr_typecheck_producer',
      kind: 'preflight',
      baseCommit: producerHead,
      requiredTestIds: ['T-TYPECHECK', 'T-LINT'],
      runChecks: false,
      commandResults: [
        {
          name: 'typecheck',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'ok',
          command: 'npm run typecheck',
        },
        {
          name: 'oxlint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 1,
          summary: 'no changed lintable files',
          command: 'npx oxlint --',
          files: [],
        },
        {
          name: 'eslint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 1,
          summary: 'no changed lintable files',
          command: 'npx eslint --',
          files: [],
        },
      ],
    });
    expect(produced.manifest.status).toBe('passed');
    expect(produced.manifest.requiredTests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'T-TYPECHECK', status: 'completed', executed: true }),
        expect.objectContaining({ id: 'T-LINT', status: 'completed', executed: true }),
      ])
    );
  });

  it('FDR-REVIEW-READINESS-001: review-start refuses when any readiness proof is missing or stale', () => {
    const repoRoot = makeTempRoot('readiness');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_fdr_readiness';
    bindAndInit(repoRoot, workstreamId, head);
    const unready = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    const refused = assertReviewReadiness({
      repoRoot,
      record: { ...unready, planPath: null },
      pass: 'first',
    });
    expect(refused.ok).toBe(false);

    const readyPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId,
        manifestPath: readyPath,
      }).ok
    ).toBe(true);
    const first = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    expect(first.ok).toBe(true);
  });
});
