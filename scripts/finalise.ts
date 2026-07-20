import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { config } from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import pg from 'pg';
import { parseCommitsFromMessages, selectPrimaryCommitMessage } from '../lib/config/release-version-logic';
import { AutomationRun } from './automation/logger';
import { checkFinaliseBlockingActivity, formatBlockingActivity } from './finalise-activity-guard';
import { getSkippableFinaliseTasks, type RecentFinaliseTaskRun } from './finalise-recent-tasks';
import {
  type FinaliseChangedFile,
  formatReleaseVersionCommitMessage,
  getFinaliseTimingSummaryLines,
  summarizeFinaliseChanges,
  type FinaliseTimingEntry,
} from './finalise-summary';
import {
  assertReleaseMetadataConsistency,
  assertReleaseMetadataTracking,
  formatReleaseRecoveryMessage,
  RELEASE_VERSION_FILES,
} from './finalise-release';

config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const REPO_ROOT = process.cwd();
const NEXT_BUILD_DIR = path.join(REPO_ROOT, '.next');
const NEXT_BUILD_ARTIFACT_PATH = path.join(NEXT_BUILD_DIR, 'BUILD_ID');
const RELEASE_VERSION_JSON_PATH = path.join(REPO_ROOT, 'lib/config/release-version.json');
const DEV_SERVER_PORT = 4000;
let automationRun: AutomationRun | null = null;

interface FinaliseOptions {
  full: boolean;
  push: boolean;
  dryRun: boolean;
  help: boolean;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ProcessInfo {
  pid: number;
  parentPid: number;
  commandLine: string;
}

interface RunCommandOptions {
  allowFailure?: boolean;
  captureOutput?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface ManagedProcess {
  child: ChildProcess;
  label: string;
  output: string[];
}

interface ReleaseVersionState {
  mmyy: string;
  major: number;
  minor: number;
  lastProcessedSha: string;
}

function parseArgs(argv: string[]): FinaliseOptions {
  const args = new Set(argv);

  return {
    full: args.has('--full'),
    push: args.has('--push'),
    dryRun: args.has('--dry-run'),
    help: args.has('--help') || args.has('-h'),
  };
}

function normalizeForMatch(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function quoteArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'git') {
    return command;
  }

  if (command === 'npm') {
    return 'npm.cmd';
  }

  if (command === 'npx') {
    return 'npx.cmd';
  }

