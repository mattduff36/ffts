import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { writeJsonAtomic } from './workflow-events';
import { getProtocolDirectory } from './workflow-review-protocol';
import { assertNoForbiddenPayload, sanitizeEvidenceLabel } from './workflow-privacy';

export type EvidenceManifestKind = 'preflight' | 'fix-delta';
export type EvidenceCommandStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface EvidenceCommandResult {
  name: string;
  status: EvidenceCommandStatus;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  command?: string;
  files?: string[];
}

export interface EvidenceTestMapping {
  id: string;
  status: 'completed' | 'unresolved' | 'missing';
  behavioral: boolean;
  /** True only when a targeted test run executed this ID successfully. */
  executed: boolean;
  evidenceLabel: string;
}

export interface WorkflowEvidenceManifest {
  schemaVersion: '1';
  kind: EvidenceManifestKind;
  workstreamId: string;
  status: 'passed' | 'failed' | 'unknown';
  createdAt: string;
  baseCommit: string;
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  contentHash: string;
  bodyHash?: string;
  changedFiles: string[];
  baseHeadEvidence: {
    baseCommit: string;
    headCommit: string;
    changedFileCount: number;
    changedFilesSample: string[];
  };
  commands: EvidenceCommandResult[];
  requiredTests: EvidenceTestMapping[];
  liveVerification?: {
    profile: string;
    status: EvidenceCommandStatus;
    summary: string;
  };
  closedBlockerIds?: string[];
  blockerEvidence?: Array<{
    blockerId: string;
    evidenceLabel: string;
    commandName?: string;
  }>;
  privacy: {
    redacted: true;
  };
}

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  // Do not trimStart: porcelain status lines can begin with a leading space
  // (e.g. " M path"). Trimming would shift slice offsets and corrupt paths.
  return (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, '');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  return hashText(readFileSync(filePath, 'utf8'));
}

function listDirtyPaths(repoRoot: string): string[] {
  const output = runGit(repoRoot, ['status', '--porcelain', '-uall', '-z']);
  if (!output) return [];
  const paths: string[] = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    // Porcelain -z entries are "XY path\0". Rename/copy adds a second path record.
    if (record.length < 3) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (!firstPath) continue;
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const renamedPath = records[index];
      if (renamedPath) paths.push(renamedPath);
      continue;
    }
    paths.push(firstPath);
  }
  return [...new Set(paths)].sort();
}

export function getCurrentTreeFingerprint(repoRoot: string): {
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  changedFiles: string[];
} {
  const headCommit = runGit(repoRoot, ['rev-parse', 'HEAD']) || 'unknown';
  const changedFiles = listDirtyPaths(repoRoot);
  return {
    headCommit,
    dirtyTreeHash: hashText(changedFiles.join('\n')),
    inputFingerprint: fingerprintInputs(repoRoot, changedFiles),
    changedFiles,
  };
}

export function listBaseToHeadChangedFiles(
  repoRoot: string,
  baseCommit: string,
  headCommit: string
): string[] {
  if (!baseCommit || !headCommit || baseCommit === 'unknown' || headCommit === 'unknown') {
    return [];
  }
  const output = runGit(repoRoot, ['diff', '--name-only', `${baseCommit}...${headCommit}`]);
  if (!output) return [];
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function fingerprintInputs(repoRoot: string, dirtyPaths: string[]): string {
  const parts = [
    `lock:${hashFile(path.join(repoRoot, 'package-lock.json'))}`,
    `pkg:${hashFile(path.join(repoRoot, 'package.json'))}`,
    `tsconfig:${hashFile(path.join(repoRoot, 'tsconfig.json'))}`,
    `vitest:${hashFile(path.join(repoRoot, 'vitest.config.ts'))}`,
    `node:${process.version}`,
  ];
  for (const relative of dirtyPaths) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      parts.push(`${relative}:absent`);
      continue;
    }
    parts.push(`${relative}:${hashFile(absolute)}`);
  }
  const migrationsDir = path.join(repoRoot, 'supabase');
  if (existsSync(migrationsDir)) {
    const migrationFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of migrationFiles) {
      parts.push(`migration:${name}:${hashFile(path.join(migrationsDir, name))}`);
    }
  }
  return hashText(parts.join('\n'));
}

function resolveCommandExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s|&<>^()"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(
  repoRoot: string,
  name: string,
  command: string,
  args: string[]
): EvidenceCommandResult {
  const started = Date.now();
  const executable = resolveCommandExecutable(command);
  // Prefer shell:false so patterns containing `|` (vitest -t id1|id2) are not
  // interpreted as Windows shell pipes. Fall back to a quoted shell command if needed.
  let result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (result.error && process.platform === 'win32') {
    const cmdline = [executable, ...args.map(quoteWindowsArg)].join(' ');
    result = spawnSync(cmdline, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
  }
  const durationMs = Date.now() - started;
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const rawSummary =
    exitCode === 0 ? 'ok' : (result.stderr || result.stdout || 'failed').trim().slice(0, 2_000);
  return {
    name,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs,
    summary: sanitizeEvidenceLabel(rawSummary),
    command: sanitizeEvidenceLabel([command, ...args].join(' ')),
  };
}

export type EvidenceCommandRunner = typeof runCommand;

function isLintableFile(relativePath: string): boolean {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(relativePath);
}

function discoverBehavioralTestIds(
  repoRoot: string,
  ids: string[],
  executedIds: Set<string>
): EvidenceTestMapping[] {
  const testRoots = [
    path.join(repoRoot, 'tests'),
    path.join(repoRoot, 'testsuite'),
  ].filter((dir) => existsSync(dir));

  const fileContents: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(test|spec)\.(ts|tsx|js|mjs)$/u.test(entry.name)) continue;
      try {
        fileContents.push(readFileSync(full, 'utf8'));
      } catch {
        // ignore unreadable
      }
    }
  };
  for (const root of testRoots) walk(root);
  const corpus = fileContents.join('\n');

  return ids.map((id) => {
    const present = corpus.includes(id);
    // Behavioral if the ID appears in an it()/test() title, not only as a source string.
    const behavioral =
      present &&
      new RegExp(
        `(?:it|test|describe)\\(\\s*['\`"][^'\`"]*${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
        'u'
      ).test(corpus);
    const executed = executedIds.has(id);
    return {
      id,
      status: behavioral && executed ? 'completed' : present ? 'unresolved' : 'missing',
      behavioral,
      executed,
      evidenceLabel:
        behavioral && executed
          ? `behavioral-executed:${id}`
          : behavioral
            ? `behavioral-unexecuted:${id}`
            : present
              ? `source-only:${id}`
              : `missing:${id}`,
    };
  });
}

export function buildEvidenceManifest(params: {
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
  commandResults?: EvidenceCommandResult[];
  executedTestIds?: string[];
  commandRunner?: EvidenceCommandRunner;
}): { manifest: WorkflowEvidenceManifest; relativePath: string; absolutePath: string } {
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const headCommit = tree.headCommit;
  const dirtyFiles = tree.changedFiles;
  const baseHeadFiles = listBaseToHeadChangedFiles(
    params.repoRoot,
    params.baseCommit,
    headCommit
  );
  const changedFiles = [...new Set([...baseHeadFiles, ...dirtyFiles])].sort();
  const dirtyTreeHash = tree.dirtyTreeHash;
  const inputFingerprint = tree.inputFingerprint;
  const executedIds = new Set(params.executedTestIds ?? []);
  const sanitizeCommand = (command: EvidenceCommandResult): EvidenceCommandResult => ({
    ...command,
    summary: sanitizeEvidenceLabel(command.summary ?? ''),
    command: command.command ? sanitizeEvidenceLabel(command.command) : undefined,
    files: command.files?.map((file) => sanitizeEvidenceLabel(file)),
  });
  const commands: EvidenceCommandResult[] = (params.commandResults ?? []).map(sanitizeCommand);
  const liveVerification = params.liveVerification
    ? {
        ...params.liveVerification,
        summary: sanitizeEvidenceLabel(params.liveVerification.summary ?? ''),
        profile: sanitizeEvidenceLabel(params.liveVerification.profile ?? ''),
      }
    : undefined;
  const liveViolations = liveVerification ? assertNoForbiddenPayload(liveVerification) : [];
  if (liveViolations.length > 0) {
    throw new Error(`liveVerification privacy violations: ${liveViolations.join('; ')}`);
  }
  const execute = params.commandRunner ?? runCommand;
  if (params.runChecks) {
    commands.push(execute(params.repoRoot, 'typecheck', 'npm', ['run', 'typecheck']));
    const lintableFiles = changedFiles.filter(
      (relativePath) =>
        isLintableFile(relativePath) && existsSync(path.join(params.repoRoot, relativePath))
    );
    if (lintableFiles.length === 0) {
      commands.push(
        {
          name: 'oxlint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx oxlint --',
          files: [],
        },
        {
          name: 'eslint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx eslint --',
          files: [],
        }
      );
    } else {
      const oxlint = execute(params.repoRoot, 'oxlint-changed', 'npx', [
        'oxlint',
        '--',
        ...lintableFiles,
      ]);
      oxlint.files = lintableFiles;
      commands.push(oxlint);
      const eslint = execute(params.repoRoot, 'eslint-changed', 'npx', [
        'eslint',
        '--',
        ...lintableFiles,
      ]);
      eslint.files = lintableFiles;
      commands.push(eslint);
    }
  }
  if (params.runRequiredTests && (params.requiredTestIds?.length ?? 0) > 0) {
    const ids = params.requiredTestIds ?? [];
    // Vitest uses -t/--testNamePattern, not --grep.
    const testRun = execute(params.repoRoot, 'required-tests', 'npm', [
      'run',
      'test:run',
      '--',
      '-t',
      ids.join('|'),
    ]);
    commands.push(testRun);
    if (testRun.status === 'passed') {
      for (const id of ids) executedIds.add(id);
    }
  }

  const requiredTests = discoverBehavioralTestIds(
    params.repoRoot,
    params.requiredTestIds ?? [],
    executedIds
  );

  const checksPassed =
    commands.length > 0 &&
    commands.every((command) => command.status === 'passed' || command.status === 'skipped');
  const testsReady =
    requiredTests.length === 0 ||
    requiredTests.every(
      (test) => test.status === 'completed' && test.behavioral && test.executed
    );
  const sanitizedCommands = commands.map(sanitizeCommand);
  const commandViolations = assertNoForbiddenPayload(sanitizedCommands);
  if (commandViolations.length > 0) {
    throw new Error(`commandResults privacy violations: ${commandViolations.join('; ')}`);
  }
  const liveOk =
    !liveVerification ||
    liveVerification.status === 'passed' ||
    liveVerification.status === 'skipped';
  const fixEvidenceReady =
    params.kind !== 'fix-delta' ||
    ((params.closedBlockerIds?.length ?? 0) > 0 &&
      (params.blockerEvidence?.length ?? 0) > 0);

  let status: WorkflowEvidenceManifest['status'] = 'passed';
  if (!checksPassed || !testsReady || !liveOk || !fixEvidenceReady) status = 'failed';
  if (sanitizedCommands.some((command) => command.status === 'unknown')) status = 'unknown';

  const draft: Omit<WorkflowEvidenceManifest, 'contentHash' | 'bodyHash'> = {
    schemaVersion: '1',
    kind: params.kind,
    workstreamId: params.workstreamId,
    status,
    createdAt: new Date().toISOString(),
    baseCommit: params.baseCommit,
    headCommit,
    dirtyTreeHash,
    inputFingerprint,
    changedFiles: changedFiles.slice(0, 500).map((file) => sanitizeEvidenceLabel(file)),
    baseHeadEvidence: {
      baseCommit: params.baseCommit,
      headCommit,
      changedFileCount: baseHeadFiles.length,
      changedFilesSample: baseHeadFiles.slice(0, 50).map((file) => sanitizeEvidenceLabel(file)),
    },
    commands: sanitizedCommands,
    requiredTests,
    liveVerification,
    closedBlockerIds: params.closedBlockerIds,
    blockerEvidence: params.blockerEvidence,
    privacy: { redacted: true },
  };

  const bodyHash = hashText(JSON.stringify(draft));
  const manifest: WorkflowEvidenceManifest = {
    ...draft,
    contentHash: bodyHash,
    bodyHash,
  };

  const directory = getProtocolDirectory(params.repoRoot, params.workstreamId);
  mkdirSync(directory, { recursive: true });
  const fileName = `${params.kind}-${manifest.contentHash}.json`;
  const absolutePath = path.join(directory, fileName);
  writeJsonAtomic(absolutePath, manifest);
  return {
    manifest,
    absolutePath,
    relativePath: path.relative(params.repoRoot, absolutePath).replace(/\\/g, '/'),
  };
}

export function readEvidenceManifest(filePath: string): WorkflowEvidenceManifest | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as WorkflowEvidenceManifest;
  } catch {
    return null;
  }
}
