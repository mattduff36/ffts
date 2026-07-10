import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateFleetInspectionReminderActions,
  hasOpenFleetInspectionActionsWithStaleInspectionMetadata,
  type FleetInspectionGenerationSummary,
} from './generate-fleet-inspection-actions';
import { loadFleetInspectionWorkflowSettings } from './fleet-inspection-workflow-settings';

export const ACTIONS_PAGE_FLEET_INSPECTION_REFRESH_INTERVAL_MS = 0;
export const DASHBOARD_FLEET_INSPECTION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export interface FleetInspectionFreshnessResult {
  refreshed: boolean;
  reason: 'disabled' | 'fresh' | 'stale' | 'never_generated';
  lastGeneratedAt: string | null;
  summary: FleetInspectionGenerationSummary | null;
}

let fleetInspectionRefreshInFlight: Promise<FleetInspectionFreshnessResult> | null = null;

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export async function ensureFleetInspectionReminderActionsFresh(params: {
  staleAfterMs: number;
  now?: Date;
}): Promise<FleetInspectionFreshnessResult> {
  if (fleetInspectionRefreshInFlight) {
    return fleetInspectionRefreshInFlight;
  }

  fleetInspectionRefreshInFlight = ensureFleetInspectionReminderActionsFreshInternal(params).finally(() => {
    fleetInspectionRefreshInFlight = null;
  });

  return fleetInspectionRefreshInFlight;
}

async function ensureFleetInspectionReminderActionsFreshInternal(params: {
  staleAfterMs: number;
  now?: Date;
}): Promise<FleetInspectionFreshnessResult> {
  const admin = createAdminClient();
  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const settings = await loadFleetInspectionWorkflowSettings(admin);

  if (!settings.is_enabled) {
    return {
      refreshed: false,
      reason: 'disabled',
      lastGeneratedAt: settings.last_generated_at,
      summary: null,
    };
  }

  const lastGeneratedAt = settings.last_generated_at;
  const lastGeneratedDate = lastGeneratedAt ? new Date(lastGeneratedAt) : null;
  const hasFreshGeneration = params.staleAfterMs > 0 && Boolean(
    lastGeneratedDate &&
      isValidDate(lastGeneratedDate) &&
      now.getTime() - lastGeneratedDate.getTime() < params.staleAfterMs,
  );

  if (hasFreshGeneration) {
    const hasStaleInspectionMetadata = await hasOpenFleetInspectionActionsWithStaleInspectionMetadata(admin, {
      thresholdDays: settings.config.overdue_days_threshold,
      today: now,
    });

    if (!hasStaleInspectionMetadata) {
      return {
        refreshed: false,
        reason: 'fresh',
        lastGeneratedAt,
        summary: null,
      };
    }
  }

  const summary = await generateFleetInspectionReminderActions({ admin, nowIso });

  return {
    refreshed: true,
    reason: lastGeneratedAt ? 'stale' : 'never_generated',
    lastGeneratedAt,
    summary,
  };
}