  return command;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function appendManagedOutput(managedProcess: ManagedProcess, chunk: string | Buffer | null | undefined): void {
  if (!chunk) {
    return;
  }

  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (!text) {
    return;
  }

  managedProcess.output.push(text);
  if (managedProcess.output.length > 20) {
    managedProcess.output.splice(0, managedProcess.output.length - 20);
  }
}

function runCommand(command: string, args: string[], options: RunCommandOptions = {}): CommandResult {
  if (automationRun) {
    return automationRun.runCommand(command, args, options);
  }

  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: options.env ?? process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    stdio: options.captureOutput ? 'pipe' : 'inherit',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (!options.allowFailure && result.status !== 0) {
    const renderedCommand = [command, ...args.map(quoteArg)].join(' ');
    const executionError = result.error instanceof Error ? `: ${result.error.message}` : '';
    throw new Error(`Command failed (${renderedCommand})${executionError}`);
  }

  return {
    status: result.status,
    stdout,
    stderr,
  };
}

function getTrimmedLines(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getChangedFileStats(): FinaliseChangedFile[] {
  const tracked = runCommand('git', ['diff', '--numstat', 'HEAD', '--'], {
    captureOutput: true,
  });
  const untracked = runCommand('git', ['ls-files', '--others', '--exclude-standard'], {
    captureOutput: true,
  });
  const statsByPath = new Map<string, FinaliseChangedFile>();

  getTrimmedLines(tracked.stdout).forEach((line) => {
    const [rawAdditions, rawDeletions, rawPath] = line.split(/\t/u);
    const filePath = rawPath || '';
    if (!filePath) return;

    const additions = Number.parseInt(rawAdditions || '0', 10);
    const deletions = Number.parseInt(rawDeletions || '0', 10);
    statsByPath.set(filePath, {
      path: filePath,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  });

  getTrimmedLines(untracked.stdout).forEach((filePath) => {
    if (!statsByPath.has(filePath)) {
      statsByPath.set(filePath, { path: filePath, additions: 0, deletions: 0 });
    }
  });

  return Array.from(statsByPath.values());
}

function getGitStatusPorcelain(): string {
  return runCommand('git', ['status', '--porcelain'], {
    captureOutput: true,
  }).stdout.trim();
}

function getUnmergedFiles(): string[] {
  return getTrimmedLines(
    runCommand('git', ['diff', '--name-only', '--diff-filter=U'], {
      captureOutput: true,
      allowFailure: true,
    }).stdout
  );
}

function hasUncommittedChanges(): boolean {
  return getGitStatusPorcelain().length > 0;
}

function getCurrentBranch(): string {
  return runCommand('git', ['branch', '--show-current'], {
    captureOutput: true,
  }).stdout.trim();
}

function getHeadSha(): string {
  return runCommand('git', ['rev-parse', 'HEAD'], {
    captureOutput: true,
  }).stdout.trim();
}

function readReleaseVersionState(): ReleaseVersionState {
  const raw = readFileSync(RELEASE_VERSION_JSON_PATH, 'utf8');
  return JSON.parse(raw) as ReleaseVersionState;
}

function formatReleaseVersionLabel(state: Pick<ReleaseVersionState, 'mmyy' | 'major' | 'minor'>): string {
  return `${state.mmyy}.${state.major}.${state.minor}`;
}

function hasReleaseVersionChanges(): boolean {
  const status = runCommand('git', ['status', '--porcelain', '--', ...RELEASE_VERSION_FILES], {
    captureOutput: true,
  });

  return status.stdout.trim().length > 0;
}

function getReleaseCommitPrimaryMessage(beforeSha: string, afterSha: string): string | null {
  if (!beforeSha || beforeSha === '0000000000000000000000000000000000000000') {
    return null;
  }

  const log = runCommand('git', ['log', '--format=%s', `${beforeSha}..${afterSha}`], {
    captureOutput: true,
  });
  const commits = parseCommitsFromMessages(getTrimmedLines(log.stdout));

  return selectPrimaryCommitMessage(commits);
}

function commitReleaseVersionChanges(primaryCommitMessage: string | null): string | null {
  if (!hasReleaseVersionChanges()) {
    return null;
  }

  const version = formatReleaseVersionLabel(readReleaseVersionState());
  runCommand('git', ['add', ...RELEASE_VERSION_FILES]);
  runCommand('git', ['commit', '-m', formatReleaseVersionCommitMessage(primaryCommitMessage, version)]);

  return version;
}

function getPushModeDescription(options: FinaliseOptions): string {
  if (options.dryRun) {
    return 'dry-run';
  }

  if (options.full && options.push) {
    return 'full + push';
  }

  if (options.full) {
    return 'full';
  }

  if (options.push) {
    return 'push';
  }

  return 'standard';
}

function printProgress(message: string, percent: number): void {
  console.log(`- ${message} [${percent}% complete]`);
}

async function timeFinaliseStep<T>(
  timings: FinaliseTimingEntry[],
  label: string,
  action: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await action();
    timings.push({
      label,
      durationMs: Date.now() - startedAt,
      status: 'completed',
    });
    return result;
  } catch (error) {
    timings.push({
      label,
      durationMs: Date.now() - startedAt,
      status: 'failed',
    });
    throw error;
  }
}

function formatRecentTask(run: RecentFinaliseTaskRun): string {
  return `${run.command} (${run.source}, completed ${run.completedAt})`;
}

function getRecentTaskMetadata(run: RecentFinaliseTaskRun): Record<string, unknown> {
  return {
    reason: 'recent-successful-run',
    command: run.command,
    completedAt: run.completedAt,
    source: run.source,
  };
}

interface BuildProgressMilestone {
  message: string;
  percent: number;
  patterns: RegExp[];
}

const BUILD_PROGRESS_MILESTONES: BuildProgressMilestone[] = [
  {
    message: 'Compiling application bundles...',
    percent: 34,
    patterns: [/Creating an optimized production build/u],
  },
  {
    message: 'Application bundles compiled.',
    percent: 38,
    patterns: [/Compiled successfully/u],
  },
  {
    message: 'Running lint and TypeScript validation...',
    percent: 41,
    patterns: [/Linting and checking validity of types/u],
  },
  {
    message: 'Collecting route and page data...',
    percent: 44,
    patterns: [/Collecting page data/u],
  },
  {
    message: 'Generating static route output...',
    percent: 47,
    patterns: [/Generating static pages/u],
  },
  {
    message: 'Finalising route manifests and build traces...',
    percent: 49,
    patterns: [/Finalizing page optimization/u, /Collecting build traces/u],
  },
];

function handleBuildProgressLine(line: string, printedMilestones: Set<number>): void {
  BUILD_PROGRESS_MILESTONES.forEach((milestone, index) => {
    if (printedMilestones.has(index)) return;
    if (!milestone.patterns.some((pattern) => pattern.test(line))) return;

    printedMilestones.add(index);
    printProgress(milestone.message, milestone.percent);
  });
}

function runCleanProductionBuildWithProgress(): Promise<void> {
  return new Promise((resolve, reject) => {
    printProgress('Starting clean Next.js production build...', 32);
    const printedMilestones = new Set<number>();
    let bufferedOutput = '';

    const child = spawn(getExecutable('npm'), ['run', 'build'], {
      cwd: REPO_ROOT,
      env: process.env,
      shell: shouldUseShell('npm'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    function processOutput(chunk: string | Buffer, writer: NodeJS.WriteStream): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      writer.write(text);
      bufferedOutput += text;

      const lines = bufferedOutput.split(/\r?\n/u);
      bufferedOutput = lines.pop() || '';
      lines.forEach((line) => handleBuildProgressLine(line, printedMilestones));
    }

    child.stdout?.on('data', (chunk: string | Buffer) => processOutput(chunk, process.stdout));
    child.stderr?.on('data', (chunk: string | Buffer) => processOutput(chunk, process.stderr));
    child.on('error', reject);
    child.on('close', (code) => {
      if (bufferedOutput) {
        handleBuildProgressLine(bufferedOutput, printedMilestones);
      }

      if (code === 0) {
        printProgress('Build passed.', 50);
        resolve();
        return;
      }

      reject(new Error(`Command failed (npm run build)${typeof code === 'number' ? ` with exit code ${code}` : ''}`));
    });
  });
}

function getLocalProductionBaseUrl(): string {
  return `http://127.0.0.1:${DEV_SERVER_PORT}`;
}

function getLocalTestEnv(): NodeJS.ProcessEnv {
  const baseUrl = getLocalProductionBaseUrl();

  return {
    ...process.env,
    PORT: String(DEV_SERVER_PORT),
    NEXT_PUBLIC_SITE_URL: baseUrl,
    TESTSUITE_BASE_URL: baseUrl,
  };
}

function runUnloggedCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });

  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function collectMigrationFilesFromScript(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf8');
  const matches = content.match(/supabase\/[A-Za-z0-9_./-]+\.sql/gu) ?? [];

  return matches
    .map((relativePath) => relativePath.replace(/\\/g, '/'))
    .filter((relativePath) => existsSync(path.join(REPO_ROOT, relativePath)));
}

function isLikelyMigrationScript(relativePath: string): boolean {
  if (relativePath.startsWith('scripts/migrations/')) {
    return false;
  }

  return (
    /^scripts\/.+migration.+\.ts$/u.test(relativePath) ||
    /^scripts\/.+migrations.+\.ts$/u.test(relativePath)
  );
}

function isDirectMigrationSql(relativePath: string): boolean {
  if (relativePath === 'supabase/schema.sql') {
    return false;
  }

  return /^supabase\/migrations\/.+\.sql$/u.test(relativePath) || /^supabase\/[^/]+\.sql$/u.test(relativePath);
}

function getPendingMigrationFiles(changedFiles: string[]): string[] {
  const pending = new Set<string>();

  for (const relativePath of changedFiles) {
    if (isDirectMigrationSql(relativePath) && existsSync(path.join(REPO_ROOT, relativePath))) {
      pending.add(relativePath);
      continue;
    }

    if (isLikelyMigrationScript(relativePath)) {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      for (const migrationFile of collectMigrationFilesFromScript(absolutePath)) {
        pending.add(migrationFile);
      }
    }
  }

  return Array.from(pending).sort((left, right) => left.localeCompare(right));
}

function migrationNeedsDbValidate(relativePath: string): boolean {
  const content = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

  return (
    /\balter\s+table\b[\s\S]{0,200}\brename\b/iu.test(content) ||
    /\bdrop\s+column\b/iu.test(content) ||
    /\bdrop\s+table\b/iu.test(content)
  );
}

function getDbConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }

  return connectionString;
}

async function createDbClient(): Promise<pg.Client> {
  const connectionString = getDbConnectionString();
  const url = new URL(connectionString);

  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  return client;
}

async function runPendingMigrations(migrationFiles: string[]): Promise<void> {
  const client = await createDbClient();

  try {
    for (const relativePath of migrationFiles) {
      const sql = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      console.log(`\n==> Apply migration ${relativePath}`);
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

function listProcesses(): ProcessInfo[] {
  if (process.platform === 'win32') {
    const command = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$items = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine',
      '$items | ConvertTo-Json -Compress',
    ].join('; ');

    const result = runUnloggedCommand('powershell.exe', ['-NoProfile', '-Command', command]);

    if (result.status !== 0 || result.stdout.trim().length === 0) {
      return [];
    }

    const parsed = JSON.parse(result.stdout) as
      | { ProcessId?: number; ParentProcessId?: number; CommandLine?: string }
      | Array<{ ProcessId?: number; ParentProcessId?: number; CommandLine?: string }>;
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .map((item) => ({
        pid: Number(item.ProcessId ?? 0),
        parentPid: Number(item.ParentProcessId ?? 0),
        commandLine: item.CommandLine ?? '',
      }))
      .filter((item) => item.pid > 0 && item.commandLine.trim().length > 0);
  }

  const result = runUnloggedCommand('ps', ['-Ao', 'pid=,ppid=,command=']);

  if (result.status !== 0) {
    return [];
  }

  return getTrimmedLines(result.stdout)
    .map((line) => line.match(/^(\d+)\s+(\d+)\s+(.*)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      commandLine: match[3],
    }));
}

function isRepoDevServerProcess(processInfo: ProcessInfo): boolean {
  const commandLine = normalizeForMatch(processInfo.commandLine);
  const repoRoot = normalizeForMatch(REPO_ROOT);
  const matchesDevCommand =
    commandLine.includes('npm run dev') ||
    commandLine.includes('next dev') ||
    commandLine.includes('next/dist/bin/next') ||
    commandLine.includes('next\\dist\\bin\\next');
  const matchesRepo =
    commandLine.includes(repoRoot) ||
    commandLine.includes(`${repoRoot}/node_modules/next`) ||
    commandLine.includes(`${repoRoot}/node_modules/npm`);
  const matchesPort =
    commandLine.includes(`-p ${DEV_SERVER_PORT}`) || commandLine.includes(`--port ${DEV_SERVER_PORT}`);

  return matchesDevCommand && matchesRepo && (matchesPort || commandLine.includes('npm run dev'));
}

function getRepoDevServerProcesses(): ProcessInfo[] {
  const seen = new Set<number>();

  return listProcesses().filter((processInfo) => {
    if (!isRepoDevServerProcess(processInfo) || seen.has(processInfo.pid)) {
      return false;
    }

    seen.add(processInfo.pid);
    return true;
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopRepoDevServer(): Promise<number[]> {
  const processes = getRepoDevServerProcesses();
  const pids = processes.map((processInfo) => processInfo.pid);

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1000);
    const remaining = pids.filter((pid) => isProcessAlive(pid));
    if (remaining.length === 0) {
      return pids;
    }
  }

  const remaining = pids.filter((pid) => isProcessAlive(pid));
  for (const pid of remaining) {
    if (process.platform === 'win32') {
      runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], {
        allowFailure: true,
      });
      continue;
    }

    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }

  return pids;
}

function getManagedProcessOutput(managedProcess: ManagedProcess): string {
  return managedProcess.output.join('').trim();
}

function startManagedProcess(
  command: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env
): ManagedProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const managedProcess: ManagedProcess = {
    child,
    label,
    output: [],
  };

