#!/usr/bin/env tsx
import { spawnSync } from 'child_process';
import path from 'path';
import {
  getFinaliseRepairSafetyFingerprint,
  markOrdinaryFinaliseStep,
  markFinaliseCheckpointStep,
  resolveActiveProtocolFinaliseContext,
} from './automation/finalise-checkpoint';
import {
  getFinaliseFailurePath,
  getFinaliseRepairCompletePath,
  incrementFinaliseRepairAttempt,
  isRepairableFinaliseStep,
  markFinaliseRepairComplete,
  readFinaliseFailureArtifact,
  readFinaliseRepairCompleteArtifact,
  recordFinaliseRepairHistory,
} from './automation/finalise-failure';
import { appendWorkflowAnomalySignal } from './automation/workflow-events';
import type { FinaliseTaskKey } from './finalise-recent-tasks';

const REPO_ROOT = process.cwd();
const MAX_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000;

interface RepairCommand {
  command: 'npm';
  args: string[];
  rendered: string;
  artifactPaths?: string[];
}

const REPAIR_COMMANDS: Partial<Record<FinaliseTaskKey, RepairCommand>> = {
  build: {
    command: 'npm',
    args: ['run', 'build'],
    rendered: 'npm run build',
    artifactPaths: [path.join('.next', 'BUILD_ID')],
  },
  'test-run': {
    command: 'npm',
    args: ['run', 'test:run'],
    rendered: 'npm run test:run',
  },
  testsuite: {
    command: 'npm',
    args: ['run', 'testsuite'],
    rendered: 'npm run testsuite',
  },
};

function executable(command: string): string {
  return process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
}

function fail(message: string): never {
  process.stderr.write(`finalise:repair refused: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const awaitingClosure = readFinaliseRepairCompleteArtifact(REPO_ROOT);
  if (awaitingClosure) {
    fail(
      `awaiting original finalise closure (${getFinaliseRepairCompletePath(REPO_ROOT)}); refuse another repair`
    );
  }

  const artifact = readFinaliseFailureArtifact(REPO_ROOT);
  if (!artifact) {
    fail(`missing or malformed ${getFinaliseFailurePath(REPO_ROOT)}`);
  }
  const ageMs = Date.now() - Date.parse(artifact.createdAt);
  if (ageMs < 0 || ageMs > MAX_ARTIFACT_AGE_MS) {
    fail('failure artifact is stale');
  }
  if (!isRepairableFinaliseStep(artifact.failedStep)) {
    fail(
      `step ${artifact.failedStep} is not allowlisted (database/migration/destructive/commit/push/unknown repair is blocked)`
    );
  }
  const task = artifact.failedStep;
  const repair = REPAIR_COMMANDS[task];
  if (!repair) {
    fail(`step ${artifact.failedStep} is not allowlisted`);
  }
  if (artifact.command !== repair.rendered) {
    fail('stored command does not match the hard-coded allowlist');
  }
  const currentSafety = getFinaliseRepairSafetyFingerprint({
    repoRoot: REPO_ROOT,
    task,
    mode: artifact.originalMode,
    command: repair.rendered,
  });
  if (currentSafety !== artifact.safetyFingerprint) {
    fail('toolchain/configuration safety fingerprint changed; rerun the original finalise command');
  }
  const activeProtocol = resolveActiveProtocolFinaliseContext(REPO_ROOT);
  if ((activeProtocol?.workstreamId ?? null) !== artifact.workstreamId) {
    fail('protocol workstream context changed; rerun the original finalise command');
  }
  const attempted = incrementFinaliseRepairAttempt(REPO_ROOT);
  const recentAttemptCount = recordFinaliseRepairHistory(REPO_ROOT, artifact);
  if ((attempted?.repairAttemptCount ?? 0) > 2 || recentAttemptCount > 2) {
    appendWorkflowAnomalySignal({
      repoRoot: REPO_ROOT,
      eventId: `finalise-repair:${artifact.originalMode}:${artifact.failedStep}:${artifact.safetyFingerprint}`,
      flags: ['targeted-repair-cycle-exceeded'],
    });
  }

  process.stdout.write(`Rerunning failed finalise step only: ${repair.rendered}\n`);
  const result = spawnSync(executable(repair.command), repair.args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (activeProtocol) {
    markFinaliseCheckpointStep({
      repoRoot: REPO_ROOT,
      workstreamId: activeProtocol.workstreamId,
      checkpointId: activeProtocol.checkpointId,
      task,
      status: 'passed',
      command: repair.rendered,
      exitCode: 0,
      artifactPaths: repair.artifactPaths,
    });
  } else {
    markOrdinaryFinaliseStep({
      repoRoot: REPO_ROOT,
      mode: artifact.originalMode,
      task,
      status: 'passed',
      command: repair.rendered,
      exitCode: 0,
      artifactPaths: repair.artifactPaths,
    });
  }

  const latest = readFinaliseFailureArtifact(REPO_ROOT) ?? artifact;
  markFinaliseRepairComplete(REPO_ROOT, latest, {
    checkpointId: activeProtocol?.checkpointId ?? null,
  });
  process.stdout.write(
    'Targeted finalise repair passed. Run the original finalise command once for closure.\n'
  );
}

main();
