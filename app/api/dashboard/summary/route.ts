import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { ALL_MODULES, createEmptyModulePermissionRecord } from '@/types/roles';
import { getPermissionMapForUser } from '@/lib/server/team-permissions';
import type { Database } from '@/types/database';
import {
  calculateAlertCounts,
  getDateBasedStatus,
  getHoursBasedStatus,
  getMileageBasedStatus,
} from '@/lib/utils/maintenanceCalculations';
import {
  MAINTENANCE_CATEGORY_NAMES,
  createMaintenanceCategoryMap,
  getMaintenanceCategory,
  getVisibleMaintenanceStatuses,
  type MaintenanceCategoryConfig,
  type MaintenanceCategoryMap,
} from '@/lib/utils/maintenanceCategoryRules';
import { getDashboardApprovalsMetrics } from '@/lib/server/dashboard-approvals';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import {
  DASHBOARD_FLEET_INSPECTION_REFRESH_INTERVAL_MS,
  ensureFleetInspectionReminderActionsFresh,
} from '@/lib/server/reminders/ensure-fleet-inspection-actions-fresh';
import { DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL } from '@/lib/utils/error-log-filters';

type PermissionMap = Record<(typeof ALL_MODULES)[number], boolean>;

type MaintenanceRow = {
  current_mileage: number | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  next_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  first_aid_kit_expiry: string | null;
  six_weekly_inspection_due_date: string | null;
  fire_extinguisher_due_date: string | null;
  taco_calibration_due_date: string | null;
  current_hours: number | null;
  next_service_hours: number | null;
};

interface MaintenanceCounts {
  attentionTotal: number;
  dueSoonTotal: number;
  overdueTotal: number;
}

interface SuggestionBadgeMetrics {
  newCount: number;
  awaitingAdminReplyCount: number;
}

interface CountMetricResult {
  count: number | null;
  error: unknown;
}

type ReminderActionSummaryRow = Pick<
  Database['public']['Tables']['reminder_actions']['Row'],
  'id' | 'ignored_forever' | 'ignored_until'
> & {
  reminders?: Array<Pick<Database['public']['Tables']['reminders']['Row'], 'status'>> | null;
};

async function resolveCountMetric(
  label: string,
  promise: PromiseLike<CountMetricResult>
): Promise<{ count: number; error: null }> {
  try {
    const result = await promise;
    if (result.error) {
      console.error(`Failed to load ${label} dashboard metric:`, result.error);
      return { count: 0, error: null };
    }

    return { count: result.count || 0, error: null };
  } catch (error) {
    console.error(`Failed to load ${label} dashboard metric:`, error);
    return { count: 0, error: null };
  }
}

async function resolveMetricValue<T>(label: string, promise: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`Failed to load ${label} dashboard metric:`, error);
    return fallback;
  }
}

function isReminderActionIgnoredNow(action: ReminderActionSummaryRow, nowIso: string): boolean {
  return action.ignored_forever || Boolean(action.ignored_until && action.ignored_until > nowIso);
}

function isUnassignedReminderAction(action: ReminderActionSummaryRow, nowIso: string): boolean {
  if (isReminderActionIgnoredNow(action, nowIso)) {
    return false;
  }

  const reminders = action.reminders || [];
  return reminders.every((reminder) => reminder.status !== 'pending' && reminder.status !== 'actioned');
}

async function getUnassignedReminderActionsCount(admin: SupabaseClient<Database>): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('reminder_actions')
    .select(`
      id,
      ignored_forever,
      ignored_until,
      reminders (
        status
      )
    `)
    .eq('status', 'open');

  if (error) {
    throw error;
  }

  return ((data || []) as ReminderActionSummaryRow[]).filter((action) =>
    isUnassignedReminderAction(action, nowIso)
  ).length;
}

function createFullAccessPermissionMap(): PermissionMap {
  return ALL_MODULES.reduce<PermissionMap>((acc, moduleName) => {
    acc[moduleName] = true;
    return acc;
  }, createEmptyModulePermissionRecord() as PermissionMap);
}

function getThresholds(categoryMap: MaintenanceCategoryMap) {
  const getDays = (name: string, fallback: number) =>
    Number(getMaintenanceCategory(categoryMap, name)?.alert_threshold_days ?? fallback);
  const getMiles = (name: string, fallback: number) =>
    Number(getMaintenanceCategory(categoryMap, name)?.alert_threshold_miles ?? fallback);
  const getHours = (name: string, fallback: number) =>
    Number(getMaintenanceCategory(categoryMap, name)?.alert_threshold_hours ?? fallback);

  return {
    taxThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.tax, 30),
    motThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.mot, 30),
    serviceThreshold: getMiles(MAINTENANCE_CATEGORY_NAMES.service, 1000),
    cambeltThreshold: getMiles(MAINTENANCE_CATEGORY_NAMES.cambelt, 5000),
    firstAidThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.firstAid, 30),
    sixWeeklyThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.sixWeekly, 7),
    fireExtinguisherThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.fireExtinguisher, 30),
    tacoCalibrationThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.tacoCalibration, 60),
    lolerThreshold: getDays(MAINTENANCE_CATEGORY_NAMES.loler, 30),
    serviceHoursThreshold: getHours(MAINTENANCE_CATEGORY_NAMES.serviceHours, 50),
  };
}

