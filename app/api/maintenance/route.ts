import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/utils/logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import type {
  VehicleMaintenanceWithStatus,
  MaintenanceCategory,
  MaintenanceListResponse,
  UpdateMaintenanceRequest,
  MaintenanceUpdateResponse,
  MaintenanceItem,
  MaintenanceItemStatus
} from '@/types/maintenance';
import {
  getDateBasedStatus,
  getMileageBasedStatus,
  getHoursBasedStatus,
  calculateAlertCounts,
  formatMaintenanceDate,
  formatMileage,
  formatHours
} from '@/lib/utils/maintenanceCalculations';
import {
  MAINTENANCE_CATEGORY_NAMES,
  categoryAppliesToAsset,
  createMaintenanceCategoryMap,
  getDistanceUnitLabel,
  getMaintenanceCategory,
  isMaintenanceCategoryVisibleOnOverview,
} from '@/lib/utils/maintenanceCategoryRules';

interface InspectionLookupRow {
  inspection_date: string | null;
  profiles:
    | {
        full_name: string | null;
      }
    | Array<{
        full_name: string | null;
      }>
    | null;
}

interface MaintenanceRow {
  id: string;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  current_mileage: number | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  next_service_mileage: number | null;
  last_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  tracker_id: string | null;
  first_aid_kit_expiry: string | null;
  six_weekly_inspection_due_date: string | null;
  fire_extinguisher_due_date: string | null;
  taco_calibration_due_date: string | null;
  current_hours: number | null;
  next_service_hours: number | null;
  last_service_hours: number | null;
  created_at: string;
  updated_at: string;
  last_updated_by: string | null;
  last_updated_at: string;
  last_mileage_update: string | null;
  notes: string | null;
}

interface CustomMaintenanceValueRow {
  id: string;
  maintenance_category_id: string;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  due_date: string | null;
  due_mileage: number | null;
  last_mileage: number | null;
  due_hours: number | null;
  last_hours: number | null;
}

interface CustomCategoryRow {
  id: string;
  name: string;
  type: 'date' | 'mileage' | 'hours';
  field_key: string | null;
}

function getAssetValueKey(assetType: 'van' | 'hgv' | 'plant', assetId: string): string {
  return `${assetType}:${assetId}`;
}

function getCustomValueAssetKey(value: CustomMaintenanceValueRow): string | null {
  if (value.van_id) return getAssetValueKey('van', value.van_id);
  if (value.hgv_id) return getAssetValueKey('hgv', value.hgv_id);
  if (value.plant_id) return getAssetValueKey('plant', value.plant_id);
  return null;
}

function getCategoryThreshold(category: MaintenanceCategory): number {
  if (category.type === 'date') return category.alert_threshold_days || 30;
  if (category.type === 'hours') return category.alert_threshold_hours || 50;
  return category.alert_threshold_miles || 1000;
}

function getStatusForCategory(params: {
  category: MaintenanceCategory;
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValue?: CustomMaintenanceValueRow;
}): MaintenanceItemStatus {
  const { category, maintenance, customValue } = params;
  const threshold = getCategoryThreshold(category);

  if (category.field_key) {
    if (category.field_key === 'tax_due_date') return getDateBasedStatus(maintenance?.tax_due_date || null, threshold);
    if (category.field_key === 'mot_due_date') return getDateBasedStatus(maintenance?.mot_due_date || null, threshold);
    if (category.field_key === 'first_aid_kit_expiry') return getDateBasedStatus(maintenance?.first_aid_kit_expiry || null, threshold);
    if (category.field_key === 'six_weekly_inspection_due_date') return getDateBasedStatus(maintenance?.six_weekly_inspection_due_date || null, threshold);
    if (category.field_key === 'fire_extinguisher_due_date') return getDateBasedStatus(maintenance?.fire_extinguisher_due_date || null, threshold);
    if (category.field_key === 'taco_calibration_due_date') return getDateBasedStatus(maintenance?.taco_calibration_due_date || null, threshold);
    if (category.field_key === 'loler_due_date') return getDateBasedStatus(params.lolerDueDate, threshold);
    if (category.field_key === 'next_service_mileage') {
      return getMileageBasedStatus(maintenance?.current_mileage ?? null, maintenance?.next_service_mileage ?? null, threshold);
    }
    if (category.field_key === 'cambelt_due_mileage') {
      return getMileageBasedStatus(maintenance?.current_mileage ?? null, maintenance?.cambelt_due_mileage ?? null, threshold);
    }
    if (category.field_key === 'next_service_hours') {
      return getHoursBasedStatus(maintenance?.current_hours ?? null, maintenance?.next_service_hours ?? null, threshold);
    }
  }

  if (category.type === 'date') return getDateBasedStatus(customValue?.due_date || null, threshold);
  if (category.type === 'hours') {
    return getHoursBasedStatus(maintenance?.current_hours ?? null, customValue?.due_hours ?? null, threshold);
  }
  return getMileageBasedStatus(maintenance?.current_mileage ?? null, customValue?.due_mileage ?? null, threshold);
}

