import {
  buildInspectionDefectSignature,
  extractInspectionDefectSignature,
} from '@/lib/utils/inspectionDefectSignature';

export interface PreviousInspectionItem {
  item_number: number;
  item_description: string;
  status: string;
  day_of_week: number;
}

export interface PreviousDefectSummary {
  item_number: number;
  item_description: string;
  days: number[];
}

export interface CompletedPreviousDefectTask {
  description?: string | null;
  actioned_at?: string | null;
  updated_at?: string | null;
  completedAt?: string | null;
}

type CompletedPreviousDefectReference = string | null | undefined | CompletedPreviousDefectTask;

interface BuildUnresolvedPreviousDefectsOptions {
  inspectionStartDate?: string | null;
}

function getCompletedTaskSignature(task: CompletedPreviousDefectReference): string | null {
  if (typeof task === 'string' || task == null) {
    return extractInspectionDefectSignature(task);
  }

  return extractInspectionDefectSignature(task.description);
}

function getCompletedTaskTimestamp(task: CompletedPreviousDefectReference): string | null {
  if (typeof task === 'string' || task == null) {
    return null;
  }

  return task.completedAt || task.actioned_at || task.updated_at || null;
}

function getInspectionItemDateMs(
  inspectionStartDate: string | null | undefined,
  dayOfWeek: number
): number | null {
  if (!inspectionStartDate || dayOfWeek < 1) {
    return null;
  }

  const inspectionStartDateMs = new Date(`${inspectionStartDate}T00:00:00.000Z`).getTime();
  if (Number.isNaN(inspectionStartDateMs)) {
    return null;
  }

  return inspectionStartDateMs + (dayOfWeek - 1) * 24 * 60 * 60 * 1000;
}

export function buildUnresolvedPreviousDefects(
  items: PreviousInspectionItem[],
  completedTasks: CompletedPreviousDefectReference[],
  options: BuildUnresolvedPreviousDefectsOptions = {}
): Map<string, PreviousDefectSummary> {
  const latestCompletionBySignature = new Map<string, number | null>();

  completedTasks.forEach((task) => {
    const signature = getCompletedTaskSignature(task);
    if (!signature) {
      return;
    }

    const completedAt = getCompletedTaskTimestamp(task);
    const completedAtMs = completedAt ? new Date(completedAt).getTime() : null;
    const normalizedCompletedAtMs =
      completedAtMs !== null && !Number.isNaN(completedAtMs) ? completedAtMs : null;
    const existingCompletedAtMs = latestCompletionBySignature.get(signature);

    if (
      existingCompletedAtMs === undefined ||
      existingCompletedAtMs === null ||
      (normalizedCompletedAtMs !== null && normalizedCompletedAtMs > existingCompletedAtMs)
    ) {
      latestCompletionBySignature.set(signature, normalizedCompletedAtMs);
    }
  });

  const defectsMap = new Map<string, PreviousDefectSummary>();

  items.forEach((item) => {
    if (item.status !== 'attention') {
      return;
    }

    const defectKey = `${item.item_number}-${item.item_description}`;
    const defectSignature = buildInspectionDefectSignature(item);
    const latestCompletedAtMs = latestCompletionBySignature.get(defectSignature);
    const itemDateMs = getInspectionItemDateMs(options.inspectionStartDate, item.day_of_week);
    const isResolvedByCompletedTask =
      latestCompletedAtMs !== undefined &&
      (itemDateMs === null || (latestCompletedAtMs !== null && latestCompletedAtMs >= itemDateMs));

    if (isResolvedByCompletedTask) {
      return;
    }

    if (!defectsMap.has(defectKey)) {
      defectsMap.set(defectKey, {
        item_number: item.item_number,
        item_description: item.item_description,
        days: [],
      });
    }

    const defectEntry = defectsMap.get(defectKey);
    if (defectEntry) {
      defectEntry.days.push(item.day_of_week);
    }
  });

  return defectsMap;
}