  child.stdout?.on('data', (chunk) => appendManagedOutput(managedProcess, chunk));
  child.stderr?.on('data', (chunk) => appendManagedOutput(managedProcess, chunk));

  return managedProcess;
}

async function waitForServerReady(managedProcess: ManagedProcess, url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (/\bready in\b/iu.test(getManagedProcessOutput(managedProcess))) {
      return;
    }

    if (managedProcess.child.exitCode !== null) {
      const details = getManagedProcessOutput(managedProcess);
      throw new Error(
        `${managedProcess.label} exited before becoming ready${details ? `\n${details}` : ''}`
      );
    }

    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status > 0) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  const details = getManagedProcessOutput(managedProcess);
  throw new Error(
    `${managedProcess.label} did not become ready within ${timeoutMs}ms${details ? `\n${details}` : ''}`
  );
}

async function stopManagedProcess(managedProcess: ManagedProcess): Promise<void> {
  const pid = managedProcess.child.pid;
  if (!pid) {
    return;
  }

  if (managedProcess.child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], {
      allowFailure: true,
    });
    return;
  }

  try {
    managedProcess.child.kill('SIGTERM');
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (managedProcess.child.exitCode !== null) {
      return;
    }
    await sleep(500);
  }

  try {
    managedProcess.child.kill('SIGKILL');
  } catch {
    // Process already exited.
  }
}

