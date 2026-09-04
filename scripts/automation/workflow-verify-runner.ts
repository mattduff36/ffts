import { spawn, type ChildProcess } from 'child_process';
import {
  createVerifyProgressReporter,
  type VerifyProgressReporter,
  type VerifyProgressWorker,
  type WorkflowStageProgress,
} from './workflow-verify-progress';

export const DEFAULT_TEE_VERIFY_JOBS = 3;
export const TEE_VERIFY_JOBS_ENV = 'TEE_VERIFY_JOBS';
export const MAX_TEE_VERIFY_JOBS = 8;

export type VerifyStageKind = 'foundation' | 'readonly' | 'mutating' | 'authority';

export interface VerifyCandidate {
  headCommit: string;
  fingerprint: string;
}

export interface VerifyStageContext {
  candidate: VerifyCandidate;
  jobs: number;
}

export interface VerifyStageOutput<T = unknown> {
  ok: boolean;
  value?: T;
  message?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  candidate?: VerifyCandidate;
}

export interface VerifyStage<T = unknown> {
  id: string;
  label: string;
  weight: number;
  kind: VerifyStageKind;
  dependsOn?: string[];
  failFast?: boolean;
  run: (ctx: VerifyStageContext) => Promise<VerifyStageOutput<T>> | VerifyStageOutput<T>;
}

export interface VerifyStageResult<T = unknown> extends VerifyStageOutput<T> {
  id: string;
  label: string;
  kind: VerifyStageKind;
  status: 'pass' | 'fail' | 'skipped';
  durationMs: number;
}

export interface VerifyBatchResult<T = unknown> {
  ok: boolean;
  drifted: boolean;
  foundationFailed: boolean;
  jobs: number;
  candidate: VerifyCandidate;
  results: VerifyStageResult<T>[];
  failures: VerifyStageResult<T>[];
  maxConcurrent: number;
  serial: boolean;
}

export function resolveTeeVerifyJobs(raw: string | undefined = process.env[TEE_VERIFY_JOBS_ENV]): number {
  if (raw == null || raw.trim() === '') return DEFAULT_TEE_VERIFY_JOBS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_TEE_VERIFY_JOBS;
  return Math.min(MAX_TEE_VERIFY_JOBS, parsed);
}

export function candidatesMatch(left: VerifyCandidate, right: VerifyCandidate): boolean {
  return left.headCommit === right.headCommit && left.fingerprint === right.fingerprint;
}

export interface CapturedProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: Error;
}

