import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkippableFinaliseTasks } from '@/scripts/finalise-recent-tasks';
import type { AutomationRunLog, AutomationStepLog } from '@/scripts/automation/types';

const NOW = new Date('2026-05-28T12:00:00.000Z');
const COMPLETED_AT = new Date('2026-05-28T11:55:00.000Z');
const STARTED_AT = new Date('2026-05-28T11:54:00.000Z');

let tempRoots: string[] = [];

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
  for (const tempRoot of tempRoots) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots = [];
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
    });

    expect(tasks.build?.command).toBe('npm run build');
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
    });

    expect(tasks.build?.source).toBe('automation-log');
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
    });

    expect(tasks.migrations?.source).toBe('automation-log');
  });
});
