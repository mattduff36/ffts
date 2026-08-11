import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { AutomationRunLog, AutomationStepLog } from './automation/types';
import {
  canReuseOrdinaryFinaliseStep,
  type FinaliseModeKey,
  getProtocolSkippableFinaliseTasks,
  resolveActiveProtocolFinaliseContext,
} from './automation/finalise-checkpoint';
import { getDefaultTerminalDirectory } from './finalise-activity-guard';

export type FinaliseTaskKey = 'migrations' | 'db-validate' | 'build' | 'test-run' | 'testsuite';

export interface RecentFinaliseTaskRun {
  task: FinaliseTaskKey;
  command: string;
  completedAt: string;
  completedAtMs: number;
  source: 'terminal' | 'automation-log' | 'exact-cache';
  /** Present when skip came from the explicit 45-minute mtime compatibility path. */
  reuseEvidence?: 'legacy-mtime-fallback';
}

export interface RecentFinaliseTaskScanOptions {
  repoRoot: string;
  changedFiles: string[];
  pendingMigrationFiles?: string[];
  buildArtifactPath?: string;
  terminalDirectory?: string;
  automationRunDirectory?: string;
  now?: Date;
  recentWindowMs?: number;
  /** When true, only protocol checkpoints may skip (no mtime fallback). */
  preferProtocolCheckpoints?: boolean;
  mode?: FinaliseModeKey;
  /** Explicit opt-in compatibility path. Exact fingerprint cache is the default. */
  allowLegacyMtimeFallback?: boolean;
}

export type SkippableFinaliseTasks = Partial<Record<FinaliseTaskKey, RecentFinaliseTaskRun>>;

const DEFAULT_RECENT_WINDOW_MS = 45 * 60 * 1000;
const FILE_MTIME_TOLERANCE_MS = 5000;

const TASK_COMMAND_PATTERNS: Record<Exclude<FinaliseTaskKey, 'migrations'>, RegExp[]> = {
  'db-validate': [/\bnpm\s+run\s+db:validate(?:\s|$)/iu, /\btsx\s+scripts[\\/]db-validate\.ts(?:\s|$)/iu],
  build: [/\bnpm\s+run\s+build(?:\s|$)/iu, /\bnext\s+build(?:\s|$)/iu],
  'test-run': [/\bnpm\s+run\s+test:run(?:\s|$)/iu, /\bvitest\s+run(?:\s|$)/iu],
  testsuite: [
    /\bnpm\s+run\s+testsuite(?::run)?(?:\s|$)/iu,
    /\btsx\s+testsuite[\\/]runner[\\/]run\.ts(?:\s|$)/iu,
  ],
};

function getHeader(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  return match?.[1] ?? '';
}

function getHeaderValue(header: string, key: string): string {
  const match = header.match(new RegExp(`^${key}:\\s*(.*)$`, 'imu'));
  return match?.[1]?.trim().replace(/^"|"$/gu, '') ?? '';
}

function getFooterValue(content: string, key: string): string {
  const footerMatch = content.match(/(?:^|\r?\n)---\r?\n([\s\S]*?)\r?\n---\s*$/u);
  const footer = footerMatch?.[1] ?? '';
  const match = footer.match(new RegExp(`^${key}:\\s*(.*)$`, 'imu'));
  return match?.[1]?.trim().replace(/^"|"$/gu, '') ?? '';
}

function getTerminalCommand(header: string): string {
  return getHeaderValue(header, 'active_command') || getHeaderValue(header, 'command') || getHeaderValue(header, 'last_command');
}

function parseInteger(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTerminalExitCode(header: string, content: string): number | null {
  return parseInteger(getFooterValue(content, 'exit_code')) ?? parseInteger(getHeaderValue(header, 'last_exit_code'));
}

function getTerminalCompletedAtMs(header: string, content: string, fallbackMtimeMs: number): number {
  const startedAt = getHeaderValue(header, 'started_at');
  const elapsedMs = parseInteger(getFooterValue(content, 'elapsed_ms'));
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;

  if (Number.isFinite(startedAtMs) && elapsedMs !== null) {
    return startedAtMs + elapsedMs;
  }

  return fallbackMtimeMs;
}

function getTaskForCommand(command: string): Exclude<FinaliseTaskKey, 'migrations'> | null {
  for (const [task, patterns] of Object.entries(TASK_COMMAND_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(command))) {
      return task as Exclude<FinaliseTaskKey, 'migrations'>;
    }
  }

  return null;
}

