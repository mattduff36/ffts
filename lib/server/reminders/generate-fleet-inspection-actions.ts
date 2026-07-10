import { createAdminClient } from '@/lib/supabase/admin';
import { FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import {
  isFleetInspectionAssetTypeEnabled,
  loadFleetInspectionWorkflowSettings,
  type FleetInspectionWorkflowConfig,
  type ResolvedFleetInspectionWorkflowSettings,
} from '@/lib/server/reminders/fleet-inspection-workflow-settings';
import type { Database, Json } from '@/types/database';
import type {
  ReminderActionStatus,
  ReminderActionWithAsset,
  ReminderAssetType,
  ReminderPriority,
  ReminderStatus,
} from '@/types/reminders';

type AdminClient = ReturnType<typeof createAdminClient>;
type ReminderActionInsert = Database['public']['Tables']['reminder_actions']['Insert'];
type ReminderActionRow = Database['public']['Tables']['reminder_actions']['Row'];
type ReminderRow = Database['public']['Tables']['reminders']['Row'];

interface BaseAssetRow {
  id: string;
  nickname?: string | null;
}

interface VanAssetRow extends BaseAssetRow {
  reg_number?: string | null;
  current_mileage?: number | null;
}

interface PlantAssetRow extends BaseAssetRow {
  plant_id?: string | null;
  reg_number?: string | null;
  serial_number?: string | null;
  current_hours?: number | null;
}

interface OverdueAsset {
  assetId: string;
  assetType: ReminderAssetType;
  assetLabel: string;
  assetRoute: string;
  assetRegistration: string | null;
  assetPlantId: string | null;
  assetSerialNumber: string | null;
  assetNickname: string | null;
  assetCurrentMileage: number | null;
  assetCurrentHours: number | null;
  lastSubmittedAt: string | null;
  daysOverdue: number;
  dedupeKey: string;
  title: string;
  description: string;
  priority: ReminderPriority;
}

interface ReminderActionRowWithReminders extends ReminderActionRow {
  reminders?: Array<Pick<ReminderRow, 'id' | 'status'>> | null;
}

type OpenReminderActionRow = Pick<ReminderActionRow, 'id' | 'dedupe_key' | 'metadata'> & {
  reminders?: Array<Pick<ReminderRow, 'id' | 'status'>> | null;
};

type OpenReminderInspectionMetadataRow = Pick<
  ReminderActionRow,
  'asset_type' | 'van_id' | 'plant_id' | 'hgv_id' | 'metadata'
>;

export interface FleetInspectionGenerationSummary {
  inserted: number;
  updated: number;
  resolved: number;
  cancelledReminders: number;
  openCount: number;
}

export interface FleetInspectionGenerationOptions {
  admin?: AdminClient;
  nowIso?: string;
}

const REMINDER_WORKFLOW_KEY = FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY;
const INSPECTION_LOOKUP_PAGE_SIZE = 1000;

function getIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getDaysBetween(dateA: Date, dateB: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((dateA.getTime() - dateB.getTime()) / msPerDay);
}

function getReminderActionStatusCounts(reminders: Array<Pick<ReminderRow, 'status'>>): ReminderActionWithAsset['reminders_count'] {
  return reminders.reduce(
    (counts, reminder) => {
      counts.total += 1;
      if (reminder.status === 'pending') counts.pending += 1;
      if (reminder.status === 'actioned') counts.actioned += 1;
      if (reminder.status === 'cancelled') counts.cancelled += 1;
      return counts;
    },
    {
      total: 0,
      pending: 0,
      actioned: 0,
      cancelled: 0,
    },
  );
}

function getJsonStringValue(metadata: Json | null | undefined, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

function buildVanLabel(row: VanAssetRow): string {
  const registration = row.reg_number?.trim() || 'Unknown Van';
  return row.nickname?.trim() ? `${registration} (${row.nickname.trim()})` : registration;
}

function buildPlantLabel(row: PlantAssetRow): string {
  const primary = row.plant_id?.trim() || row.reg_number?.trim() || 'Unknown Plant';
  return row.nickname?.trim() ? `${primary} (${row.nickname.trim()})` : primary;
}

function buildAssetRoute(assetType: ReminderAssetType, assetId: string): string {
  if (assetType === 'van') return `/fleet/vans/${assetId}/history`;
  if (assetType === 'hgv') return `/fleet/hgvs/${assetId}/history`;
  return `/fleet/plant/${assetId}/history`;
}

function buildActionDescription(params: {
  assetLabel: string;
  assetType: ReminderAssetType;
  lastSubmittedAt: string | null;
  daysOverdue: number;
}): string {
  const assetName = params.assetType === 'hgv' ? 'HGV' : params.assetType === 'plant' ? 'plant asset' : 'van';
  if (!params.lastSubmittedAt) {
    return `${params.assetLabel} has no submitted daily check on record. Assign a reminder so a user can complete an inspection for this ${assetName}.`;
  }

  return `${params.assetLabel} is overdue for a submitted daily check. The latest submitted inspection was ${params.daysOverdue} days ago on ${params.lastSubmittedAt}.`;
}

function buildOpenActionRecord(
  asset: OverdueAsset,
  nowIso: string,
  workflowSettings: FleetInspectionWorkflowConfig,
): ReminderActionInsert {
  return {
    workflow_key: REMINDER_WORKFLOW_KEY,
    source_type: 'system_generated',
    dedupe_key: asset.dedupeKey,
    status: 'open',
    priority: asset.priority,
    title: asset.title,
    description: asset.description,
    asset_type: asset.assetType,
    metadata: {
      asset_label: asset.assetLabel,
      asset_route: asset.assetRoute,
      asset_registration: asset.assetRegistration,
      asset_plant_id: asset.assetPlantId,
      asset_serial_number: asset.assetSerialNumber,
      asset_nickname: asset.assetNickname,
      asset_current_mileage: asset.assetCurrentMileage,
      asset_current_hours: asset.assetCurrentHours,
      days_overdue: asset.daysOverdue,
      last_submitted_inspection_date: asset.lastSubmittedAt,
      threshold_days: workflowSettings.overdue_days_threshold,
    },
    first_detected_at: nowIso,
    last_detected_at: nowIso,
    ...(asset.assetType === 'van' ? { van_id: asset.assetId } : {}),
    ...(asset.assetType === 'plant' ? { plant_id: asset.assetId } : {}),
    ...(asset.assetType === 'hgv' ? { hgv_id: asset.assetId } : {}),
  };
}

export async function loadLatestInspectionDates(
  admin: AdminClient,
  tableName: 'van_inspections' | 'plant_inspections' | 'hgv_inspections',
  assetKey: 'van_id' | 'plant_id' | 'hgv_id',
  assetIds: string[],
): Promise<Map<string, string>> {
  if (assetIds.length === 0) {
    return new Map<string, string>();
  }

  const latestByAsset = new Map<string, string>();
  let pageStart = 0;

  while (true) {
    const { data, error } = await admin
      .from(tableName)
      .select(`${assetKey}, inspection_date`)
      .eq('status', 'submitted')
      .in(assetKey, assetIds)
      .order(assetKey, { ascending: true })
      .order('inspection_date', { ascending: false })
      .range(pageStart, pageStart + INSPECTION_LOOKUP_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const rows = (data || []) as Array<Record<string, string | null>>;
    for (const row of rows) {
      const assetId = row[assetKey];
      if (!assetId || latestByAsset.has(assetId)) {
        continue;
      }

      const lastSubmittedAt = row.inspection_date;
      if (lastSubmittedAt) {
        latestByAsset.set(assetId, lastSubmittedAt);
      }
    }

    if (rows.length < INSPECTION_LOOKUP_PAGE_SIZE) {
      break;
    }

    pageStart += INSPECTION_LOOKUP_PAGE_SIZE;
  }

  return latestByAsset;
}

function getActionAssetId(action: OpenReminderInspectionMetadataRow): string | null {
  if (action.asset_type === 'van') return action.van_id;
  if (action.asset_type === 'plant') return action.plant_id;
  if (action.asset_type === 'hgv') return action.hgv_id;
  return null;
}

export async function hasOpenFleetInspectionActionsWithStaleInspectionMetadata(
  admin: AdminClient,
  params: {
    thresholdDays: number;
    today: Date;
  },
): Promise<boolean> {
  const { data, error } = await admin
    .from('reminder_actions')
    .select('asset_type, van_id, plant_id, hgv_id, metadata')
    .eq('workflow_key', REMINDER_WORKFLOW_KEY)
    .eq('status', 'open');

  if (error) {
    throw error;
  }

  const actions = (data || []) as OpenReminderInspectionMetadataRow[];
  const assetIdsByType = actions.reduce(
    (accumulator, action) => {
      const assetId = getActionAssetId(action);
      if (assetId && (action.asset_type === 'van' || action.asset_type === 'plant' || action.asset_type === 'hgv')) {
        accumulator[action.asset_type].add(assetId);
      }
      return accumulator;
    },
    {
      van: new Set<string>(),
      plant: new Set<string>(),
      hgv: new Set<string>(),
    },
  );

  const [vanLatest, plantLatest, hgvLatest] = await Promise.all([
    loadLatestInspectionDates(admin, 'van_inspections', 'van_id', Array.from(assetIdsByType.van)),
    loadLatestInspectionDates(admin, 'plant_inspections', 'plant_id', Array.from(assetIdsByType.plant)),
    loadLatestInspectionDates(admin, 'hgv_inspections', 'hgv_id', Array.from(assetIdsByType.hgv)),
  ]);

  for (const action of actions) {
    const assetId = getActionAssetId(action);
    if (!assetId) {
      continue;
    }

    const latestByAsset = action.asset_type === 'van'
      ? vanLatest
      : action.asset_type === 'plant'
        ? plantLatest
        : hgvLatest;
    const latestSubmittedAt = latestByAsset.get(assetId);
    if (!latestSubmittedAt) {
      continue;
    }

    const latestSubmittedDate = new Date(latestSubmittedAt);
    const normalizedLatestSubmittedAt = Number.isNaN(latestSubmittedDate.getTime())
      ? latestSubmittedAt
      : getIsoDateOnly(latestSubmittedDate);
    const previousLastSubmittedAt = getJsonStringValue(action.metadata, 'last_submitted_inspection_date');
    const daysOverdue = Number.isNaN(latestSubmittedDate.getTime())
      ? params.thresholdDays
      : getDaysBetween(params.today, latestSubmittedDate);

    if (previousLastSubmittedAt !== normalizedLatestSubmittedAt || daysOverdue < params.thresholdDays) {
      return true;
    }
  }

  return false;
}

async function loadOverdueAssets(
  admin: AdminClient,
  workflowSettings: ResolvedFleetInspectionWorkflowSettings,
  today = new Date(),
): Promise<OverdueAsset[]> {
  if (!workflowSettings.is_enabled) {
    return [];
  }

  const thresholdDays = workflowSettings.config.overdue_days_threshold;
  const includeVan = isFleetInspectionAssetTypeEnabled(workflowSettings.config, 'van');
  const includePlant = isFleetInspectionAssetTypeEnabled(workflowSettings.config, 'plant');
  const includeHgv = isFleetInspectionAssetTypeEnabled(workflowSettings.config, 'hgv');

  const [vansResult, hgvsResult, plantResult] = await Promise.all([
    includeVan
      ? admin.from('vans').select('id, reg_number, nickname').eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    includeHgv
      ? admin.from('hgvs').select('id, reg_number, nickname, current_mileage').eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    includePlant
      ? admin.from('plant').select('id, plant_id, reg_number, nickname, serial_number, current_hours').eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;

  const vanRows = (vansResult.data || []) as VanAssetRow[];
  const hgvRows = (hgvsResult.data || []) as VanAssetRow[];
  const plantRows = (plantResult.data || []) as PlantAssetRow[];

  const [vanLatest, hgvLatest, plantLatest, vanMileageRows] = await Promise.all([
    includeVan
      ? loadLatestInspectionDates(admin, 'van_inspections', 'van_id', vanRows.map((row) => row.id))
      : Promise.resolve(new Map<string, string>()),
    includeHgv
      ? loadLatestInspectionDates(admin, 'hgv_inspections', 'hgv_id', hgvRows.map((row) => row.id))
      : Promise.resolve(new Map<string, string>()),
    includePlant
      ? loadLatestInspectionDates(admin, 'plant_inspections', 'plant_id', plantRows.map((row) => row.id))
      : Promise.resolve(new Map<string, string>()),
    includeVan && vanRows.length > 0
      ? admin
        .from('vehicle_maintenance')
        .select('van_id, current_mileage')
        .in('van_id', vanRows.map((row) => row.id))
        .order('updated_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vanMileageRows.error) throw vanMileageRows.error;

  const vanMileageByAssetId = new Map<string, number | null>();
  for (const row of (vanMileageRows.data || []) as Array<{ van_id: string | null; current_mileage: number | null }>) {
    if (row.van_id && !vanMileageByAssetId.has(row.van_id)) {
      vanMileageByAssetId.set(row.van_id, row.current_mileage);
    }
  }

  function mapAssetRow(
    assetType: ReminderAssetType,
    row: VanAssetRow | PlantAssetRow,
    lastSubmittedAt: string | null,
  ): OverdueAsset | null {
    const lastSubmittedDate = lastSubmittedAt ? new Date(lastSubmittedAt) : null;
    const daysOverdue = lastSubmittedDate ? getDaysBetween(today, lastSubmittedDate) : thresholdDays;

    if (lastSubmittedDate && daysOverdue < thresholdDays) {
      return null;
    }

    const assetLabel = assetType === 'plant' ? buildPlantLabel(row as PlantAssetRow) : buildVanLabel(row as VanAssetRow);
    const assetRoute = buildAssetRoute(assetType, row.id);
    const normalizedLastSubmittedAt = lastSubmittedAt ? getIsoDateOnly(lastSubmittedDate!) : null;
    const plantRow = row as PlantAssetRow;
    const vehicleRow = row as VanAssetRow;

    return {
      assetId: row.id,
      assetType,
      assetLabel,
      assetRoute,
      assetRegistration: assetType === 'plant' ? plantRow.reg_number?.trim() || null : vehicleRow.reg_number?.trim() || null,
      assetPlantId: assetType === 'plant' ? plantRow.plant_id?.trim() || null : null,
      assetSerialNumber: assetType === 'plant' ? plantRow.serial_number?.trim() || null : null,
      assetNickname: row.nickname?.trim() || null,
      assetCurrentMileage: assetType === 'van'
        ? vanMileageByAssetId.get(row.id) ?? null
        : assetType === 'hgv'
          ? vehicleRow.current_mileage ?? null
          : null,
      assetCurrentHours: assetType === 'plant' ? plantRow.current_hours ?? null : null,
      lastSubmittedAt: normalizedLastSubmittedAt,
      daysOverdue,
      dedupeKey: `${REMINDER_WORKFLOW_KEY}:${assetType}:${row.id}`,
      title: `${assetLabel} requires an inspection`,
      description: buildActionDescription({
        assetLabel,
        assetType,
        lastSubmittedAt: normalizedLastSubmittedAt,
        daysOverdue,
      }),
      priority: 'high',
    };
  }

  return [
    ...(includeVan ? vanRows.map((row) => mapAssetRow('van', row, vanLatest.get(row.id) || null)) : []),
    ...(includeHgv ? hgvRows.map((row) => mapAssetRow('hgv', row, hgvLatest.get(row.id) || null)) : []),
    ...(includePlant ? plantRows.map((row) => mapAssetRow('plant', row, plantLatest.get(row.id) || null)) : []),
  ].filter((asset): asset is OverdueAsset => Boolean(asset)).sort((left, right) => right.daysOverdue - left.daysOverdue || left.assetLabel.localeCompare(right.assetLabel));
}

async function markFleetInspectionWorkflowGenerated(admin: AdminClient, nowIso: string) {
  const { error } = await admin
    .from('reminder_workflow_settings')
    .update({ last_generated_at: nowIso })
    .eq('workflow_key', REMINDER_WORKFLOW_KEY);

  if (error) {
    throw error;
  }
}

export async function generateFleetInspectionReminderActions(
  options: FleetInspectionGenerationOptions = {},
): Promise<FleetInspectionGenerationSummary> {
  const admin = options.admin || createAdminClient();
  const nowIso = options.nowIso || new Date().toISOString();
  const workflowSettings = await loadFleetInspectionWorkflowSettings(admin);
  const overdueAssets = await loadOverdueAssets(admin, workflowSettings, new Date(nowIso));

  const { data: openActionRows, error: openActionError } = await admin
    .from('reminder_actions')
    .select(`
      id,
      dedupe_key,
      metadata,
      reminders (
        id,
        status
      )
    `)
    .eq('workflow_key', REMINDER_WORKFLOW_KEY)
    .eq('status', 'open');

  if (openActionError) {
    throw openActionError;
  }

  const openActionsByDedupeKey = new Map(
    ((openActionRows || []) as OpenReminderActionRow[]).map((row) => [row.dedupe_key, row]),
  );

  let inserted = 0;
  let updated = 0;

  for (const asset of overdueAssets) {
    const existing = openActionsByDedupeKey.get(asset.dedupeKey);
    const nextRecord = buildOpenActionRecord(asset, nowIso, workflowSettings.config);

    if (!existing) {
      const { error } = await admin.from('reminder_actions').insert(nextRecord);
      if (error) throw error;
      inserted += 1;
      continue;
    }

    const previousLastSubmittedAt = getJsonStringValue(existing.metadata, 'last_submitted_inspection_date');
    const inspectionSnapshotChanged = previousLastSubmittedAt !== asset.lastSubmittedAt;
    const existingReminders = existing.reminders || [];
    const hasPendingReminder = existingReminders.some((reminder) => reminder.status === 'pending');
    const hasActionedReminder = existingReminders.some((reminder) => reminder.status === 'actioned');
    const completedButStillOverdue = hasActionedReminder && !hasPendingReminder;

    if (inspectionSnapshotChanged || completedButStillOverdue) {
      const { error: remindersDeleteError } = await admin
        .from('reminders')
        .delete()
        .eq('action_id', existing.id);

      if (remindersDeleteError) throw remindersDeleteError;
    }

    const { error } = await admin
      .from('reminder_actions')
      .update({
        title: nextRecord.title,
        description: nextRecord.description,
        priority: nextRecord.priority,
        metadata: nextRecord.metadata,
        last_detected_at: nowIso,
        resolved_at: null,
        resolved_by: null,
        ...(inspectionSnapshotChanged || completedButStillOverdue
          ? {
              ignored_until: null,
              ignored_forever: false,
              ignored_at: null,
              ignored_by: null,
            }
          : {}),
        ...(asset.assetType === 'van' ? { van_id: asset.assetId, plant_id: null, hgv_id: null } : {}),
        ...(asset.assetType === 'plant' ? { van_id: null, plant_id: asset.assetId, hgv_id: null } : {}),
        ...(asset.assetType === 'hgv' ? { van_id: null, plant_id: null, hgv_id: asset.assetId } : {}),
      })
      .eq('id', existing.id);

    if (error) throw error;
    updated += 1;
  }

  const overdueDedupeKeys = new Set(overdueAssets.map((asset) => asset.dedupeKey));
  const actionIdsToResolve = ((openActionRows || []) as Array<Pick<ReminderActionRow, 'id' | 'dedupe_key'>>)
    .filter((row) => !overdueDedupeKeys.has(row.dedupe_key))
    .map((row) => row.id);

  let resolved = 0;
  let cancelledReminders = 0;

  if (actionIdsToResolve.length > 0) {
    const { error: resolveError } = await admin
      .from('reminder_actions')
      .update({
        status: 'resolved',
        resolved_at: nowIso,
        last_detected_at: nowIso,
        updated_at: nowIso,
      })
      .in('id', actionIdsToResolve);

    if (resolveError) throw resolveError;
    resolved = actionIdsToResolve.length;

    const { data: cancelledRows, error: cancelError } = await admin
      .from('reminders')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
      })
      .in('action_id', actionIdsToResolve)
      .eq('status', 'pending')
      .select('id');

    if (cancelError) throw cancelError;
    cancelledReminders = (cancelledRows || []).length;
  }

  await markFleetInspectionWorkflowGenerated(admin, nowIso);

  return {
    inserted,
    updated,
    resolved,
    cancelledReminders,
    openCount: overdueAssets.length,
  };
}

export function mapReminderActionWithAsset(
  action: ReminderActionRowWithReminders,
): ReminderActionWithAsset {
  const reminders = (action.reminders || []) as Array<Pick<ReminderRow, 'status'>>;

  return {
    id: action.id,
    workflow_key: action.workflow_key,
    source_type: action.source_type,
    dedupe_key: action.dedupe_key,
    status: action.status as ReminderActionStatus,
    priority: action.priority as ReminderPriority,
    title: action.title,
    description: action.description,
    asset_type: action.asset_type as ReminderAssetType | null,
    van_id: action.van_id,
    plant_id: action.plant_id,
    hgv_id: action.hgv_id,
    metadata: (action.metadata || {}) as Record<string, unknown>,
    created_by: action.created_by,
    resolved_by: action.resolved_by,
    ignored_until: action.ignored_until,
    ignored_forever: action.ignored_forever,
    ignored_at: action.ignored_at,
    ignored_by: action.ignored_by,
    first_detected_at: action.first_detected_at,
    last_detected_at: action.last_detected_at,
    resolved_at: action.resolved_at,
    created_at: action.created_at,
    updated_at: action.updated_at,
    asset_label: getJsonStringValue(action.metadata, 'asset_label'),
    asset_route: getJsonStringValue(action.metadata, 'asset_route'),
    reminders_count: getReminderActionStatusCounts(reminders),
  };
}

export function isReminderPending(status: ReminderStatus): boolean {
  return status === 'pending';
}
