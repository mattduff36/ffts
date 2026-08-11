import { existsSync, readFileSync, renameSync } from 'fs';
import path from 'path';
import {
  runMonthlyAutomationFollowUp,
  type MonthlyFollowUpDecision,
  type PendingMonthlyFollowUp,
} from './monthly-follow-up';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  saveWorkflowReviewState,
  withWorkflowLock,
  WORKFLOW_SCRIPT_NAME,
} from './workflow-events';

interface ResolveOptions {
  pendingPath?: string;
  decisions: MonthlyFollowUpDecision[];
}

function parseDecision(value: string): MonthlyFollowUpDecision {
  const [suggestionId, actionValue] = value.split('=');
  const action = actionValue?.trim();
  if (!suggestionId || !['approve', 'reject', 'skip'].includes(action)) {
    throw new Error(`Invalid decision "${value}". Use suggestion-id=approve|reject|skip.`);
  }

  return {
    suggestionId: suggestionId.trim(),
    action: action as MonthlyFollowUpDecision['action'],
  };
}

function parseArgs(argv: string[]): ResolveOptions {
  const decisions: MonthlyFollowUpDecision[] = [];
  let pendingPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pending') {
      pendingPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--decision') {
      decisions.push(parseDecision(argv[index + 1] ?? ''));
      index += 1;
      continue;
    }
  }

  return { pendingPath, decisions };
}

function deriveRepoRootFromPendingPath(pendingPath: string): string {
  const absolute = path.resolve(pendingPath);
  const marker = `${path.sep}docs_private${path.sep}automation${path.sep}follow-ups${path.sep}`;
  const index = absolute.toLowerCase().indexOf(marker.toLowerCase());
  if (index >= 0) {
    return absolute.slice(0, index);
  }
  return process.cwd();
}

function loadPendingFollowUp(pendingPath: string): PendingMonthlyFollowUp {
  const parsed = JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingMonthlyFollowUp;
  const repoRoot = deriveRepoRootFromPendingPath(pendingPath);
  const resolveMaybeRelative = (candidate: string): string =>
    path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
  return {
    ...parsed,
    repoRoot,
    reviewPath: resolveMaybeRelative(parsed.reviewPath),
    suggestionsPath: resolveMaybeRelative(parsed.suggestionsPath),
    knowledgeDirectory: resolveMaybeRelative(parsed.knowledgeDirectory),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.pendingPath) {
    throw new Error('Missing --pending <path>');
  }
  if (options.decisions.length === 0) {
    throw new Error('Provide at least one --decision suggestion-id=approve|reject|skip');
  }

  const pending = loadPendingFollowUp(options.pendingPath);
  const decisionsById = new Map(options.decisions.map((decision) => [decision.suggestionId, decision]));

  const unknownDecisions = options.decisions.filter(
    (decision) => !pending.suggestions.some((suggestion) => suggestion.id === decision.suggestionId)
  );
  if (unknownDecisions.length > 0) {
    throw new Error(
      `Unknown suggestion id(s): ${unknownDecisions.map((decision) => decision.suggestionId).join(', ')}`
    );
  }

  const duplicateIds = options.decisions
    .map((decision) => decision.suggestionId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate decision id(s): ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const result = await runMonthlyAutomationFollowUp({
    scriptName: pending.scriptName,
    monthKey: pending.monthKey,
    reviewPath: pending.reviewPath,
    suggestionsPath: pending.suggestionsPath,
    suggestions: pending.suggestions,
    knowledgeDirectory: pending.knowledgeDirectory,
    repoRoot: pending.repoRoot,
    reviewWindowId: pending.reviewWindowId,
    sourceWorkstreamIds: pending.sourceWorkstreamIds,
    decisionProvider: (suggestion) => decisionsById.get(suggestion.id) ?? {
      suggestionId: suggestion.id,
      action: 'skip',
    },
  });

  if (options.pendingPath && existsSync(options.pendingPath)) {
    const resolvedPath = `${options.pendingPath}.resolved`;
    renameSync(options.pendingPath, resolvedPath);
  }

  if (pending.scriptName === WORKFLOW_SCRIPT_NAME) {
    const paths = getWorkflowPaths(pending.repoRoot);
    withWorkflowLock(paths.lockPath, () => {
      const state = loadWorkflowReviewState(paths.statePath);
      if (state.pendingFollowUpPath === options.pendingPath || !state.pendingFollowUpPath) {
        saveWorkflowReviewState(paths.statePath, {
          ...state,
          pendingFollowUpPath: null,
        });
      }
    });
  }

  if (result.planPath) {
    const relativePlan = path
      .relative(pending.repoRoot, result.planPath)
      .split(path.sep)
      .join('/');
    console.log(`Repository-local plan file: ${relativePlan}`);
    console.log(
      'Build this plan from the repository-local path. External Cursor plan copies are not written.'
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