function getDueValuesForCategory(params: {
  category: MaintenanceCategory;
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValue?: CustomMaintenanceValueRow;
}) {
  const { category, maintenance, customValue } = params;

  if (category.field_key === 'tax_due_date') return { dueDate: maintenance?.tax_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'mot_due_date') return { dueDate: maintenance?.mot_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'first_aid_kit_expiry') return { dueDate: maintenance?.first_aid_kit_expiry || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'six_weekly_inspection_due_date') return { dueDate: maintenance?.six_weekly_inspection_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'fire_extinguisher_due_date') return { dueDate: maintenance?.fire_extinguisher_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'taco_calibration_due_date') return { dueDate: maintenance?.taco_calibration_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'loler_due_date') return { dueDate: params.lolerDueDate, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'next_service_mileage') {
    return { dueDate: null, dueMileage: maintenance?.next_service_mileage ?? null, lastMileage: maintenance?.last_service_mileage ?? null, dueHours: null, lastHours: null };
  }
  if (category.field_key === 'cambelt_due_mileage') {
    return { dueDate: null, dueMileage: maintenance?.cambelt_due_mileage ?? null, lastMileage: null, dueHours: null, lastHours: null };
  }
  if (category.field_key === 'next_service_hours') {
    return { dueDate: null, dueMileage: null, lastMileage: null, dueHours: maintenance?.next_service_hours ?? null, lastHours: maintenance?.last_service_hours ?? null };
  }

  return {
    dueDate: customValue?.due_date || null,
    dueMileage: customValue?.due_mileage ?? null,
    lastMileage: customValue?.last_mileage ?? null,
    dueHours: customValue?.due_hours ?? null,
    lastHours: customValue?.last_hours ?? null,
  };
}

function formatMaintenanceItemValue(
  itemType: MaintenanceCategory['type'],
  values: ReturnType<typeof getDueValuesForCategory>
): string {
  if (itemType === 'date') return formatMaintenanceDate(values.dueDate);
  if (itemType === 'hours') return formatHours(values.dueHours);
  return formatMileage(values.dueMileage);
}

