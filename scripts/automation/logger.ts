import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { writeMonthlyAutomationPendingFollowUp } from './monthly-follow-up';
import { formatReviewForConsole, reviewAutomationRun } from './self-review';
import type {
  AutomationCommandResult,
  AutomationExpectedArtifact,
  AutomationRunLog,
  AutomationRunMetadata,
  AutomationRunStatus,
  AutomationStepLog,
  WorkflowActiveFinaliseContext,
  WorkflowFinaliseCorrelation,
  WorkflowReviewState,
} from './types';
import {
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  withWorkflowLock,
} from './workflow-events';
import {
  correlateFinaliseRun,
  shouldApplyFinaliseCorrelation,
} from './workflow-finalise-correlation';
import {
  commitFinaliseCorrelationStateAndProtocols,
  getActiveFinaliseContext,
  readProtocolRecord,
  recoverIncompleteFinalisePassedCommit,
} from './workflow-review-protocol';
import { appendOwnedCommit, lastOwnedCommit, readWorkflowGitBinding } from './workflow-git-binding';
import {
  assertCapturedIdentityMatchesRunMemory,
  assertGitMatchesCapturedC9Identity,
  assertLiveFinaliseContextMatchesCaptured,
  assertProtectedPushAuthorizationCurrent,
  buildProtectedC9PushAuthorization,
  buildProtectedC9RunIdentity,
  capturedContextFromIdentity,
  cloneActiveFinaliseContext,
  persistProtectedC9RunIdentity,
  protectedC9IdentityPath,
  readProtectedC9RunIdentity,
  type ProtectedC9PushAuthorization,
} from './workflow-c9-run-identity';

const DEFAULT_REPO_ROOT = process.cwd();
const MAX_STEP_OUTPUT_LENGTH = 500_000;

interface AutomationRunOptions {
  scriptName: string;
  mode: string;
  args?: string[];
  expectedArtifacts?: AutomationExpectedArtifact[];
  persist?: boolean;
  repoRoot?: string;
}

interface LoggedCommandOptions {
  allowFailure?: boolean;
  captureOutput?: boolean;
  env?: NodeJS.ProcessEnv;
}

function getExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function quoteArg(value: string): string {
  if (!/[ \t"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map(quoteArg)].join(' ');
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function runMetadataCommand(command: string, args: string[], repoRoot = DEFAULT_REPO_ROOT): string {
  const result = spawnSync(getExecutable(command), args, {
    cwd: repoRoot,
    env: process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function getMetadata(repoRoot = DEFAULT_REPO_ROOT): AutomationRunMetadata {
  const gitStatus = runMetadataCommand('git', ['status', '--porcelain'], repoRoot);

  return {
    branch: runMetadataCommand('git', ['branch', '--show-current'], repoRoot) || '(detached HEAD)',
    commit: runMetadataCommand('git', ['rev-parse', '--short', 'HEAD'], repoRoot) || 'unknown',
    dirtyFileCount: gitStatus ? gitStatus.split(/\r?\n/u).filter(Boolean).length : 0,
    nodeVersion: process.version,
    npmVersion: runMetadataCommand('npm', ['--version'], repoRoot) || 'unknown',
    platform: process.platform,
  };
}

export function readPostRunGitIdentity(repoRoot = DEFAULT_REPO_ROOT): {
  branchName: string;
  headCommit: string | null;
} {
  return {
    branchName:
      runMetadataCommand('git', ['branch', '--show-current'], repoRoot) || '(detached HEAD)',
    headCommit: runMetadataCommand('git', ['rev-parse', 'HEAD'], repoRoot) || null,
  };
}

function loadProtectedC9Context(repoRoot: string): WorkflowActiveFinaliseContext | null {
  const paths = getWorkflowPaths(repoRoot);
  return getActiveFinaliseContext(loadWorkflowReviewStateStrict(paths.statePath));
}

export function assertPassedProtectedFinaliseC9Identity(params: {
  persist: boolean;
  scriptName: string;
  mode?: string;
  args?: string[];
  repoRoot: string;
  correlation?: WorkflowFinaliseCorrelation;
  state?: WorkflowReviewState;
  requiredActiveContext?: WorkflowActiveFinaliseContext | null;
}): void {
  if (!params.persist) return;
  if (
    !shouldApplyFinaliseCorrelation({
      scriptName: params.scriptName,
      mode: params.mode,
      args: params.args,
    })
  ) {
    return;
  }

  const active = params.requiredActiveContext ?? null;
  if (!active) {
    throw new Error('protected finalise C9 identity is missing; refuse finish(passed)');
  }

  if (
    typeof active.workstreamId !== 'string' ||
    !active.workstreamId ||
    typeof active.checkpointId !== 'string' ||
    !active.checkpointId ||
    (active.activatedHeadCommit != null && typeof active.activatedHeadCommit !== 'string') ||
    (active.ownedCommits != null && !Array.isArray(active.ownedCommits))
  ) {
    throw new Error('protected finalise C9 identity evidence is malformed; refuse finish(passed)');
  }

  const git = readWorkflowGitBinding(params.repoRoot);
  if (git.detached || !git.branchName || !git.headCommit) {
    throw new Error('protected finalise C9 git identity cannot be verified; refuse finish(passed)');
  }

  const correlation = params.correlation;
  if (!correlation || typeof correlation !== 'object') {
    throw new Error('protected finalise C9 identity is missing; refuse finish(passed)');
  }
  if (
    correlation.identityStatus !== 'present' &&
    correlation.identityStatus !== 'missing' &&
    correlation.identityStatus !== 'unknown' &&
    correlation.identityStatus !== undefined
  ) {
    throw new Error('protected finalise C9 identity evidence is malformed; refuse finish(passed)');
  }
  if (correlation.identityStatus !== 'present') {
    if (active.activatedBranchName && git.branchName !== active.activatedBranchName) {
      throw new Error('protected finalise C9 branch mismatch; refuse finish(passed)');
    }
    const expectedOwnedHead = lastOwnedCommit(
      active.ownedCommits,
      active.activatedHeadCommit ?? null
    );
    if (expectedOwnedHead && git.headCommit !== expectedOwnedHead) {
      throw new Error('protected finalise C9 HEAD/owned-chain mismatch; refuse finish(passed)');
    }
    throw new Error(
      `protected finalise C9 identityStatus=${correlation.identityStatus ?? 'missing'}; refuse finish(passed)`
    );
  }
  if (correlation.matchedBy !== 'explicit_context') {
    throw new Error('protected finalise C9 identity is mismatched; refuse finish(passed)');
  }
  if (
    !Array.isArray(correlation.workstreamIds) ||
    correlation.workstreamIds.length === 0 ||
    typeof correlation.checkpointId !== 'string' ||
    !correlation.checkpointId ||
    typeof correlation.branchName !== 'string' ||
    !correlation.branchName ||
    typeof correlation.headCommit !== 'string' ||
    !correlation.headCommit
  ) {
    throw new Error('protected finalise C9 identity evidence is malformed; refuse finish(passed)');
  }
  if (
    correlation.workstreamIds[0] !== active.workstreamId ||
    correlation.checkpointId !== active.checkpointId
  ) {
    throw new Error('protected finalise C9 checkpoint/workstream mismatch; refuse finish(passed)');
  }
  if (active.activatedBranchName && active.activatedBranchName !== correlation.branchName) {
    throw new Error('protected finalise C9 branch mismatch; refuse finish(passed)');
  }
  if (git.branchName !== correlation.branchName) {
    throw new Error('protected finalise C9 branch mismatch; refuse finish(passed)');
  }
  if (!active.activatedHeadCommit) {
    throw new Error('protected finalise C9 HEAD/owned-chain mismatch; refuse finish(passed)');
  }
  const progressed = appendOwnedCommit({
    repoRoot: params.repoRoot,
    ownedCommits: active.ownedCommits ?? [active.activatedHeadCommit],
    activatedHeadCommit: active.activatedHeadCommit,
  });
  if (!progressed.ok) {
    throw new Error('protected finalise C9 HEAD/owned-chain mismatch; refuse finish(passed)');
  }
  const expectedHead = lastOwnedCommit(progressed.ownedCommits, active.activatedHeadCommit);
  if (!expectedHead || correlation.headCommit !== expectedHead || git.headCommit !== expectedHead) {
    throw new Error('protected finalise C9 HEAD/owned-chain mismatch; refuse finish(passed)');
  }
}

export function computeFinaliseAutomationCorrelation(params: {
  scriptName: string;
  status: AutomationRunStatus;
  runId: string;
  repoRoot?: string;
  state: WorkflowReviewState;
  mode?: string;
  args?: string[];
}): WorkflowFinaliseCorrelation | undefined {
  if (
    !shouldApplyFinaliseCorrelation({
      scriptName: params.scriptName,
      mode: params.mode,
      args: params.args,
    })
  ) {
    return undefined;
  }
  const repoRoot = params.repoRoot ?? DEFAULT_REPO_ROOT;
  const identity = readPostRunGitIdentity(repoRoot);
  const result = correlateFinaliseRun({
    state: params.state,
    repoRoot,
    finaliseRunId: params.runId,
    finaliseOutcome: params.status === 'passed' ? 'passed' : 'failed',
  });
  return {
    ...result.correlation,
    resultingCommit: result.correlation.resultingCommit ?? identity.headCommit,
    branchName: result.correlation.branchName || identity.branchName,
  };
}

export function correlateFinaliseAutomationRun(params: {
  scriptName: string;
  status: AutomationRunStatus;
  runId: string;
  repoRoot?: string;
  state?: WorkflowReviewState;
  mode?: string;
  args?: string[];
}): WorkflowFinaliseCorrelation | undefined {
  if (
    !shouldApplyFinaliseCorrelation({
      scriptName: params.scriptName,
      mode: params.mode,
      args: params.args,
    })
  ) {
    return undefined;
  }
  if (params.state) {
    return computeFinaliseAutomationCorrelation({
      scriptName: params.scriptName,
      status: params.status,
      runId: params.runId,
      repoRoot: params.repoRoot,
      state: params.state,
      mode: params.mode,
      args: params.args,
    });
  }
  if (params.status === 'passed') {
    throw new Error(
      'passed finalise correlation cannot persist independently; use AutomationRun.finish after C9 validation'
    );
  }
  const repoRoot = params.repoRoot ?? DEFAULT_REPO_ROOT;
  const identity = readPostRunGitIdentity(repoRoot);
  const correlate = (state: WorkflowReviewState) =>
    correlateFinaliseRun({
      state,
      repoRoot,
      finaliseRunId: params.runId,
      finaliseOutcome: 'failed',
    });

  const paths = getWorkflowPaths(repoRoot);
  return withWorkflowLock(paths.lockPath, () => {
    recoverIncompleteFinalisePassedCommit(repoRoot);
    const previousState = loadWorkflowReviewStateStrict(paths.statePath);
    const result = correlate(previousState);
    commitFinaliseCorrelationStateAndProtocols({
      repoRoot,
      statePath: paths.statePath,
      previousState,
      nextState: result.state,
      workstreamIds: result.correlation.workstreamIds,
    });
    return {
      ...result.correlation,
      resultingCommit: result.correlation.resultingCommit ?? identity.headCommit,
      branchName: result.correlation.branchName || identity.branchName,
    };
  });
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/giu, '$1[REDACTED]$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gu, '$1[REDACTED]')
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|SERVICE_ROLE|PRIVATE_KEY|API_KEY|POSTGRES_URL)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,]+)/giu,
      '$1$2[REDACTED]'
    )
    .replace(
      /\b(password|token|secret|apiKey|serviceRoleKey)(["']?\s*[:=]\s*["']?)([^"',\s}]+)/giu,
      '$1$2[REDACTED]'
    );
}

function limitOutput(output: string): { output: string; truncated: boolean } {
  const redacted = redactSensitiveText(output);
  if (redacted.length <= MAX_STEP_OUTPUT_LENGTH) {
    return { output: redacted, truncated: false };
  }

  return {
    output: `${redacted.slice(0, MAX_STEP_OUTPUT_LENGTH)}\n\n[Output truncated at ${MAX_STEP_OUTPUT_LENGTH} characters]`,
    truncated: true,
  };
}

function renderMarkdown(log: AutomationRunLog, repoRoot = DEFAULT_REPO_ROOT): string {
  const lines = [
    `# ${log.scriptName} Run Log`,
    '',
    `Run ID: ${log.id}`,
    `Status: ${log.status}`,
    `Mode: ${log.mode}`,
    `Started: ${log.startedAt}`,
    `Ended: ${log.endedAt}`,
    `Duration: ${log.durationMs}ms`,
    `Branch: ${log.metadata.branch}`,
    `Commit: ${log.metadata.commit}`,
    `Dirty files at start: ${log.metadata.dirtyFileCount}`,
    `Node: ${log.metadata.nodeVersion}`,
    `npm: ${log.metadata.npmVersion}`,
    '',
    '## Artifacts',
    '',
    ...log.artifacts.map((artifact) => `- ${artifact.exists ? 'present' : 'missing'}: ${artifact.path}${artifact.required ? ' (required)' : ''}`),
    '',
    '## Steps',
    '',
  ];

  for (const step of log.steps) {
    lines.push(`### ${step.name}`);
    lines.push('');
    lines.push(`- Status: ${step.status}`);
    lines.push(`- Duration: ${step.durationMs}ms`);
    if (step.command) lines.push(`- Command: \`${step.command}\``);
    if (step.exitCode !== undefined) lines.push(`- Exit code: ${step.exitCode}`);
    if (step.error) lines.push(`- Error: ${step.error}`);
    if (step.metadata) {
      lines.push('');
      lines.push('Metadata:');
      lines.push('```json');
      lines.push(JSON.stringify(step.metadata, null, 2));
      lines.push('```');
    }
    if (step.output) {
      lines.push('');
      lines.push('```text');
      lines.push(step.output);
      lines.push('```');
      if (step.outputTruncated) lines.push('');
      if (step.outputTruncated) lines.push('Output was truncated in this log.');
    }
    lines.push('');
  }

  if (log.error) {
    lines.push('## Error');
    lines.push('');
    lines.push(log.error);
    lines.push('');
  }

  if (log.review) {
    lines.push('## Self-Review');
    lines.push('');
    lines.push(`Recent runs: ${log.review.recentRunCount}`);
    lines.push(`Recent failures: ${log.review.recentFailureCount}`);
    lines.push(`Average duration: ${log.review.averageDurationMs}ms`);
    lines.push('');
    for (const suggestion of log.review.suggestions) {
      lines.push(`- ${suggestion.severity}: ${suggestion.message}`);
    }
    if (log.review.monthlyReviewGenerated && log.review.monthlyReviewPath) {
      lines.push('');
      lines.push(`Monthly review: ${path.relative(repoRoot, log.review.monthlyReviewPath)}`);
    }
    if (log.review.monthlyReviewGenerated && log.review.monthlyPromptPath) {
      lines.push(`Review prompt: ${path.relative(repoRoot, log.review.monthlyPromptPath)}`);
    }
    if (log.review.advisorReviewPath) {
      lines.push(`Advisor review: ${path.relative(repoRoot, log.review.advisorReviewPath)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export class AutomationRun {
  private readonly persist: boolean;
  private readonly repoRoot: string;
  private readonly runDirectory: string;
  private readonly reviewsDirectory: string;
  private readonly logPath: string;
  private readonly markdownPath: string;
  private readonly capturedC9Context: WorkflowActiveFinaliseContext | null;
  private readonly capturedC9WorkstreamId: string | null;
  private readonly log: Omit<AutomationRunLog, 'endedAt' | 'durationMs' | 'status' | 'artifacts'>;

  constructor(options: AutomationRunOptions) {
    const startedAt = new Date();
    const safeScriptName = options.scriptName.replace(/[^a-z0-9-]/giu, '-').toLowerCase();
    this.persist = options.persist !== false;
    this.repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
    const loadedContext =
      this.persist &&
      shouldApplyFinaliseCorrelation({
        scriptName: safeScriptName,
        mode: options.mode,
        args: options.args,
      })
        ? loadProtectedC9Context(this.repoRoot)
        : null;
    this.capturedC9Context = loadedContext ? cloneActiveFinaliseContext(loadedContext) : null;
    this.capturedC9WorkstreamId = this.capturedC9Context?.workstreamId ?? null;
    const automationRoot = path.join(this.repoRoot, 'docs_private', 'automation');
    this.runDirectory = path.join(automationRoot, 'runs', safeScriptName);
    this.reviewsDirectory = path.join(automationRoot, 'reviews');
    if (this.persist) {
      mkdirSync(this.runDirectory, { recursive: true });
    }

    const id = `${startedAt.toISOString().replace(/[:.]/gu, '-')}-${process.pid}`;
    this.logPath = path.join(this.runDirectory, `${id}.json`);
    this.markdownPath = path.join(this.runDirectory, `${id}.md`);
    this.log = {
      id,
      scriptName: safeScriptName,
      mode: options.mode,
      args: options.args ?? [],
      startedAt: startedAt.toISOString(),
      metadata: getMetadata(this.repoRoot),
      expectedArtifacts: options.expectedArtifacts ?? [],
      steps: [],
    };
    if (this.persist && this.capturedC9Context) {
      const built = buildProtectedC9RunIdentity({
        runId: this.log.id,
        context: this.capturedC9Context,
        capturedAt: this.log.startedAt,
      });
      if (built.ok) {
        const persisted = persistProtectedC9RunIdentity({
          runDirectory: this.runDirectory,
          identity: built.identity,
        });
        if (!persisted.ok) {
          throw new Error(persisted.message);
        }
      }
    }
  }

  get runId(): string {
    return this.log.id;
  }

  get protectedC9IdentityPath(): string {
    return protectedC9IdentityPath(this.runDirectory, this.log.id);
  }

  loadCapturedC9Identity() {
    return readProtectedC9RunIdentity({
      runDirectory: this.runDirectory,
      runId: this.log.id,
    });
  }

  async step<T>(name: string, action: () => Promise<T> | T, metadata?: Record<string, unknown>): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await action();
      this.log.steps.push({
        name,
        status: 'passed',
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        metadata,
      });
      return result;
    } catch (error) {
      this.log.steps.push({
        name,
        status: 'failed',
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        error: redactSensitiveText(error instanceof Error ? error.message : String(error)),
        metadata,
      });
      throw error;
    }
  }

  recordStep(step: AutomationStepLog): void {
    this.log.steps.push(step);
  }

  runCommand(command: string, args: string[], options: LoggedCommandOptions = {}): AutomationCommandResult {
    const startedAt = new Date();
    const formattedCommand = formatCommand(command, args);
    const result = spawnSync(getExecutable(command), args, {
      cwd: this.repoRoot,
      env: options.env ?? process.env,
      shell: shouldUseShell(command),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 50,
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const output = `${stdout}${stderr}`;

    if (!options.captureOutput) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }

    const limitedOutput = limitOutput(output);
    const commandPassed = result.status === 0 || options.allowFailure === true;
    this.recordStep({
      name: formattedCommand,
      status: commandPassed ? 'passed' : 'failed',
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      command: formattedCommand,
      exitCode: result.status,
      output: limitedOutput.output,
      outputTruncated: limitedOutput.truncated,
      error: !commandPassed && result.error instanceof Error ? redactSensitiveText(result.error.message) : undefined,
    });

    if (!options.allowFailure && result.status !== 0) {
      const executionError = result.error instanceof Error ? `: ${result.error.message}` : '';
      throw new Error(`Command failed (${formattedCommand})${executionError}`);
    }

    return { status: result.status, stdout, stderr };
  }

  private correlateWorkflowIfFinalise(
    status: AutomationRunStatus
  ): WorkflowFinaliseCorrelation | undefined {
    if (!this.persist) return undefined;
    return correlateFinaliseAutomationRun({
      scriptName: this.log.scriptName,
      status,
      runId: this.log.id,
      repoRoot: this.repoRoot,
      mode: this.log.mode,
      args: this.log.args,
    });
  }

  /**
   * Validate captured C9 identity and the intended correlation in memory, then
   * persist success-authoritative protocol/state only after every check passes.
   */
  private commitPassedProtectedFinaliseAfterC9Validation(): WorkflowFinaliseCorrelation {
    const paths = getWorkflowPaths(this.repoRoot);
    return withWorkflowLock(paths.lockPath, () => {
      recoverIncompleteFinalisePassedCommit(this.repoRoot);
      const captured = this.loadCapturedC9Identity();
      let requiredActiveContext = this.capturedC9Context;
      if (captured.ok) {
        const memoryMatch = assertCapturedIdentityMatchesRunMemory({
          identity: captured.identity,
          runId: this.log.id,
          capturedContext: this.capturedC9Context,
          capturedWorkstreamId: this.capturedC9WorkstreamId,
        });
        if (!memoryMatch.ok) {
          throw new Error(memoryMatch.message.replace('remote mutation', 'finish(passed)'));
        }
        requiredActiveContext = capturedContextFromIdentity(captured.identity);
      } else if (this.capturedC9Context) {
        const built = buildProtectedC9RunIdentity({
          runId: this.log.id,
          context: this.capturedC9Context,
          capturedAt: this.log.startedAt,
        });
        if (built.ok) {
          throw new Error(captured.message.replace('remote mutation', 'finish(passed)'));
        }
        requiredActiveContext = this.capturedC9Context;
      } else {
        throw new Error(captured.message.replace('remote mutation', 'finish(passed)'));
      }

      const previousState = loadWorkflowReviewStateStrict(paths.statePath);
      const identity = readPostRunGitIdentity(this.repoRoot);
      const computed = correlateFinaliseRun({
        state: previousState,
        repoRoot: this.repoRoot,
        finaliseRunId: this.log.id,
        finaliseOutcome: 'passed',
      });
      const correlation: WorkflowFinaliseCorrelation = {
        ...computed.correlation,
        resultingCommit: computed.correlation.resultingCommit ?? identity.headCommit,
        branchName: computed.correlation.branchName || identity.branchName,
      };
      assertPassedProtectedFinaliseC9Identity({
        persist: this.persist,
        scriptName: this.log.scriptName,
        mode: this.log.mode,
        args: this.log.args,
        repoRoot: this.repoRoot,
        correlation,
        state: previousState,
        requiredActiveContext,
      });
      commitFinaliseCorrelationStateAndProtocols({
        repoRoot: this.repoRoot,
        statePath: paths.statePath,
        previousState,
        nextState: computed.state,
        workstreamIds: correlation.workstreamIds,
        fromProtectedFinish: true,
      });
      return correlation;
    });
  }

  assertC9BeforeRemoteMutation(): ProtectedC9PushAuthorization | undefined {
    if (!this.persist) return undefined;
    if (
      !shouldApplyFinaliseCorrelation({
        scriptName: this.log.scriptName,
        mode: this.log.mode,
        args: this.log.args,
      })
    ) {
      return undefined;
    }
    const captured = this.loadCapturedC9Identity();
    if (!captured.ok) {
      throw new Error(captured.message);
    }
    const memoryMatch = assertCapturedIdentityMatchesRunMemory({
      identity: captured.identity,
      runId: this.log.id,
      capturedContext: this.capturedC9Context,
      capturedWorkstreamId: this.capturedC9WorkstreamId,
    });
    if (!memoryMatch.ok) {
      throw new Error(memoryMatch.message);
    }
    const gitMatch = assertGitMatchesCapturedC9Identity({
      repoRoot: this.repoRoot,
      identity: captured.identity,
      expectedWorkstreamId: this.capturedC9WorkstreamId ?? captured.identity.workstreamId,
    });
    if (!gitMatch.ok) {
      throw new Error(gitMatch.message);
    }
    const live = getActiveFinaliseContext(loadWorkflowReviewStateStrict(getWorkflowPaths(this.repoRoot).statePath));
    const liveProtocol = readProtocolRecord(this.repoRoot, captured.identity.workstreamId);
    const liveMatch = assertLiveFinaliseContextMatchesCaptured({
      identity: captured.identity,
      live,
      protocolPhase: liveProtocol?.phase ?? null,
      protocolCheckpointId: liveProtocol?.activeCheckpointId ?? null,
      protocolWorkstreamId: liveProtocol?.workstreamId ?? null,
      protocolBranchName: liveProtocol?.branchName ?? null,
      protocolHeadCommit: liveProtocol?.headCommit ?? null,
      protocolBaseCommit: liveProtocol?.baseCommit ?? null,
      protocolReviewedTreeFingerprint: liveProtocol?.reviewedTreeFingerprint ?? null,
    });
    if (!liveMatch.ok) {
      throw new Error(liveMatch.message);
    }
    const git = readWorkflowGitBinding(this.repoRoot);
    const capturedContext = capturedContextFromIdentity(captured.identity);
    const correlation: WorkflowFinaliseCorrelation = {
      identityStatus: 'present',
      matchedBy: 'explicit_context',
      workstreamIds: [captured.identity.workstreamId],
      checkpointId: captured.identity.checkpointId,
      branchName: captured.identity.branchName,
      headCommit: gitMatch.expectedHead,
      resultingCommit: git.headCommit ?? gitMatch.expectedHead,
    };
    const state = loadWorkflowReviewStateStrict(getWorkflowPaths(this.repoRoot).statePath);
    assertPassedProtectedFinaliseC9Identity({
      persist: this.persist,
      scriptName: this.log.scriptName,
      mode: this.log.mode,
      args: this.log.args,
      repoRoot: this.repoRoot,
      correlation,
      state,
      requiredActiveContext: capturedContext,
    });
    const authorization = buildProtectedC9PushAuthorization({
      identity: captured.identity,
      sourceCommit: gitMatch.expectedHead,
    });
    if (!authorization.ok) {
      throw new Error(authorization.message);
    }
    return authorization.authorization;
  }

  assertAuthorizedC9PushStillValid(authorization: ProtectedC9PushAuthorization): void {
    const captured = this.loadCapturedC9Identity();
    if (!captured.ok) {
      throw new Error(captured.message);
    }
    const gitMatch = assertGitMatchesCapturedC9Identity({
      repoRoot: this.repoRoot,
      identity: captured.identity,
      expectedWorkstreamId: this.capturedC9WorkstreamId ?? captured.identity.workstreamId,
    });
    if (!gitMatch.ok) {
      throw new Error(gitMatch.message);
    }
    if (gitMatch.expectedHead.toLowerCase() !== authorization.sourceCommit.toLowerCase()) {
      throw new Error('C9-validated HEAD does not match push authorization source commit; refuse remote mutation');
    }
    const git = readWorkflowGitBinding(this.repoRoot);
    const live = getActiveFinaliseContext(loadWorkflowReviewStateStrict(getWorkflowPaths(this.repoRoot).statePath));
    const liveProtocol = readProtocolRecord(this.repoRoot, captured.identity.workstreamId);
    const current = assertProtectedPushAuthorizationCurrent({
      authorization,
      headCommit: git.headCommit,
      branchName: git.branchName,
      identity: captured.identity,
      live,
      protocolPhase: liveProtocol?.phase ?? null,
      protocolCheckpointId: liveProtocol?.activeCheckpointId ?? null,
      protocolWorkstreamId: liveProtocol?.workstreamId ?? null,
      protocolBranchName: liveProtocol?.branchName ?? null,
      protocolHeadCommit: liveProtocol?.headCommit ?? null,
      protocolBaseCommit: liveProtocol?.baseCommit ?? null,
      protocolReviewedTreeFingerprint: liveProtocol?.reviewedTreeFingerprint ?? null,
    });
    if (!current.ok) {
      throw new Error(current.message);
    }
  }

  async finish(status: AutomationRunStatus, error?: unknown): Promise<void> {
    const endedAt = new Date();
    const artifacts = this.log.expectedArtifacts.map((artifact) => ({
      path: artifact.path,
      exists: existsSync(path.join(this.repoRoot, artifact.path)),
      required: artifact.required !== false,
    }));
    let workflowCorrelation: WorkflowFinaliseCorrelation | undefined;
    const protectedPassed =
      status === 'passed' &&
      this.persist &&
      shouldApplyFinaliseCorrelation({
        scriptName: this.log.scriptName,
        mode: this.log.mode,
        args: this.log.args,
      });
    if (protectedPassed) {
      // Validate C9 + correlation in memory, then persist success atomically.
      workflowCorrelation = this.commitPassedProtectedFinaliseAfterC9Validation();
    } else {
      try {
        workflowCorrelation = this.correlateWorkflowIfFinalise(status);
      } catch (correlationError) {
        // Passed finalise must fail closed so repair-complete clearance cannot proceed.
        // Failed finishes still write the run log without inventing a successful correlation.
        if (status === 'passed' && this.log.scriptName === 'finalise') {
          throw correlationError instanceof Error
            ? correlationError
            : new Error(String(correlationError));
        }
        workflowCorrelation = undefined;
      }
      if (status === 'passed') {
        const paths = getWorkflowPaths(this.repoRoot);
        const state = loadWorkflowReviewStateStrict(paths.statePath);
        assertPassedProtectedFinaliseC9Identity({
          persist: this.persist,
          scriptName: this.log.scriptName,
          mode: this.log.mode,
          args: this.log.args,
          repoRoot: this.repoRoot,
          correlation: workflowCorrelation,
          state,
          requiredActiveContext: this.capturedC9Context,
        });
      }
    }
    const finalLog: AutomationRunLog = {
      ...this.log,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - new Date(this.log.startedAt).getTime(),
      status,
      artifacts,
      error: error ? redactSensitiveText(error instanceof Error ? error.message : String(error)) : undefined,
      workflowCorrelation,
    };

    if (!this.persist) {
      console.log(`Dry-run complete for ${this.log.scriptName}; no automation files were written.`);
      return;
    }

    writeFileSync(this.logPath, JSON.stringify(finalLog, null, 2), 'utf8');
    const review = reviewAutomationRun({
      runDirectory: this.runDirectory,
      reviewsDirectory: this.reviewsDirectory,
      latestLog: finalLog,
    });
    const reviewedLog = { ...finalLog, review };
    writeFileSync(this.logPath, JSON.stringify(reviewedLog, null, 2), 'utf8');
    writeFileSync(this.markdownPath, renderMarkdown(reviewedLog, this.repoRoot), 'utf8');
    console.log(formatReviewForConsole(review));
    console.log(`Automation log written: ${path.relative(this.repoRoot, this.markdownPath)}`);

    if (review.monthlyReviewGenerated && review.monthlyReview) {
      try {
        writeMonthlyAutomationPendingFollowUp({
          scriptName: review.scriptName,
          monthKey: review.monthlyReview.monthKey,
          reviewPath: review.monthlyReview.reviewPath,
          suggestionsPath: review.monthlyReview.suggestionsPath,
          suggestions: review.monthlyReview.suggestions,
          knowledgeDirectory: review.monthlyReview.knowledgeDirectory,
          repoRoot: this.repoRoot,
        });
      } catch (followUpError) {
        try {
          writeFileSync(
            review.monthlyReview.suggestionsPath,
            JSON.stringify(review.monthlyReview.suggestions, null, 2),
            'utf8'
          );
        } catch {
          // Best effort only; the main workflow has already completed.
        }
        console.warn(
          `Automation monthly follow-up skipped: ${redactSensitiveText(
            followUpError instanceof Error ? followUpError.message : String(followUpError)
          )}`
        );
      }
    }
  }
}
