import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
export const maxDuration = 300; // 5 minutes max execution time

function mapTableToAssetType(tableName: 'vans' | 'hgvs' | 'plant'): FleetAssetType {
  if (tableName === 'hgvs') return 'hgv';
  if (tableName === 'plant') return 'plant';
  return 'van';
}

async function loadActiveTargets(
  supabase: SupabaseClient<Database>,
  tableName: 'vans' | 'hgvs' | 'plant'
): Promise<FleetSyncTarget[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select('id, reg_number')
    .eq('status', 'active');
  if (error) throw error;

  return (data || [])
    .filter((row) => Boolean(row.reg_number))
    .map((row) => ({
      assetType: mapTableToAssetType(tableName),
      assetId: row.id,
      registrationNumber: row.reg_number as string,
    }))
    .filter((target) => isRoadEligibleRegistration(target.registrationNumber));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Internal server error';
}

async function handleScheduledSync(request: NextRequest, method: 'GET' | 'POST') {
  const startedAt = Date.now();
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('Scheduled DVLA sync unauthorized', {
        method,
        hasCronSecret: Boolean(cronSecret),
        hasAuthorizationHeader: Boolean(authHeader),
      });
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createAdminClient();
    const maxTargets = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get('limit') || '40', 10) || 40, 1),
      100
    );

    // Check if DVLA API is configured
    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      console.log('DVLA API not configured - skipping scheduled sync');
      return NextResponse.json({
        success: true,
        message: 'DVLA API not configured',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }

    // Check if MOT API is configured (optional, sync will continue if not available)
    const motService = createMotHistoryService();

    const [vanTargets, hgvTargets, plantTargets] = await Promise.all([
      loadActiveTargets(supabase, 'vans'),
      loadActiveTargets(supabase, 'hgvs'),
      loadActiveTargets(supabase, 'plant'),
    ]);
    const allTargets = [...vanTargets, ...hgvTargets, ...plantTargets];

    if (allTargets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active road-eligible assets to sync',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }

    const { data: maintenanceRecords } = await supabase.from('vehicle_maintenance').select(
      'van_id, hgv_id, plant_id, last_dvla_sync'
    );
    const maintenanceMap = new Map<string, string | null>();
    for (const row of maintenanceRecords || []) {
      if (row.van_id) maintenanceMap.set(`van:${row.van_id}`, row.last_dvla_sync);
      if (row.hgv_id) maintenanceMap.set(`hgv:${row.hgv_id}`, row.last_dvla_sync);
      if (row.plant_id) maintenanceMap.set(`plant:${row.plant_id}`, row.last_dvla_sync);
    }

    // Filter assets that need syncing (not synced in the last 23 hours)
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

    const dueTargets = allTargets.filter((target) => {
      const lastSync = maintenanceMap.get(`${target.assetType}:${target.assetId}`);
      if (!lastSync) return true; // Never synced
      return new Date(lastSync) < twentyThreeHoursAgo; // Synced more than 23 hours ago
    });
    const targetsToSync = dueTargets
      .sort((a, b) => {
        const aLastSync = maintenanceMap.get(`${a.assetType}:${a.assetId}`);
        const bLastSync = maintenanceMap.get(`${b.assetType}:${b.assetId}`);
        if (!aLastSync && !bLastSync) return 0;
        if (!aLastSync) return -1;
        if (!bLastSync) return 1;
        return new Date(aLastSync).getTime() - new Date(bLastSync).getTime();
      })
      .slice(0, maxTargets);

    console.log(`Scheduled sync: ${targetsToSync.length}/${allTargets.length} assets selected for syncing`);

    if (dueTargets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All road-eligible assets recently synced',
        total: allTargets.length,
        successful: 0,
        failed: 0,
        skipped: allTargets.length,
      });
    }

    const summary = await runFleetDvlaSync({
      supabase,
      dvlaService,
      motService,
      targets: targetsToSync,
      triggerType: 'automatic',
      triggeredBy: null,
      logPrefix: '[CRON] ',
      delayMsBetweenRequests: 1000,
    });

    console.log('Scheduled sync complete', {
      duration_ms: Date.now() - startedAt,
      total_assets: allTargets.length,
      due_assets: dueTargets.length,
      processed_assets: targetsToSync.length,
      successful: summary.successful,
      failed: summary.failed,
      deferred: Math.max(dueTargets.length - targetsToSync.length, 0),
    });

    return NextResponse.json({
      success: true,
      total: allTargets.length,
      due: dueTargets.length,
      synced: targetsToSync.length,
      successful: summary.successful,
      failed: summary.failed,
      skipped: allTargets.length - targetsToSync.length,
      deferred: Math.max(dueTargets.length - targetsToSync.length, 0),
      results: summary.results,
    });

  } catch (error: unknown) {
    await logServerError({
      error: error instanceof Error ? error : String(error),
      request,
      componentName: '/api/maintenance/sync-dvla-scheduled',
      additionalData: {
        endpoint: '/api/maintenance/sync-dvla-scheduled',
        method,
      },
    });

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleScheduledSync(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handleScheduledSync(request, 'POST');
}