function buildMaintenanceItems(params: {
  assetType: 'van' | 'hgv' | 'plant';
  assetId: string;
  categories: MaintenanceCategory[];
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValuesByAsset: Map<string, CustomMaintenanceValueRow[]>;
}): MaintenanceItem[] {
  const assetValues = params.customValuesByAsset.get(getAssetValueKey(params.assetType, params.assetId)) || [];
  const valuesByCategoryId = new Map(assetValues.map(value => [value.maintenance_category_id, value]));

  return params.categories
    .filter(category => category.is_active !== false)
    .filter(category => categoryAppliesToAsset(category, params.assetType, category.name))
    .map(category => {
      const customValue = valuesByCategoryId.get(category.id);
      const status = getStatusForCategory({
        category,
        maintenance: params.maintenance,
        lolerDueDate: params.lolerDueDate,
        customValue,
      });
      const values = getDueValuesForCategory({
        category,
        maintenance: params.maintenance,
        lolerDueDate: params.lolerDueDate,
        customValue,
      });
      const displayUnit = category.type === 'date'
        ? 'date'
        : category.type === 'hours'
          ? 'hours'
          : getDistanceUnitLabel(params.assetType);

      return {
        id: `${params.assetId}:${category.id}`,
        category_id: category.id,
        category_name: category.name,
        category_type: category.type,
        category_field_key: category.field_key || null,
        source: category.field_key ? 'system' : 'custom',
        is_system: category.is_system ?? false,
        is_delete_protected: category.is_delete_protected ?? false,
        sort_order: category.sort_order,
        asset_type: params.assetType,
        status,
        due_date: values.dueDate,
        due_mileage: values.dueMileage,
        last_mileage: values.lastMileage,
        due_hours: values.dueHours,
        last_hours: values.lastHours,
        display_value: formatMaintenanceItemValue(category.type, values),
        display_unit: displayUnit,
        value_id: customValue?.id || null,
      } satisfies MaintenanceItem;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.category_name.localeCompare(b.category_name));
}

/**
 * GET /api/maintenance
 * Returns all vehicle maintenance records with calculated status
 */
export async function GET() {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const hasPermission = await canEffectiveRoleAccessModule('maintenance');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    
    // Get all maintenance categories so disabled/hidden rows can suppress alerts.
    const { data: categories, error: categoriesError } = await admin
      .from('maintenance_categories')
      .select('*')
      .order('sort_order');
    
    if (categoriesError) {
      logger.error('Failed to fetch maintenance categories', categoriesError);
      throw categoriesError;
    }
    
    const maintenanceCategories = (categories || []) as MaintenanceCategory[];
    const categoryMap = createMaintenanceCategoryMap(maintenanceCategories);
    
    // Get thresholds (with defaults)
    const taxThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.tax)?.alert_threshold_days || 30;
    const motThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.mot)?.alert_threshold_days || 30;
    const serviceThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.service)?.alert_threshold_miles || 1000;
    const cambeltThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.cambelt)?.alert_threshold_miles || 5000;
    const firstAidThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.firstAid)?.alert_threshold_days || 30;
    const sixWeeklyThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.sixWeekly)?.alert_threshold_days || 7;
    const fireExtinguisherThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.fireExtinguisher)?.alert_threshold_days || 30;
    const tacoCalibrationThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.tacoCalibration)?.alert_threshold_days || 60;
    const lolerThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.loler)?.alert_threshold_days || 30;
    const serviceHoursThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.serviceHours)?.alert_threshold_hours || 50;
    
    // ---------------------------------------------------------------
    // Fetch all three asset tables with their maintenance records
    // ---------------------------------------------------------------

    const [vansResult, hgvsResult, plantResult] = await Promise.all([
      admin
        .from('vans')
        .select(`
          id,
          reg_number,
          category_id,
          status,
          nickname,
          maintenance:vehicle_maintenance!van_id(*),
          van_inspections!van_inspections_van_id_fkey(
            inspection_date,
            profiles!van_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'van_inspections', ascending: false })
        .limit(1, { foreignTable: 'van_inspections' }),
      admin
        .from('hgvs')
        .select(`
          id,
          reg_number,
          category_id,
          status,
          nickname,
          maintenance:vehicle_maintenance!hgv_id(*),
          hgv_inspections!hgv_inspections_hgv_id_fkey(
            inspection_date,
            profiles!hgv_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'hgv_inspections', ascending: false })
        .limit(1, { foreignTable: 'hgv_inspections' }),
      admin
        .from('plant')
        .select(`
          id,
          plant_id,
          reg_number,
          nickname,
          serial_number,
          year,
          weight_class,
          category_id,
          status,
          loler_due_date,
          maintenance:vehicle_maintenance!plant_id(*),
          plant_inspections!plant_inspections_plant_id_fkey(
            inspection_date,
            profiles!plant_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'plant_inspections', ascending: false })
        .limit(1, { foreignTable: 'plant_inspections' }),
    ]);

    if (vansResult.error) { logger.error('Failed to fetch vans', vansResult.error); throw vansResult.error; }
    if (hgvsResult.error) { logger.error('Failed to fetch hgvs', hgvsResult.error); throw hgvsResult.error; }
    if (plantResult.error) { logger.error('Failed to fetch plant', plantResult.error); throw plantResult.error; }

    const { data: customValues, error: customValuesError } = await (admin as never as { from: (table: string) => { select: (columns: string) => Promise<{ data: unknown; error: unknown }> } })
      .from('asset_maintenance_category_values')
      .select('*');

    if (customValuesError) {
      logger.error('Failed to fetch custom maintenance category values', customValuesError);
      throw customValuesError;
    }

    const customValuesByAsset = ((customValues || []) as CustomMaintenanceValueRow[]).reduce(
      (map, value) => {
        const assetKey = getCustomValueAssetKey(value);
        if (!assetKey) return map;
        const assetValues = map.get(assetKey) || [];
        assetValues.push(value);
        map.set(assetKey, assetValues);
        return map;
      },
      new Map<string, CustomMaintenanceValueRow[]>()
    );

    // Tag each asset with its source type
    interface TaggedAsset {
      _assetType: 'van' | 'hgv' | 'plant';
      id: string;
      reg_number: string | null;
      category_id: string | null;
      status: string;
      nickname: string | null;
      plant_id?: string | null;
      serial_number?: string | null;
      year?: number | null;
      weight_class?: string | null;
      loler_due_date?: string | null;
      maintenance?: Record<string, unknown>[] | Record<string, unknown> | null;
      van_inspections?: InspectionLookupRow[] | null;
      hgv_inspections?: InspectionLookupRow[] | null;
      plant_inspections?: InspectionLookupRow[] | null;
    }
    const taggedAssets: TaggedAsset[] = [
      ...(vansResult.data || []).map(v => ({ ...v, _assetType: 'van' as const })),
      ...(hgvsResult.data || []).map(v => ({ ...v, _assetType: 'hgv' as const })),
      ...(plantResult.data || []).map(v => ({ ...v, _assetType: 'plant' as const })),
    ];

    // Calculate status for each asset
    const vehiclesWithStatus = taggedAssets.map(asset => {
      const assetType = asset._assetType;
      const maintenance = (
        Array.isArray(asset.maintenance) ? asset.maintenance[0] : asset.maintenance
      ) as MaintenanceRow | null;
      const latestInspection = (
        assetType === 'van'
          ? asset.van_inspections?.[0]
          : assetType === 'hgv'
            ? asset.hgv_inspections?.[0]
            : asset.plant_inspections?.[0]
      ) || null;
      const latestInspectorProfile = Array.isArray(latestInspection?.profiles)
        ? latestInspection?.profiles[0] || null
        : latestInspection?.profiles || null;

      const vehicleObj = {
        id: asset.id,
        reg_number: asset.reg_number || null,
        category_id: asset.category_id || null,
        status: asset.status,
        nickname: asset.nickname || null,
        asset_type: assetType as 'van' | 'hgv' | 'plant',
        plant_id: asset.plant_id || null,
        serial_number: asset.serial_number || null,
        year: asset.year || null,
        weight_class: asset.weight_class || null,
      };

      // LOLER due date comes from the plant table, not vehicle_maintenance
      const loler_due_date = assetType === 'plant' ? (asset.loler_due_date || null) : null;
      const loler_status = assetType === 'plant'
        ? getDateBasedStatus(loler_due_date, lolerThreshold)
        : { status: 'not_set' as const };
      const maintenanceItems = buildMaintenanceItems({
        assetType,
        assetId: asset.id,
        categories: maintenanceCategories,
        maintenance,
        lolerDueDate: loler_due_date,
        customValuesByAsset,
      });

      if (!maintenance) {
        const noMaintenanceAlertCounts = calculateAlertCounts(
          maintenanceItems
            .filter(item => isMaintenanceCategoryVisibleOnOverview(
              maintenanceCategories.find(category => category.id === item.category_id),
              assetType,
              item.category_name
            ))
            .map(item => item.status)
        );

        return {
          // No vehicle_maintenance row exists yet. Keep the maintenance id null
          // so edit dialogs create a record instead of PUT-ing to the asset id.
          id: null,
          van_id: assetType === 'van' ? asset.id : null,
          hgv_id: assetType === 'hgv' ? asset.id : null,
          plant_id: assetType === 'plant' ? asset.id : null,
          is_plant: assetType === 'plant',
          vehicle: vehicleObj,
          last_inspector: latestInspectorProfile?.full_name || null,
          last_inspection_date: latestInspection?.inspection_date || null,
          current_mileage: null,
          current_hours: null,
          tax_due_date: null,
          mot_due_date: null,
          next_service_mileage: null,
          last_service_mileage: null,
          next_service_hours: null,
          last_service_hours: null,
          cambelt_due_mileage: null,
          tracker_id: null,
          first_aid_kit_expiry: null,
          six_weekly_inspection_due_date: null,
          fire_extinguisher_due_date: null,
          taco_calibration_due_date: null,
          loler_due_date,
          created_at: null,
          updated_at: null,
          last_updated_by: null,
          last_updated_at: '',
          last_mileage_update: null,
          notes: null,
          tax_status: { status: 'not_set' as const },
          mot_status: { status: 'not_set' as const },
          service_status: { status: 'not_set' as const },
          cambelt_status: { status: 'not_set' as const },
          first_aid_status: { status: 'not_set' as const },
          six_weekly_status: { status: 'not_set' as const },
          fire_extinguisher_status: { status: 'not_set' as const },
          taco_calibration_status: { status: 'not_set' as const },
          loler_status,
          service_hours_status: { status: 'not_set' as const },
          maintenance_items: maintenanceItems,
          overdue_count: noMaintenanceAlertCounts.overdue,
          due_soon_count: noMaintenanceAlertCounts.due_soon
        };
      }

      const tax_status = getDateBasedStatus(maintenance.tax_due_date, taxThreshold);
      const mot_status = getDateBasedStatus(maintenance.mot_due_date, motThreshold);
      const service_status = getMileageBasedStatus(
        maintenance.current_mileage,
        maintenance.next_service_mileage,
        serviceThreshold
      );
      const cambelt_status = getMileageBasedStatus(
        maintenance.current_mileage,
        maintenance.cambelt_due_mileage,
        cambeltThreshold
      );
      const first_aid_status = getDateBasedStatus(
        maintenance.first_aid_kit_expiry,
        firstAidThreshold
      );
      const six_weekly_status = getDateBasedStatus(
        maintenance.six_weekly_inspection_due_date,
        sixWeeklyThreshold
      );
      const fire_extinguisher_status = getDateBasedStatus(
        maintenance.fire_extinguisher_due_date,
        fireExtinguisherThreshold
      );
      const taco_calibration_status = getDateBasedStatus(
        maintenance.taco_calibration_due_date,
        tacoCalibrationThreshold
      );
      const service_hours_status = assetType === 'plant'
        ? getHoursBasedStatus(
            maintenance.current_hours,
            maintenance.next_service_hours,
            serviceHoursThreshold
          )
        : { status: 'not_set' as const };

      const alertCounts = calculateAlertCounts(
        maintenanceItems
          .filter(item => isMaintenanceCategoryVisibleOnOverview(
            maintenanceCategories.find(category => category.id === item.category_id),
            assetType,
            item.category_name
          ))
          .map(item => item.status)
      );

      return {
        ...maintenance,
        is_plant: assetType === 'plant',
        vehicle: vehicleObj,
        last_inspector: latestInspectorProfile?.full_name || null,
        last_inspection_date: latestInspection?.inspection_date || null,
        tax_status,
        mot_status,
        service_status,
        cambelt_status,
        first_aid_status,
        six_weekly_status,
        fire_extinguisher_status,
        taco_calibration_status,
        loler_status,
        loler_due_date,
        service_hours_status,
        maintenance_items: maintenanceItems,
        overdue_count: alertCounts.overdue,
        due_soon_count: alertCounts.due_soon
      };
    }) as VehicleMaintenanceWithStatus[];
    
    // Calculate summary
    const summary = {
      total: vehiclesWithStatus.length,
      overdue: vehiclesWithStatus.filter(v => v.overdue_count > 0).length,
      due_soon: vehiclesWithStatus.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length
    };
    
    const response: MaintenanceListResponse = {
      success: true,
      vehicles: vehiclesWithStatus,
      summary
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('GET /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * POST /api/maintenance
 * Create a new maintenance record for a vehicle
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const canManageMaintenance = await canEffectiveRoleAccessModule('maintenance');
    if (!canManageMaintenance) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }
    
    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    
    const userName = profile?.full_name || 'Unknown User';
    
    // Parse request body
    const body: UpdateMaintenanceRequest & { van_id?: string; hgv_id?: string } = await request.json();
    
    const assetId = body.van_id || body.hgv_id;
    const assetColumn = body.van_id ? 'van_id' : body.hgv_id ? 'hgv_id' : null;

    if (!assetId || !assetColumn) {
      return NextResponse.json(
        { error: 'van_id or hgv_id is required' },
        { status: 400 }
      );
    }
    
    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        { error: 'Comment is required and must be at least 10 characters' },
        { status: 400 }
      );
    }
    
    // Check if maintenance record already exists
    const { data: existingRecord } = await supabase
      .from('vehicle_maintenance')
      .select('id')
      .eq(assetColumn, assetId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    
    if ((existingRecord?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Maintenance record already exists for this vehicle' },
        { status: 409 }
      );
    }
    
    // Create new maintenance record
    const newRecord = {
      van_id: body.van_id || null,
      hgv_id: body.hgv_id || null,
      current_mileage: body.current_mileage || 0,
      tax_due_date: body.tax_due_date || null,
      mot_due_date: body.mot_due_date || null,
      first_aid_kit_expiry: body.first_aid_kit_expiry || null,
      six_weekly_inspection_due_date: body.six_weekly_inspection_due_date || null,
      fire_extinguisher_due_date: body.fire_extinguisher_due_date || null,
      taco_calibration_due_date: body.taco_calibration_due_date || null,
      next_service_mileage: body.next_service_mileage || null,
      last_service_mileage: body.last_service_mileage || null,
      cambelt_due_mileage: body.cambelt_due_mileage || null,
      tracker_id: body.tracker_id || null,
      notes: body.notes || null,
      last_updated_by: user.id
    };
    
    const { data: createdMaintenance, error: createError } = await supabase
      .from('vehicle_maintenance')
      .insert(newRecord)
      .select()
      .single();
    
    if (createError) {
      logger.error('Failed to create maintenance record', createError);
      throw createError;
    }

    if (body.hgv_id && body.current_mileage !== undefined && body.current_mileage !== null) {
      const { error: updateHgvError } = await supabase
        .from('hgvs')
        .update({ current_mileage: body.current_mileage })
        .eq('id', body.hgv_id);

      if (updateHgvError) {
        logger.error('Failed to sync hgvs.current_mileage from maintenance create', updateHgvError);
      }
    }
    
    // Create history entry for initial creation
    const historyEntries = [];

    const customItems = body.custom_items || [];
    if (customItems.length > 0) {
      const categoryIds = [...new Set(customItems.map(item => item.category_id))];
      const { data: customCategories, error: customCategoriesError } = await (supabase as never as { from: (table: string) => { select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: unknown; error: unknown }> } } })
        .from('maintenance_categories')
        .select('id, name, type, field_key')
        .in('id', categoryIds);

      if (customCategoriesError) {
        logger.error('Failed to fetch custom categories for create', customCategoriesError);
        throw customCategoriesError;
      }

      const categoriesById = new Map(((customCategories || []) as CustomCategoryRow[]).map(category => [category.id, category]));
      const customRows = customItems
        .filter(item => {
          const category = categoriesById.get(item.category_id);
          return category && !category.field_key && (
            item.due_date != null
            || item.due_mileage != null
            || item.last_mileage != null
            || item.due_hours != null
            || item.last_hours != null
            || item.notes
          );
        })
        .map(item => ({
          maintenance_category_id: item.category_id,
          van_id: body.van_id || null,
          hgv_id: body.hgv_id || null,
          due_date: item.due_date ?? null,
          due_mileage: item.due_mileage ?? null,
          last_mileage: item.last_mileage ?? null,
          due_hours: item.due_hours ?? null,
          last_hours: item.last_hours ?? null,
          notes: item.notes ?? null,
          last_updated_by: user.id,
          last_updated_at: new Date().toISOString(),
        }));

      if (customRows.length > 0) {
        const { error: customValuesError } = await (supabase as never as { from: (table: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> } })
          .from('asset_maintenance_category_values')
          .insert(customRows);

        if (customValuesError) {
          logger.error('Failed to create custom category values', customValuesError);
          throw customValuesError;
        }

        customRows.forEach(row => {
          const category = categoriesById.get(row.maintenance_category_id);
          if (!category) return;

          const dueValue = row.due_date ?? row.due_mileage ?? row.due_hours ?? null;
          const lastValue = row.last_mileage ?? row.last_hours ?? null;
          const newValue = lastValue != null && dueValue != null
            ? `${lastValue} -> ${dueValue}`
            : dueValue != null
              ? String(dueValue)
              : lastValue != null
                ? String(lastValue)
                : row.notes?.slice(0, 50) || null;

          historyEntries.push({
            van_id: body.van_id || null,
            hgv_id: body.hgv_id || null,
            maintenance_category_id: row.maintenance_category_id,
            field_name: `category:${category.name}`,
            old_value: null,
            new_value: newValue,
            value_type: category.type === 'date' ? 'date' as const : category.type === 'mileage' ? 'mileage' as const : 'text' as const,
            comment: body.comment,
            updated_by: user.id,
            updated_by_name: userName
          });
        });
      }
    }
    
    if (body.tax_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'tax_due_date',
        old_value: null,
        new_value: body.tax_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.mot_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'mot_due_date',
        old_value: null,
        new_value: body.mot_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.first_aid_kit_expiry) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'first_aid_kit_expiry',
        old_value: null,
        new_value: body.first_aid_kit_expiry,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.six_weekly_inspection_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'six_weekly_inspection_due_date',
        old_value: null,
        new_value: body.six_weekly_inspection_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.fire_extinguisher_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'fire_extinguisher_due_date',
        old_value: null,
        new_value: body.fire_extinguisher_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.taco_calibration_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'taco_calibration_due_date',
        old_value: null,
        new_value: body.taco_calibration_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.next_service_mileage) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'next_service_mileage',
        old_value: null,
        new_value: body.next_service_mileage.toString(),
        value_type: 'mileage' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.cambelt_due_mileage) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'cambelt_due_mileage',
        old_value: null,
        new_value: body.cambelt_due_mileage.toString(),
        value_type: 'mileage' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    // Insert history entries if any
    if (historyEntries.length > 0) {
      const { error: historyError } = await supabase
        .from('maintenance_history')
        .insert(historyEntries);
      
      if (historyError) {
        logger.error('Failed to create history entries', historyError);
        // Don't fail the request if history fails
      }
    }
    
    const response: MaintenanceUpdateResponse = {
      success: true,
      maintenance: {
        ...createdMaintenance,
        last_updated_at: createdMaintenance.last_updated_at ?? '',
        created_at: createdMaintenance.created_at ?? '',
        updated_at: createdMaintenance.updated_at ?? '',
      }
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('POST /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
