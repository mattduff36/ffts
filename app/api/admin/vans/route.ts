import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { formatRegistrationForStorage, validateRegistrationNumber } from '@/lib/utils/registration';
import {
  isExpectedFleetDvlaLookupFailure,
  isRoadEligibleRegistration,
  runFleetDvlaSync,
} from '@/lib/services/fleet-dvla-sync';
import type { Database } from '@/types/database';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface ProfileNameShape {
  full_name?: string | null;
}

interface VanInspectionLookupRow {
  van_id: string;
  inspection_date?: string | null;
  profiles?: ProfileNameShape | ProfileNameShape[] | null;
}

function pickProfileName(
  profile: ProfileNameShape | ProfileNameShape[] | null | undefined
): string | null {
  if (!profile) return null;
  const profileEntry = Array.isArray(profile) ? profile[0] ?? null : profile;
  return profileEntry?.full_name ?? null;
}

// GET - List all vans with category and last inspector info
export async function GET(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json(
        { error: 'Forbidden: Fleet admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    const { data: vehicles, error } = await supabase
      .from('vans')
      .select(`
        *,
        van_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    const vehicleRows = vehicles || [];
    const latestInspectionByVanId = new Map<string, VanInspectionLookupRow>();

    if (vehicleRows.length > 0) {
      const { data: inspections, error: inspectionsError } = await supabase
        .from('van_inspections')
        .select(`
          van_id,
          inspection_date,
          profiles!van_inspections_user_id_fkey (
            full_name
          )
        `)
        .in('van_id', vehicleRows.map((vehicle) => vehicle.id))
        .order('inspection_date', { ascending: false });

      if (inspectionsError) throw inspectionsError;

      for (const inspection of (inspections || []) as VanInspectionLookupRow[]) {
        if (!latestInspectionByVanId.has(inspection.van_id)) {
          latestInspectionByVanId.set(inspection.van_id, inspection);
        }
      }
    }

    const vehiclesWithInspector = vehicleRows.map((vehicle) => {
      const lastInspection = latestInspectionByVanId.get(vehicle.id) || null;

      return {
        ...vehicle,
        last_inspector: pickProfileName(
          lastInspection?.profiles as ProfileNameShape | ProfileNameShape[] | null
        ),
        last_inspection_date: lastInspection?.inspection_date || null,
      };
    });

    return NextResponse.json({ vehicles: vehiclesWithInspector });
  } catch (error) {
    console.error('Error fetching vans:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new van
export async function POST(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json(
        { error: 'Forbidden: Fleet admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    const body = await request.json();
    const { 
      reg_number, 
      category_id, 
      nickname,
      status = 'active'
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    const validationError = validateRegistrationNumber(reg_number);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    
    const cleanReg = formatRegistrationForStorage(reg_number);

    const { data, error } = await supabase
      .from('vans')
      .insert({
        reg_number: cleanReg,
        category_id: category_id,
        status: status,
        nickname: nickname?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Van with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    console.log(`[INFO] Van created: ${data.reg_number} (ID: ${data.id})`);

    // Automatically sync TAX and MOT data from APIs (non-blocking)
    const syncResult = await syncVanData(data.id, data.reg_number || cleanReg, effectiveRole.user_id, supabase);

    return NextResponse.json({ 
      vehicle: data,
      syncResult: syncResult,
      message: syncResult.success 
        ? 'Van created and data synced successfully'
        : 'Van created. Note: ' + (syncResult.warning || 'API sync will retry automatically')
    });
  } catch (error) {
    console.error('Error creating van:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Sync van data from DVLA and MOT APIs
 * Runs automatically when a new van is added
 */
async function syncVanData(
  vanId: string, 
  regNumber: string, 
  userId: string,
  supabase: SupabaseClient<Database>
) {
  if (!isRoadEligibleRegistration(regNumber)) {
    console.log(`[INFO] Skipping API sync for test van: ${regNumber}`);
    return { 
      success: true, 
      skipped: true,
      reason: 'test vehicle' 
    };
  }

  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    console.log(`[WARN] DVLA API not configured, skipping auto-sync for ${regNumber}`);
    return { 
      success: false, 
      warning: 'DVLA API not configured' 
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
          assetType: 'van',
          assetId: vanId,
          registrationNumber: regNumber,
        },
      ],
      triggerType: 'auto_on_create',
      triggeredBy: userId,
    });

    const row = summary.results[0];
    if (!row || !row.success) {
      throw new Error(row?.error || row?.errors?.[0] || 'Unknown auto-sync error');
    }

    return {
      success: true,
      fieldsUpdated: row.updatedFields || [],
      responseTime: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown auto-sync error';
    const shouldLogServerError = !isExpectedFleetDvlaLookupFailure(message);

    if (shouldLogServerError) {
      console.error(`[ERROR] Auto-sync failed for ${regNumber}:`, message);
      await logServerError({
        error: error as Error,
        componentName: 'syncVanData',
        additionalData: {
          vanId,
          regNumber,
          context: 'auto_sync_on_van_create'
        },
      });
    } else {
      console.warn(`[WARN] DVLA lookup did not find ${regNumber}:`, message);
    }

    return {
      success: false,
      error: message,
      warning: 'Could not fetch vehicle data from DVLA/MOT APIs. Please check the registration number or try manual sync later.'
    };
  }
}
