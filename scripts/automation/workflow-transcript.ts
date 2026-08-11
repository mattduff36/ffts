import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { extractWorkflowCompletionMarker } from './workflow-marker';
import {
  PLAN_CONTRACT_MARKER_PREFIX,
  extractPlanContractMarker,
  resolvePlanPath,
} from './workflow-plan-contract';
import type {
  WorkflowPlanContract,
  WorkflowTranscriptSignals,
  WorkflowTranscriptStatus,
} from './types';

export const WORKFLOW_TRANSCRIPT_ADAPTER_VERSION = '2';
const MAX_TRANSCRIPT_BYTES = 8_000_000;
const MAX_LINE_LENGTH = 500_000;

export interface TranscriptParseResult {
  signals: WorkflowTranscriptSignals;
  assistantText: string;
  planValidationStatus: 'present' | 'missing' | 'malformed' | 'unknown';
  planContract: WorkflowPlanContract | null;
  transcriptStatus: WorkflowTranscriptStatus;
}

function emptySignals(parseErrors: string[] = []): WorkflowTranscriptSignals {
  return {
    adapterVersion: WORKFLOW_TRANSCRIPT_ADAPTER_VERSION,
    skillRead: false,
    architectureGateTask: false,
    finalDiffReviewerTask: false,
    exploreTask: false,
    truncatedShellEvidence: false,
    bulkInsertionScriptEvidence: false,
    duplicateBroadSearchAfterExplore: false,
    gitCommitEvidence: false,
    markerPresent: false,
    planContractPresent: false,
    planPathSource: 'unavailable',
    planPathRef: null,
    parseErrors,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const record = asRecord(part);
      if (!record) return '';
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      return '';
    })
    .join('\n');
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  const record = asRecord(value);
  return record ? Object.values(record).flatMap(collectStringValues) : [];
}