function getMaintenanceCountsForAsset(params: {
  assetType: 'van' | 'hgv' | 'plant';
  maintenance: MaintenanceRow | null;
  lolerDueDate?: string | null;
  thresholds: ReturnType<typeof getThresholds>;
  categoryMap: MaintenanceCategoryMap;
}): MaintenanceCounts {
  const lolerStatus = params.assetType === 'plant'
    ? getDateBasedStatus(params.lolerDueDate || null, params.thresholds.lolerThreshold)
    : { status: 'not_set' as const };

  if (!params.maintenance) {
    const counts = params.assetType === 'plant'
      ? calculateAlertCounts(getVisibleMaintenanceStatuses(params.assetType, params.categoryMap, [
          { categoryName: MAINTENANCE_CATEGORY_NAMES.loler, status: lolerStatus },
        ]))
      : { overdue: 0, due_soon: 0 };
    return {
      attentionTotal: counts.overdue + counts.due_soon,
      dueSoonTotal: counts.due_soon,
      overdueTotal: counts.overdue,
    };
  }

  const taxStatus = getDateBasedStatus(params.maintenance.tax_due_date, params.thresholds.taxThreshold);
  const motStatus = getDateBasedStatus(params.maintenance.mot_due_date, params.thresholds.motThreshold);
  const serviceStatus = getMileageBasedStatus(
      params.maintenance.current_mileage,
      params.maintenance.next_service_mileage,
      params.thresholds.serviceThreshold
    );
  const cambeltStatus = getMileageBasedStatus(
      params.maintenance.current_mileage,
      params.maintenance.cambelt_due_mileage,
      params.thresholds.cambeltThreshold
    );
  const firstAidStatus = getDateBasedStatus(params.maintenance.first_aid_kit_expiry, params.thresholds.firstAidThreshold);
  const sixWeeklyStatus = getDateBasedStatus(
      params.maintenance.six_weekly_inspection_due_date,
      params.thresholds.sixWeeklyThreshold
    );
  const fireExtinguisherStatus = getDateBasedStatus(
      params.maintenance.fire_extinguisher_due_date,
      params.thresholds.fireExtinguisherThreshold
    );
  const tacoCalibrationStatus = getDateBasedStatus(
      params.maintenance.taco_calibration_due_date,
      params.thresholds.tacoCalibrationThreshold
    );
  const serviceHoursStatus = params.assetType === 'plant'
      ? getHoursBasedStatus(
          params.maintenance.current_hours,
          params.maintenance.next_service_hours,
          params.thresholds.serviceHoursThreshold
        )
      : { status: 'not_set' as const };

  const counts = calculateAlertCounts(getVisibleMaintenanceStatuses(params.assetType, params.categoryMap, [
    { categoryName: MAINTENANCE_CATEGORY_NAMES.tax, status: taxStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.mot, status: motStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.service, status: serviceStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.cambelt, status: cambeltStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.firstAid, status: firstAidStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.sixWeekly, status: sixWeeklyStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.fireExtinguisher, status: fireExtinguisherStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.tacoCalibration, status: tacoCalibrationStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.loler, status: lolerStatus },
    { categoryName: MAINTENANCE_CATEGORY_NAMES.serviceHours, status: serviceHoursStatus },
  ]));
  return {
    attentionTotal: counts.overdue + counts.due_soon,
    dueSoonTotal: counts.due_soon,
    overdueTotal: counts.overdue,
  };
}

