#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { buildEvidenceManifest } from './automation/workflow-evidence-manifest';
import {
  applyProtocolTransition,
  readProtocolRecord,
} from './automation/workflow-review-protocol';
import {
  assertSafeOpaqueId,
  extractPlanContractMarker,
  resolvePlanPath,
  resolveRequiredTestIdsForWorkstream,
} from './automation/workflow-plan-contract';
import { resolveCanonicalReviewRequiredIds } from './automation/workflow-v24-required-id-set';
import {
  createHumanVerifyProgress,
  formatVerificationFailure,
  runAndBuildEvidenceManifest,
} from './automation/workflow-verify-batch';
import { collectPremiumPacketEvidence } from './automation/workflow-premium-packet';
import { captureVerificationIdentity } from './automation/workflow-verification-ledger';
import { createPreflightWorkflowStages } from './automation/workflow-verify-progress';

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printUsage(): void {
  process.stdout.write(`Usage:
  npm run review:preflight -- --workstream <id> [--plan <path>] [--profile <name>] [--skip-checks]

Creates a content-addressed preflight evidence manifest and records it on the protocol workstream.
Independent read-only checks may run concurrently (TEE_VERIFY_JOBS, default 3; 1 = serial).
Progress is written to stderr and is not evidence. JSON on stdout remains the machine result.
FFTS ships no live-product default inventory profile. Unknown profiles are rejected.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const repoRoot = path.resolve(readFlag(args, '--repo-root') ?? process.cwd());
  const workstreamIdRaw = readFlag(args, '--workstream');
  const planPath = readFlag(args, '--plan');
  const profile = readFlag(args, '--profile');
  const skipChecks = hasFlag(args, '--skip-checks');
  const liveDb = hasFlag(args, '--live-db');

  if (!workstreamIdRaw) {
    printUsage();
    process.exit(1);
  }

  if (liveDb) {
    throw new Error(
      'FFTS review preflight does not open live database connections. Remove --live-db.'
    );
  }

  if (profile) {
    throw new Error(
      `Unknown preflight profile "${profile}". FFTS has no live-product default profile in TEE core.`
    );
  }

  const safeWorkstream = assertSafeOpaqueId(workstreamIdRaw, 'workstreamId');
  if (!safeWorkstream.ok) {
    throw new Error(safeWorkstream.error);
  }
  const workstreamId = safeWorkstream.value;

  let requiredTestIds: string[] = [];

  let protocol = readProtocolRecord(repoRoot, workstreamId);
  if (!protocol) {
    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      planPath,
    });
    if (!init.ok || !init.record) {
      throw new Error(init.message);
    }
    protocol = init.record;
  }

  const effectivePlanPath = planPath ?? protocol.planPath ?? undefined;
  if (effectivePlanPath) {
    const resolved = resolvePlanPath({ candidatePath: effectivePlanPath, repoRoot });
    if (resolved.status !== 'ok' || !resolved.absolutePath) {
      throw new Error(`invalid plan path: ${resolved.errors.join('; ')}`);
    }
    const contract = extractPlanContractMarker(readFileSync(resolved.absolutePath, 'utf8'));
    if (contract.status === 'present' && contract.contract) {
      requiredTestIds = resolveCanonicalReviewRequiredIds(
        resolveRequiredTestIdsForWorkstream(contract.contract, workstreamId)
      );
    }
  }

  const identity = captureVerificationIdentity(repoRoot);
  if (!identity.ok) {
    throw new Error(identity.message);
  }
  const runChecks = !skipChecks;
  const runRequiredTests = !skipChecks && requiredTestIds.length > 0;
  const progress = skipChecks
    ? undefined
    : createHumanVerifyProgress({
        title: `TEE preflight — ${workstreamId}`,
        candidate: identity.headCommit.slice(0, 12),
      });
  progress?.setStages(createPreflightWorkflowStages({ runChecks, runRequiredTests }));
  progress?.updateStage('candidate-capture', { status: 'running' });
  progress?.updateStage('candidate-capture', { status: 'pass', elapsedMs: 0 });
  progress?.updateStage('protocol-validation', { status: 'running' });
  progress?.updateStage('protocol-validation', { status: 'pass' });

  const built = skipChecks
    ? {
        ...buildEvidenceManifest({
          repoRoot,
          workstreamId,
          kind: 'preflight',
          baseCommit: protocol.baseCommit,
          requiredTestIds,
          runChecks: false,
          runRequiredTests: false,
          frozenCandidate: {
            headCommit: identity.headCommit,
            productTreeFingerprint: identity.productTreeFingerprint,
          },
        }),
        batch: null,
      }
    : await runAndBuildEvidenceManifest({
        repoRoot,
        workstreamId,
        kind: 'preflight',
        baseCommit: protocol.baseCommit,
        requiredTestIds,
        runChecks,
        runRequiredTests,
        progress,
      });

  if (built.batch) {
    for (const failure of built.batch.failures) {
      process.stderr.write(formatVerificationFailure(failure));
    }
    if (built.batch.drifted) {
      process.stderr.write('candidate drift during preflight; evidence was not aggregated\n');
    }
    process.stderr.write(
      `TEE_VERIFY_JOBS=${built.batch.jobs} (${built.batch.serial ? 'serial' : 'parallel'})\n`
    );
  }

  if (built.manifest.status !== 'passed') {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          message: 'preflight failed',
          manifestPath: built.relativePath,
          manifest: {
            status: built.manifest.status,
            requiredTests: built.manifest.requiredTests,
            commands: built.manifest.commands,
            liveVerification: built.manifest.liveVerification,
          },
        },
        null,
        2
      )}\n`
    );
    process.exit(1);
  }

  progress?.updateStage('preflight-record', { status: 'running' });
  const recorded = applyProtocolTransition({
    repoRoot,
    command: 'preflight-record',
    workstreamId,
    manifestPath: built.relativePath,
  });
  progress?.updateStage('preflight-record', { status: recorded.ok ? 'pass' : 'fail' });

  const packet = await collectPremiumPacketEvidence({
    repoRoot,
    workstreamId,
    candidate: {
      headCommit: identity.headCommit,
      fingerprint: identity.productTreeFingerprint,
    },
  });
  if (!packet.ok) {
    process.stderr.write(`premium packet evidence: ${packet.message}\n`);
  }

  progress?.complete(recorded.ok ? 'PASS' : 'FAIL', 'Preflight');

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: recorded.ok,
        message: recorded.message,
        manifestPath: built.relativePath,
        protocolPhase: recorded.record?.phase,
        contentHash: built.manifest.contentHash,
        exists: existsSync(built.absolutePath),
      },
      null,
      2
    )}\n`
  );
  process.exit(recorded.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
