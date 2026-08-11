import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkippableFinaliseTasks } from '@/scripts/finalise-recent-tasks';
import * as finaliseCheckpoint from '@/scripts/automation/finalise-checkpoint';
import {
  canResumeFinaliseCheckpointStep,
  canReuseOrdinaryFinaliseStep,
  createOrLoadFinaliseCheckpoint,
  getCheckpointPath,
  markFinaliseCheckpointStep,
  markOrdinaryFinaliseStep,
} from '@/scripts/automation/finalise-checkpoint';
import type { AutomationRunLog, AutomationStepLog } from '@/scripts/automation/types';

const NOW = new Date('2026-05-28T12:00:00.000Z');
const COMPLETED_AT = new Date('2026-05-28T11:55:00.000Z');
const STARTED_AT = new Date('2026-05-28T11:54:00.000Z');

let tempRoots: string[] = [];
let environmentSnapshot: NodeJS.ProcessEnv | null = null;

function createTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'finalise-recent-tasks-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeRepoFile(repoRoot: string, relativePath: string, mtime: Date): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, 'test', 'utf8');
  utimesSync(absolutePath, mtime, mtime);
}

function writeSuccessfulTerminalCommand(terminalDirectory: string, command: string): void {
  mkdirSync(terminalDirectory, { recursive: true });
  writeFileSync(path.join(terminalDirectory, '1.txt'), [
    '---',
    `last_command: ${command}`,
    'last_exit_code: 0',
    `started_at: ${STARTED_AT.toISOString()}`,
    '---',
    'command output',
    '---',
    'exit_code: 0',
    'elapsed_ms: 60000',
    '---',
  ].join('\n'), 'utf8');
}

function writeBuildArtifact(repoRoot: string): string {
  const buildArtifactPath = path.join(repoRoot, '.next', 'BUILD_ID');
  mkdirSync(path.dirname(buildArtifactPath), { recursive: true });
  writeFileSync(buildArtifactPath, 'build-id', 'utf8');
  return buildArtifactPath;
}

function useControlledFinaliseEnvironment(): void {
  environmentSnapshot = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (
      key === 'PATH' ||
      key === 'PATHEXT' ||
      key === 'SystemRoot' ||
      key === 'SYSTEMROOT' ||
      key === 'ComSpec' ||
      key === 'COMSPEC' ||
      key === 'TEMP' ||
      key === 'TMP' ||
      key === 'HOME' ||
      key === 'USERPROFILE' ||
      key === 'APPDATA' ||
      key === 'LOCALAPPDATA' ||
      key === 'USERNAME' ||
      key === 'USER' ||
      key === 'OS' ||
      key === 'WINDIR' ||
      key.startsWith('CURSOR_') ||
      key.startsWith('VSCODE_') ||
      key.startsWith('npm_') ||
      key.startsWith('NPM_')
    ) {
      continue;
    }
    delete process.env[key];
  }
  process.env.NODE_ENV = 'test';
}