async function getMaintenanceCounts(): Promise<MaintenanceCounts> {
  const supabase = createAdminClient();
  const [{ data: categories, error: categoriesError }, vansResult, hgvsResult, plantResult] = await Promise.all([
    supabase
      .from('maintenance_categories')
      .select('name, alert_threshold_days, alert_threshold_miles, alert_threshold_hours, applies_to, is_active, show_on_overview'),
    supabase
      .from('vans')
      .select(`
        id,
        maintenance:vehicle_maintenance!van_id(
          current_mileage,
          tax_due_date,
          mot_due_date,
          next_service_mileage,
          cambelt_due_mileage,
          first_aid_kit_expiry,
          six_weekly_inspection_due_date,
          fire_extinguisher_due_date,
          taco_calibration_due_date,
          current_hours,
          next_service_hours
        )
      `)
      .eq('status', 'active'),
    supabase
      .from('hgvs')
      .select(`
        id,
        maintenance:vehicle_maintenance!hgv_id(
          current_mileage,
          tax_due_date,
          mot_due_date,
          next_service_mileage,
          cambelt_due_mileage,
          first_aid_kit_expiry,
          six_weekly_inspection_due_date,
          fire_extinguisher_due_date,
          taco_calibration_due_date,
          current_hours,
          next_service_hours
        )
      `)
      .eq('status', 'active'),
    supabase
      .from('plant')
      .select(`
        id,
        loler_due_date,
        maintenance:vehicle_maintenance!plant_id(
          current_mileage,
          tax_due_date,
          mot_due_date,
          next_service_mileage,
          cambelt_due_mileage,
          first_aid_kit_expiry,
          six_weekly_inspection_due_date,
          fire_extinguisher_due_date,
          taco_calibration_due_date,
          current_hours,
          next_service_hours
        )
      `)
      .eq('status', 'active'),
  ]);

  if (categoriesError) throw categoriesError;
  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;

  const categoryMap = createMaintenanceCategoryMap((categories || []) as MaintenanceCategoryConfig[]);
  const thresholds = getThresholds(categoryMap);
  const totals: MaintenanceCounts = {
    attentionTotal: 0,
    dueSoonTotal: 0,
    overdueTotal: 0,
  };

  (vansResult.data || []).forEach((row) => {
    const counts = getMaintenanceCountsForAsset({
      assetType: 'van',
      maintenance: (Array.isArray(row.maintenance) ? row.maintenance[0] : row.maintenance) as MaintenanceRow | null,
      thresholds,
      categoryMap,
    });
    totals.attentionTotal += counts.attentionTotal;
    totals.dueSoonTotal += counts.dueSoonTotal;
    totals.overdueTotal += counts.overdueTotal;
  });

  (hgvsResult.data || []).forEach((row) => {
    const counts = getMaintenanceCountsForAsset({
      assetType: 'hgv',
      maintenance: (Array.isArray(row.maintenance) ? row.maintenance[0] : row.maintenance) as MaintenanceRow | null,
      thresholds,
      categoryMap,
    });
    totals.attentionTotal += counts.attentionTotal;
    totals.dueSoonTotal += counts.dueSoonTotal;
    totals.overdueTotal += counts.overdueTotal;
  });

  (plantResult.data || []).forEach((row) => {
    const counts = getMaintenanceCountsForAsset({
      assetType: 'plant',
      maintenance: (Array.isArray(row.maintenance) ? row.maintenance[0] : row.maintenance) as MaintenanceRow | null,
      lolerDueDate: row.loler_due_date,
      thresholds,
      categoryMap,
    });
    totals.attentionTotal += counts.attentionTotal;
    totals.dueSoonTotal += counts.dueSoonTotal;
    totals.overdueTotal += counts.overdueTotal;
  });

  return totals;
}

async function getSuggestionBadgeMetrics(supabase: SupabaseClient<Database>): Promise<SuggestionBadgeMetrics> {
  const [{ data: suggestions, error: suggestionsError }, { data: updates, error: updatesError }] = await Promise.all([
    supabase.from('suggestions').select('id, created_by, status'),
    supabase.from('suggestion_updates').select('suggestion_id, created_by, created_at').order('created_at', { ascending: false }),
  ]);

  if (suggestionsError) throw suggestionsError;
  if (updatesError) throw updatesError;

  const latestUpdateBySuggestionId = new Map<string, { created_by: string | null }>();
  for (const update of updates || []) {
    if (!latestUpdateBySuggestionId.has(update.suggestion_id)) {
      latestUpdateBySuggestionId.set(update.suggestion_id, { created_by: update.created_by });
    }
  }

  let newCount = 0;
  let awaitingAdminReplyCount = 0;

  for (const suggestion of suggestions || []) {
    if (suggestion.status === 'new') {
      newCount += 1;
      continue;
    }

    const latestUpdate = latestUpdateBySuggestionId.get(suggestion.id);
    if (latestUpdate?.created_by && latestUpdate.created_by === suggestion.created_by) {
      awaitingAdminReplyCount += 1;
    }
  }

  return {
    newCount,
    awaitingAdminReplyCount,
  };
}

