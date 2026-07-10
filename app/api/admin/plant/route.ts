import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { isRoadEligibleRegistration, runFleetDvlaSync } from '@/lib/services/fleet-dvla-sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';

export async function POST(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet)
      return NextResponse.json({ error: 'Forbidden: Fleet admin access required' }, { status: 403 });

    const supabase = await createServerClient();
    const body = await request.json();
    const {
      plant_id,
      category_id,
      nickname,
      reg_number,
      serial_number,
      year,
      weight_class,
      status = 'active',
    } = body;

    if (!plant_id) return NextResponse.json({ error: 'Plant ID is required' }, { status: 400 });
    if (!category_id) return NextResponse.json({ error: 'Category is required' }, { status: 400 });

    const serialNumberResult = validateAndNormalizePlantSerialNumber(serial_number);
    if (!serialNumberResult.valid) {
      return NextResponse.json({ error: serialNumberResult.error || 'Serial Number is invalid' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('plant')
      .insert({
        plant_id: String(plant_id).trim(),
        category_id,
        nickname: nickname?.trim() || null,
        reg_number: reg_number?.trim() || null,
        serial_number: serialNumberResult.value,
        year: typeof year === 'number' ? year : null,
        weight_class: weight_class?.trim() || null,
        status,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505' && String(error.message || '').includes('serial_number'))
        return NextResponse.json({ error: 'Plant with this Serial Number already exists' }, { status: 400 });
      if (error.code === '23505')
        return NextResponse.json({ error: 'Plant with this ID already exists' }, { status: 400 });
      throw error;
    }

    console.log(`[INFO] Plant created: ${data.plant_id} (ID: ${data.id})`);

    let syncResult: { success: boolean; warning?: string } = { success: true };
    if (data.reg_number) {
      syncResult = await syncPlantData(data.id, data.reg_number, effectiveRole.user_id, supabase);
    }

    return NextResponse.json({
      plant: data,
      syncResult,
      message: syncResult.success
        ? data.reg_number
          ? 'Plant created and data synced successfully'
          : 'Plant created successfully'
        : 'Plant created. Note: ' + (syncResult.warning || 'API sync will retry automatically'),
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/plant',
      additionalData: { endpoint: '/api/admin/plant' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function syncPlantData(
  plantId: string,
  regNumber: string,
  userId: string,
  supabase: SupabaseClient<Database>
) {
  if (!isRoadEligibleRegistration(regNumber)) {
    return {
      success: true,
      skipped: true,
      reason: 'not road-eligible',
    };
  }

  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    return {
      success: false,
      warning: 'DVLA API not configured',
    };
  }

  const motService = createMotHistoryService();

  try {
    const summary = await runFleetDvlaSync({
      supabase,
      dvlaService,
      motService,
      targets: [
        {
          assetType: 'plant',
          assetId: plantId,
          registrationNumber: regNumber,
        },
      ],
      triggerType: 'auto_on_create',
      triggeredBy: userId,
    });

    const row = summary.results[0];
    if (!row || !row.success) {
      throw new Error(row?.error || row?.errors?.[0] || 'Unknown plant auto-sync error');
    }

    return {
      success: true,
      fieldsUpdated: row.updatedFields || [],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown plant auto-sync error';
    await logServerError({
      error: error as Error,
      componentName: 'syncPlantData',
      additionalData: {
        plantId,
        regNumber,
        context: 'auto_sync_on_plant_create',
      },
    });

    return {
      success: false,
      error: message,
      warning: 'Could not fetch plant data from DVLA/MOT APIs. Please check the registration number or try manual sync later.',
    };
  }
}

