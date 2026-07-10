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
} from './types';

const REPO_ROOT = process.cwd();
const AUTOMATION_ROOT = path.join(REPO_ROOT, 'docs_private', 'automation');
const MAX_STEP_OUTPUT_LENGTH = 500_000;

interface AutomationRunOptions {
  scriptName: string;
  mode: string;
  args?: string[];
  expectedArtifacts?: AutomationExpectedArtifact[];
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

function runMetadataCommand(command: string, args: string[]): string {
  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function getMetadata(): AutomationRunMetadata {
  const gitStatus = runMetadataCommand('git', ['status', '--porcelain']);

  return {
    branch: runMetadataCommand('git', ['branch', '--show-current']) || '(detached HEAD)',
    commit: runMetadataCommand('git', ['rev-parse', '--short', 'HEAD']) || 'unknown',
    dirtyFileCount: gitStatus ? gitStatus.split(/\r?\n/u).filter(Boolean).length : 0,
    nodeVersion: process.version,
    npmVersion: runMetadataCommand('npm', ['--version']) || 'unknown',
    platform: process.platform,
  };
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

function renderMarkdown(log: AutomationRunLog): string {
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
      lines.push(`Monthly review: ${path.relative(REPO_ROOT, log.review.monthlyReviewPath)}`);
    }
    if (log.review.monthlyReviewGenerated && log.review.monthlyPromptPath) {
      lines.push(`Review prompt: ${path.relative(REPO_ROOT, log.review.monthlyPromptPath)}`);
    }
    if (log.review.advisorReviewPath) {
      lines.push(`Advisor review: ${path.relative(REPO_ROOT, log.review.advisorReviewPath)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export class AutomationRun {
  private readonly runDirectory: string;
  private readonly reviewsDirectory: string;
  private readonly logPath: string;
  private readonly markdownPath: string;
  private readonly log: Omit<AutomationRunLog, 'endedAt' | 'durationMs' | 'status' | 'artifacts'>;

  constructor(options: AutomationRunOptions) {
    const startedAt = new Date();
    const safeScriptName = options.scriptName.replace(/[^a-z0-9-]/giu, '-').toLowerCase();
    this.runDirectory = path.join(AUTOMATION_ROOT, 'runs', safeScriptName);
    this.reviewsDirectory = path.join(AUTOMATION_ROOT, 'reviews');
    mkdirSync(this.runDirectory, { recursive: true });

    const id = `${startedAt.toISOString().replace(/[:.]/gu, '-')}-${process.pid}`;
    this.logPath = path.join(this.runDirectory, `${id}.json`);
    this.markdownPath = path.join(this.runDirectory, `${id}.md`);
    this.log = {
      id,
      scriptName: safeScriptName,
      mode: options.mode,
      args: options.args ?? [],
      startedAt: startedAt.toISOString(),
      metadata: getMetadata(),
      expectedArtifacts: options.expectedArtifacts ?? [],
      steps: [],
    };
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
      cwd: REPO_ROOT,
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

  async finish(status: AutomationRunStatus, error?: unknown): Promise<void> {
    const endedAt = new Date();
    const artifacts = this.log.expectedArtifacts.map((artifact) => ({
      path: artifact.path,
      exists: existsSync(path.join(REPO_ROOT, artifact.path)),
      required: artifact.required !== false,
    }));
    const finalLog: AutomationRunLog = {
      ...this.log,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - new Date(this.log.startedAt).getTime(),
      status,
      artifacts,
      error: error ? redactSensitiveText(error instanceof Error ? error.message : String(error)) : undefined,
    };

    writeFileSync(this.logPath, JSON.stringify(finalLog, null, 2), 'utf8');
    const review = reviewAutomationRun({
      runDirectory: this.runDirectory,
      reviewsDirectory: this.reviewsDirectory,
      latestLog: finalLog,
    });
    const reviewedLog = { ...finalLog, review };
    writeFileSync(this.logPath, JSON.stringify(reviewedLog, null, 2), 'utf8');
    writeFileSync(this.markdownPath, renderMarkdown(reviewedLog), 'utf8');
    console.log(formatReviewForConsole(review));
    console.log(`Automation log written: ${path.relative(REPO_ROOT, this.markdownPath)}`);

    if (review.monthlyReviewGenerated && review.monthlyReview) {
      try {
        writeMonthlyAutomationPendingFollowUp({
          scriptName: review.scriptName,
          monthKey: review.monthlyReview.monthKey,
          reviewPath: review.monthlyReview.reviewPath,
          suggestionsPath: review.monthlyReview.suggestionsPath,
          suggestions: review.monthlyReview.suggestions,
          knowledgeDirectory: review.monthlyReview.knowledgeDirectory,
          repoRoot: REPO_ROOT,
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