function removeNextBuildOutput(): boolean {
  if (!existsSync(NEXT_BUILD_DIR)) {
    return false;
  }

  rmSync(NEXT_BUILD_DIR, { recursive: true, force: true });
  return true;
}

function commitAllChanges(commitMessage: string): boolean {
  if (!hasUncommittedChanges()) {
    return false;
  }

  runCommand('git', ['add', '-A']);
  runCommand('git', ['commit', '-m', commitMessage]);
  return true;
}

function pushCurrentBranch(): string {
  const branch = getCurrentBranch();
  if (!branch) {
    throw new Error('Cannot push from a detached HEAD state');
  }

  const upstream = runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    captureOutput: true,
    allowFailure: true,
  });

  if (upstream.status === 0 && upstream.stdout.trim().length > 0) {
    runCommand('git', ['push']);
    return branch;
  }

  runCommand('git', ['push', '-u', 'origin', 'HEAD']);
  return branch;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/finalise.ts [--full] [--push] [--dry-run]

Variants:
  --full     Run the full automated test suite after the clean build
  --push     Push the current branch after commit
  --dry-run  Print the planned actions without changing anything
`);
}

function assertNoBlockingCursorActivity(): void {
  const activityCheck = checkFinaliseBlockingActivity(REPO_ROOT, [process.pid, process.ppid]);
  const nowMs = Date.now();
  const blockingActivities = activityCheck.blockingActivities.filter((activity) => {
    if (!activity.isFinalise || activity.isAgentReview || !activity.startedAt) return true;
    const startedAtMs = Date.parse(activity.startedAt);
    if (Number.isNaN(startedAtMs)) return true;
    // Cursor writes the current terminal metadata before this script can run.
    // Ignore only a finalise terminal that has just started, which is this invocation.
    return Math.abs(nowMs - startedAtMs) > 60_000;
  });
  if (blockingActivities.length === 0) return;

  throw new Error([
    'Blocking Cursor activity detected before finalise:',
    ...blockingActivities.map((activity) => `- ${formatBlockingActivity(activity)}`),
    `Terminal directory checked: ${activityCheck.terminalDirectory}`,
    'Wait for the active Agent Review/finalise run to finish, then rerun finalise.',
  ].join('\n'));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const run = new AutomationRun({
    scriptName: 'finalise',
    mode: getPushModeDescription(options),
    args: process.argv.slice(2),
  });
  automationRun = run;

  try {
    if (options.help) {
      printHelp();
      await run.finish('passed');
      return;
    }

    await run.step('Check for blocking Cursor activity', () => assertNoBlockingCursorActivity());

    const unmergedFiles = getUnmergedFiles();
    if (unmergedFiles.length > 0) {
      throw new Error(`Resolve merge conflicts before finalising: ${unmergedFiles.join(', ')}`);
    }

    await run.step('Validate release metadata tracking', () => {
      assertReleaseMetadataTracking(REPO_ROOT);
      assertReleaseMetadataConsistency(REPO_ROOT);
    });

    const changedFileStats = getChangedFileStats();
    const changedFiles = changedFileStats.map((entry) => entry.path);
    const pendingMigrationFiles = getPendingMigrationFiles(changedFiles);
    const shouldRunDbValidate = pendingMigrationFiles.some((relativePath) => migrationNeedsDbValidate(relativePath));
    const devServerProcesses = getRepoDevServerProcesses();
    const branch = getCurrentBranch();
    const initialChangeSummary = summarizeFinaliseChanges(changedFileStats);
    const skippableTasks = getSkippableFinaliseTasks({
      repoRoot: REPO_ROOT,
      changedFiles,
      pendingMigrationFiles,
      buildArtifactPath: NEXT_BUILD_ARTIFACT_PATH,
    });
    const recentMigrationRun = pendingMigrationFiles.length > 0 ? skippableTasks.migrations : undefined;
    const recentDbValidateRun = shouldRunDbValidate ? skippableTasks['db-validate'] : undefined;
    const recentBuildRun = skippableTasks.build;
    const recentTestRun = options.full ? skippableTasks['test-run'] : undefined;
    const recentTestsuiteRun = options.full ? skippableTasks.testsuite : undefined;

    if (options.dryRun) {
      console.log(`Mode: ${getPushModeDescription(options)}`);
      console.log(`Branch: ${branch || '(detached HEAD)'}`);
      console.log(`Dev server: ${devServerProcesses.length > 0 ? `would stop ${devServerProcesses.length} process(es)` : 'none running'}`);
      console.log(
        `Migrations: ${
          recentMigrationRun
            ? `would skip; recent run found: ${formatRecentTask(recentMigrationRun)}`
            : pendingMigrationFiles.length > 0
            ? `would run ${pendingMigrationFiles.join(', ')}`
            : 'none pending'
        }`
      );
      console.log(
        `DB validate: ${
          recentDbValidateRun
            ? `would skip; recent run found: ${formatRecentTask(recentDbValidateRun)}`
            : shouldRunDbValidate
            ? 'would run'
            : 'not needed'
        }`
      );
      console.log(
        `Build: ${
          recentBuildRun
            ? `would reuse recent passed build: ${formatRecentTask(recentBuildRun)}`
            : 'would remove .next and run npm run build'
        }`
      );
      console.log(
        `Tests: ${
          options.full
            ? [
                `would start a local production server on ${DEV_SERVER_PORT} if needed`,
                recentTestRun ? `skip npm run test:run (${formatRecentTask(recentTestRun)})` : 'run npm run test:run',
                recentTestsuiteRun ? `skip npm run testsuite (${formatRecentTask(recentTestsuiteRun)})` : 'run npm run testsuite',
              ].join(', ')
            : 'skipped'
        }`
      );
      console.log(
        `Commit: ${
          hasUncommittedChanges()
            ? `would commit ${initialChangeSummary.fileCount} file(s) with "${initialChangeSummary.commitMessage}"`
            : 'no changes to commit'
        }`
      );
      console.log('Release version: would update locally before push if a bump is due');
      console.log(`Push: ${options.push ? 'would push current branch' : 'skipped'}`);
      await run.finish('passed');
      return;
    }

    console.log(`Starting finalise workflow (${getPushModeDescription(options)})`);
    printProgress('Workflow started.', 0);
    const timingEntries: FinaliseTimingEntry[] = [];

    if (devServerProcesses.length > 0) {
      console.log(`\n==> Stop dev server (${devServerProcesses.length} process${devServerProcesses.length === 1 ? '' : 'es'})`);
      printProgress('Stopping repo dev server...', 5);
      await timeFinaliseStep(timingEntries, 'Stop repo dev server', () =>
        run.step('Stop repo dev server', () => stopRepoDevServer(), {
          processCount: devServerProcesses.length,
        })
      );
      printProgress('Repo dev server stopped.', 10);
    } else {
      console.log('\n==> Stop dev server');
      printProgress('No repo dev server detected.', 10);
    }

    if (pendingMigrationFiles.length > 0) {
      console.log(`\n==> Run pending local migrations (${pendingMigrationFiles.length})`);
      if (recentMigrationRun) {
        await run.step('Skip pending local migrations', () => undefined, {
          ...getRecentTaskMetadata(recentMigrationRun),
          migrationFiles: pendingMigrationFiles,
        });
        printProgress(`Reused recent migration run: ${formatRecentTask(recentMigrationRun)}.`, 20);
      } else {
        printProgress(`Running ${pendingMigrationFiles.length} pending migration${pendingMigrationFiles.length === 1 ? '' : 's'}...`, 12);
        await timeFinaliseStep(timingEntries, 'Run pending local migrations', () =>
          run.step('Run pending local migrations', () => runPendingMigrations(pendingMigrationFiles), {
            migrationFiles: pendingMigrationFiles,
          })
        );
        printProgress('Pending migrations applied.', 20);
      }
    } else {
      console.log('\n==> Run pending local migrations');
      printProgress('No pending local migration files detected.', 20);
    }

    if (shouldRunDbValidate) {
      console.log('\n==> Validate database after schema-risk migration');
      if (recentDbValidateRun) {
        await run.step('Skip database validation after schema-risk migration', () => undefined, getRecentTaskMetadata(recentDbValidateRun));
        printProgress(`Reused recent database validation: ${formatRecentTask(recentDbValidateRun)}.`, 25);
      } else {
        printProgress('Running database validation...', 22);
        await timeFinaliseStep(timingEntries, 'Run database validation', () => runCommand('npm', ['run', 'db:validate']));
        printProgress('Database validation passed.', 25);
      }
    } else {
      console.log('\n==> Validate database after schema-risk migration');
      printProgress('No rename/drop migration detected.', 25);
    }

    console.log('\n==> Run clean production build');
    if (recentBuildRun) {
      await run.step('Reuse recent production build', () => undefined, getRecentTaskMetadata(recentBuildRun));
      printProgress(`Reused recent production build: ${formatRecentTask(recentBuildRun)}.`, 50);
    } else {
      console.log('\n==> Remove clean build output');
      printProgress('Removing previous clean build output...', 28);
      const removedBuildOutput = await run.step('Remove clean build output', () => removeNextBuildOutput());
      printProgress(removedBuildOutput ? 'Removed .next build output.' : 'No .next build output to remove.', 30);

      await timeFinaliseStep(timingEntries, 'Run clean production build', () =>
        run.step('Run clean production build', () => runCleanProductionBuildWithProgress())
      );
    }

    if (options.full) {
      console.log('\n==> Run full automated test suite');
      const localProductionBaseUrl = getLocalProductionBaseUrl();
      const localTestEnv = getLocalTestEnv();
      const shouldRunTestRun = !recentTestRun;
      const shouldRunTestsuite = !recentTestsuiteRun;

      if (!shouldRunTestRun && !shouldRunTestsuite) {
        await run.step('Reuse recent full automated test suite', () => undefined, {
          testRun: recentTestRun ? getRecentTaskMetadata(recentTestRun) : null,
          testsuite: recentTestsuiteRun ? getRecentTaskMetadata(recentTestsuiteRun) : null,
        });
        printProgress('Reused recent full automated test suite.', 84);
      } else {
        printProgress(`Starting local production server on ${localProductionBaseUrl}...`, 52);
        const testServer = startManagedProcess(
          'npm',
          ['run', 'start', '--', '--port', String(DEV_SERVER_PORT)],
          'Local production server',
          localTestEnv
        );

        try {
          printProgress('Waiting for local production server readiness...', 55);
          await run.step('Wait for local production server', () =>
            waitForServerReady(testServer, localProductionBaseUrl)
          );
          printProgress(`Local production server ready on port ${DEV_SERVER_PORT}.`, 58);
          if (recentTestRun) {
            await run.step('Reuse recent Vitest test run', () => undefined, getRecentTaskMetadata(recentTestRun));
            printProgress(`Reused recent Vitest test run: ${formatRecentTask(recentTestRun)}.`, 72);
          } else {
            printProgress('Running Vitest unit, integration, and component tests...', 60);
            await timeFinaliseStep(timingEntries, 'Run Vitest test run', () =>
              runCommand('npm', ['run', 'test:run'], { env: localTestEnv })
            );
            printProgress('Vitest test run passed.', 72);
          }
          if (recentTestsuiteRun) {
            await run.step('Reuse recent API and Playwright testsuite', () => undefined, getRecentTaskMetadata(recentTestsuiteRun));
            printProgress(`Reused recent API and Playwright testsuite: ${formatRecentTask(recentTestsuiteRun)}.`, 84);
          } else {
            printProgress('Running API and Playwright testsuite...', 75);
            await timeFinaliseStep(timingEntries, 'Run API and Playwright testsuite', () =>
              runCommand('npm', ['run', 'testsuite'], { env: localTestEnv })
            );
            printProgress('Full automated test suite passed.', 84);
          }
        } finally {
          printProgress('Stopping local production server...', 85);
          await timeFinaliseStep(timingEntries, 'Stop local production server', () =>
            run.step('Stop local production server', () => stopManagedProcess(testServer))
          );
          printProgress('Local production server stopped.', 86);
        }
      }
    } else {
      console.log('\n==> Run full automated test suite');
      printProgress('Skipped for non-full finalise.', 84);
    }

    console.log('\n==> Summarise workspace changes');
    printProgress('Summarising workspace changes...', 87);
    const changeSummary = summarizeFinaliseChanges(changedFileStats);
    if (changeSummary.fileCount > 0) {
      console.log(`Changed files: ${changeSummary.fileCount}`);
      console.log(`Areas: ${changeSummary.areas.join(', ')}`);
      console.log(`Commit message: ${changeSummary.commitMessage}`);
    } else {
      console.log('No workspace changes to summarise.');
    }

    console.log('\n==> Commit workspace changes');
    printProgress('Committing workspace changes if needed...', 90);
    const committed = await timeFinaliseStep(timingEntries, 'Commit workspace changes', () =>
      run.step('Commit workspace changes', () => commitAllChanges(changeSummary.commitMessage), {
        plannedCommitMessage: changeSummary.commitMessage,
      })
    );
    const productCommitSha = getHeadSha();
    printProgress(
      committed ? `Created commit: ${changeSummary.commitMessage}` : 'No uncommitted changes, so no commit was created.',
      92
    );

    console.log('\n==> Bump release version locally');
    printProgress('Checking release version bump...', 93);
    const releaseBeforeSha = readReleaseVersionState().lastProcessedSha;
    const releaseAfterSha = getHeadSha();
    const releasePrimaryCommitMessage =
      getReleaseCommitPrimaryMessage(releaseBeforeSha, releaseAfterSha) ??
      (committed ? changeSummary.commitMessage : null);
    let releaseVersion: string | null;
    try {
      releaseVersion = await timeFinaliseStep(timingEntries, 'Bump release version locally', () =>
        run.step('Create release version commit', () => {
          runCommand('npm', ['run', 'version:bump', '--', releaseBeforeSha, releaseAfterSha]);
          const version = commitReleaseVersionChanges(releasePrimaryCommitMessage);
          assertReleaseMetadataConsistency(REPO_ROOT);
          return version;
        }, {
          releaseBeforeSha,
          releaseAfterSha,
        })
      );
    } catch (error) {
      if (committed) {
        throw new Error(formatReleaseRecoveryMessage({
          productCommitSha,
          releaseBeforeSha,
          releaseAfterSha,
          cause: error,
        }));
      }
      throw error;
    }
    printProgress(
      releaseVersion
        ? `Created release version commit: ${formatReleaseVersionCommitMessage(releasePrimaryCommitMessage, releaseVersion).split(/\r?\n/u)[0]}`
        : 'No release version bump required.',
      95
    );

    let pushedBranch: string | null = null;
    if (options.push) {
      console.log('\n==> Push current branch');
      printProgress(`Pushing branch ${branch || '(detached HEAD)'}...`, 97);
      pushedBranch = await timeFinaliseStep(timingEntries, 'Push current branch', () =>
        run.step('Push current branch', () => pushCurrentBranch(), {
          branch: branch || null,
        })
      );
      printProgress(`Pushed ${pushedBranch}.`, 99);
    } else {
      console.log('\n==> Push current branch');
      printProgress('Skipped for non-push finalise.', 99);
    }

    console.log('\nFinalise complete.');
    console.log(`- Branch: ${branch || '(detached HEAD)'}`);
    console.log(`- Migrations run: ${recentMigrationRun ? 'reused recent run' : pendingMigrationFiles.length}`);
    console.log(`- Build: ${recentBuildRun ? 'reused recent passed build' : 'passed'}`);
    console.log(
      `- Tests: ${
        options.full
          ? recentTestRun && recentTestsuiteRun
            ? 'reused recent passed runs'
            : 'passed'
          : 'skipped'
      }`
    );
    console.log(`- Commit: ${committed ? 'created' : 'skipped'}`);
    console.log(`- Release version: ${releaseVersion ? `bumped to ${releaseVersion}` : 'unchanged'}`);
    console.log(`- Push: ${pushedBranch ? `pushed ${pushedBranch}` : 'skipped'}`);
    run.recordStep({
      name: 'Record finalise outcomes',
      status: 'passed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      metadata: {
        productCommit: committed ? 'created' : 'skipped',
        productCommitSha,
        releaseCommit: releaseVersion ? 'created' : 'skipped',
        releaseVersion,
        push: pushedBranch ? 'completed' : options.push ? 'failed' : 'skipped',
        pushedBranch,
      },
    });
    console.log('\n==> Timing summary');
    getFinaliseTimingSummaryLines(timingEntries).forEach((line) => console.log(line));
    printProgress('Finalise workflow complete.', 100);
    await run.finish('passed');
  } catch (error) {
    await run.finish('failed', error);
    throw error;
  } finally {
    automationRun = null;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFinalise failed: ${message}`);
  process.exit(1);
});