function isWithinRecentWindow(completedAtMs: number, nowMs: number, recentWindowMs: number): boolean {
  return completedAtMs <= nowMs + FILE_MTIME_TOLERANCE_MS && nowMs - completedAtMs <= recentWindowMs;
}

function readRecentTerminalTaskRuns(options: Required<Pick<RecentFinaliseTaskScanOptions, 'repoRoot' | 'terminalDirectory' | 'now' | 'recentWindowMs'>>): RecentFinaliseTaskRun[] {
  if (!existsSync(options.terminalDirectory)) {
    return [];
  }

  return readdirSync(options.terminalDirectory)
    .filter((fileName) => fileName.endsWith('.txt'))
    .flatMap((fileName): RecentFinaliseTaskRun[] => {
      const filePath = path.join(options.terminalDirectory, fileName);
      const content = readFileSync(filePath, 'utf8');
      const header = getHeader(content);
      const command = getTerminalCommand(header);
      const task = getTaskForCommand(command);
      const exitCode = getTerminalExitCode(header, content);

      if (!task || exitCode !== 0) {
        return [];
      }

      const completedAtMs = getTerminalCompletedAtMs(header, content, statSync(filePath).mtimeMs);
      if (!isWithinRecentWindow(completedAtMs, options.now.getTime(), options.recentWindowMs)) {
        return [];
      }

      return [{
        task,
        command,
        completedAt: new Date(completedAtMs).toISOString(),
        completedAtMs,
        source: 'terminal',
        reuseEvidence: 'legacy-mtime-fallback',
      }];
    });
}

function getAutomationTaskForStep(step: AutomationStepLog, pendingMigrationFiles: string[]): FinaliseTaskKey | null {
  if (step.status !== 'passed') {
    return null;
  }

  if (pendingMigrationFiles.length > 0 && step.name === 'Run pending local migrations') {
    const migrationFiles = Array.isArray(step.metadata?.migrationFiles)
      ? step.metadata.migrationFiles.filter((item): item is string => typeof item === 'string')
      : [];
    const ranAllPendingMigrations = pendingMigrationFiles.every((migrationFile) => migrationFiles.includes(migrationFile));
    return ranAllPendingMigrations ? 'migrations' : null;
  }

  if (step.name === 'Run clean production build') {
    return 'build';
  }

  const command = step.command || step.name;
  return getTaskForCommand(command);
}

function readRecentAutomationTaskRuns(options: Required<Pick<RecentFinaliseTaskScanOptions, 'automationRunDirectory' | 'now' | 'recentWindowMs'>> & Pick<RecentFinaliseTaskScanOptions, 'pendingMigrationFiles'>): RecentFinaliseTaskRun[] {
  if (!existsSync(options.automationRunDirectory)) {
    return [];
  }

  const pendingMigrationFiles = options.pendingMigrationFiles ?? [];

  return readdirSync(options.automationRunDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .flatMap((fileName): RecentFinaliseTaskRun[] => {
      try {
        const log = JSON.parse(readFileSync(path.join(options.automationRunDirectory, fileName), 'utf8')) as AutomationRunLog;
        return log.steps.flatMap((step): RecentFinaliseTaskRun[] => {
          const task = getAutomationTaskForStep(step, pendingMigrationFiles);
          const completedAtMs = Date.parse(step.endedAt);

          if (!task || !Number.isFinite(completedAtMs)) {
            return [];
          }

          if (!isWithinRecentWindow(completedAtMs, options.now.getTime(), options.recentWindowMs)) {
            return [];
          }

          return [{
            task,
            command: step.command || step.name,
            completedAt: new Date(completedAtMs).toISOString(),
            completedAtMs,
            source: 'automation-log',
            reuseEvidence: 'legacy-mtime-fallback',
          }];
        });
      } catch {
        return [];
      }
    });
}

function hasRelevantFileChangedAfter(repoRoot: string, relativePaths: string[], completedAtMs: number): boolean {
  return relativePaths.some((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      return false;
    }

    return statSync(absolutePath).mtimeMs > completedAtMs + FILE_MTIME_TOLERANCE_MS;
  });
}

