import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { inferAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';
import type { Database } from '@/types/database';

type AssetType = 'van' | 'plant' | 'hgv';
type ActionInsert = Database['public']['Tables']['actions']['Insert'];
type VehicleMaintenanceInsert = Database['public']['Tables']['vehicle_maintenance']['Insert'];

interface CreateWorkshopTaskBody {
  vehicle_id?: string;
  asset_type?: AssetType;
  workshop_category_id?: string | null;
  workshop_subcategory_id?: string | null;
  workshop_comments?: string;
  meter_reading?: number | string;
  title?: string | null;
}

interface AssetRecord {
  id: string;
  label: string;
}

function isAssetType(value: unknown): value is AssetType {
  return value === 'van' || value === 'plant' || value === 'hgv';
}

function parseMeterReading(value: number | string | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

async function resolveAsset(assetType: AssetType, assetId: string): Promise<AssetRecord | null> {
  const admin = createAdminClient();

  if (assetType === 'plant') {
    const { data, error } = await admin
      .from('plant')
      .select('id, plant_id, nickname')
      .eq('id', assetId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      label: data.nickname ? `${data.plant_id || 'Unknown Plant'} (${data.nickname})` : data.plant_id || 'Unknown Plant',
    };
  }

  const table = assetType === 'hgv' ? 'hgvs' : 'vans';
  const { data, error } = await admin
    .from(table)
    .select('id, reg_number, nickname')
    .eq('id', assetId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const label = data.reg_number || 'Unknown Asset';
  return {
    id: data.id,
    label: data.nickname ? `${label} (${data.nickname})` : label,
  };
}

async function updateMeterReading({
  assetId,
  assetType,
  readingValue,
  userId,
}: {
  assetId: string;
  assetType: AssetType;
  readingValue: number;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const idColumn = assetType === 'plant' ? 'plant_id' : assetType === 'hgv' ? 'hgv_id' : 'van_id';
  const now = new Date().toISOString();

  const meterFields: VehicleMaintenanceInsert = {
    last_updated_at: now,
    last_updated_by: userId,
  };

  if (assetType === 'plant') {
    meterFields.plant_id = assetId;
    meterFields.current_hours = readingValue;
    meterFields.last_hours_update = now;
  } else {
    if (assetType === 'hgv') {
      meterFields.hgv_id = assetId;
    } else {
      meterFields.van_id = assetId;
    }
    meterFields.current_mileage = readingValue;
    meterFields.last_mileage_update = now;
  }

  const { data: existingMaintenance, error: existingMaintenanceError } = await admin
    .from('vehicle_maintenance')
    .select('id')
    .eq(idColumn, assetId)
    .order('last_updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingMaintenanceError) throw existingMaintenanceError;

  const { error } = existingMaintenance
    ? await admin
        .from('vehicle_maintenance')
        .update(meterFields)
        .eq('id', existingMaintenance.id)
    : await admin
        .from('vehicle_maintenance')
        .insert(meterFields);

  if (error) throw error;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessWorkshopTasks = await canEffectiveRoleAccessModule('workshop-tasks');
    if (!canAccessWorkshopTasks) {
      return NextResponse.json(
        { error: 'Forbidden: Workshop Tasks access required' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateWorkshopTaskBody;
    const vehicleId = body.vehicle_id?.trim();
    const comments = body.workshop_comments?.trim() || '';
    const readingValue = parseMeterReading(body.meter_reading);

    if (!vehicleId || !isAssetType(body.asset_type)) {
      return NextResponse.json({ error: 'A valid asset is required' }, { status: 400 });
    }

    if (!body.workshop_category_id && !body.workshop_subcategory_id) {
      return NextResponse.json({ error: 'A workshop category is required' }, { status: 400 });
    }

    if (comments.length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      return NextResponse.json({ error: `Comments must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters` }, { status: 400 });
    }

    if (readingValue === null) {
      return NextResponse.json({ error: 'A valid meter reading is required' }, { status: 400 });
    }

    const asset = await resolveAsset(body.asset_type, vehicleId);
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const taskData: ActionInsert = {
      action_type: 'workshop_vehicle_task',
      workshop_comments: comments,
      title: body.title?.trim() || `Workshop Task - ${asset.label}`,
      description: comments.substring(0, 200),
      status: 'pending',
      priority: 'medium',
      created_by: user.id,
      asset_meter_reading: readingValue,
      asset_meter_unit: inferAssetMeterUnit(body.asset_type),
    };

    if (body.workshop_subcategory_id) {
      taskData.workshop_subcategory_id = body.workshop_subcategory_id;
    } else {
      taskData.workshop_category_id = body.workshop_category_id || null;
      taskData.workshop_subcategory_id = null;
    }

    if (body.asset_type === 'plant') {
      taskData.plant_id = vehicleId;
    } else if (body.asset_type === 'hgv') {
      taskData.hgv_id = vehicleId;
    } else {
      taskData.van_id = vehicleId;
    }

    const admin = createAdminClient();
    const { data: task, error: taskError } = await admin
      .from('actions')
      .insert(taskData)
      .select('id')
      .single();

    if (taskError) throw taskError;

    let meterReadingUpdated = true;
    try {
      await updateMeterReading({
        assetId: vehicleId,
        assetType: body.asset_type,
        readingValue,
        userId: user.id,
      });
    } catch (meterReadingError) {
      meterReadingUpdated = false;
      console.error('Error updating workshop task meter reading:', meterReadingError);
      await logServerError({
        error: meterReadingError as Error,
        request,
        componentName: '/api/workshop-tasks/tasks',
        additionalData: {
          endpoint: 'POST /api/workshop-tasks/tasks',
          task_id: task.id,
          asset_type: body.asset_type,
        },
      });
    }

    return NextResponse.json({
      success: true,
      task,
      meter_reading_updated: meterReadingUpdated,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating workshop task:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/tasks',
      },
    });
    return NextResponse.json(
      { error: 'Failed to create workshop task' },
      { status: 500 },
    );
  }
}