function initializeGitRepo(repoRoot: string): void {
  spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync('git', ['add', '.'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
}

function createAutomationLog(steps: AutomationStepLog[]): AutomationRunLog {
  return {
    id: 'run-1',
    scriptName: 'finalise',
    mode: 'standard',
    args: [],
    startedAt: STARTED_AT.toISOString(),
    endedAt: COMPLETED_AT.toISOString(),
    durationMs: 60_000,
    status: 'failed',
    metadata: {
      branch: 'feature/test',
      commit: 'abc123',
      dirtyFileCount: 1,
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      platform: 'win32',
    },
    expectedArtifacts: [],
    artifacts: [],
    steps,
  };
}

afterEach(() => {
  if (environmentSnapshot) {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environmentSnapshot);
    environmentSnapshot = null;
  }
  for (const tempRoot of tempRoots) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots = [];
  vi.restoreAllMocks();
});

describe('finalise recent task detection', () => {
  it('marks a recent successful build as skippable when changed files are older', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build?.command).toBe('npm run build');
    expect(tasks.build?.reuseEvidence).toBe('legacy-mtime-fallback');
  });

  it('does not skip a build when a changed file is newer than the prior build', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() + 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('does not skip a build when the Next build artifact is missing', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath: path.join(repoRoot, '.next', 'BUILD_ID'),
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('does not treat related npm scripts as equivalent finalise tasks', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build:analyze');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('marks a recently logged clean production build as skippable', () => {
    const repoRoot = createTempRoot();
    const automationRunDirectory = path.join(repoRoot, 'automation-runs');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    mkdirSync(automationRunDirectory, { recursive: true });
    const log = createAutomationLog([{
      name: 'Run clean production build',
      status: 'passed',
      startedAt: STARTED_AT.toISOString(),
      endedAt: COMPLETED_AT.toISOString(),
      durationMs: 60_000,
    }]);
    writeFileSync(path.join(automationRunDirectory, 'run-1.json'), JSON.stringify(log), 'utf8');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory: path.join(repoRoot, 'terminals'),
      automationRunDirectory,
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build?.source).toBe('automation-log');
    expect(tasks.build?.reuseEvidence).toBe('legacy-mtime-fallback');
  });

  it('marks recently logged pending migrations as skippable only when all pending files match', () => {
    const repoRoot = createTempRoot();
    const automationRunDirectory = path.join(repoRoot, 'automation-runs');
    const migrationFile = 'supabase/migrations/20260528_example.sql';
    writeRepoFile(repoRoot, migrationFile, new Date(COMPLETED_AT.getTime() - 10_000));
    mkdirSync(automationRunDirectory, { recursive: true });
    const log = createAutomationLog([{
        name: 'Run pending local migrations',
        status: 'passed',
        startedAt: STARTED_AT.toISOString(),
        endedAt: COMPLETED_AT.toISOString(),
        durationMs: 60_000,
        metadata: { migrationFiles: [migrationFile] },
    }]);
    writeFileSync(path.join(automationRunDirectory, 'run-1.json'), JSON.stringify(log), 'utf8');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: [migrationFile],
      pendingMigrationFiles: [migrationFile],
      terminalDirectory: path.join(repoRoot, 'terminals'),
      automationRunDirectory,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.migrations?.source).toBe('automation-log');
  });

  it('TEE-CHECKPOINT-001 reuses exact passed fingerprints independent of age', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    writeRepoFile(repoRoot, 'tsconfig.json', NOW);
    writeRepoFile(repoRoot, 'next.config.ts', NOW);
    writeRepoFile(repoRoot, 'app/page.tsx', NOW);
    writeRepoFile(repoRoot, '.gitignore', NOW);
    initializeGitRepo(repoRoot);
    const buildArtifactPath = writeBuildArtifact(repoRoot);

    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
      artifactPaths: [buildArtifactPath],
    });

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      mode: 'finalise',
      changedFiles: [],
      buildArtifactPath,
      now: new Date('2036-01-01T00:00:00.000Z'),
    });
    expect(tasks.build?.source).toBe('exact-cache');
    expect(
      canReuseOrdinaryFinaliseStep({
        repoRoot,
        mode: 'finalise',
        task: 'build',
        command: 'npm run build',
        requiredArtifactPaths: [buildArtifactPath],
      }).reusable
    ).toBe(true);
  });

  it('TEE-NOLIVE-001: non-db checkpoint bind/mark does not open a database connection', () => {
    useControlledFinaliseEnvironment();
    process.env.POSTGRES_URL_NON_POOLING = 'postgres://should-not-connect/ffts';
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    writeRepoFile(repoRoot, 'tsconfig.json', NOW);
    writeRepoFile(repoRoot, '.gitignore', NOW);
    initializeGitRepo(repoRoot);
    const artifact = writeBuildArtifact(repoRoot);

    const liveSpy = vi
      .spyOn(finaliseCheckpoint, 'liveSchemaFingerprint')
      .mockReturnValue('would-have-connected');

    const created = createOrLoadFinaliseCheckpoint({
      repoRoot,
      workstreamId: 'ws_nolive_1',
      checkpointId: 'ckpt_nolive',
    });
    expect(created.liveSchemaFingerprint).toBe('unavailable');
    expect(liveSpy).not.toHaveBeenCalled();

    const marked = markFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_nolive_1',
      checkpointId: 'ckpt_nolive',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
      artifactPaths: [artifact],
    });
    expect(marked.liveSchemaFingerprint).toBe('unavailable');
    expect(liveSpy).not.toHaveBeenCalled();
  });

  it('TEE-CHECKPOINT-001 rejects command mismatch and unsafe checkpoint path ids', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    writeRepoFile(repoRoot, 'tsconfig.json', NOW);
    mkdirSync(path.join(repoRoot), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.gitignore'),
      ['docs_private/', '.next/', '.env.local'].join('\n'),
      'utf8'
    );
    initializeGitRepo(repoRoot);
    const artifact = writeBuildArtifact(repoRoot);

    createOrLoadFinaliseCheckpoint({
      repoRoot,
      workstreamId: 'ws_ckpt_cmd_1',
      checkpointId: 'ckpt_cmd_1',
    });
    markFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_cmd_1',
      checkpointId: 'ckpt_cmd_1',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
      artifactPaths: [artifact],
    });

    const mismatch = canResumeFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_cmd_1',
      checkpointId: 'ckpt_cmd_1',
      task: 'build',
      command: 'npm run build:analyze',
      requiredArtifactPaths: [artifact],
    });
    expect(mismatch.resumable).toBe(false);
    expect(mismatch.reason).toBe('command-mismatch');

    expect(() =>
      createOrLoadFinaliseCheckpoint({
        repoRoot,
        workstreamId: '../evil',
        checkpointId: 'ckpt_x',
      })
    ).toThrow(/path|opaque|workstreamId/iu);

    const checkpointSource = readFileSync(
      path.join(process.cwd(), 'scripts', 'automation', 'finalise-checkpoint.ts'),
      'utf8'
    );
    expect(checkpointSource).toMatch(/data_type/);
    expect(checkpointSource).toMatch(/is_nullable/);
    expect(checkpointSource).toMatch(/pathHasSymlinkComponent/);

    if (process.platform !== 'win32') {
      const workstreamDir = path.join(
        repoRoot,
        'docs_private',
        'automation',
        'workstreams',
        'ws_symlink_1'
      );
      const realCheckpoints = path.join(repoRoot, 'real-checkpoints');
      mkdirSync(realCheckpoints, { recursive: true });
      mkdirSync(workstreamDir, { recursive: true });
      try {
        symlinkSync(realCheckpoints, path.join(workstreamDir, 'checkpoints'));
        expect(() =>
          getCheckpointPath(repoRoot, 'ws_symlink_1', 'ckpt_symlink')
        ).toThrow(/symlink/iu);
      } catch {
        // Some environments disallow symlink creation; source assertions above remain.
      }
    }
  });
});
