import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  bindEvidenceCommandToCandidate,
  buildEvidenceManifest,
  getCurrentTreeFingerprint,
  listBaseToHeadChangedFiles,
  type EvidenceCommandResult,
  type EvidenceManifestKind,
  type WorkflowEvidenceManifest,
} from './workflow-evidence-manifest';
import {
  captureVerificationIdentity,
  inspectCandidateGitScope,
  loadCanonicalV24RequiredTestIds,
  loadCanonicalWorkflowSuiteManifest,
  provenVitestCaseIds,
  runVitestJsonAndPersistLedgerAsync,
  verificationRunIsProofEligible,
} from './workflow-verification-ledger';
import {
  resolveTeeVerifyJobs,
  runCapturedProcess,
  runVerifyBatch,
  type VerifyBatchResult,
  type VerifyCandidate,
  type VerifyStage,
  type VerifyStageResult,
} from './workflow-verify-runner';
import {
  applyTestSuiteProgress,
  createVerifyProgressReporter,
  shouldUseMachineProgress,
  type VerifyProgressReporter,
} from './workflow-verify-progress';

function isLintableFile(relativePath: string): boolean {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(relativePath);
}

function listLintableCandidateFiles(repoRoot: string, baseCommit: string, headCommit: string): string[] {
  const tree = getCurrentTreeFingerprint(repoRoot);
  const baseHeadFiles = listBaseToHeadChangedFiles(repoRoot, baseCommit, headCommit);
  const scoped = inspectCandidateGitScope(repoRoot, baseCommit || 'HEAD');
  const scopedPaths = scoped.ok ? scoped.scope.all : [];
  return [...new Set([...baseHeadFiles, ...tree.changedFiles, ...scopedPaths])]
    .filter(
      (relativePath) =>
        isLintableFile(relativePath) && existsSync(path.join(repoRoot, relativePath))
    )
    .sort();
}

function commandFromCapture(
  name: string,
  command: string,
  args: string[],
  captured: Awaited<ReturnType<typeof runCapturedProcess>>
): EvidenceCommandResult {
  const raw =
    captured.exitCode === 0
      ? 'ok'
      : (captured.stderr || captured.stdout || captured.error?.message || 'failed').trim().slice(0, 2_000);
  return {
    name,
    status: captured.exitCode === 0 ? 'passed' : 'failed',
    exitCode: captured.exitCode,
    durationMs: captured.durationMs,
    summary: raw,
    command: [command, ...args].join(' '),
  };
}

function skippedLintCommand(name: string, command: string): EvidenceCommandResult {
  return {
    name,
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    summary: 'no changed lintable files',
    command,
    files: [],
  };
}

export function formatVerificationFailure(result: VerifyStageResult): string {
  const lines = [
    'Verification failed',
    `Stage: ${result.label}`,
    result.message ? `Detail: ${result.message}` : null,
    result.exitCode != null ? `Exit: ${result.exitCode}` : result.signal ? `Signal: ${result.signal}` : null,
    result.stderr?.trim() ? result.stderr.trim().slice(0, 4_000) : null,
    result.stdout?.trim() && !result.stderr?.trim() ? result.stdout.trim().slice(0, 4_000) : null,
  ].filter((line): line is string => Boolean(line));
  return `${lines.join('\n')}\n`;
}

export function bindBatchCommandsToCandidate(
  commands: EvidenceCommandResult[],
  candidate: VerifyCandidate
): EvidenceCommandResult[] {
  return commands.map((command) =>
    bindEvidenceCommandToCandidate(command, candidate.headCommit, candidate.fingerprint)
  );
}

