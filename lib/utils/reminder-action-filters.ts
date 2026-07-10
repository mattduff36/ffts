import type { ReminderActionWithAsset } from '@/types/reminders';

export type ReminderAssignmentFilter = 'all' | 'unassigned' | 'has_pending' | 'fully_actioned';

export interface ReminderActionFilterState {
  search: string;
  assignment: ReminderAssignmentFilter;
}

export function getReminderAssignmentFilterValue(action: ReminderActionWithAsset): Exclude<ReminderAssignmentFilter, 'all'> {
  if (action.reminders_count.actioned > 0 && !action.ignored_at) {
    return 'fully_actioned';
  }

  if (action.reminders_count.pending > 0) {
    return 'has_pending';
  }

  return 'unassigned';
}

export function isReminderActionActioned(action: ReminderActionWithAsset): boolean {
  return getReminderAssignmentFilterValue(action) === 'fully_actioned';
}

export function isReminderActionActive(action: ReminderActionWithAsset): boolean {
  return !isReminderActionActioned(action);
}

export function getReminderActionSearchHaystack(action: ReminderActionWithAsset): string {
  return [
    action.asset_label || '',
    action.title,
    action.description || '',
  ]
    .join(' ')
    .toLowerCase();
}

export function matchesReminderActionSearch(action: ReminderActionWithAsset, search: string): boolean {
  const normalizedQuery = search.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return getReminderActionSearchHaystack(action).includes(normalizedQuery);
}

export function matchesReminderActionAssignment(
  action: ReminderActionWithAsset,
  assignment: ReminderAssignmentFilter,
): boolean {
  if (assignment === 'all') {
    return true;
  }

  return getReminderAssignmentFilterValue(action) === assignment;
}

export function hasNeverSubmittedInspection(action: ReminderActionWithAsset): boolean {
  const lastSubmitted = action.metadata?.last_submitted_inspection_date;
  return typeof lastSubmitted !== 'string' || lastSubmitted.length === 0;
}

export function filterReminderActions(
  actions: ReminderActionWithAsset[],
  filters: ReminderActionFilterState,
): ReminderActionWithAsset[] {
  return actions.filter((action) => {
    if (!matchesReminderActionSearch(action, filters.search)) {
      return false;
    }

    if (!matchesReminderActionAssignment(action, filters.assignment)) {
      return false;
    }

    return true;
  });
}

export function buildReminderActionsQueryParams(params: {
  workflowKey: string;
  assetType?: string;
  ensureFresh?: boolean;
}): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set('workflow', params.workflowKey);
  searchParams.set('status', 'open');

  if (params.ensureFresh) {
    searchParams.set('ensure_fresh', 'true');
  }

  if (params.assetType) {
    searchParams.set('asset_type', params.assetType);
  }

  return searchParams;
}