export function resolveCommandExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s|&<>^()"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function runCapturedProcess(params: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CapturedProcessResult> {
  const started = Date.now();
  const executable = resolveCommandExecutable(params.command);
  const env = params.env ?? process.env;
  const spawnOnce = (useShell: boolean): Promise<CapturedProcessResult> =>
    new Promise((resolve) => {
      let child: ChildProcess;
      try {
        // Node 22 on Windows throws EINVAL for .cmd/.bat when shell:false + windowsHide.
        child = useShell
          ? spawn([executable, ...params.args.map(quoteWindowsArg)].join(' '), {
              cwd: params.cwd,
              env,
              shell: true,
            })
          : spawn(executable, params.args, {
              cwd: params.cwd,
              env,
              shell: false,
              windowsHide: executable.endsWith('.cmd') || executable.endsWith('.bat') ? false : true,
            });
      } catch (error) {
        resolve({
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          durationMs: Date.now() - started,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result: CapturedProcessResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const timer =
        params.timeoutMs != null
          ? setTimeout(() => {
              child.kill();
              finish({
                exitCode: null,
                signal: 'SIGTERM',
                stdout,
                stderr,
                durationMs: Date.now() - started,
                error: new Error('process timed out'),
              });
            }, params.timeoutMs)
          : null;
      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        finish({
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          error,
        });
      });
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        finish({
          exitCode: typeof code === 'number' ? code : null,
          signal: signal ?? null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
    });

  const preferShell =
    process.platform === 'win32' &&
    (params.command === 'npm' ||
      params.command === 'npx' ||
      executable.endsWith('.cmd') ||
      executable.endsWith('.bat'));
  return spawnOnce(preferShell).then((result) => {
    if (result.error && process.platform === 'win32' && !preferShell) {
      return spawnOnce(true);
    }
    return result;
  });
}

function depsSatisfied(stage: VerifyStage, completed: Map<string, VerifyStageResult>): boolean {
  return (stage.dependsOn ?? []).every((id) => completed.get(id)?.status === 'pass');
}

function depsFailed(stage: VerifyStage, completed: Map<string, VerifyStageResult>): boolean {
  return (stage.dependsOn ?? []).some((id) => {
    const result = completed.get(id);
    return result != null && result.status !== 'pass';
  });
}

function barrierOccupied(running: Iterable<VerifyStage>): boolean {
  for (const stage of running) {
    if (stage.kind === 'mutating' || stage.kind === 'authority' || stage.kind === 'foundation') {
      return true;
    }
  }
  return false;
}

export async function runVerifyBatch<T = unknown>(params: {
  stages: VerifyStage<T>[];
  candidate: VerifyCandidate;
  jobs?: number;
  progress?: VerifyProgressReporter;
  readCandidate?: () => VerifyCandidate | { drifted: true } | { error: string };
  now?: () => number;
  heartbeatMs?: number;
}): Promise<VerifyBatchResult<T>> {
  const jobs = Math.max(1, params.jobs ?? resolveTeeVerifyJobs());
  const serial = jobs === 1;
  const completed = new Map<string, VerifyStageResult<T>>();
  const results: VerifyStageResult<T>[] = [];
  const pending = [...params.stages];
  const running = new Map<string, Promise<VerifyStageResult<T>>>();
  const runningStages = new Map<string, VerifyStage<T>>();
  const startedAt = new Map<string, number>();
  let maxConcurrent = 0;
  let drifted = false;
  let foundationFailed = false;
  const totalWeight = params.stages.reduce((sum, stage) => sum + Math.max(0, stage.weight), 0);
  const now = params.now ?? Date.now;

  const currentCandidate = (): VerifyCandidate | { drifted: true } | { error: string } => {
    if (!params.readCandidate) return params.candidate;
    return params.readCandidate();
  };

  const assertSameCandidate = (): boolean => {
    const seen = currentCandidate();
    if ('drifted' in seen) {
      drifted = true;
      return false;
    }
    if ('error' in seen) {
      drifted = true;
      return false;
    }
    if (!candidatesMatch(params.candidate, seen)) {
      drifted = true;
      return false;
    }
    return true;
  };

  const completedWeight = (): number =>
    [...completed.values()].reduce((sum, result) => {
      const stage = params.stages.find((item) => item.id === result.id);
      return sum + (stage ? Math.max(0, stage.weight) : 0);
    }, 0);

  const workers = (): VerifyProgressWorker[] =>
    params.stages.map((stage) => {
      const done = completed.get(stage.id);
      const runningSince = startedAt.get(stage.id);
      return {
        id: stage.id,
        label: stage.label,
        status: done
          ? done.status === 'pass'
            ? 'pass'
            : done.status === 'skipped'
              ? 'skipped'
              : 'fail'
          : runningSince != null
            ? 'running'
            : 'waiting',
        elapsedMs: runningSince != null ? now() - runningSince : done?.durationMs ?? 0,
      };
    });

  const syncProgressStages = (): WorkflowStageProgress[] => {
    const current = params.progress?.snapshot().stages ?? [];
    const byId = new Map(current.map((stage) => [stage.id, stage]));
    for (const worker of workers()) {
      const defined = params.stages.find((stage) => stage.id === worker.id);
      const previous = byId.get(worker.id);
      byId.set(worker.id, {
        id: worker.id,
        label: worker.label,
        status: worker.status,
        weight: previous?.weight ?? defined?.weight ?? 1,
        elapsedMs: worker.elapsedMs,
        parentId: previous?.parentId,
        measure: previous?.measure ?? 'opaque',
        completed: previous?.completed,
        total: previous?.total,
        current: previous?.current,
        failures: previous?.failures,
      });
    }
    return current.length > 0
      ? current.map((stage) => byId.get(stage.id) ?? stage)
      : [...byId.values()];
  };

  const publish = (message: string): void => {
    params.progress?.update({
      message,
      completedWeight: completedWeight(),
      totalWeight,
      workers: workers(),
      stages: syncProgressStages(),
    });
  };

  const heartbeatTimer =
    params.progress == null
      ? null
      : setInterval(() => {
          params.progress?.heartbeat({
            message: 'Verification batch',
            completedWeight: completedWeight(),
            totalWeight,
            workers: workers(),
            stages: syncProgressStages(),
          });
        }, params.heartbeatMs ?? 15_000);
  heartbeatTimer?.unref?.();

  const skipStage = (stage: VerifyStage<T>, message: string): void => {
    const result: VerifyStageResult<T> = {
      id: stage.id,
      label: stage.label,
      kind: stage.kind,
      ok: false,
      status: 'skipped',
      durationMs: 0,
      message,
    };
    completed.set(stage.id, result);
    results.push(result);
  };

  const startStage = (stage: VerifyStage<T>): void => {
    if (!assertSameCandidate()) {
      skipStage(stage, 'candidate drift; downstream evidence discarded');
      return;
    }
    const begun = now();
    startedAt.set(stage.id, begun);
    publish(`Running ${stage.label}`);
    const task = Promise.resolve()
      .then(() => stage.run({ candidate: params.candidate, jobs }))
      .then((output): VerifyStageResult<T> => {
        if (output.candidate && !candidatesMatch(params.candidate, output.candidate)) {
          return {
            ...output,
            id: stage.id,
            label: stage.label,
            kind: stage.kind,
            ok: false,
            status: 'fail',
            durationMs: now() - begun,
            message: output.message ?? 'worker result is bound to a different candidate',
          };
        }
        return {
          ...output,
          id: stage.id,
          label: stage.label,
          kind: stage.kind,
          status: output.ok ? 'pass' : 'fail',
          durationMs: now() - begun,
        };
      })
      .catch((error: unknown): VerifyStageResult<T> => ({
        id: stage.id,
        label: stage.label,
        kind: stage.kind,
        ok: false,
        status: 'fail',
        durationMs: now() - begun,
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((result) => {
        completed.set(stage.id, result);
        results.push(result);
        if (!result.ok && (stage.failFast || stage.kind === 'foundation')) {
          foundationFailed = true;
        }
        if (!assertSameCandidate()) {
          drifted = true;
        }
        publish(`${stage.label} ${result.status === 'pass' ? 'PASS' : result.status === 'skipped' ? 'SKIP' : 'FAIL'}`);
        return result;
      })
      .finally(() => {
        running.delete(stage.id);
        runningStages.delete(stage.id);
        startedAt.delete(stage.id);
      });
    running.set(stage.id, task);
    runningStages.set(stage.id, stage);
    maxConcurrent = Math.max(maxConcurrent, running.size);
  };

  try {
    if (!assertSameCandidate()) {
      for (const stage of pending.splice(0)) {
        skipStage(stage, 'candidate drift before verification batch');
      }
    }

    while (pending.length > 0 || running.size > 0) {
      if (drifted) {
        while (pending.length > 0) {
          skipStage(pending.shift()!, 'candidate drift; downstream evidence discarded');
        }
      } else {
        let started = true;
        while (started) {
          started = false;
          if (running.size >= jobs) break;
          const barrierRunning = barrierOccupied(runningStages.values());
          for (let index = 0; index < pending.length; index += 1) {
            const stage = pending[index]!;
            if (!depsSatisfied(stage, completed)) {
              if (depsFailed(stage, completed) || foundationFailed) {
                pending.splice(index, 1);
                skipStage(
                  stage,
                  foundationFailed
                    ? 'foundational invalidation blocked downstream evidence'
                    : 'dependency did not pass'
                );
                index -= 1;
              }
              continue;
            }
            if (foundationFailed && stage.kind !== 'foundation') {
              pending.splice(index, 1);
              skipStage(stage, 'foundational invalidation blocked downstream evidence');
              index -= 1;
              continue;
            }
            const needsBarrier =
              stage.kind === 'mutating' || stage.kind === 'authority' || stage.kind === 'foundation';
            if (serial && running.size > 0) continue;
            if (needsBarrier && running.size > 0) continue;
            if (barrierRunning) continue;
            pending.splice(index, 1);
            startStage(stage);
            started = true;
            break;
          }
        }
      }

      if (running.size === 0) {
        if (pending.length === 0) break;
        const blocked = pending.filter((stage) => !depsSatisfied(stage, completed));
        if (blocked.length === pending.length) {
          for (const stage of pending.splice(0)) {
            skipStage(stage, 'dependency barrier unmet');
          }
          break;
        }
        continue;
      }
      await Promise.race(running.values());
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }

  const ordered = params.stages
    .map((stage) => completed.get(stage.id))
    .filter((row): row is VerifyStageResult<T> => row != null);
  const failures = ordered.filter((row) => row.status === 'fail');
  const ok = !drifted && !foundationFailed && failures.length === 0 && ordered.every((row) => row.status !== 'fail');

  return {
    ok,
    drifted,
    foundationFailed,
    jobs,
    candidate: params.candidate,
    results: ordered,
    failures,
    maxConcurrent,
    serial,
  };
}

export function createBatchProgressReporter(params: {
  title: string;
  candidate?: string;
  stream?: { write(chunk: string): void };
  isTty?: boolean;
  ci?: boolean;
  now?: () => number;
  heartbeatMs?: number;
}): VerifyProgressReporter {
  return createVerifyProgressReporter(params);
}
