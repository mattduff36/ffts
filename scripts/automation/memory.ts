import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import type {
  AutomationMemory,
  AutomationMemorySuggestion,
  AutomationMonthlyMetrics,
  AutomationReviewPrompt,
} from './types';

export interface AutomationReviewHistory {
  previousReviewText?: string;
  previousPromptText?: string;
  previousMetrics?: AutomationMonthlyMetrics;
  previousSuggestions: AutomationMemorySuggestion[];
}

function createEmptyMemory(scriptName: string): AutomationMemory {
  return {
    version: '1.0.0',
    scriptName,
    updatedAt: new Date().toISOString(),
    suggestions: [],
    prompts: [],
    monthlyMetrics: [],
  };
}

function isMemory(value: unknown, scriptName: string): value is AutomationMemory {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AutomationMemory>;
  return candidate.scriptName === scriptName && Array.isArray(candidate.suggestions);
}

export function loadAutomationMemory(knowledgeDirectory: string, scriptName: string): AutomationMemory {
  const memoryPath = path.join(knowledgeDirectory, `${scriptName}-memory.json`);
  if (!existsSync(memoryPath)) return createEmptyMemory(scriptName);

  try {
    const parsed = JSON.parse(readFileSync(memoryPath, 'utf8')) as unknown;
    if (isMemory(parsed, scriptName)) {
      return {
        ...createEmptyMemory(scriptName),
        ...parsed,
        suggestions: parsed.suggestions ?? [],
        prompts: parsed.prompts ?? [],
        monthlyMetrics: parsed.monthlyMetrics ?? [],
      };
    }
  } catch {
    // Keep automation reviews running even if a human-edited memory file is invalid.
  }

  return createEmptyMemory(scriptName);
}

export function saveAutomationMemory(knowledgeDirectory: string, memory: AutomationMemory): string {
  mkdirSync(knowledgeDirectory, { recursive: true });
  const memoryPath = path.join(knowledgeDirectory, `${memory.scriptName}-memory.json`);
  writeFileSync(memoryPath, JSON.stringify({ ...memory, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  return memoryPath;
}

export function hasMonthlyReviewArtifact(reviewsDirectory: string, scriptName: string, monthKey: string): boolean {
  const scriptReviewDirectory = path.join(reviewsDirectory, scriptName);
  const folderReviewPath = path.join(scriptReviewDirectory, monthKey, 'review.md');
  const legacyReviewPath = path.join(scriptReviewDirectory, `${monthKey}.md`);
  return existsSync(folderReviewPath) || existsSync(legacyReviewPath);
}

function getPreviousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 7);
}

function readIfExists(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, 'utf8');
}

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function readAutomationReviewHistory(params: {
  reviewsDirectory: string;
  scriptName: string;
  monthKey: string;
  memory: AutomationMemory;
}): AutomationReviewHistory {
  const previousMonthKey = getPreviousMonthKey(params.monthKey);
  const previousFolder = path.join(params.reviewsDirectory, params.scriptName, previousMonthKey);
  const legacyReviewPath = path.join(params.reviewsDirectory, params.scriptName, `${previousMonthKey}.md`);
  const previousSuggestions =
    readJsonIfExists<AutomationMemorySuggestion[]>(path.join(previousFolder, 'suggestions.json')) ??
    params.memory.suggestions.filter((suggestion) => suggestion.createdMonth === previousMonthKey);

  return {
    previousReviewText: readIfExists(path.join(previousFolder, 'review.md')) ?? readIfExists(legacyReviewPath),
    previousPromptText: readIfExists(path.join(previousFolder, 'review-prompt.md')),
    previousMetrics:
      readJsonIfExists<AutomationMonthlyMetrics>(path.join(previousFolder, 'metrics.json')) ??
      params.memory.monthlyMetrics.find((metrics) => metrics.month === previousMonthKey),
    previousSuggestions,
  };
}

export function mergeAutomationMemorySuggestions(
  existingSuggestions: AutomationMemorySuggestion[],
  nextSuggestions: AutomationMemorySuggestion[]
): AutomationMemorySuggestion[] {
  const byId = new Map(existingSuggestions.map((suggestion) => [suggestion.id, suggestion]));

  for (const suggestion of nextSuggestions) {
    const existing = byId.get(suggestion.id);
    if (!existing) {
      byId.set(suggestion.id, suggestion);
      continue;
    }

    byId.set(suggestion.id, {
      ...suggestion,
      status: existing.status,
      statusReason: existing.statusReason,
      decisionAt: existing.decisionAt,
      decisionReason: existing.decisionReason,
      planPath: existing.planPath,
      implementedAt: existing.implementedAt,
      outcome: existing.outcome,
      createdMonth: existing.createdMonth,
      lastSeenMonth: suggestion.lastSeenMonth,
      evidence: Array.from(new Set([...existing.evidence, ...suggestion.evidence])),
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function upsertByMonth<T extends { month: string }>(items: T[], nextItem: T): T[] {
  return [...items.filter((item) => item.month !== nextItem.month), nextItem]
    .sort((left, right) => left.month.localeCompare(right.month));
}

export function updateAutomationMemory(params: {
  memory: AutomationMemory;
  metrics: AutomationMonthlyMetrics;
  prompt: AutomationReviewPrompt;
  suggestions: AutomationMemorySuggestion[];
}): AutomationMemory {
  return {
    ...params.memory,
    updatedAt: new Date().toISOString(),
    suggestions: mergeAutomationMemorySuggestions(params.memory.suggestions, params.suggestions),
    prompts: upsertByMonth(params.memory.prompts, params.prompt),
    monthlyMetrics: upsertByMonth(params.memory.monthlyMetrics, params.metrics),
  };
}

export function getExistingReviewMonths(reviewsDirectory: string, scriptName: string): string[] {
  const scriptReviewDirectory = path.join(reviewsDirectory, scriptName);
  if (!existsSync(scriptReviewDirectory)) return [];

  return readdirSync(scriptReviewDirectory)
    .map((entry) => entry.replace(/\.md$/u, ''))
    .filter((entry) => /^\d{4}-\d{2}$/u.test(entry))
    .sort();
}
