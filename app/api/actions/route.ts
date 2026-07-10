import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import {
  ACTIONS_PAGE_FLEET_INSPECTION_REFRESH_INTERVAL_MS,
  ensureFleetInspectionReminderActionsFresh,
} from '@/lib/server/reminders/ensure-fleet-inspection-actions-fresh';
import { mapReminderActionWithAsset } from '@/lib/server/reminders/generate-fleet-inspection-actions';
import type { ReminderActionWithAsset } from '@/types/reminders';

type AdminClient = ReturnType<typeof createAdminClient>;

interface VehicleAssetDetails {
  id: string;
  reg_number: string | null;
  nickname: string | null;
  current_mileage?: number | null;
}

interface PlantAssetDetails {
  id: string;
  plant_id: string | null;
  reg_number: string | null;
  nickname: string | null;
  serial_number: string | null;
  current_hours: number | null;
}

function uniqueValues(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildVehicleLabel(asset: VehicleAssetDetails): string {
  const registration = asset.reg_number?.trim() || 'Unknown';
  return asset.nickname?.trim() ? `${registration} (${asset.nickname.trim()})` : registration;
}

function buildPlantLabel(asset: PlantAssetDetails): string {
  const primary = asset.plant_id?.trim() || asset.reg_number?.trim() || 'Unknown Plant';
  return asset.nickname?.trim() ? `${primary} (${asset.nickname.trim()})` : primary;
}

async function enrichActionAssetMetadata(
  admin: AdminClient,
  actions: ReminderActionWithAsset[],
): Promise<ReminderActionWithAsset[]> {
  const vanIds = uniqueValues(actions.map((action) => action.van_id));
  const hgvIds = uniqueValues(actions.map((action) => action.hgv_id));
  const plantIds = uniqueValues(actions.map((action) => action.plant_id));

  const [vansResult, hgvsResult, plantResult, vanMileageResult] = await Promise.all([
    vanIds.length > 0
      ? admin.from('vans').select('id, reg_number, nickname').in('id', vanIds)
      : Promise.resolve({ data: [], error: null }),
    hgvIds.length > 0
      ? admin.from('hgvs').select('id, reg_number, nickname, current_mileage').in('id', hgvIds)
      : Promise.resolve({ data: [], error: null }),
    plantIds.length > 0
      ? admin.from('plant').select('id, plant_id, reg_number, nickname, serial_number, current_hours').in('id', plantIds)
      : Promise.resolve({ data: [], error: null }),
    vanIds.length > 0
      ? admin
        .from('vehicle_maintenance')
        .select('van_id, current_mileage')
        .in('van_id', vanIds)
        .order('updated_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;
  if (vanMileageResult.error) throw vanMileageResult.error;

  const vansById = new Map((vansResult.data || []).map((asset) => [asset.id, asset as VehicleAssetDetails]));
  const hgvsById = new Map((hgvsResult.data || []).map((asset) => [asset.id, asset as VehicleAssetDetails]));
  const plantById = new Map((plantResult.data || []).map((asset) => [asset.id, asset as PlantAssetDetails]));
  const vanMileageById = new Map<string, number | null>();

  for (const row of (vanMileageResult.data || []) as Array<{ van_id: string | null; current_mileage: number | null }>) {
    if (row.van_id && !vanMileageById.has(row.van_id)) {
      vanMileageById.set(row.van_id, row.current_mileage);
    }
  }

  return actions.map((action) => {
    if (action.asset_type === 'van' && action.van_id) {
      const asset = vansById.get(action.van_id);
      if (!asset) return action;

      return {
        ...action,
        asset_label: buildVehicleLabel(asset),
        metadata: {
          ...action.metadata,
          asset_label: buildVehicleLabel(asset),
          asset_registration: asset.reg_number?.trim() || null,
          asset_nickname: asset.nickname?.trim() || null,
          asset_current_mileage: vanMileageById.get(action.van_id) ?? null,
        },
      };
    }

    if (action.asset_type === 'hgv' && action.hgv_id) {
      const asset = hgvsById.get(action.hgv_id);
      if (!asset) return action;

      return {
        ...action,
        asset_label: buildVehicleLabel(asset),
        metadata: {
          ...action.metadata,
          asset_label: buildVehicleLabel(asset),
          asset_registration: asset.reg_number?.trim() || null,
          asset_nickname: asset.nickname?.trim() || null,
          asset_current_mileage: asset.current_mileage ?? null,
        },
      };
    }

    if (action.asset_type === 'plant' && action.plant_id) {
      const asset = plantById.get(action.plant_id);
      if (!asset) return action;

      return {
        ...action,
        asset_label: buildPlantLabel(asset),
        metadata: {
          ...action.metadata,
          asset_label: buildPlantLabel(asset),
          asset_registration: asset.reg_number?.trim() || null,
          asset_plant_id: asset.plant_id?.trim() || null,
          asset_serial_number: asset.serial_number?.trim() || null,
          asset_nickname: asset.nickname?.trim() || null,
          asset_current_hours: asset.current_hours ?? null,
        },
      };
    }

    return action;
  });
}

export async function GET(request: NextRequest) {
  try {
    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const statusFilter = request.nextUrl.searchParams.get('status');
    const workflowKey = request.nextUrl.searchParams.get('workflow');
    const assetType = request.nextUrl.searchParams.get('asset_type');
    const ignoredFilter = request.nextUrl.searchParams.get('ignored');
    const ensureFresh = request.nextUrl.searchParams.get('ensure_fresh') === 'true';
    const nowIso = new Date().toISOString();
    const admin = createAdminClient();

    if (ensureFresh && workflowKey === FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY && statusFilter === 'open') {
      await ensureFleetInspectionReminderActionsFresh({
        staleAfterMs: ACTIONS_PAGE_FLEET_INSPECTION_REFRESH_INTERVAL_MS,
      });
    }

    let query = admin
      .from('reminder_actions')
      .select(`
        id,
        workflow_key,
        source_type,
        dedupe_key,
        status,
        priority,
        title,
        description,
        asset_type,
        van_id,
        plant_id,
        hgv_id,
        metadata,
        created_by,
        resolved_by,
        ignored_until,
        ignored_forever,
        ignored_at,
        ignored_by,
        first_detected_at,
        last_detected_at,
        resolved_at,
        created_at,
        updated_at,
        reminders (
          id,
          status
        )
      `)
      .order('last_detected_at', { ascending: false });

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (workflowKey) {
      query = query.eq('workflow_key', workflowKey);
    }

    if (assetType && assetType !== 'all') {
      query = query.eq('asset_type', assetType);
    }

    if (ignoredFilter === 'active') {
      query = query.or(`ignored_forever.eq.true,ignored_until.gt.${nowIso}`);
    } else if (ignoredFilter !== 'all') {
      query = query
        .eq('ignored_forever', false)
        .or(`ignored_until.is.null,ignored_until.lte.${nowIso}`);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const actions = (data || []).map((row) => mapReminderActionWithAsset(row));
    const enrichedActions = await enrichActionAssetMetadata(admin, actions);

    return NextResponse.json({
      success: true,
      actions: enrichedActions,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions',
      additionalData: {
        endpoint: 'GET /api/actions',
      },
    });

    return NextResponse.json(
      { error: 'Failed to load actions' },
      { status: 500 },
    );
  }
}
