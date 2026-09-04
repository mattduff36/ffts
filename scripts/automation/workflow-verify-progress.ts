import { existsSync, readFileSync } from 'fs';

export type VerifyProgressStatus = 'pending' | 'waiting' | 'running' | 'pass' | 'fail' | 'skipped';

export interface VerifyProgressWorker {
  id: string;
  label: string;
  status: VerifyProgressStatus;
  elapsedMs: number;
  detail?: string;
}

export type WorkflowStageMeasure = 'opaque' | 'tests' | 'count';

export interface WorkflowStageProgress {
  id: string;
  label: string;
  status: VerifyProgressStatus;
  weight: number;
  elapsedMs: number;
  parentId?: string;
  measure?: WorkflowStageMeasure;
  completed?: number;
  total?: number;
  current?: string;
  failures?: string[];
}

export interface TestSuiteProgressEvent {
  type: 'collected' | 'case';
  completed: number;
  total?: number;
  current?: string;
  failed?: boolean;
  state?: string;
}

export interface VerifyProgressSnapshot {
  title: string;
  candidate?: string;
  percent: number;
  message: string;
  elapsedMs: number;
  etaRemainingMs: number | null;
  workers: VerifyProgressWorker[];
  stages: WorkflowStageProgress[];
  terminal: boolean;
  result?: 'PASS' | 'FAIL';
}

export interface VerifyProgressWriter {
  write(chunk: string): void;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const ETA_MIN_ELAPSED_MS = 20_000;
const ETA_MIN_FRACTION = 0.15;
const LABEL_WIDTH = 20;
const BAR_WIDTH = 10;
const ANSI_CLEAR_DOWN = '\u001b[J';

export function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return Math.floor(value);
}

export function monotonicPercent(previous: number, next: number): number {
  return Math.max(clampPercent(previous), clampPercent(next));
}

export function displayPercent(params: {
  completedWeight: number;
  totalWeight: number;
  terminal: boolean;
}): number {
  if (params.terminal) return 100;
  if (params.totalWeight <= 0) return 0;
  const raw = Math.floor((params.completedWeight / params.totalWeight) * 100);
  return Math.min(99, Math.max(0, raw));
}

export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatApproximateRemaining(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 10) return `~${minutes}m`;
  return `~${Math.round(minutes / 5) * 5}m`;
}

export function estimateRemainingMs(params: {
  elapsedMs: number;
  completedWeight: number;
  totalWeight: number;
}): number | null {
  if (
    params.completedWeight <= 0 ||
    params.totalWeight <= 0 ||
    params.elapsedMs < ETA_MIN_ELAPSED_MS ||
    params.completedWeight / params.totalWeight < ETA_MIN_FRACTION
  ) {
    return null;
  }
  const remainingWeight = params.totalWeight - params.completedWeight;
  if (remainingWeight <= 0) return 0;
  return Math.round((remainingWeight * params.elapsedMs) / params.completedWeight);
}

