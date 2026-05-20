import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { config } from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import pg from 'pg';

config({ path: path.resolve(process.cwd(), '.env.local') });

if (process.env.NODE_ENV === 'development') {
  Reflect.deleteProperty(process.env, 'NODE_ENV');
}

const { Client } = pg;
const REPO_ROOT = process.cwd();
const NEXT_BUILD_DIR = path.join(REPO_ROOT, '.next');
const DEV_SERVER_PORT = 4000;
const DEFAULT_COMMIT_MESSAGE = 'chore(finalise): repo finalisation';
const FULL_COMMIT_MESSAGE = 'chore(finalise): full repo finalisation';
const PRIVATE_PATH_PREFIX = 'private/';

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
}

interface ManagedProcess {
  child: ChildProcess;
  label: string;
  output: string[];
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
  const useShell = process.platform === 'win32' && command !== 'git';
  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: useShell,
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

function getChangedFiles(): string[] {
  const tracked = runCommand('git', ['diff', '--name-only', 'HEAD', '--'], {
    captureOutput: true,
  });
  const untracked = runCommand('git', ['ls-files', '--others', '--exclude-standard'], {
    captureOutput: true,
  });

  return Array.from(new Set([...getTrimmedLines(tracked.stdout), ...getTrimmedLines(untracked.stdout)]));
}

function getTrackedPrivateFiles(): string[] {
  return getTrimmedLines(
    runCommand('git', ['ls-files', '--', 'private'], {
      captureOutput: true,
    }).stdout
  ).filter((relativePath) => normalizeForMatch(relativePath).startsWith(PRIVATE_PATH_PREFIX));
}

function assertNoTrackedPrivateFiles(): void {
  const trackedPrivateFiles = getTrackedPrivateFiles();
  if (trackedPrivateFiles.length === 0) {
    return;
  }

  throw new Error(
    [
      'Refusing to finalise while private/ files are tracked or staged.',
      'Remove them from the index with: git rm -r --cached -- private/',
      `First matches: ${trackedPrivateFiles.slice(0, 10).join(', ')}`,
    ].join(' ')
  );
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

function getPushModeDescription(options: FinaliseOptions): string {
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
  return (
    /^scripts\/migrations\/.+\.ts$/u.test(relativePath) ||
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

    const result = runCommand('powershell.exe', ['-NoProfile', '-Command', command], {
      captureOutput: true,
      allowFailure: true,
    });

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

  const result = runCommand('ps', ['-Ao', 'pid=,ppid=,command='], {
    captureOutput: true,
    allowFailure: true,
  });

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

function startManagedProcess(command: string, args: string[], label: string): ManagedProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: process.env,
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

  assertNoTrackedPrivateFiles();
  runCommand('git', ['add', '-A']);
  assertNoTrackedPrivateFiles();
  runCommand('git', ['commit', '-m', commitMessage]);
  return true;
}

function pushCurrentBranch(): string {
  assertNoTrackedPrivateFiles();
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const unmergedFiles = getUnmergedFiles();
  if (unmergedFiles.length > 0) {
    throw new Error(`Resolve merge conflicts before finalising: ${unmergedFiles.join(', ')}`);
  }
  assertNoTrackedPrivateFiles();

  const changedFiles = getChangedFiles();
  const pendingMigrationFiles = getPendingMigrationFiles(changedFiles);
  const shouldRunDbValidate = pendingMigrationFiles.some((relativePath) => migrationNeedsDbValidate(relativePath));
  const devServerProcesses = getRepoDevServerProcesses();
  const branch = getCurrentBranch();
  const commitMessage = options.full ? FULL_COMMIT_MESSAGE : DEFAULT_COMMIT_MESSAGE;

  if (options.dryRun) {
    console.log(`Mode: ${getPushModeDescription(options)}`);
    console.log(`Branch: ${branch || '(detached HEAD)'}`);
    console.log(`Dev server: ${devServerProcesses.length > 0 ? `would stop ${devServerProcesses.length} process(es)` : 'none running'}`);
    console.log(
      `Migrations: ${
        pendingMigrationFiles.length > 0
          ? `would run ${pendingMigrationFiles.join(', ')}`
          : 'none pending'
      }`
    );
    console.log(`DB validate: ${shouldRunDbValidate ? 'would run' : 'not needed'}`);
    console.log('Build: would remove .next and run npm run build');
    console.log(
      `Tests: ${
        options.full
          ? `would run npm run test:run, start a local production server on ${DEV_SERVER_PORT}, then run npm run testsuite`
          : 'skipped'
      }`
    );
    console.log(`Commit: ${hasUncommittedChanges() ? `would commit with "${commitMessage}"` : 'no changes to commit'}`);
    console.log(`Push: ${options.push ? 'would push current branch' : 'skipped'}`);
    return;
  }

  console.log(`Starting finalise workflow (${getPushModeDescription(options)})`);

  if (devServerProcesses.length > 0) {
    console.log(`\n==> Stop dev server (${devServerProcesses.length} process${devServerProcesses.length === 1 ? '' : 'es'})`);
    await stopRepoDevServer();
  } else {
    console.log('\n==> Stop dev server');
    console.log('No repo dev server detected.');
  }

  if (pendingMigrationFiles.length > 0) {
    console.log(`\n==> Run pending local migrations (${pendingMigrationFiles.length})`);
    await runPendingMigrations(pendingMigrationFiles);
  } else {
    console.log('\n==> Run pending local migrations');
    console.log('No pending local migration files detected.');
  }

  if (shouldRunDbValidate) {
    console.log('\n==> Validate database after schema-risk migration');
    runCommand('npm', ['run', 'db:validate']);
  } else {
    console.log('\n==> Validate database after schema-risk migration');
    console.log('No rename/drop migration detected.');
  }

  console.log('\n==> Remove clean build output');
  const removedBuildOutput = removeNextBuildOutput();
  console.log(removedBuildOutput ? 'Removed .next build output.' : 'No .next build output to remove.');

  console.log('\n==> Run clean production build');
  runCommand('npm', ['run', 'build']);

  if (options.full) {
    console.log('\n==> Run full automated test suite');
    console.log('Preparing test users...');
    runCommand('npm', ['run', 'setup:test-users']);
    runCommand('npm', ['run', 'test:run']);
    console.log(`Starting local production server on port ${DEV_SERVER_PORT} for testsuite...`);
    const testServer = startManagedProcess(
      'npm',
      ['run', 'start', '--', '--port', String(DEV_SERVER_PORT)],
      'Local production server'
    );

    try {
      await waitForServerReady(testServer, `http://127.0.0.1:${DEV_SERVER_PORT}`);
      runCommand('npm', ['run', 'testsuite']);
    } finally {
      await stopManagedProcess(testServer);
    }
  } else {
    console.log('\n==> Run full automated test suite');
    console.log('Skipped for non-full finalise.');
  }

  console.log('\n==> Commit workspace changes');
  const committed = commitAllChanges(commitMessage);
  console.log(committed ? `Created commit: ${commitMessage}` : 'No uncommitted changes, so no commit was created.');

  let pushedBranch: string | null = null;
  if (options.push) {
    console.log('\n==> Push current branch');
    pushedBranch = pushCurrentBranch();
  } else {
    console.log('\n==> Push current branch');
    console.log('Skipped for non-push finalise.');
  }

  console.log('\nFinalise complete.');
  console.log(`- Branch: ${branch || '(detached HEAD)'}`);
  console.log(`- Migrations run: ${pendingMigrationFiles.length}`);
  console.log(`- Build: passed`);
  console.log(`- Tests: ${options.full ? 'passed' : 'skipped'}`);
  console.log(`- Commit: ${committed ? 'created' : 'skipped'}`);
  console.log(`- Push: ${pushedBranch ? `pushed ${pushedBranch}` : 'skipped'}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFinalise failed: ${message}`);
  process.exit(1);
});