export async function runEvidenceVerificationBatch(params: {
  repoRoot: string;
  workstreamId: string;
  baseCommit: string;
  requiredTestIds?: string[];
  runChecks?: boolean;
  runRequiredTests?: boolean;
  jobs?: number;
  progress?: VerifyProgressReporter;
  candidate: VerifyCandidate;
  readCandidate?: () => VerifyCandidate | { drifted: true } | { error: string };
}): Promise<{
  batch: VerifyBatchResult<EvidenceCommandResult | EvidenceCommandResult[] | RequiredTestsValue>;
  commands: EvidenceCommandResult[];
  executedTestIds: string[];
  verificationLedgerRefs: NonNullable<WorkflowEvidenceManifest['verificationLedgers']>;
}> {
  const jobs = params.jobs ?? resolveTeeVerifyJobs();
  const stages: VerifyStage<EvidenceCommandResult | EvidenceCommandResult[] | RequiredTestsValue>[] = [];
  const lintable =
    params.runChecks === true
      ? listLintableCandidateFiles(params.repoRoot, params.baseCommit, params.candidate.headCommit)
      : [];

  if (params.runChecks) {
    stages.push({
      id: 'typecheck',
      label: 'Typecheck',
      weight: 22,
      kind: 'readonly',
      async run() {
        const captured = await runCapturedProcess({
          command: 'npm',
          args: ['run', 'typecheck'],
          cwd: params.repoRoot,
        });
        return {
          ok: captured.exitCode === 0,
          value: commandFromCapture('typecheck', 'npm', ['run', 'typecheck'], captured),
          exitCode: captured.exitCode,
          signal: captured.signal,
          stdout: captured.stdout,
          stderr: captured.stderr,
          candidate: params.candidate,
        };
      },
    });
    stages.push({
      id: 'oxlint',
      label: 'Oxlint',
      weight: 8,
      kind: 'readonly',
      async run() {
        if (lintable.length === 0) {
          return { ok: true, value: skippedLintCommand('oxlint-changed', 'npx oxlint --'), candidate: params.candidate };
        }
        const args = ['oxlint', '--', ...lintable];
        const captured = await runCapturedProcess({ command: 'npx', args, cwd: params.repoRoot });
        const value = commandFromCapture('oxlint-changed', 'npx', args, captured);
        value.files = lintable;
        return {
          ok: captured.exitCode === 0,
          value,
          exitCode: captured.exitCode,
          signal: captured.signal,
          stdout: captured.stdout,
          stderr: captured.stderr,
          candidate: params.candidate,
        };
      },
    });
    stages.push({
      id: 'eslint',
      label: 'ESLint',
      weight: 12,
      kind: 'readonly',
      async run() {
        if (lintable.length === 0) {
          return { ok: true, value: skippedLintCommand('eslint-changed', 'npx eslint --'), candidate: params.candidate };
        }
        const args = ['eslint', '--', ...lintable];
        const captured = await runCapturedProcess({ command: 'npx', args, cwd: params.repoRoot });
        const value = commandFromCapture('eslint-changed', 'npx', args, captured);
        value.files = lintable;
        return {
          ok: captured.exitCode === 0,
          value,
          exitCode: captured.exitCode,
          signal: captured.signal,
          stdout: captured.stdout,
          stderr: captured.stderr,
          candidate: params.candidate,
        };
      },
    });
  }

  if (params.runRequiredTests && (params.requiredTestIds?.length ?? 0) > 0) {
    const ids = params.requiredTestIds ?? [];
    stages.push({
      id: 'required-tests',
      label: 'Workflow tests',
      weight: 48,
      kind: 'readonly',
      async run() {
        const started = Date.now();
        const proveCanonicalSet = ids.includes('TEE-V24-VERIFY-MANIFEST-001');
        const requiredIds = proveCanonicalSet
          ? [...new Set([...ids, ...loadCanonicalV24RequiredTestIds()])]
          : ids;
        const persisted = await runVitestJsonAndPersistLedgerAsync({
          repoRoot: params.repoRoot,
          workstreamId: params.workstreamId,
          commandId: 'preflight-required-tests',
          commandType: proveCanonicalSet ? 'vitest_suite' : 'vitest_case',
          files: loadCanonicalWorkflowSuiteManifest().files,
          extraArgs: proveCanonicalSet
            ? []
            : [
                '-t',
                ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|'),
                '--testTimeout=60000',
              ],
          requiredIds,
          onTestProgress: (event) => {
            const current = params.progress?.snapshot().stages.find((stage) => stage.id === 'required-tests');
            const next = applyTestSuiteProgress(current ?? {}, event);
            params.progress?.updateStage('required-tests', {
              status: 'running',
              measure: 'tests',
              ...next,
            });
          },
        });
        const proofEligible = persisted.ok
          ? verificationRunIsProofEligible({
              record: persisted.record,
              reporterRaw: readFileSync(
                path.join(params.repoRoot, persisted.reference.reporterRelativePath)
              ),
              expectedHeadCommit: params.candidate.headCommit,
              expectedFingerprint: params.candidate.fingerprint,
              requiredIds,
            })
          : { ok: false as const, message: persisted.message };
        const executed: string[] = [];
        if (persisted.ok && proofEligible.ok) {
          const caseProof = provenVitestCaseIds({
            records: [persisted.record],
            requiredIds,
          });
          if (caseProof.ok) executed.push(...caseProof.provenIds);
        }
        const value: RequiredTestsValue = {
          command: {
            name: 'required-tests',
            status: persisted.ok && proofEligible.ok ? 'passed' : 'failed',
            exitCode: persisted.ok && proofEligible.ok ? 0 : 1,
            durationMs: Date.now() - started,
            summary: persisted.ok
              ? proofEligible.ok
                ? `vitest ledger ${persisted.reference.contentHash}`
                : proofEligible.message
              : persisted.message,
            command: 'vitest run --reporter=json',
          },
          executedTestIds: executed,
          verificationLedgerRefs: persisted.ok && proofEligible.ok ? [persisted.reference] : [],
        };
        return {
          ok: persisted.ok && proofEligible.ok,
          value,
          exitCode: persisted.ok && proofEligible.ok ? 0 : 1,
          message: persisted.ok
            ? proofEligible.ok
              ? undefined
              : proofEligible.message
            : persisted.message,
          candidate: params.candidate,
        };
      },
    });
  }

  const batch = await runVerifyBatch({
    stages,
    candidate: params.candidate,
    jobs,
    progress: params.progress,
    readCandidate: params.readCandidate,
  });

  const commands: EvidenceCommandResult[] = [];
  const executedTestIds: string[] = [];
  const verificationLedgerRefs: NonNullable<WorkflowEvidenceManifest['verificationLedgers']> = [];
  const order = ['typecheck', 'oxlint', 'eslint', 'required-tests'];
  for (const id of order) {
    const result = batch.results.find((row) => row.id === id);
    if (!result?.value) continue;
    if (id === 'required-tests') {
      const value = result.value as RequiredTestsValue;
      commands.push(value.command);
      executedTestIds.push(...value.executedTestIds);
      verificationLedgerRefs.push(...value.verificationLedgerRefs);
      continue;
    }
    if (Array.isArray(result.value)) {
      commands.push(...result.value);
    } else {
      commands.push(result.value as EvidenceCommandResult);
    }
  }

  return {
    batch,
    commands: bindBatchCommandsToCandidate(commands, params.candidate),
    executedTestIds: [...new Set(executedTestIds)],
    verificationLedgerRefs,
  };
}