function getRelevantFilesForTask(task: FinaliseTaskKey, options: RecentFinaliseTaskScanOptions): string[] {
  if (task === 'migrations' || task === 'db-validate') {
    return options.pendingMigrationFiles ?? [];
  }

  return options.changedFiles;
}

function canSkipTask(task: FinaliseTaskKey, run: RecentFinaliseTaskRun, options: RecentFinaliseTaskScanOptions): boolean {
  if (task === 'build' && options.buildArtifactPath && !existsSync(options.buildArtifactPath)) {
    return false;
  }

  return !hasRelevantFileChangedAfter(options.repoRoot, getRelevantFilesForTask(task, options), run.completedAtMs);
}

export function getSkippableFinaliseTasks(options: RecentFinaliseTaskScanOptions): SkippableFinaliseTasks {
  // Protocol workstreams use content-addressed checkpoints only — never mtime heuristics.
  const activeProtocol = resolveActiveProtocolFinaliseContext(options.repoRoot);
  if (activeProtocol || options.preferProtocolCheckpoints) {
    const protocolSkips = getProtocolSkippableFinaliseTasks({
      repoRoot: options.repoRoot,
      buildArtifactPath: options.buildArtifactPath,
    });
    const skippableFromProtocol: SkippableFinaliseTasks = {};
    for (const [task, meta] of Object.entries(protocolSkips) as Array<
      [FinaliseTaskKey, { reason: string; checkpointId: string }]
    >) {
      skippableFromProtocol[task] = {
        task,
        command: `protocol-checkpoint:${meta.checkpointId}`,
        completedAt: new Date().toISOString(),
        completedAtMs: Date.now(),
        source: 'exact-cache',
      };
    }
    return skippableFromProtocol;
  }

  const mode = options.mode ?? 'finalise';
  const exactCommands: Partial<Record<FinaliseTaskKey, string>> = {
    build: 'npm run build',
    'test-run': 'npm run test:run',
    testsuite: 'npm run testsuite',
  };
  const exact: SkippableFinaliseTasks = {};
  for (const [task, command] of Object.entries(exactCommands) as Array<
    [FinaliseTaskKey, string]
  >) {
    const requiredArtifactPaths =
      task === 'build' && options.buildArtifactPath ? [options.buildArtifactPath] : [];
    const result = canReuseOrdinaryFinaliseStep({
      repoRoot: options.repoRoot,
      mode,
      task,
      command,
      requiredArtifactPaths,
    });
    if (result.reusable && result.step?.endedAt) {
      exact[task] = {
        task,
        command,
        completedAt: result.step.endedAt,
        completedAtMs: Date.parse(result.step.endedAt),
        source: 'exact-cache',
      };
    }
  }
  if (!options.allowLegacyMtimeFallback) {
    return exact;
  }

  const now = options.now ?? new Date();
  const recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const terminalDirectory = options.terminalDirectory ?? getDefaultTerminalDirectory(options.repoRoot);
  const automationRunDirectory = options.automationRunDirectory ?? path.join(options.repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
  const runs = [
    ...readRecentTerminalTaskRuns({ repoRoot: options.repoRoot, terminalDirectory, now, recentWindowMs }),
    ...readRecentAutomationTaskRuns({
      automationRunDirectory,
      now,
      recentWindowMs,
      pendingMigrationFiles: options.pendingMigrationFiles,
    }),
  ].sort((left, right) => right.completedAtMs - left.completedAtMs);

  const skippableTasks: SkippableFinaliseTasks = { ...exact };

  for (const run of runs) {
    if (skippableTasks[run.task]) {
      continue;
    }

    if (canSkipTask(run.task, run, options)) {
      skippableTasks[run.task] = run;
    }
  }

  return skippableTasks;
}
