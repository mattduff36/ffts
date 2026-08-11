import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { FinaliseTaskKey } from '../finalise-recent-tasks';
import { assertSafeOpaqueId } from './workflow-plan-contract';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  writeJsonAtomic,
} from './workflow-events';
import { getActiveFinaliseContext, readProtocolRecord } from './workflow-review-protocol';

function requireSafeFinaliseIds(params: {
  workstreamId: string;
  checkpointId: string;
}): { workstreamId: string; checkpointId: string } {
  const workstream = assertSafeOpaqueId(params.workstreamId, 'workstreamId');
  if (!workstream.ok) {
    throw new Error(workstream.error);
  }
  const checkpoint = assertSafeOpaqueId(params.checkpointId, 'checkpointId');
  if (!checkpoint.ok) {
    throw new Error(checkpoint.error);
  }
  return { workstreamId: workstream.value, checkpointId: checkpoint.value };
}

export const FINALISE_TASK_COMMANDS: Record<FinaliseTaskKey, string> = {
  migrations: 'run-pending-migrations',
  'db-validate': 'npm run db:validate',
  build: 'npm run build',
  'test-run': 'npm run test:run',
  testsuite: 'npm run testsuite',
};

export interface FinaliseCheckpointStep {
  task: FinaliseTaskKey;
  status: 'passed' | 'failed' | 'started' | 'incomplete';
  startedAt: string;
  endedAt?: string;
  inputFingerprint: string;
  artifactHashes: Record<string, string>;
  command: string;
  exitCode?: number | null;
}

export interface FinaliseCheckpointRecord {
  schemaVersion: '1';
  checkpointId: string;
  workstreamId: string;
  branchName: string;
  headCommit: string;
  createdAt: string;
  updatedAt: string;
  inputFingerprint: string;
  migrationFingerprint: string;
  /** Live schema fingerprint from read-only catalog query, or 'unavailable'. */
  liveSchemaFingerprint: string;
  environmentFingerprint: string;
  steps: Partial<Record<FinaliseTaskKey, FinaliseCheckpointStep>>;
}

export type FinaliseModeKey = 'finalise' | 'finalise-full' | 'fap' | 'ffap';

export interface OrdinaryFinaliseCacheRecord {
  schemaVersion: '1';
  mode: FinaliseModeKey;
  updatedAt: string;
  steps: Partial<Record<FinaliseTaskKey, FinaliseCheckpointStep>>;
}

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  return hashText(readFileSync(filePath, 'utf8'));
}

function listDirtyFingerprint(repoRoot: string): string {
  const status = runGit(repoRoot, ['status', '--porcelain', '-uall']);
  const lines = status
    ? status
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .sort()
    : [];
  const parts: string[] = [];
  for (const line of lines) {
    const renameMatch = line.match(/^R\d*\s+(.+?)\s+->\s+(.+)$/u);
    const relativePaths = renameMatch
      ? [renameMatch[1]!.trim(), renameMatch[2]!.trim()]
      : [line.slice(3).trim()];
    for (const relative of relativePaths) {
      const absolute = path.join(repoRoot, relative);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        parts.push(`${relative}:absent`);
        continue;
      }
      parts.push(`${relative}:${hashFile(absolute)}`);
    }
  }
  return hashText(parts.join('\n'));
}

function listDirtyPaths(repoRoot: string): string[] {
  const output = runGit(repoRoot, ['status', '--porcelain', '-uall', '-z']);
  if (!output) return [];
  const records = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const renamedPath = records[index];
      if (renamedPath) paths.push(renamedPath.replace(/\\/g, '/'));
      continue;
    }
    paths.push(firstPath.replace(/\\/g, '/'));
  }
  return [...new Set(paths)].sort();
}

function isTaskRelevantPath(task: FinaliseTaskKey, relativePath: string): boolean {
  if (task === 'migrations' || task === 'db-validate') {
    return relativePath.startsWith('supabase/') || /migration/iu.test(relativePath);
  }
  if (relativePath.startsWith('.cursor/')) {
    return task === 'test-run';
  }
  if (
    relativePath.startsWith('docs/') ||
    relativePath.startsWith('docs_private/') ||
    relativePath.startsWith('plans/')
  ) {
    return false;
  }
  if (task === 'build') {
    return !relativePath.startsWith('tests/') && !relativePath.startsWith('testsuite/');
  }
  return true;
}