export function renderProgressBar(fraction: number | null, width = BAR_WIDTH): string {
  if (fraction == null) {
    return '░'.repeat(width);
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function normalizeStageStatus(status: VerifyProgressStatus): Exclude<VerifyProgressStatus, 'pending'> {
  return status === 'pending' ? 'waiting' : status;
}

export function stageBarFraction(stage: WorkflowStageProgress): number | null {
  const status = normalizeStageStatus(stage.status);
  if (status === 'waiting') return 0;
  if (status === 'pass' || status === 'fail' || status === 'skipped') return 1;
  if (status === 'running') {
    if ((stage.measure === 'tests' || stage.measure === 'count') && (stage.total ?? 0) > 0) {
      const total = stage.total ?? 0;
      const completed = Math.min(Math.max(0, stage.completed ?? 0), total);
      return completed / total;
    }
    return null;
  }
  return 0;
}

export function stageCompletedWeight(stage: WorkflowStageProgress): number {
  const weight = Math.max(0, stage.weight);
  const status = normalizeStageStatus(stage.status);
  if (status === 'pass' || status === 'fail' || status === 'skipped') return weight;
  if (status === 'running') {
    const fraction = stageBarFraction(stage);
    if (fraction == null) return 0;
    return weight * fraction;
  }
  return 0;
}

export function scoredWorkflowStages(stages: readonly WorkflowStageProgress[]): WorkflowStageProgress[] {
  const parentsWithChildren = new Set(
    stages.map((stage) => stage.parentId).filter((id): id is string => Boolean(id))
  );
  return stages.filter((stage) => !parentsWithChildren.has(stage.id));
}

export function workflowWeightTotals(stages: readonly WorkflowStageProgress[]): {
  completedWeight: number;
  totalWeight: number;
} {
  const scored = scoredWorkflowStages(stages);
  return {
    completedWeight: scored.reduce((sum, stage) => sum + stageCompletedWeight(stage), 0),
    totalWeight: scored.reduce((sum, stage) => sum + Math.max(0, stage.weight), 0),
  };
}

export function parseVitestProgressLine(line: string): TestSuiteProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const payload = trimmed.startsWith('TEE_VITEST_PROGRESS ')
    ? trimmed.slice('TEE_VITEST_PROGRESS '.length)
    : trimmed;
  try {
    const parsed = JSON.parse(payload) as Partial<TestSuiteProgressEvent>;
    if (parsed.type !== 'collected' && parsed.type !== 'case') return null;
    if (typeof parsed.completed !== 'number' || !Number.isFinite(parsed.completed)) return null;
    return {
      type: parsed.type,
      completed: Math.max(0, Math.floor(parsed.completed)),
      total:
        typeof parsed.total === 'number' && Number.isFinite(parsed.total)
          ? Math.max(0, Math.floor(parsed.total))
          : undefined,
      current: typeof parsed.current === 'string' ? parsed.current : undefined,
      failed: parsed.failed === true || parsed.state === 'failed',
      state: typeof parsed.state === 'string' ? parsed.state : undefined,
    };
  } catch {
    return null;
  }
}

export function consumeVitestProgressFile(
  filePath: string,
  seenLines: number,
  onEvent: (event: TestSuiteProgressEvent) => void
): number {
  if (!filePath) return seenLines;
  try {
    if (!existsSync(filePath)) return seenLines;
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
    const complete = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    for (let index = seenLines; index < complete; index += 1) {
      const event = parseVitestProgressLine(lines[index] ?? '');
      if (event) onEvent(event);
    }
    return complete;
  } catch {
    return seenLines;
  }
}

export function applyTestSuiteProgress(
  current: Pick<WorkflowStageProgress, 'completed' | 'total' | 'current' | 'failures'>,
  event: TestSuiteProgressEvent
): Required<Pick<WorkflowStageProgress, 'completed' | 'current'>> &
  Pick<WorkflowStageProgress, 'total' | 'failures'> {
  const knownTotal =
    event.total != null
      ? event.total
      : current.total != null && current.total > 0
        ? current.total
        : undefined;
  const rawCompleted = event.type === 'collected' ? event.completed : Math.max(current.completed ?? 0, event.completed);
  const completed = knownTotal != null ? Math.min(rawCompleted, knownTotal) : rawCompleted;
  const failures = [...(current.failures ?? [])];
  if (event.failed && event.current && !failures.includes(event.current)) {
    failures.push(event.current);
  }
  return {
    completed,
    total: knownTotal,
    current: event.current ?? current.current,
    failures,
  };
}

function padLabel(label: string, width: number): string {
  return label.length >= width ? label.slice(0, width) : `${label}${' '.repeat(width - label.length)}`;
}

function formatStageStatus(status: VerifyProgressStatus): string {
  const normalized = normalizeStageStatus(status);
  if (normalized === 'pass') return 'PASS';
  if (normalized === 'fail') return 'FAIL';
  if (normalized === 'skipped') return 'SKIP';
  if (normalized === 'running') return 'RUNNING';
  return 'WAITING';
}

function effectiveParentStatus(
  parent: WorkflowStageProgress,
  stages: readonly WorkflowStageProgress[]
): VerifyProgressStatus {
  const children = stages.filter((stage) => stage.parentId === parent.id);
  if (children.length === 0) return normalizeStageStatus(parent.status);
  if (children.some((child) => normalizeStageStatus(child.status) === 'running')) return 'running';
  if (children.some((child) => normalizeStageStatus(child.status) === 'fail')) return 'fail';
  if (children.every((child) => normalizeStageStatus(child.status) === 'waiting')) return 'waiting';
  if (
    children.every((child) => {
      const status = normalizeStageStatus(child.status);
      return status === 'pass' || status === 'skipped';
    })
  ) {
    return 'pass';
  }
  if (children.every((child) => normalizeStageStatus(child.status) === 'skipped')) return 'skipped';
  return 'running';
}

function stagesFromSnapshot(snapshot: VerifyProgressSnapshot): WorkflowStageProgress[] {
  if (snapshot.stages.length > 0) return snapshot.stages;
  return snapshot.workers.map((worker) => ({
    id: worker.id,
    label: worker.label,
    status: normalizeStageStatus(worker.status),
    weight: 1,
    elapsedMs: worker.elapsedMs,
    measure: 'opaque' as const,
  }));
}

function formatStageRow(stage: WorkflowStageProgress, indent: string): string[] {
  const status = normalizeStageStatus(stage.status);
  const fraction = stageBarFraction({ ...stage, status });
  const count =
    (stage.measure === 'tests' || stage.measure === 'count') && (stage.completed != null || stage.total != null)
      ? `${stage.completed ?? 0}${stage.total != null ? `/${stage.total}` : ''}`
      : '';
  const clock = stage.elapsedMs > 0 ? formatElapsedClock(stage.elapsedMs) : '';
  const parts = [
    `${indent}${padLabel(stage.label, LABEL_WIDTH)} [${renderProgressBar(fraction)}]`,
    count,
    formatStageStatus(status),
    clock,
  ].filter((part) => part.length > 0);
  const lines = [parts.join(' ')];
  if (status === 'running' && stage.current) {
    lines.push(`${indent}  Current: ${stage.current}`);
  }
  for (const failure of (stage.failures ?? []).slice(0, 5)) {
    lines.push(`${indent}  FAIL: ${failure}`);
  }
  return lines;
}

export function formatProgressRecord(snapshot: VerifyProgressSnapshot): string {
  const stages = stagesFromSnapshot(snapshot);
  const weights = workflowWeightTotals(stages);
  const percent = String(snapshot.percent).padStart(3, ' ');
  const elapsed = formatElapsedClock(snapshot.elapsedMs);
  const eta =
    snapshot.terminal || snapshot.etaRemainingMs == null
      ? elapsed
      : `${elapsed} · ${formatApproximateRemaining(snapshot.etaRemainingMs)} remaining`;
  const heading = snapshot.candidate ? `${snapshot.title} — ${snapshot.candidate}` : snapshot.title;
  const overallSuffix = snapshot.terminal && snapshot.result ? ` ${snapshot.result}` : '';
  const lines = [
    heading,
    '',
    `${padLabel('Overall', LABEL_WIDTH)} [${renderProgressBar(snapshot.percent / 100)}] ${percent}%${overallSuffix}   ${eta}`,
    '',
  ];
  const roots = stages.filter((stage) => !stage.parentId);
  for (const root of roots) {
    const children = stages.filter((stage) => stage.parentId === root.id);
    if (children.length > 0) {
      const parentStatus = effectiveParentStatus(root, stages);
      lines.push(`${padLabel(root.label, LABEL_WIDTH)} ${formatStageStatus(parentStatus)}`);
      for (const child of children) {
        lines.push(...formatStageRow(child, '  '));
      }
      continue;
    }
    lines.push(...formatStageRow(root, ''));
  }
  return `${lines.join('\n')}\n`;
}

export function frameLineCount(text: string): number {
  if (!text) return 0;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.length === 0 ? 0 : body.split('\n').length;
}

export function ttyRedrawPrefix(previousLineCount: number): string {
  if (previousLineCount <= 0) return '';
  return `\u001b[${previousLineCount}A${ANSI_CLEAR_DOWN}`;
}

export function createVerifyProgressReporter(options: {
  title: string;
  candidate?: string;
  stream?: VerifyProgressWriter;
  isTty?: boolean;
  now?: () => number;
  heartbeatMs?: number;
  ci?: boolean;
}): VerifyProgressReporter {
  const startedAt = (options.now ?? Date.now)();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const machineSafe = options.ci === true || options.isTty !== true;
  let lastPercent = 0;
  let lastHeartbeatAt = startedAt;
  let lastPaint = '';
  let lastLineCount = 0;
  let snapshot: VerifyProgressSnapshot = {
    title: options.title,
    candidate: options.candidate,
    percent: 0,
    message: options.title,
    elapsedMs: 0,
    etaRemainingMs: null,
    workers: [],
    stages: [],
    terminal: false,
  };

  const write = (text: string): void => {
    options.stream?.write(text);
  };

  const emit = (next: VerifyProgressSnapshot, heartbeat: boolean): void => {
    const weights = workflowWeightTotals(next.stages);
    const derivedPercent =
      next.stages.length > 0
        ? displayPercent({
            completedWeight: weights.completedWeight,
            totalWeight: weights.totalWeight,
            terminal: next.terminal,
          })
        : next.percent;
    snapshot = {
      ...next,
      percent: monotonicPercent(lastPercent, derivedPercent),
      etaRemainingMs: next.terminal
        ? 0
        : estimateRemainingMs({
            elapsedMs: next.elapsedMs,
            completedWeight: weights.completedWeight || (next.percent > 0 ? next.percent : 0),
            totalWeight: weights.totalWeight || 100,
          }),
    };
    lastPercent = snapshot.percent;
    const record = formatProgressRecord(snapshot);
    if (heartbeat && record === lastPaint) return;
    if (machineSafe) {
      write(record);
      lastPaint = record;
      lastLineCount = frameLineCount(record);
      return;
    }
    write(`${ttyRedrawPrefix(lastLineCount)}${record}`);
    lastPaint = record;
    lastLineCount = frameLineCount(record);
  };

  const mergeStage = (id: string, patch: Partial<WorkflowStageProgress>): WorkflowStageProgress[] => {
    const existing = snapshot.stages.find((stage) => stage.id === id);
    const nextStage: WorkflowStageProgress = {
      id,
      label: patch.label ?? existing?.label ?? id,
      status: normalizeStageStatus(patch.status ?? existing?.status ?? 'waiting'),
      weight: patch.weight ?? existing?.weight ?? 0,
      elapsedMs: patch.elapsedMs ?? existing?.elapsedMs ?? 0,
      parentId: patch.parentId ?? existing?.parentId,
      measure: patch.measure ?? existing?.measure,
      completed: patch.completed ?? existing?.completed,
      total: patch.total ?? existing?.total,
      current: patch.current ?? existing?.current,
      failures: patch.failures ?? existing?.failures,
    };
    if (snapshot.stages.some((stage) => stage.id === id)) {
      return snapshot.stages.map((stage) => (stage.id === id ? nextStage : stage));
    }
    return [...snapshot.stages, nextStage];
  };

  const publish = (
    partial: {
      message?: string;
      percent?: number;
      completedWeight?: number;
      totalWeight?: number;
      workers?: VerifyProgressWorker[];
      stages?: WorkflowStageProgress[];
      terminal?: boolean;
      result?: 'PASS' | 'FAIL';
    },
    heartbeat: boolean
  ): VerifyProgressSnapshot => {
    const now = (options.now ?? Date.now)();
    const elapsedMs = now - startedAt;
    const terminal = partial.terminal === true;
    const stages = (partial.stages ?? snapshot.stages).map((stage) => ({
      ...stage,
      status: normalizeStageStatus(stage.status),
    }));
    const weights = workflowWeightTotals(stages);
    const percent =
      stages.length > 0
        ? displayPercent({
            completedWeight: weights.completedWeight,
            totalWeight: weights.totalWeight,
            terminal,
          })
        : partial.percent != null
          ? terminal
            ? 100
            : Math.min(99, clampPercent(partial.percent))
          : displayPercent({
              completedWeight: partial.completedWeight ?? 0,
              totalWeight: partial.totalWeight ?? 1,
              terminal,
            });
    emit(
      {
        title: options.title,
        candidate: options.candidate,
        percent,
        message: partial.message ?? snapshot.message,
        elapsedMs,
        etaRemainingMs: estimateRemainingMs({
          elapsedMs,
          completedWeight: stages.length > 0 ? weights.completedWeight : (partial.completedWeight ?? 0),
          totalWeight: stages.length > 0 ? weights.totalWeight : (partial.totalWeight ?? 1),
        }),
        workers: partial.workers ?? snapshot.workers,
        stages,
        terminal,
        result: partial.result,
      },
      heartbeat
    );
    return snapshot;
  };

  return {
    snapshot: () => snapshot,
    lastPercent: () => lastPercent,
    setStages(stages) {
      publish({ stages }, false);
    },
    updateStage(id, patch) {
      publish({ stages: mergeStage(id, patch) }, false);
    },
    update(partial) {
      return publish(partial, false);
    },
    heartbeat(state) {
      const now = (options.now ?? Date.now)();
      if (now - lastHeartbeatAt < heartbeatMs) return null;
      lastHeartbeatAt = now;
      if (!state && snapshot.stages.length === 0) return snapshot;
      return publish(
        {
          message: state?.message ?? snapshot.message,
          completedWeight: state?.completedWeight,
          totalWeight: state?.totalWeight,
          workers: state?.workers,
          stages: state?.stages ?? snapshot.stages,
        },
        true
      );
    },
    complete(result, message) {
      return publish(
        {
          message: message ?? options.title,
          stages: snapshot.stages.map((stage) => {
            const status = normalizeStageStatus(stage.status);
            if (status === 'waiting') return stage;
            if (status === 'running') {
              return { ...stage, status: result === 'PASS' ? 'pass' : 'fail' };
            }
            return stage;
          }),
          workers: snapshot.workers.map((worker) =>
            normalizeStageStatus(worker.status) === 'running'
              ? { ...worker, status: result === 'PASS' ? 'pass' : 'fail' }
              : worker
          ),
          terminal: true,
          result,
        },
        false
      );
    },
  };
}

export interface VerifyProgressReporter {
  snapshot: () => VerifyProgressSnapshot;
  lastPercent: () => number;
  setStages: (stages: WorkflowStageProgress[]) => void;
  updateStage: (id: string, patch: Partial<WorkflowStageProgress>) => void;
  update: (partial: {
    message: string;
    percent?: number;
    completedWeight?: number;
    totalWeight?: number;
    workers?: VerifyProgressWorker[];
    stages?: WorkflowStageProgress[];
    terminal?: boolean;
    result?: 'PASS' | 'FAIL';
  }) => VerifyProgressSnapshot;
  heartbeat: (state?: {
    message: string;
    completedWeight?: number;
    totalWeight?: number;
    workers?: VerifyProgressWorker[];
    stages?: WorkflowStageProgress[];
  }) => VerifyProgressSnapshot | null;
  complete: (result: 'PASS' | 'FAIL', message?: string) => VerifyProgressSnapshot;
}

export function shouldUseMachineProgress(env: NodeJS.ProcessEnv, isTty: boolean | undefined): boolean {
  if (env.TEE_VERIFY_PROGRESS === 'off' || env.TEE_VERIFY_PROGRESS === 'plain') return true;
  if (env.CI === 'true' || env.CI === '1') return true;
  return isTty !== true;
}

export function createPreflightWorkflowStages(params: {
  runChecks: boolean;
  runRequiredTests: boolean;
}): WorkflowStageProgress[] {
  const stages: WorkflowStageProgress[] = [
    { id: 'candidate-capture', label: 'Candidate capture', status: 'waiting', weight: 4, elapsedMs: 0 },
    { id: 'protocol-validation', label: 'Protocol validation', status: 'waiting', weight: 4, elapsedMs: 0 },
    { id: 'verification-batch', label: 'Verification batch', status: 'waiting', weight: 0, elapsedMs: 0 },
  ];
  if (params.runChecks) {
    stages.push(
      {
        id: 'typecheck',
        label: 'Typecheck',
        status: 'waiting',
        weight: 22,
        elapsedMs: 0,
        parentId: 'verification-batch',
        measure: 'opaque',
      },
      {
        id: 'oxlint',
        label: 'Oxlint',
        status: 'waiting',
        weight: 8,
        elapsedMs: 0,
        parentId: 'verification-batch',
        measure: 'opaque',
      },
      {
        id: 'eslint',
        label: 'ESLint',
        status: 'waiting',
        weight: 12,
        elapsedMs: 0,
        parentId: 'verification-batch',
        measure: 'opaque',
      }
    );
  }
  if (params.runRequiredTests) {
    stages.push({
      id: 'required-tests',
      label: 'Workflow tests',
      status: 'waiting',
      weight: 48,
      elapsedMs: 0,
      parentId: 'verification-batch',
      measure: 'tests',
    });
  }
  stages.push(
    { id: 'required-id-proof', label: 'Required-ID proof', status: 'waiting', weight: 8, elapsedMs: 0 },
    { id: 'manifest', label: 'Manifest generation', status: 'waiting', weight: 6, elapsedMs: 0 },
    { id: 'evidence-convergence', label: 'Evidence convergence', status: 'waiting', weight: 6, elapsedMs: 0 },
    { id: 'preflight-record', label: 'Preflight record', status: 'waiting', weight: 4, elapsedMs: 0 }
  );
  return stages;
}

export function createFinaliseWorkflowStages(): WorkflowStageProgress[] {
  return [
    { id: 'activity', label: 'Cursor activity', status: 'waiting', weight: 2, elapsedMs: 0, measure: 'opaque' },
    { id: 'unmerged', label: 'Git cleanliness', status: 'waiting', weight: 3, elapsedMs: 0, measure: 'opaque' },
    { id: 'protocol', label: 'Protocol readiness', status: 'waiting', weight: 4, elapsedMs: 0, measure: 'opaque' },
    { id: 'release-meta', label: 'Release metadata', status: 'waiting', weight: 3, elapsedMs: 0, measure: 'opaque' },
    { id: 'migration-inventory', label: 'Migration inventory', status: 'waiting', weight: 4, elapsedMs: 0, measure: 'opaque' },
    { id: 'finalise-start', label: 'Finalise-start', status: 'waiting', weight: 4, elapsedMs: 0, measure: 'opaque' },
    {
      id: 'production-build',
      label: 'Production build',
      status: 'waiting',
      weight: 40,
      elapsedMs: 0,
      measure: 'count',
    },
    { id: 'release-finish', label: 'Release finish', status: 'waiting', weight: 8, elapsedMs: 0, measure: 'opaque' },
  ];
}
