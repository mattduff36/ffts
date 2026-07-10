import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  CustomMaintenanceItemUpdate,
  MaintenanceCategory,
  UpdateMaintenanceRequest,
} from '@/types/maintenance';
import { buildAutomaticMaintenancePlan } from '@/lib/utils/workshopMaintenanceSync';

type SupabaseAdminClient = SupabaseClient<Database>;
type AssetType = 'van' | 'hgv' | 'plant';
type FkColumn = 'van_id' | 'hgv_id' | 'plant_id';
type VehicleMaintenanceRow = Pick<
  Database['public']['Tables']['vehicle_maintenance']['Row'],
  | 'id'
  | 'current_mileage'
  | 'current_hours'
  | 'tax_due_date'
  | 'mot_due_date'
  | 'first_aid_kit_expiry'
  | 'six_weekly_inspection_due_date'
  | 'fire_extinguisher_due_date'
  | 'taco_calibration_due_date'
  | 'next_service_mileage'
  | 'last_service_mileage'
  | 'cambelt_due_mileage'
  | 'next_service_hours'
  | 'last_service_hours'
>;
type VehicleMaintenanceUpdate = Database['public']['Tables']['vehicle_maintenance']['Update'];
type MaintenanceHistoryInsert = Database['public']['Tables']['maintenance_history']['Insert'];
type AssetMaintenanceCategoryValueRow = Pick<
  Database['public']['Tables']['asset_maintenance_category_values']['Row'],
  | 'id'
  | 'maintenance_category_id'
  | 'due_date'
  | 'due_mileage'
  | 'last_mileage'
  | 'due_hours'
  | 'last_hours'
  | 'notes'
>;

export interface RelatedName {
  name: string | null;
}

export interface WorkshopTaskCompletionSyncTask {
  id: string;
  title: string | null;
  description: string | null;
  workshop_comments: string | null;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  workshop_task_categories: RelatedName | RelatedName[] | null;
  workshop_task_subcategories: RelatedName | RelatedName[] | null;
}

export interface WorkshopTaskCompletionSyncResult {
  attachmentTimestampsUpdated: boolean;
  maintenanceFieldsChanged: number;
  customItemsChanged: number;
  plantFieldsChanged: number;
  historyRowsInserted: number;
}

interface AssetContext {
  assetType: AssetType;
  assetId: string;
  fkColumn: FkColumn;
}

const MAINTENANCE_SELECT_COLUMNS = [
  'id',
  'current_mileage',
  'current_hours',
  'tax_due_date',
  'mot_due_date',
  'first_aid_kit_expiry',
  'six_weekly_inspection_due_date',
  'fire_extinguisher_due_date',
  'taco_calibration_due_date',
  'next_service_mileage',
  'last_service_mileage',
  'cambelt_due_mileage',
  'next_service_hours',
  'last_service_hours',
].join(', ');

const FIELD_TO_CATEGORY_NAME: Record<string, string> = {
  tax_due_date: 'Tax Due Date',
  mot_due_date: 'MOT Due Date',
  first_aid_kit_expiry: 'First Aid Kit Expiry',
  six_weekly_inspection_due_date: '6 Weekly Inspection Due',
  fire_extinguisher_due_date: 'Fire Extinguisher Due',
  taco_calibration_due_date: 'Taco Calibration Due',
  next_service_mileage: 'Service Due',
  last_service_mileage: 'Service Due',
  cambelt_due_mileage: 'Cambelt Replacement',
  next_service_hours: 'Service Due (Hours)',
  last_service_hours: 'Service Due (Hours)',
  loler_due_date: 'LOLER Due',
};

function getRelatedName(
  related: RelatedName | RelatedName[] | null
): string | null {
  if (Array.isArray(related)) return related[0]?.name ?? null;
  return related?.name ?? null;
}

function getAssetContext(task: WorkshopTaskCompletionSyncTask): AssetContext | null {
  if (task.hgv_id) {
    return {
      assetType: 'hgv',
      assetId: task.hgv_id,
      fkColumn: 'hgv_id',
    };
  }

  if (task.plant_id) {
    return {
      assetType: 'plant',
      assetId: task.plant_id,
      fkColumn: 'plant_id',
    };
  }

  if (task.van_id) {
    return {
      assetType: 'van',
      assetId: task.van_id,
      fkColumn: 'van_id',
    };
  }

  return null;
}