function taskDirtyFingerprint(repoRoot: string, task: FinaliseTaskKey): string {
  const parts = listDirtyPaths(repoRoot)
    .filter((relativePath) => isTaskRelevantPath(task, relativePath))
    .map((relativePath) => {
      const absolute = path.join(repoRoot, relativePath);
      return existsSync(absolute) && statSync(absolute).isFile()
        ? `${relativePath}:${hashFile(absolute)}`
        : `${relativePath}:absent`;
    });
  return hashText(parts.join('\n'));
}

function collectSqlFiles(directory: string, prefix = ''): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSqlFiles(absolute, relative));
      continue;
    }
    if (entry.name.endsWith('.sql')) files.push(relative.replace(/\\/g, '/'));
  }
  return files.sort();
}

function migrationFingerprint(repoRoot: string): string {
  const migrationsDir = path.join(repoRoot, 'supabase');
  if (!existsSync(migrationsDir)) return hashText('no-migrations');
  const files = collectSqlFiles(migrationsDir);
  return hashText(
    files.map((name) => `${name}:${hashFile(path.join(migrationsDir, name))}`).join('\n')
  );
}

const ORDINARY_REUSE_FINGERPRINTED_ENV_KEYS = new Set([
  'ANALYZE',
  'BROWSERSLIST_ENV',
  'CI',
  'NEXT_RUNTIME',
  'NODE_ENV',
  'NODE_OPTIONS',
  'SKIP_BUILD_CHECKS',
  'TZ',
  'UV_THREADPOOL_SIZE',
  'VERCEL',
  'VERCEL_ENV',
]);

const ORDINARY_REUSE_AMBIENT_ENV_KEYS = new Set([
  '_',
  'ALLUSERSPROFILE',
  'APPDATA',
  'COLORTERM',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'COMPUTERNAME',
  'COMSPEC',
  'DRIVERDATA',
  'GDK_BACKEND',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOSTNAME',
  'LANG',
  'LOCALAPPDATA',
  'LOGNAME',
  'MSYSTEM',
  'NUMBER_OF_PROCESSORS',
  'OLDPWD',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PROMPT',
  'PSMODULEPATH',
  'PUBLIC',
  'PWD',
  'SESSIONNAME',
  'SHELL',
  'SHLVL',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TMP',
  'TMPDIR',
  'USER',
  'USERDOMAIN',
  'USERDOMAIN_ROAMINGPROFILE',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
  'WT_SESSION',
]);

const ORDINARY_REUSE_AMBIENT_ENV_PREFIXES = [
  'COREPACK_',
  'CURSOR_',
  'GIT_',
  'LC_',
  'MINGW_',
  'NPM_',
  'NVM_',
  'PNPM_',
  'VITEST',
  'VOLTA_',
  'VSCODE_',
  'WSL_',
  'XDG_',
  'YARN_',
];

function declaredEnvironmentKeys(repoRoot: string): Set<string> {
  const filePath = path.join(repoRoot, '.env.local');
  if (!existsSync(filePath)) return new Set();
  const keys = new Set<string>();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const matched = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
    if (matched?.[1]) keys.add(matched[1].toUpperCase());
  }
  return keys;
}

function isKnownOrdinaryReuseEnvironmentKey(
  key: string,
  declaredKeys: Set<string>
): boolean {
  const normalized = key.toUpperCase();
  return (
    normalized.startsWith('NEXT_PUBLIC_') ||
    ORDINARY_REUSE_FINGERPRINTED_ENV_KEYS.has(normalized) ||
    ORDINARY_REUSE_AMBIENT_ENV_KEYS.has(normalized) ||
    ORDINARY_REUSE_AMBIENT_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    declaredKeys.has(normalized)
  );
}

function environmentFingerprint(repoRoot: string): string {
  const declaredKeys = declaredEnvironmentKeys(repoRoot);
  const fingerprintedEnvironment = Object.entries(process.env)
    .filter(([key]) => isKnownOrdinaryReuseEnvironmentKey(key, declaredKeys))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value ?? '']);
  return hashText([
    `node:${process.version}`,
    `platform:${process.platform}`,
    `arch:${process.arch}`,
    `environment:${hashText(JSON.stringify(fingerprintedEnvironment))}`,
    `envLocal:${hashFile(path.join(repoRoot, '.env.local'))}`,
  ].join('|'));
}

