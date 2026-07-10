export type AutomationRunStatus = 'passed' | 'failed';

export interface AutomationExpectedArtifact {
  path: string;
  required?: boolean;
}

export interface AutomationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface AutomationStepLog {
  name: string;
  status: AutomationRunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  command?: string;
  exitCode?: number | null;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationRunMetadata {
  branch: string;
  commit: string;
  dirtyFileCount: number;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
}

export interface AutomationRunLog {
  id: string;
  scriptName: string;
  mode: string;
  args: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: AutomationRunStatus;
  metadata: AutomationRunMetadata;
  expectedArtifacts: AutomationExpectedArtifact[];
  artifacts: Array<{ path: string; exists: boolean; required: boolean }>;
  steps: AutomationStepLog[];
  review?: AutomationReviewSummary;
  error?: string;
}

export interface AutomationReviewSuggestion {
  severity: 'info' | 'warning' | 'action';
  message: string;
}

export interface AutomationReviewSummary {
  scriptName: string;
  generatedAt: string;
  runCount: number;
  recentRunCount: number;
  recentFailureCount: number;
  averageDurationMs: number;
  slowestStepName: string | null;
  suggestions: AutomationReviewSuggestion[];
  monthlyReviewPath?: string;
  monthlyPromptPath?: string;
  monthlySuggestionsPath?: string;
  monthlyReview?: AutomationReviewArtifacts;
  advisorReviewPath?: string;
  monthlyReviewGenerated: boolean;
}

export type AutomationSuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'implemented'
  | 'superseded';

export type AutomationSuggestionOutcomeResult =
  | 'unknown'
  | 'improved'
  | 'no_change'
  | 'worse'
  | 'not_measured';

export interface AutomationSuggestionOutcome {
  result: AutomationSuggestionOutcomeResult;
  measuredAt?: string;
  beforeAvgMs?: number;
  afterAvgMs?: number;
  notes?: string;
}

export interface AutomationMemorySuggestion {
  id: string;
  scriptName: string;
  title: string;
  reason: string;
  evidence: string[];
  createdMonth: string;
  lastSeenMonth: string;
  status: AutomationSuggestionStatus;
  statusReason?: string;
  decisionAt?: string;
  decisionReason?: string;
  planPath?: string;
  implementedAt?: string;
  outcome?: AutomationSuggestionOutcome;
  source: 'deterministic' | 'advisor';
}

export interface AutomationReviewPrompt {
  month: string;
  path?: string;
  focusAreas: string[];
  deprioritizedAreas: string[];
  prompt: string;
}

export interface AutomationMonthlyMetrics {
  scriptName: string;
  month: string;
  generatedAt: string;
  runCount: number;
  failureCount: number;
  averageDurationMs: number;
  modeCounts: Record<string, number>;
  finalise?: {
    fullTestRuns: number;
    buildAverageMs: number;
    migrationRuns: number;
    dbValidateRuns: number;
    commitCommandCount: number;
    pushCommandCount: number;
  };
  fixerrors?: {
    totalFetched: number;
    totalFiltered: number;
    totalGrouped: number;
    fetchLimitHitCount: number;
    highFilteredRuns: number;
    untriagedCount: number;
    staleCount: number;
    repeatedPatternCount: number;
    repeatedSourceFileCount: number;
  };
}

export interface AutomationMemory {
  version: string;
  scriptName: string;
  updatedAt: string;
  suggestions: AutomationMemorySuggestion[];
  prompts: AutomationReviewPrompt[];
  monthlyMetrics: AutomationMonthlyMetrics[];
}

export interface AutomationReviewArtifacts {
  monthKey: string;
  reviewPath: string;
  promptPath: string;
  metricsPath: string;
  suggestionsPath: string;
  suggestions: AutomationMemorySuggestion[];
  knowledgeDirectory: string;
  advisorReviewPath?: string;
}