function buildCategoryIdByField(categories: MaintenanceCategory[]): Map<string, string> {
  const categoryIdByName = new Map(
    categories.map((category) => [category.name.toLowerCase(), category.id])
  );

  return new Map(
    Object.entries(FIELD_TO_CATEGORY_NAME)
      .map(([fieldName, categoryName]) => [
        fieldName,
        categoryIdByName.get(categoryName.toLowerCase()),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function getHistoryValueType(fieldName: string): MaintenanceHistoryInsert['value_type'] {
  if (fieldName.includes('date') || fieldName.includes('expiry')) return 'date';
  if (fieldName.includes('mileage')) return 'mileage';
  return 'text';
}

function serializeCustomValue(value?: AssetMaintenanceCategoryValueRow | CustomMaintenanceItemUpdate | null): string | null {
  if (!value) return null;
  const dueValue = value.due_date ?? value.due_mileage ?? value.due_hours ?? null;
  const lastValue = value.last_mileage ?? value.last_hours ?? null;
  if (lastValue != null && dueValue != null) return `${lastValue} -> ${dueValue}`;
  if (dueValue != null) return String(dueValue);
  if (lastValue != null) return String(lastValue);
  return value.notes ? value.notes.slice(0, 50) : null;
}

function buildHistoryAssetKeys(asset: AssetContext) {
  return {
    van_id: asset.assetType === 'van' ? asset.assetId : null,
    hgv_id: asset.assetType === 'hgv' ? asset.assetId : null,
    plant_id: asset.assetType === 'plant' ? asset.assetId : null,
  };
}

export async function syncCompletedAttachmentTimestamps(params: {
  supabaseAdmin: SupabaseAdminClient;
  taskId: string;
  completedAt: string;
}): Promise<void> {
  const { error } = await params.supabaseAdmin
    .from('workshop_task_attachments')
    .update({ completed_at: params.completedAt })
    .eq('task_id', params.taskId)
    .eq('status', 'completed');

  if (error) throw error;
}

export async function syncWorkshopTaskCompletionDependents(params: {
  supabaseAdmin: SupabaseAdminClient;
  task: WorkshopTaskCompletionSyncTask;
  completedAt: string;
  userId: string;
  syncCompletedAttachments?: boolean;
  historyComment?: string;
}): Promise<WorkshopTaskCompletionSyncResult> {
  const result: WorkshopTaskCompletionSyncResult = {
    attachmentTimestampsUpdated: false,
    maintenanceFieldsChanged: 0,
    customItemsChanged: 0,
    plantFieldsChanged: 0,
    historyRowsInserted: 0,
  };

  if (params.syncCompletedAttachments !== false) {
    await syncCompletedAttachmentTimestamps({
      supabaseAdmin: params.supabaseAdmin,
      taskId: params.task.id,
      completedAt: params.completedAt,
    });
    result.attachmentTimestampsUpdated = true;
  }

  const asset = getAssetContext(params.task);
  if (!asset) return result;

  const [
    { data: categories, error: categoriesError },
    { data: existingRecord, error: existingError },
  ] = await Promise.all([
    params.supabaseAdmin
      .from('maintenance_categories')
      .select('*')
      .eq('is_active', true),
    params.supabaseAdmin
      .from('vehicle_maintenance')
      .select(MAINTENANCE_SELECT_COLUMNS)
      .eq(asset.fkColumn, asset.assetId)
      .maybeSingle(),
  ]);

  if (categoriesError) throw categoriesError;
  if (existingError && existingError.code !== 'PGRST116') throw existingError;

  const maintenanceCategories = (categories || []) as MaintenanceCategory[];
  const typedExistingRecord = existingRecord as VehicleMaintenanceRow | null;
  const autoPlan = buildAutomaticMaintenancePlan({
    context: {
      title: params.task.title,
      description: params.task.description || params.task.workshop_comments,
      workshopCategoryName: getRelatedName(params.task.workshop_task_categories),
      workshopSubcategoryName: getRelatedName(params.task.workshop_task_subcategories),
    },
    categories: maintenanceCategories,
    state: {
      currentMileage: typedExistingRecord?.current_mileage ?? null,
      currentHours: typedExistingRecord?.current_hours ?? null,
    },
    completedAt: params.completedAt,
    assetType: asset.assetType,
  });

  if (!autoPlan) return result;

  const historyRows: MaintenanceHistoryInsert[] = [];
  const categoryIdByField = buildCategoryIdByField(maintenanceCategories);
  const historyAssetKeys = buildHistoryAssetKeys(asset);
  const historyComment =
    params.historyComment ||
    `Updated from workshop task completed timestamp adjustment: ${params.task.title || 'Task'}`;

  const requestedUpdates = autoPlan.maintenanceUpdates;
  const updateEntries = Object.entries(requestedUpdates) as Array<[
    keyof UpdateMaintenanceRequest,
    string | number | null | undefined,
  ]>;
  const changedFields = updateEntries.filter(([fieldName, value]) => {
    if (value === undefined) return false;
    if (!typedExistingRecord) return true;
    return typedExistingRecord[fieldName as keyof VehicleMaintenanceRow] !== value;
  });

  if (updateEntries.length > 0) {
    const updates: VehicleMaintenanceUpdate = {
      ...requestedUpdates,
      last_updated_by: params.userId,
      last_updated_at: new Date().toISOString(),
    };

    const { error: updateError } = typedExistingRecord
      ? await params.supabaseAdmin
          .from('vehicle_maintenance')
          .update(updates)
          .eq('id', typedExistingRecord.id)
      : await params.supabaseAdmin
          .from('vehicle_maintenance')
          .insert({
            [asset.fkColumn]: asset.assetId,
            ...updates,
          });

    if (updateError) throw updateError;
  }

  for (const [fieldName, value] of changedFields) {
    historyRows.push({
      ...historyAssetKeys,
      field_name: fieldName,
      old_value: typedExistingRecord?.[fieldName as keyof VehicleMaintenanceRow] != null
        ? String(typedExistingRecord[fieldName as keyof VehicleMaintenanceRow])
        : null,
      new_value: value != null ? String(value) : null,
      value_type: getHistoryValueType(fieldName),
      maintenance_category_id: categoryIdByField.get(fieldName) || autoPlan.linkedCategoryId,
      comment: historyComment,
      updated_by: params.userId,
    });
  }
  result.maintenanceFieldsChanged = changedFields.length;

  if (
    asset.assetType === 'plant' &&
    autoPlan.plantUpdates.loler_due_date !== undefined
  ) {
    const { data: plantRecord, error: plantFetchError } = await params.supabaseAdmin
      .from('plant')
      .select('id, loler_due_date')
      .eq('id', asset.assetId)
      .maybeSingle();

    if (plantFetchError) throw plantFetchError;

    if (plantRecord?.loler_due_date !== autoPlan.plantUpdates.loler_due_date) {
      const { error: plantUpdateError } = await params.supabaseAdmin
        .from('plant')
        .update({ loler_due_date: autoPlan.plantUpdates.loler_due_date })
        .eq('id', asset.assetId);

      if (plantUpdateError) throw plantUpdateError;

      historyRows.push({
        ...historyAssetKeys,
        field_name: 'loler_due_date',
        old_value: plantRecord?.loler_due_date ?? null,
        new_value: autoPlan.plantUpdates.loler_due_date ?? null,
        value_type: 'date',
        maintenance_category_id: categoryIdByField.get('loler_due_date') || autoPlan.linkedCategoryId,
        comment: historyComment,
        updated_by: params.userId,
      });
      result.plantFieldsChanged = 1;
    }
  }

  if (autoPlan.customItems.length > 0) {
    const categoryIds = autoPlan.customItems.map((item) => item.category_id);
    const { data: existingCustomValues, error: existingCustomValuesError } = await params.supabaseAdmin
      .from('asset_maintenance_category_values')
      .select('id, maintenance_category_id, due_date, due_mileage, last_mileage, due_hours, last_hours, notes')
      .in('maintenance_category_id', categoryIds)
      .eq(asset.fkColumn, asset.assetId);

    if (existingCustomValuesError) throw existingCustomValuesError;

    const existingValuesByCategoryId = new Map(
      ((existingCustomValues || []) as AssetMaintenanceCategoryValueRow[]).map((value) => [
        value.maintenance_category_id,
        value,
      ])
    );

    for (const item of autoPlan.customItems) {
      const existingValue = existingValuesByCategoryId.get(item.category_id) || null;
      const oldValue = serializeCustomValue(existingValue);
      const newValue = serializeCustomValue(item);
      if (oldValue === newValue) continue;

      const { error: upsertValueError } = await params.supabaseAdmin
        .from('asset_maintenance_category_values')
        .upsert({
          maintenance_category_id: item.category_id,
          van_id: asset.assetType === 'van' ? asset.assetId : null,
          hgv_id: asset.assetType === 'hgv' ? asset.assetId : null,
          plant_id: asset.assetType === 'plant' ? asset.assetId : null,
          due_date: item.due_date ?? null,
          due_mileage: item.due_mileage ?? null,
          last_mileage: item.last_mileage ?? null,
          due_hours: item.due_hours ?? null,
          last_hours: item.last_hours ?? null,
          notes: item.notes ?? null,
          last_updated_by: params.userId,
          last_updated_at: new Date().toISOString(),
        }, { onConflict: 'maintenance_category_id,asset_type,asset_id' });

      if (upsertValueError) throw upsertValueError;

      const category = maintenanceCategories.find((candidate) => candidate.id === item.category_id);
      historyRows.push({
        ...historyAssetKeys,
        field_name: `category:${category?.name || item.category_id}`,
        old_value: oldValue,
        new_value: newValue,
        value_type: category?.type === 'date' ? 'date' : category?.type === 'mileage' ? 'mileage' : 'text',
        maintenance_category_id: item.category_id,
        comment: historyComment,
        updated_by: params.userId,
      });
      result.customItemsChanged += 1;
    }
  }

  if (historyRows.length > 0) {
    const { data: profile } = await params.supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', params.userId)
      .maybeSingle();
    const updatedByName = (profile as { full_name?: string | null } | null)?.full_name || 'Unknown User';
    const { error: historyError } = await params.supabaseAdmin
      .from('maintenance_history')
      .insert(historyRows.map((row) => ({
        ...row,
        updated_by_name: updatedByName,
      })));

    if (historyError) {
      console.error('Failed to record maintenance history for workshop completion sync:', historyError);
    } else {
      result.historyRowsInserted = historyRows.length;
    }
  }

  return result;
}