function ordinaryReuseEnvironmentSupported(repoRoot: string): boolean {
  const declaredKeys = declaredEnvironmentKeys(repoRoot);
  return (
    !process.env.CI &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== 'production' &&
    Object.keys(process.env).every((key) =>
      isKnownOrdinaryReuseEnvironmentKey(key, declaredKeys)
    )
  );
}

function isDatabaseFinaliseTask(task: FinaliseTaskKey): boolean {
  return task === 'migrations' || task === 'db-validate';
}

/**
 * Read-only live schema fingerprint for database finalise steps only.
 * Non-db steps must never call this (TEE-NOLIVE-001).
 */
export function liveSchemaFingerprint(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) return 'unavailable';
  try {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
        const { Client } = require('pg');
        const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING, ssl: { rejectUnauthorized: false } });
        (async () => {
          await client.connect();
          await client.query('BEGIN TRANSACTION READ ONLY');
          await client.query('SET LOCAL statement_timeout = 5000');
          const res = await client.query("SELECT md5(string_agg(table_name || ':' || column_name, ',' ORDER BY table_name, column_name)) AS fp FROM information_schema.columns WHERE table_schema = 'public'");
          await client.query('ROLLBACK');
          await client.end();
          process.stdout.write(String(res.rows[0]?.fp || 'unknown'));
        })().catch(async (error) => {
          try { await client.end(); } catch {}
          process.stderr.write(String(error));
          process.exit(1);
        });
        `,
      ],
      {
        encoding: 'utf8',
        env: process.env,
        shell: false,
        timeout: 15_000,
      }
    );
    if (result.status !== 0) return 'unavailable';
    const fp = (result.stdout || '').trim();
    return fp || 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function inputFingerprint(repoRoot: string): string {
  return hashText(
    [
      `head:${runGit(repoRoot, ['rev-parse', 'HEAD'])}`,
      `dirty:${listDirtyFingerprint(repoRoot)}`,
      `lock:${hashFile(path.join(repoRoot, 'package-lock.json'))}`,
      `pkg:${hashFile(path.join(repoRoot, 'package.json'))}`,
      `tsconfig:${hashFile(path.join(repoRoot, 'tsconfig.json'))}`,
      `next:${hashFile(path.join(repoRoot, 'next.config.ts'))}`,
      `nextAlt:${hashFile(path.join(repoRoot, 'next.config.js'))}`,
      `migrations:${migrationFingerprint(repoRoot)}`,
      `env:${environmentFingerprint(repoRoot)}`,
    ].join('\n')
  );
}

export function getFinaliseTaskFingerprint(params: {
  repoRoot: string;
  task: FinaliseTaskKey;
  mode: FinaliseModeKey;
  command: string;
}): string {
  const taskConfigPaths =
    params.task === 'build'
      ? ['tsconfig.json', 'next.config.ts', 'next.config.js', 'next.config.mjs']
      : params.task === 'test-run'
        ? ['tsconfig.json', 'tsconfig.tests.json', 'vitest.config.ts', 'vitest.workspace.ts']
        : params.task === 'testsuite'
          ? [
              'tsconfig.json',
              'tsconfig.tests.json',
              'testsuite/config/vitest.config.ts',
              'testsuite/config/playwright.config.ts',
            ]
          : [];
  return hashText(
    [
      `task:${params.task}`,
      `mode:${params.mode}`,
      `command:${params.command}`,
      `head:${runGit(params.repoRoot, ['rev-parse', 'HEAD'])}`,
      `dirty:${taskDirtyFingerprint(params.repoRoot, params.task)}`,
      `lock:${hashFile(path.join(params.repoRoot, 'package-lock.json'))}`,
      `pkg:${hashFile(path.join(params.repoRoot, 'package.json'))}`,
      ...taskConfigPaths.map(
        (relativePath) => `${relativePath}:${hashFile(path.join(params.repoRoot, relativePath))}`
      ),
      `env:${environmentFingerprint(params.repoRoot)}`,
      isDatabaseFinaliseTask(params.task)
        ? `migrations:${migrationFingerprint(params.repoRoot)}`
        : '',
    ].join('\n')
  );
}

export function getFinaliseRepairSafetyFingerprint(params: {
  repoRoot: string;
  task: FinaliseTaskKey;
  mode: FinaliseModeKey;
  command: string;
}): string {
  return hashText(
    [
      `task:${params.task}`,
      `mode:${params.mode}`,
      `command:${params.command}`,
      `head:${runGit(params.repoRoot, ['rev-parse', 'HEAD'])}`,
      `lock:${hashFile(path.join(params.repoRoot, 'package-lock.json'))}`,
      `pkg:${hashFile(path.join(params.repoRoot, 'package.json'))}`,
      `tsconfig:${hashFile(path.join(params.repoRoot, 'tsconfig.json'))}`,
      `next:${hashFile(path.join(params.repoRoot, 'next.config.ts'))}`,
      `vitest:${hashFile(path.join(params.repoRoot, 'vitest.config.ts'))}`,
      `env:${environmentFingerprint(params.repoRoot)}`,
    ].join('\n')
  );
}

export function getOrdinaryFinaliseCachePath(
  repoRoot: string,
  mode: FinaliseModeKey
): string {
  return path.join(
    repoRoot,
    'docs_private',
    'automation',
    'finalise-cache',
    `${mode}.json`
  );
}

export function readOrdinaryFinaliseCache(
  repoRoot: string,
  mode: FinaliseModeKey
): OrdinaryFinaliseCacheRecord | null {
  const filePath = getOrdinaryFinaliseCachePath(repoRoot, mode);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as OrdinaryFinaliseCacheRecord;
    if (parsed.schemaVersion !== '1' || parsed.mode !== mode || !parsed.steps) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function markOrdinaryFinaliseStep(params: {
  repoRoot: string;
  mode: FinaliseModeKey;
  task: FinaliseTaskKey;
  status: FinaliseCheckpointStep['status'];
  command: string;
  exitCode?: number | null;
  artifactPaths?: string[];
}): OrdinaryFinaliseCacheRecord {
  const current = readOrdinaryFinaliseCache(params.repoRoot, params.mode);
  const now = new Date().toISOString();
  const previous = current?.steps[params.task];
  const artifactHashes: Record<string, string> = {};
  for (const relative of params.artifactPaths ?? []) {
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    artifactHashes[relative.replace(/\\/g, '/')] = hashFile(absolute);
  }
  const step: FinaliseCheckpointStep = {
    task: params.task,
    status: params.status,
    startedAt: previous?.startedAt ?? now,
    endedAt: params.status === 'started' ? undefined : now,
    inputFingerprint: getFinaliseTaskFingerprint(params),
    artifactHashes,
    command: params.command,
    exitCode: params.exitCode,
  };
  const next: OrdinaryFinaliseCacheRecord = {
    schemaVersion: '1',
    mode: params.mode,
    updatedAt: now,
    steps: {
      ...(current?.steps ?? {}),
      [params.task]: step,
    },
  };
  writeJsonAtomic(getOrdinaryFinaliseCachePath(params.repoRoot, params.mode), next);
  return next;
}

export function canReuseOrdinaryFinaliseStep(params: {
  repoRoot: string;
  mode: FinaliseModeKey;
  task: FinaliseTaskKey;
  command: string;
  requiredArtifactPaths?: string[];
}): { reusable: boolean; reason: string; step?: FinaliseCheckpointStep } {
  if (isDatabaseFinaliseTask(params.task)) {
    return { reusable: false, reason: 'ordinary-database-reuse-disabled' };
  }
  if (!ordinaryReuseEnvironmentSupported(params.repoRoot)) {
    return { reusable: false, reason: 'ordinary-reuse-environment-unsupported' };
  }
  const cache = readOrdinaryFinaliseCache(params.repoRoot, params.mode);
  if (!cache) return { reusable: false, reason: 'cache-missing-or-corrupt' };
  const step = cache.steps[params.task];
  if (!step) return { reusable: false, reason: 'step-missing' };
  if (step.status !== 'passed') {
    return { reusable: false, reason: `step-status=${step.status}` };
  }
  if (step.command !== params.command) {
    return { reusable: false, reason: 'command-mismatch' };
  }
  if (step.inputFingerprint !== getFinaliseTaskFingerprint(params)) {
    return { reusable: false, reason: 'input-fingerprint-mismatch' };
  }
  for (const relative of params.requiredArtifactPaths ?? []) {
    const normalized = relative.replace(/\\/g, '/');
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    const expected = step.artifactHashes[normalized];
    if (!expected) return { reusable: false, reason: `artifact-untracked:${normalized}` };
    if (hashFile(absolute) !== expected) {
      return { reusable: false, reason: `artifact-mismatch:${normalized}` };
    }
  }
  return { reusable: true, reason: 'exact-match', step };
}

export function getCheckpointDirectory(repoRoot: string, workstreamId: string): string {
  const safe = assertSafeOpaqueId(workstreamId, 'workstreamId');
  if (!safe.ok) {
    throw new Error(safe.error);
  }
  return path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    safe.value,
    'checkpoints'
  );
}

export function getCheckpointPath(
  repoRoot: string,
  workstreamId: string,
  checkpointId: string
): string {
  const ids = requireSafeFinaliseIds({ workstreamId, checkpointId });
  return path.join(getCheckpointDirectory(repoRoot, ids.workstreamId), `${ids.checkpointId}.json`);
}

export function readFinaliseCheckpoint(
  repoRoot: string,
  workstreamId: string,
  checkpointId: string
): FinaliseCheckpointRecord | null {
  let filePath: string;
  try {
    filePath = getCheckpointPath(repoRoot, workstreamId, checkpointId);
  } catch {
    return null;
  }
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as FinaliseCheckpointRecord;
    return {
      ...parsed,
      liveSchemaFingerprint: parsed.liveSchemaFingerprint ?? 'unavailable',
    };
  } catch {
    return null;
  }
}

export function createOrLoadFinaliseCheckpoint(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
}): FinaliseCheckpointRecord {
  const ids = requireSafeFinaliseIds(params);
  const existing = readFinaliseCheckpoint(
    params.repoRoot,
    ids.workstreamId,
    ids.checkpointId
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const record: FinaliseCheckpointRecord = {
    schemaVersion: '1',
    checkpointId: ids.checkpointId,
    workstreamId: ids.workstreamId,
    branchName: runGit(params.repoRoot, ['branch', '--show-current']) || 'unknown',
    headCommit: runGit(params.repoRoot, ['rev-parse', 'HEAD']) || 'unknown',
    createdAt: now,
    updatedAt: now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    migrationFingerprint: migrationFingerprint(params.repoRoot),
    // TEE-NOLIVE-001: do not open a DB connection during checkpoint bind.
    liveSchemaFingerprint: 'unavailable',
    environmentFingerprint: environmentFingerprint(params.repoRoot),
    steps: {},
  };
  mkdirSync(getCheckpointDirectory(params.repoRoot, ids.workstreamId), { recursive: true });
  writeJsonAtomic(
    getCheckpointPath(params.repoRoot, ids.workstreamId, ids.checkpointId),
    record
  );
  return record;
}

export function markFinaliseCheckpointStep(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
  task: FinaliseTaskKey;
  status: FinaliseCheckpointStep['status'];
  command: string;
  exitCode?: number | null;
  artifactPaths?: string[];
}): FinaliseCheckpointRecord {
  const ids = requireSafeFinaliseIds(params);
  const current = createOrLoadFinaliseCheckpoint({
    repoRoot: params.repoRoot,
    workstreamId: ids.workstreamId,
    checkpointId: ids.checkpointId,
  });
  const artifactHashes: Record<string, string> = {};
  for (const relative of params.artifactPaths ?? []) {
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    artifactHashes[relative.replace(/\\/g, '/')] = hashFile(absolute);
  }

  const now = new Date().toISOString();
  const previous = current.steps[params.task];
  const step: FinaliseCheckpointStep = {
    task: params.task,
    status: params.status,
    startedAt: previous?.startedAt ?? now,
    endedAt: params.status === 'started' ? undefined : now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    artifactHashes,
    command: params.command,
    exitCode: params.exitCode,
  };

  const next: FinaliseCheckpointRecord = {
    ...current,
    updatedAt: now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    migrationFingerprint: migrationFingerprint(params.repoRoot),
    // TEE-NOLIVE-001: live schema only for database steps.
    liveSchemaFingerprint: isDatabaseFinaliseTask(params.task)
      ? liveSchemaFingerprint()
      : current.liveSchemaFingerprint,
    environmentFingerprint: environmentFingerprint(params.repoRoot),
    headCommit: runGit(params.repoRoot, ['rev-parse', 'HEAD']) || current.headCommit,
    steps: {
      ...current.steps,
      [params.task]: step,
    },
  };
  writeJsonAtomic(
    getCheckpointPath(params.repoRoot, ids.workstreamId, ids.checkpointId),
    next
  );
  return next;
}

export function canResumeFinaliseCheckpointStep(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
  task: FinaliseTaskKey;
  command: string;
  requiredArtifactPaths?: string[];
}): { resumable: boolean; reason: string } {
  let ids: { workstreamId: string; checkpointId: string };
  try {
    ids = requireSafeFinaliseIds(params);
  } catch {
    return { resumable: false, reason: 'unsafe-id' };
  }
  const record = readFinaliseCheckpoint(
    params.repoRoot,
    ids.workstreamId,
    ids.checkpointId
  );
  if (!record) return { resumable: false, reason: 'checkpoint-missing' };

  const step = record.steps[params.task];
  if (!step) return { resumable: false, reason: 'step-missing' };
  if (step.status !== 'passed') return { resumable: false, reason: `step-status=${step.status}` };
  if (step.command !== params.command) {
    return { resumable: false, reason: 'command-mismatch' };
  }

  const currentInput = inputFingerprint(params.repoRoot);
  if (record.inputFingerprint !== currentInput) {
    return { resumable: false, reason: 'input-fingerprint-mismatch' };
  }
  if (record.migrationFingerprint !== migrationFingerprint(params.repoRoot)) {
    return { resumable: false, reason: 'migration-fingerprint-mismatch' };
  }
  if (isDatabaseFinaliseTask(params.task)) {
    const liveFp = liveSchemaFingerprint();
    if (liveFp === 'unavailable' || record.liveSchemaFingerprint === 'unavailable') {
      return { resumable: false, reason: 'live-schema-fingerprint-unavailable' };
    }
    if (liveFp !== record.liveSchemaFingerprint) {
      return { resumable: false, reason: 'live-schema-fingerprint-mismatch' };
    }
  }
  if (record.environmentFingerprint !== environmentFingerprint(params.repoRoot)) {
    return { resumable: false, reason: 'environment-fingerprint-mismatch' };
  }
  if (step.inputFingerprint !== currentInput) {
    return { resumable: false, reason: 'step-input-mismatch' };
  }

  for (const relative of params.requiredArtifactPaths ?? []) {
    const normalized = relative.replace(/\\/g, '/');
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    const expected = step.artifactHashes[normalized];
    if (!expected) return { resumable: false, reason: `artifact-untracked:${normalized}` };
    if (hashFile(absolute) !== expected) {
      return { resumable: false, reason: `artifact-mismatch:${normalized}` };
    }
  }

  return { resumable: true, reason: 'exact-match' };
}

export function resolveActiveProtocolFinaliseContext(repoRoot: string): {
  workstreamId: string;
  checkpointId: string;
} | null {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewState(paths.statePath);
  const active = getActiveFinaliseContext(state);
  if (!active) return null;
  const protocol = readProtocolRecord(repoRoot, active.workstreamId);
  if (!protocol || protocol.activeCheckpointId !== active.checkpointId) {
    return null;
  }
  if (protocol.phase !== 'finalise_ready' && protocol.phase !== 'finalised') {
    return null;
  }
  return {
    workstreamId: active.workstreamId,
    checkpointId: active.checkpointId,
  };
}

export function getProtocolSkippableFinaliseTasks(params: {
  repoRoot: string;
  buildArtifactPath?: string;
}): Partial<Record<FinaliseTaskKey, { reason: string; checkpointId: string }>> {
  const active = resolveActiveProtocolFinaliseContext(params.repoRoot);
  if (!active) return {};

  const tasks: FinaliseTaskKey[] = ['migrations', 'db-validate', 'build', 'test-run', 'testsuite'];
  const skippable: Partial<Record<FinaliseTaskKey, { reason: string; checkpointId: string }>> = {};
  for (const task of tasks) {
    const requiredArtifactPaths =
      task === 'build' && params.buildArtifactPath ? [params.buildArtifactPath] : [];
    const result = canResumeFinaliseCheckpointStep({
      repoRoot: params.repoRoot,
      workstreamId: active.workstreamId,
      checkpointId: active.checkpointId,
      task,
      command: FINALISE_TASK_COMMANDS[task],
      requiredArtifactPaths,
    });
    if (result.resumable) {
      skippable[task] = { reason: result.reason, checkpointId: active.checkpointId };
    }
  }
  return skippable;
}