function normalizePlanCandidatePath(candidatePath: string, repoRoot: string): string {
  const absolute = path.isAbsolute(candidatePath)
    ? path.normalize(candidatePath.trim())
    : path.resolve(repoRoot, candidatePath.trim());
  const normalized = absolute.replace(/\\/gu, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function inspectToolUse(
  part: Record<string, unknown>,
  signals: WorkflowTranscriptSignals,
  counters: {
    exploreSeen: boolean;
    broadSearchSignatures: Set<string>;
    planToolSeen: boolean;
    planCandidatePaths: string[];
    planPayloads: string[];
  }
): void {
  if (part.type !== 'tool_use') return;
  const name = typeof part.name === 'string' ? part.name : '';
  const input = asRecord(part.input) ?? {};
  const normalizedName = name.toLowerCase();

  const serializedInput = JSON.stringify(input);
  const isCreatePlan = normalizedName === 'createplan' || normalizedName === 'create_plan';
  const isWriteTool =
    normalizedName === 'write' ||
    normalizedName === 'writefile' ||
    normalizedName === 'write_file' ||
    normalizedName === 'editfile' ||
    normalizedName === 'edit_file' ||
    normalizedName === 'applypatch' ||
    normalizedName === 'apply_patch';
  const pathValues = [
    input.path,
    input.filePath,
    input.file_path,
    input.targetFile,
    input.target_file,
    input.planPath,
    input.plan_path,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const patchPaths = [...serializedInput.matchAll(/\*{3}\s+(?:Add|Update) File:\s*([^\\r\\n"]+\.md)\b/giu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const planPaths = [...pathValues, ...patchPaths].filter(
    (candidate) => /\.md$/iu.test(candidate) && (isCreatePlan || /(?:^|[\\/_.-])plans?(?:[\\/_.-]|$)/iu.test(candidate))
  );
  if (isCreatePlan || (isWriteTool && planPaths.length > 0)) {
    counters.planToolSeen = true;
    counters.planCandidatePaths.push(...planPaths);
    counters.planPayloads.push(...collectStringValues(input));
    if (serializedInput.includes(PLAN_CONTRACT_MARKER_PREFIX)) {
      signals.planContractPresent = true;
    }
  }

  if (name === 'Read' || name === 'ReadFile') {
    const filePath = typeof input.path === 'string' ? input.path : '';
    if (/token-efficient-engineering[\\/]+SKILL\.md/iu.test(filePath)) {
      signals.skillRead = true;
    }
  }

  if (name === 'Task' || name === 'Subagent') {
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : '';
    if (subagentType === 'architecture-gate') signals.architectureGateTask = true;
    if (subagentType === 'final-diff-reviewer') signals.finalDiffReviewerTask = true;
    if (subagentType === 'explore') {
      signals.exploreTask = true;
      counters.exploreSeen = true;
    }
  }

  if ((name === 'Grep' || name === 'rg' || name === 'Glob') && counters.exploreSeen) {
    const signature = JSON.stringify({
      name,
      pattern: input.pattern ?? null,
      glob: input.glob ?? input.glob_pattern ?? null,
      path: input.path ?? null,
    });
    if (counters.broadSearchSignatures.has(signature)) {
      signals.duplicateBroadSearchAfterExplore = true;
    } else {
      counters.broadSearchSignatures.add(signature);
    }
  }

  if (name === 'Shell') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (
      /\|\s*head\b|\|\s*tail\b|\bhead\s+-[nc]\b|\btail\s+-n\b|\.slice\(\s*0\s*,\s*\d+/iu.test(command) ||
      /\bhead\s+-c\b/iu.test(command)
    ) {
      signals.truncatedShellEvidence = true;
    }
    if (/\bgit\s+commit\b/iu.test(command)) {
      signals.gitCommitEvidence = true;
    }
    if (
      /\bbulk[-_ ]?(?:text[-_ ]?)?(?:import|insert|insertion)\b/iu.test(command) ||
      /python(?:3)?\b[^\n]*\b(?:insert|rewrite).*(?:import|across files|many files)/iu.test(command)
    ) {
      signals.bulkInsertionScriptEvidence = true;
    }
  }
}

export async function parseWorkflowTranscript(
  transcriptPath: string | null,
  options?: { repoRoot?: string }
): Promise<TranscriptParseResult> {
  if (transcriptPath === null) {
    return {
      signals: emptySignals(['transcript_path was null']),
      assistantText: '',
      planValidationStatus: 'unknown',
      planContract: null,
      transcriptStatus: 'null',
    };
  }

  if (!transcriptPath.trim()) {
    return {
      signals: emptySignals(['transcript_path was empty']),
      assistantText: '',
      planValidationStatus: 'unknown',
      planContract: null,
      transcriptStatus: 'missing',
    };
  }

  if (!existsSync(transcriptPath)) {
    return {
      signals: emptySignals(['transcript file not found']),
      assistantText: '',
      planValidationStatus: 'unknown',
      planContract: null,
      transcriptStatus: 'missing',
    };
  }

  const stats = statSync(transcriptPath);
  if (stats.size > MAX_TRANSCRIPT_BYTES) {
    return {
      signals: emptySignals([`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`]),
      assistantText: '',
      planValidationStatus: 'unknown',
      planContract: null,
      transcriptStatus: 'malformed',
    };
  }

  const signals = emptySignals();
  const counters = {
    exploreSeen: false,
    broadSearchSignatures: new Set<string>(),
    planToolSeen: false,
    planCandidatePaths: [] as string[],
    planPayloads: [] as string[],
  };
  const assistantChunks: string[] = [];
  let sawBom = false;

  const stream = createReadStream(transcriptPath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of reader) {
    let line = rawLine;
    if (!sawBom && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1);
      sawBom = true;
    }
    if (!line.trim()) continue;
    if (line.length > MAX_LINE_LENGTH) {
      signals.parseErrors.push('skipped oversized JSONL line');
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      signals.parseErrors.push('skipped malformed JSONL line');
      continue;
    }

    const record = asRecord(parsed);
    if (!record) continue;

    if (record.role === 'assistant') {
      const message = asRecord(record.message);
      const content = message?.content;
      const text = collectText(content);
      if (text) assistantChunks.push(text);
      if (Array.isArray(content)) {
        for (const part of content) {
          const partRecord = asRecord(part);
          if (partRecord) inspectToolUse(partRecord, signals, counters);
        }
      }
    }
  }

  const assistantText = assistantChunks.join('\n');
  const marker = extractWorkflowCompletionMarker(assistantText);
  signals.markerPresent = marker.status === 'present';
  let planValidationStatus: TranscriptParseResult['planValidationStatus'] = counters.planToolSeen
    ? 'missing'
    : 'unknown';
  let planContract: WorkflowPlanContract | null = null;

  for (const payload of counters.planPayloads) {
    if (!payload.includes(PLAN_CONTRACT_MARKER_PREFIX)) continue;
    const parsedPlan = extractPlanContractMarker(payload);
    planValidationStatus = parsedPlan.status;
    signals.planContractPresent = parsedPlan.status === 'present';
    planContract = parsedPlan.contract;
  }

  const repoRoot = options?.repoRoot ?? process.cwd();
  const distinctPlanPaths = new Map<string, string>();
  for (const candidatePath of counters.planCandidatePaths) {
    const normalized = normalizePlanCandidatePath(candidatePath, repoRoot);
    if (!distinctPlanPaths.has(normalized)) distinctPlanPaths.set(normalized, candidatePath);
  }
  const planPaths = [...distinctPlanPaths.values()];
  if (planPaths.length > 1) {
    signals.planPathSource = 'unavailable';
    signals.planPathRef = null;
    signals.parseErrors.push('ambiguous plan candidates');
  } else if (planPaths[0]) {
    const resolution = resolvePlanPath({
      candidatePath: planPaths[0],
      repoRoot,
    });
    signals.planPathSource = resolution.source;
    signals.planPathRef = resolution.pathRef;
    if (resolution.status === 'ok' && resolution.absolutePath) {
      try {
        const parsedPlan = extractPlanContractMarker(
          readFileSync(resolution.absolutePath, 'utf8')
        );
        planValidationStatus = parsedPlan.status;
        signals.planContractPresent = parsedPlan.status === 'present';
        planContract = parsedPlan.contract;
      } catch {
        signals.parseErrors.push('unable to inspect resolved plan file');
        planValidationStatus = 'unknown';
      }
    }
  }

  const transcriptStatus: WorkflowTranscriptStatus =
    signals.parseErrors.some((error) => error.includes('malformed')) && !assistantText
      ? 'malformed'
      : 'parsed';

  return { signals, assistantText, planValidationStatus, planContract, transcriptStatus };
}