export async function GET() {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = current.profile.id;
  const supabase = await createClient();
  const admin = createAdminClient();
  const effectiveRole = await getEffectiveRole();
  const permissions =
    hasEffectiveRoleFullAccess(effectiveRole)
      ? createFullAccessPermissionMap()
      : await getPermissionMapForUser(userId, effectiveRole.role_id, admin, effectiveRole.team_id, {
        includeUserOverrides: effectiveRole.is_viewing_as !== true,
      });

  const canViewApprovals = permissions.approvals;
  const canViewActions = permissions.actions;
  const canViewWorkshopTasks = permissions['workshop-tasks'];
  const canViewMaintenance = permissions.maintenance;
  const canViewReminders = permissions.reminders;
  const canViewSuggestions = permissions.suggestions;
  const canViewErrorReports = permissions['error-reports'];
  const canViewQuotes = permissions.quotes;
  const canAccessDebugTools = canAccessDebugConsole({
    email: current.profile.email,
    isActualSuperAdmin: effectiveRole.is_actual_super_admin,
    isViewingAs: effectiveRole.is_viewing_as,
  });

  if (canViewActions) {
    await resolveMetricValue(
      'fleet inspection action refresh',
      ensureFleetInspectionReminderActionsFresh({
        staleAfterMs: DASHBOARD_FLEET_INSPECTION_REFRESH_INTERVAL_MS,
      }),
      null,
    );
  }

  const [
    approvalsMetrics,
    workshopPendingResult,
    suggestionBadgeMetrics,
    errorsNewResult,
    quotesResult,
    errorLogsResult,
    maintenanceCounts,
    remindersPendingResult,
    actionsUnassignedCount,
  ] = await Promise.all([
    canViewApprovals
      ? resolveMetricValue(
          'approvals metrics',
          getDashboardApprovalsMetrics({
            supabase: admin,
            actorProfileId: userId,
            effectiveRole,
          }),
          {
            summaryTimesheets: 0,
            summaryAbsences: 0,
            tileTotal: 0,
          }
        )
      : Promise.resolve({
          summaryTimesheets: 0,
          summaryAbsences: 0,
          tileTotal: 0,
        }),
    canViewWorkshopTasks
      ? resolveCountMetric(
          'pending workshop actions',
          supabase
            .from('actions')
            .select('id', { count: 'exact', head: true })
            .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
            .eq('status', 'pending')
        )
      : Promise.resolve({ count: 0, error: null }),
    canViewSuggestions
      ? resolveMetricValue(
          'suggestion badges',
          getSuggestionBadgeMetrics(supabase),
          { newCount: 0, awaitingAdminReplyCount: 0 }
        )
      : Promise.resolve({ newCount: 0, awaitingAdminReplyCount: 0 }),
    canViewErrorReports
      ? resolveCountMetric(
          'new error reports',
          supabase.from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'new')
        )
      : Promise.resolve({ count: 0, error: null }),
    canViewQuotes
      ? resolveCountMetric(
          'pending quotes',
          supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'pending_internal_approval')
        )
      : Promise.resolve({ count: 0, error: null }),
    canAccessDebugTools
      ? resolveCountMetric(
          'error logs',
          supabase
            .from('error_logs')
            .select('id', { count: 'exact', head: true })
            .or('page_url.is.null,page_url.not.ilike.%localhost%')
            .or(`user_email.is.null,user_email.neq.${DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL}`)
        )
      : Promise.resolve({ count: 0, error: null }),
    canViewMaintenance
      ? resolveMetricValue(
          'maintenance totals',
          getMaintenanceCounts(),
          {
            attentionTotal: 0,
            dueSoonTotal: 0,
            overdueTotal: 0,
          }
        )
      : Promise.resolve({
          attentionTotal: 0,
          dueSoonTotal: 0,
          overdueTotal: 0,
        }),
    canViewReminders
      ? resolveCountMetric(
          'pending reminders',
          supabase
            .from('reminders')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', userId)
            .eq('status', 'pending')
        )
      : Promise.resolve({ count: 0, error: null }),
    canViewActions
      ? resolveMetricValue(
          'unassigned action reminders',
          getUnassignedReminderActionsCount(admin),
          0
        )
      : Promise.resolve(0),
  ]);

  return NextResponse.json({
    success: true,
    metrics: {
      approvals: {
        timesheets: approvalsMetrics.summaryTimesheets,
        absences: approvalsMetrics.summaryAbsences,
      },
      badges: {
        approvals: approvalsMetrics.tileTotal,
        workshop_pending: workshopPendingResult.count || 0,
        maintenance_due_soon: maintenanceCounts.dueSoonTotal,
        maintenance_overdue: maintenanceCounts.overdueTotal,
        reminders_pending: remindersPendingResult.count || 0,
        actions_unassigned: actionsUnassignedCount,
        suggestions_new: suggestionBadgeMetrics.newCount + suggestionBadgeMetrics.awaitingAdminReplyCount,
        error_reports_new: errorsNewResult.count || 0,
        quotes_pending_internal_approval: quotesResult.count || 0,
        error_logs: errorLogsResult.count || 0,
      },
    },
  });
}