interface RequiredTestsValue {
  command: EvidenceCommandResult;
  executedTestIds: string[];
  verificationLedgerRefs: NonNullable<WorkflowEvidenceManifest['verificationLedgers']>;
}

export async function runAndBuildEvidenceManifest(params: {
  repoRoot: string;
  workstreamId: string;
  kind: EvidenceManifestKind;
  baseCommit: string;
  requiredTestIds?: string[];
  runChecks?: boolean;
  runRequiredTests?: boolean;
  liveVerification?: WorkflowEvidenceManifest['liveVerification'];
  closedBlockerIds?: string[];
  blockerEvidence?: WorkflowEvidenceManifest['blockerEvidence'];
  jobs?: number;
  progress?: VerifyProgressReporter;
}): Promise<{
  manifest: WorkflowEvidenceManifest;
  relativePath: string;
  absolutePath: string;
  batch: VerifyBatchResult<EvidenceCommandResult | EvidenceCommandResult[] | RequiredTestsValue>;
}> {
  const identity = captureVerificationIdentity(params.repoRoot);
  if (!identity.ok) {
    throw new Error(identity.message);
  }
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const candidate: VerifyCandidate = {
    headCommit: identity.headCommit,
    fingerprint: identity.productTreeFingerprint,
  };
  params.progress?.updateStage('verification-batch', { status: 'running' });
  const executed = await runEvidenceVerificationBatch({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    baseCommit: params.baseCommit,
    requiredTestIds: params.requiredTestIds,
    runChecks: params.runChecks,
    runRequiredTests: params.runRequiredTests,
    jobs: params.jobs,
    progress: params.progress,
    candidate,
    readCandidate: () => {
      const current = captureVerificationIdentity(params.repoRoot);
      if (!current.ok) return { error: current.message };
      if (current.headCommit !== candidate.headCommit || current.productTreeFingerprint !== candidate.fingerprint) {
        return { drifted: true };
      }
      return { headCommit: current.headCommit, fingerprint: current.productTreeFingerprint };
    },
  });
  if (executed.batch.drifted) {
    throw new Error('candidate drift during verification batch; evidence was not aggregated');
  }
  params.progress?.updateStage('verification-batch', {
    status: executed.batch.ok ? 'pass' : 'fail',
  });
  params.progress?.updateStage('required-id-proof', { status: 'running' });
  params.progress?.updateStage('required-id-proof', {
    status: executed.batch.ok ? 'pass' : 'fail',
  });
  params.progress?.updateStage('manifest', { status: 'running' });
  const built = buildEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    kind: params.kind,
    baseCommit: params.baseCommit,
    requiredTestIds: params.requiredTestIds,
    runChecks: false,
    runRequiredTests: false,
    liveVerification: params.liveVerification,
    closedBlockerIds: params.closedBlockerIds,
    blockerEvidence: params.blockerEvidence,
    commandResults: executed.commands,
    executedTestIds: executed.executedTestIds,
    verificationLedgerRefs: executed.verificationLedgerRefs,
    frozenCandidate: {
      headCommit: candidate.headCommit,
      productTreeFingerprint: candidate.fingerprint,
      dirtyTreeHash: tree.dirtyTreeHash,
      inputFingerprint: tree.inputFingerprint,
    },
  });
  params.progress?.updateStage('manifest', { status: 'pass' });
  params.progress?.updateStage('evidence-convergence', {
    status: built.manifest.status === 'passed' ? 'pass' : 'fail',
  });
  return { ...built, batch: executed.batch };
}

export function createHumanVerifyProgress(params: {
  title: string;
  candidate?: string;
  env?: NodeJS.ProcessEnv;
  stderrIsTty?: boolean;
}): VerifyProgressReporter | undefined {
  const env = params.env ?? process.env;
  if (env.TEE_VERIFY_PROGRESS === 'off') return undefined;
  const machine = shouldUseMachineProgress(env, params.stderrIsTty ?? process.stderr.isTTY);
  return createVerifyProgressReporter({
    title: params.title,
    candidate: params.candidate,
    stream: process.stderr,
    isTty: !machine,
    ci: machine,
  });
}

export function proveRequiredIdsExact(params: {
  requiredIds: string[];
  provenIds: string[];
}): { ok: true } | { ok: false; missing: string[]; extra: string[] } {
  const required = [...new Set(params.requiredIds)].sort();
  const proven = [...new Set(params.provenIds)].sort();
  const requiredSet = new Set(required);
  const provenSet = new Set(proven);
  const missing = required.filter((id) => !provenSet.has(id));
  const extra = proven.filter((id) => !requiredSet.has(id));
  if (missing.length > 0) return { ok: false, missing, extra };
  return { ok: true };
}
