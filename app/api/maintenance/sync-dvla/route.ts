import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  isRoadEligibleRegistration,
  runFleetDvlaSync,
  type FleetAssetType,
  type FleetSyncTarget,
} from '@/lib/services/fleet-dvla-sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export const dynamic = 'force-dynamic';

interface SyncRequestBody {
  vehicleId?: string;
  vehicleIds?: string[];
  assetId?: string;
  assetIds?: string[];
  assetType?: FleetAssetType;
  syncAll?: boolean;
}

function mapTableToAssetType(tableName: 'vans' | 'hgvs' | 'plant'): FleetAssetType {
  if (tableName === 'hgvs') return 'hgv';
  if (tableName === 'plant') return 'plant';
  return 'van';
}

function filterRoadEligible(targets: FleetSyncTarget[]): FleetSyncTarget[] {
  return targets.filter((target) => isRoadEligibleRegistration(target.registrationNumber));
}

async function loadTargetsByTable(
  supabase: SupabaseClient<Database>,
  tableName: 'vans' | 'hgvs' | 'plant',
  options: { ids?: string[]; activeOnly?: boolean }
): Promise<FleetSyncTarget[]> {
  let query = supabase.from(tableName).select('id, reg_number');
  if (options.ids?.length) query = query.in('id', options.ids);
  if (options.activeOnly) query = query.eq('status', 'active');

  const { data, error } = await query;
  if (error) throw error;

  return (data || [])
    .filter((row) => Boolean(row.reg_number))
    .map((row) => ({
      assetType: mapTableToAssetType(tableName),
      assetId: row.id,
      registrationNumber: row.reg_number as string,
    }));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Internal server error';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if DVLA API is configured
    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'DVLA API not configured',
          message: 'Please configure DVLA_API_PROVIDER, DVLA_API_KEY, and DVLA_API_BASE_URL in .env.local'
        },
        { status: 503 }
      );
    }

    // Check if MOT API is configured (optional, sync will continue if not available)
    const motService = createMotHistoryService();

    const body = (await request.json()) as SyncRequestBody;
    const { vehicleId, vehicleIds, assetId, assetIds, assetType, syncAll } = body;

    const combinedIds = [
      ...(Array.isArray(vehicleIds) ? vehicleIds : []),
      ...(Array.isArray(assetIds) ? assetIds : []),
      ...(vehicleId ? [vehicleId] : []),
      ...(assetId ? [assetId] : []),
    ];
    const requestedIds = Array.from(new Set(combinedIds));

    let targets: FleetSyncTarget[] = [];
    if (syncAll) {
      const [vanTargets, hgvTargets, plantTargets] = await Promise.all([
        loadTargetsByTable(supabase, 'vans', { activeOnly: true }),
        loadTargetsByTable(supabase, 'hgvs', { activeOnly: true }),
        loadTargetsByTable(supabase, 'plant', { activeOnly: true }),
      ]);
      targets = [...vanTargets, ...hgvTargets, ...plantTargets];
    } else if (requestedIds.length > 0) {
      if (assetType) {
        const tableName = assetType === 'hgv' ? 'hgvs' : assetType === 'plant' ? 'plant' : 'vans';
        targets = await loadTargetsByTable(supabase, tableName, { ids: requestedIds });
      } else {
        const [vanTargets, hgvTargets, plantTargets] = await Promise.all([
          loadTargetsByTable(supabase, 'vans', { ids: requestedIds }),
          loadTargetsByTable(supabase, 'hgvs', { ids: requestedIds }),
          loadTargetsByTable(supabase, 'plant', { ids: requestedIds }),
        ]);
        targets = [...vanTargets, ...hgvTargets, ...plantTargets];
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'No assets specified' },
        { status: 400 }
      );
    }

    targets = filterRoadEligible(targets);

    if (targets.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No road-eligible assets found' },
        { status: 404 }
      );
    }

    const bulkRequested = Boolean(syncAll || (vehicleIds?.length || 0) > 1 || (assetIds?.length || 0) > 1);
    const summary = await runFleetDvlaSync({
      supabase,
      dvlaService,
      motService,
      targets,
      triggerType: bulkRequested ? 'bulk' : 'manual',
      triggeredBy: user.id,
    });

    return NextResponse.json({
      success: true,
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
      results: summary.results,
    });

  } catch (error: unknown) {
    await logServerError({
      error: error instanceof Error ? error : String(error),
      request,
      componentName: '/api/maintenance/sync-dvla',
      additionalData: {
        endpoint: '/api/maintenance/sync-dvla',
        method: 'POST',
      },
    });

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

