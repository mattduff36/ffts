import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createDebugAccessErrorBody, requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import { logServerError } from '@/lib/utils/server-error-logger';

type FleetItem = {
  id: string;
  reg_number?: string;
  plant_id?: string;
  category_id?: string;
  status?: string;
};

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function getReminderAssetColumns(fleetType: 'vans' | 'hgvs' | 'plant') {
  if (fleetType === 'hgvs') {
    return { assetType: 'hgv', idColumn: 'hgv_id' } as const;
  }

  if (fleetType === 'plant') {
    return { assetType: 'plant', idColumn: 'plant_id' } as const;
  }

  return { assetType: 'van', idColumn: 'van_id' } as const;
}

async function getReminderActionCleanupTargets(
  adminSupabase: ReturnType<typeof getSupabaseAdmin>,
  fleetType: 'vans' | 'hgvs' | 'plant',
  itemIds: string[],
) {
  if (itemIds.length === 0) {
    return {
      actionIds: [] as string[],
      reminderCount: 0,
    };
  }

  const { assetType, idColumn } = getReminderAssetColumns(fleetType);
  const { data: reminderActions, error: actionsError } = await adminSupabase
    .from('reminder_actions')
    .select('id')
    .eq('asset_type', assetType)
    .in(idColumn, itemIds);

  if (actionsError) {
    throw actionsError;
  }

  const actionIds = (reminderActions || []).map((action) => action.id);
  if (actionIds.length === 0) {
    return {
      actionIds,
      reminderCount: 0,
    };
  }

  const { count: reminderCount, error: remindersError } = await adminSupabase
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .in('action_id', actionIds);

  if (remindersError) {
    throw remindersError;
  }

  return {
    actionIds,
    reminderCount: reminderCount || 0,
  };
}

async function deleteReminderActionsForFleetItems(
  adminSupabase: ReturnType<typeof getSupabaseAdmin>,
  fleetType: 'vans' | 'hgvs' | 'plant',
  itemIds: string[],
) {
  const targets = await getReminderActionCleanupTargets(adminSupabase, fleetType, itemIds);
  if (targets.actionIds.length === 0) {
    return targets;
  }

  const { error } = await adminSupabase
    .from('reminder_actions')
    .delete()
    .in('id', targets.actionIds);

  if (error) {
    throw error;
  }

  return targets;
}

/**
 * GET /api/debug/test-vehicles
 * List fleet items (vans, HGVs, and/or plant) matching a prefix (for test data management)
 * SuperAdmin only
 * Query: prefix=ZZ99, type=vans|hgvs|plant|all
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireDebugConsoleAccess();
    if (!access.ok) {
      return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get('prefix') || 'ZZ99';
    const typeParam = searchParams.get('type') || 'all'; // vans | hgvs | plant | all

    type FleetItem = { id: string; reg_number: string; nickname: string | null; status: string; fleet_type: 'van' | 'hgv' | 'plant' };
    const adminSupabase = getSupabaseAdmin();
    const result: {
      vans: FleetItem[];
      hgvs: FleetItem[];
      plant: FleetItem[];
      prefix: string;
    } = { vans: [], hgvs: [], plant: [], prefix };

    if (typeParam === 'vans' || typeParam === 'all') {
      const { data: vans, error } = await adminSupabase
        .from('vans')
        .select('id, reg_number, nickname, status')
        .ilike('reg_number', `${prefix}%`)
        .order('reg_number');

      if (error) throw error;
      result.vans = (vans || []).map(v => ({ ...v, fleet_type: 'van' as const }));
    }

    if (typeParam === 'hgvs' || typeParam === 'all') {
      const { data: hgvs, error } = await adminSupabase
        .from('hgvs')
        .select('id, reg_number, nickname, status')
        .ilike('reg_number', `${prefix}%`)
        .order('reg_number');

      if (error) throw error;
      result.hgvs = (hgvs || []).map(h => ({ ...h, fleet_type: 'hgv' as const }));
    }

    if (typeParam === 'plant' || typeParam === 'all') {
      const { data: plantItems, error } = await adminSupabase
        .from('plant')
        .select('id, plant_id, nickname, status')
        .ilike('plant_id', `${prefix}%`)
        .order('plant_id');

      if (error) throw error;
      result.plant = (plantItems || []).map(p => ({
        id: p.id,
        reg_number: p.plant_id,
        nickname: p.nickname,
        status: p.status,
        fleet_type: 'plant' as const,
      }));
    }

    // For backward compatibility: when type=vans only, return { vehicles } for existing tests
    if (typeParam === 'vans') {
      return NextResponse.json({
        success: true,
        vehicles: result.vans,
        vans: result.vans,
        hgvs: [],
        plant: [],
        prefix,
      });
    }

    return NextResponse.json({
      success: true,
      vehicles: [...result.vans, ...result.hgvs, ...result.plant],
      vans: result.vans,
      hgvs: result.hgvs,
      plant: result.plant,
      prefix,
    });
  } catch (error) {
    console.error('Error fetching test vehicles:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'GET /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/debug/test-vehicles
 * Preview or execute purge operations on test vehicles
 * SuperAdmin only
 */
export async function POST(request: NextRequest) {
  try {
    const access = await requireDebugConsoleAccess();
    if (!access.ok) {
      return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
    }

    const body = await request.json();
    const {
      mode,
      vehicle_ids,
      prefix,
      actions,
      fleet_type = 'vans', // vans | hgvs | plant
    } = body;

    // Validate required fields
    if (!mode || !['preview', 'execute'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "preview" or "execute"' },
        { status: 400 }
      );
    }

    if (!vehicle_ids || !Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return NextResponse.json(
        { error: 'vehicle_ids is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    const validPrefix = prefix || 'ZZ99';
    const fleetType = fleet_type === 'hgvs' ? 'hgvs' : fleet_type === 'plant' ? 'plant' : 'vans';
    const adminSupabase = getSupabaseAdmin();

    const table = fleetType === 'hgvs' ? 'hgvs' : fleetType === 'plant' ? 'plant' : 'vans';
    const idColumn = fleetType === 'hgvs' ? 'hgv_id' : fleetType === 'plant' ? 'plant_id' : 'van_id';
    const regColumn = fleetType === 'plant' ? 'plant_id' : 'reg_number';

    // SECURITY: Verify all selected items match the prefix
    const { data: rawItemsToProcess, error: itemError } = await adminSupabase
      .from(table)
      .select(`id, ${regColumn}`)
      .in('id', vehicle_ids);

    if (itemError) {
      throw itemError;
    }

    if (!rawItemsToProcess || rawItemsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No fleet items found with provided IDs' },
        { status: 404 }
      );
    }

    const itemsToProcess = rawItemsToProcess as FleetItem[];

    // CRITICAL SECURITY CHECK: Verify ALL items match the prefix
    const invalidItems = itemsToProcess.filter(
      v => !((v[regColumn as keyof FleetItem] as string) ?? '').toUpperCase().startsWith(validPrefix.toUpperCase())
    );

    if (invalidItems.length > 0) {
      return NextResponse.json(
        {
          error: `Security violation: Cannot process items that don't match prefix "${validPrefix}"`,
          invalid_vehicles: invalidItems.map(v => v[regColumn as keyof FleetItem]),
        },
        { status: 403 }
      );
    }

    const itemIds = itemsToProcess.map(v => v.id);

    // Build counts object
    const counts: Record<string, number> = {};

    if (actions?.inspections) {
      const reminderTargets = await getReminderActionCleanupTargets(adminSupabase, fleetType, itemIds);
      counts.reminder_actions = reminderTargets.actionIds.length;
      counts.reminders = reminderTargets.reminderCount;

      if (mode === 'execute' && reminderTargets.actionIds.length > 0) {
        const { error: deleteReminderActionsError } = await adminSupabase
          .from('reminder_actions')
          .delete()
          .in('id', reminderTargets.actionIds);

        if (deleteReminderActionsError) throw deleteReminderActionsError;
      }
    }

    // Count/delete inspections (van_inspections, hgv_inspections, or plant_inspections)
    if (actions?.inspections) {
      if (fleetType === 'vans') {
        const { count: inspectionCount } = await adminSupabase
          .from('van_inspections')
          .select('id', { count: 'exact', head: true })
          .in('van_id', itemIds);

        counts.inspections = inspectionCount || 0;

        if (mode === 'execute' && counts.inspections > 0) {
          const { error: deleteError } = await adminSupabase
            .from('van_inspections')
            .delete()
            .in('van_id', itemIds);

          if (deleteError) throw deleteError;
        }
      } else if (fleetType === 'hgvs') {
        const { data: hgvInspections } = await adminSupabase
          .from('hgv_inspections')
          .select('id')
          .in('hgv_id', itemIds);

        const inspectionIds = hgvInspections?.map(i => i.id) || [];
        counts.inspections = inspectionIds.length;

        if (mode === 'execute' && inspectionIds.length > 0) {
          await adminSupabase.from('inspection_items').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_photos').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_daily_hours').delete().in('inspection_id', inspectionIds);
          const { error: deleteError } = await adminSupabase
            .from('hgv_inspections')
            .delete()
            .in('id', inspectionIds);

          if (deleteError) throw deleteError;
        }
      } else {
        // Plant: plant_inspections with child tables
        const { data: plantInspections } = await adminSupabase
          .from('plant_inspections')
          .select('id')
          .in('plant_id', itemIds);

        const inspectionIds = plantInspections?.map(i => i.id) || [];
        counts.inspections = inspectionIds.length;

        if (mode === 'execute' && inspectionIds.length > 0) {
          await adminSupabase.from('inspection_items').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_photos').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_daily_hours').delete().in('inspection_id', inspectionIds);
          const { error: deleteError } = await adminSupabase
            .from('plant_inspections')
            .delete()
            .in('id', inspectionIds);

          if (deleteError) throw deleteError;
        }
      }
    }

    // Count/delete workshop tasks (actions table)
    if (actions?.workshop_tasks) {
      const taskQuery = adminSupabase
        .from('actions')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, itemIds)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);
      const { count: taskCount } = await taskQuery;
      counts.workshop_tasks = taskCount || 0;

      if (mode === 'execute' && counts.workshop_tasks > 0) {
        const { error: deleteError } = await adminSupabase
          .from('actions')
          .delete()
          .in(idColumn, itemIds)
          .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

        if (deleteError) throw deleteError;
      }
    }

    // Count/delete workshop task attachments
    if (actions?.attachments || actions?.workshop_tasks) {
      const { data: tasksForAttachments } = await adminSupabase
        .from('actions')
        .select('id')
        .in(idColumn, itemIds)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

      const taskIdsForAttachments = tasksForAttachments?.map(t => t.id) || [];

      if (taskIdsForAttachments.length > 0) {
        const { count: attachmentsCount } = await adminSupabase
          .from('workshop_task_attachments')
          .select('id', { count: 'exact', head: true })
          .in('task_id', taskIdsForAttachments);

        counts.workshop_attachments = attachmentsCount || 0;

        if (mode === 'execute' && actions?.attachments && counts.workshop_attachments > 0) {
          const { data: attachmentsToDelete } = await adminSupabase
            .from('workshop_task_attachments')
            .select('id')
            .in('task_id', taskIdsForAttachments);

          const attachmentIds = attachmentsToDelete?.map(a => a.id) || [];

          if (attachmentIds.length > 0) {
            const { error: e } = await adminSupabase.from('workshop_task_attachments').delete().in('id', attachmentIds);
            if (e) throw e;
          }
        }
      } else {
        counts.workshop_attachments = 0;
      }
    }

    // Count/delete maintenance records
    if (actions?.maintenance) {
      const { count: maintenanceCount } = await adminSupabase
        .from('vehicle_maintenance')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, itemIds);

      counts.maintenance_records = maintenanceCount || 0;

      const { count: historyCount } = await adminSupabase
        .from('maintenance_history')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, itemIds);

      counts.maintenance_history = historyCount || 0;

      if (mode === 'execute') {
        if (counts.maintenance_history > 0) {
          const { error: e } = await adminSupabase
            .from('maintenance_history')
            .delete()
            .in(idColumn, itemIds);
          if (e) throw e;
        }
        if (counts.maintenance_records > 0) {
          const { error: e } = await adminSupabase
            .from('vehicle_maintenance')
            .delete()
            .in(idColumn, itemIds);
          if (e) throw e;
        }
      }
    }

    // Count/delete DVLA sync logs
    if (actions?.maintenance) {
      const { count: dvlaCount } = await adminSupabase
        .from('dvla_sync_log')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, itemIds);

      counts.dvla_sync_logs = dvlaCount || 0;

      if (mode === 'execute' && counts.dvla_sync_logs > 0) {
        const { error: e } = await adminSupabase
          .from('dvla_sync_log')
          .delete()
          .in(idColumn, itemIds);
        if (e) throw e;
      }
    }

    // Count/delete MOT history records (road vehicles only, not plant)
    if (actions?.maintenance && fleetType !== 'plant') {
      const { count: motCount } = await adminSupabase
        .from('mot_test_history')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, itemIds);

      counts.mot_test_history = motCount || 0;

      if (mode === 'execute' && counts.mot_test_history > 0) {
        const { error: e } = await adminSupabase
          .from('mot_test_history')
          .delete()
          .in(idColumn, itemIds);
        if (e) throw e;
      }
    }

    // Count/delete vehicle archives (van_archive only - HGVs and plant have no archive table)
    if (actions?.archives && fleetType === 'vans') {
      const regNumbers = itemsToProcess.map(v => v.reg_number as string);
      const { count: archiveCount } = await adminSupabase
        .from('van_archive')
        .select('id', { count: 'exact', head: true })
        .in('reg_number', regNumbers);

      counts.vehicle_archives = archiveCount || 0;

      if (mode === 'execute' && counts.vehicle_archives > 0) {
        const { error: e } = await adminSupabase
          .from('van_archive')
          .delete()
          .in('reg_number', regNumbers);
        if (e) throw e;
      }
    } else if (actions?.archives && (fleetType === 'hgvs' || fleetType === 'plant')) {
      counts.vehicle_archives = 0;
    }

    // Return preview or execution results
    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        counts,
        vehicles: itemsToProcess.length,
      });
    } else {
      return NextResponse.json({
        success: true,
        mode: 'execute',
        deleted_counts: counts,
        affected_vehicles: itemsToProcess.length,
        vehicle_ids: itemIds,
      });
    }
  } catch (error) {
    console.error('Error in test vehicles purge:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'POST /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/debug/test-vehicles
 * Archive or hard delete vehicle records
 * SuperAdmin only
 */
export async function DELETE(request: NextRequest) {
  try {
    const access = await requireDebugConsoleAccess();
    if (!access.ok) {
      return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
    }
    const actorProfileId = access.profileId;
    if (!actorProfileId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      vehicle_ids,
      prefix,
      mode, // 'archive' or 'hard_delete'
      archive_reason,
      fleet_type = 'vans',
    } = body;

    // Validate required fields
    if (!vehicle_ids || !Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return NextResponse.json(
        { error: 'vehicle_ids is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!mode || !['archive', 'hard_delete'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "archive" or "hard_delete"' },
        { status: 400 }
      );
    }

    const validPrefix = prefix || 'ZZ99';
    const fleetType = fleet_type === 'hgvs' ? 'hgvs' : fleet_type === 'plant' ? 'plant' : 'vans';
    const adminSupabase = getSupabaseAdmin();

    // Archive is only supported for vans (HGVs and plant have no archive table)
    if (mode === 'archive' && fleetType !== 'vans') {
      return NextResponse.json(
        { error: `Archive is not supported for ${fleetType}. Use Hard Delete instead.` },
        { status: 400 }
      );
    }

    const table = fleetType === 'hgvs' ? 'hgvs' : fleetType === 'plant' ? 'plant' : 'vans';
    const idColumn = fleetType === 'hgvs' ? 'hgv_id' : fleetType === 'plant' ? 'plant_id' : 'van_id';
    const regColumn = fleetType === 'plant' ? 'plant_id' : 'reg_number';

    // SECURITY: Verify all selected items match the prefix
    const { data: rawItemsToProcessDel, error: itemError } = await adminSupabase
      .from(table)
      .select(`id, ${regColumn}, category_id, status`)
      .in('id', vehicle_ids);

    if (itemError) {
      throw itemError;
    }

    if (!rawItemsToProcessDel || rawItemsToProcessDel.length === 0) {
      return NextResponse.json(
        { error: 'No fleet items found with provided IDs' },
        { status: 404 }
      );
    }

    const itemsToProcess = rawItemsToProcessDel as FleetItem[];

    // CRITICAL SECURITY CHECK: Verify ALL items match the prefix
    const invalidItemsDel = itemsToProcess.filter(
      v => !((v[regColumn as keyof FleetItem] as string) ?? '').toUpperCase().startsWith(validPrefix.toUpperCase())
    );

    if (invalidItemsDel.length > 0) {
      return NextResponse.json(
        {
          error: `Security violation: Cannot delete items that don't match prefix "${validPrefix}"`,
          invalid_vehicles: invalidItemsDel.map(v => v[regColumn as keyof FleetItem]),
        },
        { status: 403 }
      );
    }

    if (mode === 'archive') {
      const vehiclesToProcess = itemsToProcess;
      // Use existing archive pattern (soft delete)
      let archivedCount = 0;
      const failedVehicles: Array<{ reg_number: string; error: string }> = [];

      for (const vehicle of vehiclesToProcess) {
        // Get full vehicle data for archiving
        const { data: fullVehicle } = await adminSupabase
          .from('vans')
          .select('*, vehicle_maintenance(*)')
          .eq('id', vehicle.id)
          .single();

        if (fullVehicle) {
          // Archive the vehicle
          const { error: archiveError } = await adminSupabase
            .from('van_archive')
            .insert({
              van_id: fullVehicle.id,
              reg_number: fullVehicle.reg_number,
              category_id: fullVehicle.category_id,
              status: fullVehicle.status,
              archive_reason: archive_reason || 'Test Data Cleanup',
              archived_by: actorProfileId,
              vehicle_data: fullVehicle,
              maintenance_data: fullVehicle.vehicle_maintenance || null,
            });

          if (archiveError) {
            console.error('Failed to archive vehicle:', archiveError);
            failedVehicles.push({
              reg_number: vehicle.reg_number ?? '',
              error: archiveError.message,
            });
            continue; // Skip to next vehicle
          }

          // Mark vehicle as archived
          const { error: updateError } = await adminSupabase
            .from('vans')
            .update({ status: 'archived' })
            .eq('id', vehicle.id);

          if (updateError) {
            failedVehicles.push({
              reg_number: vehicle.reg_number ?? '',
              error: `Failed to update status: ${updateError.message}`,
            });
          } else {
            archivedCount++;
          }
        } else {
          failedVehicles.push({
            reg_number: vehicle.reg_number ?? '',
            error: 'Vehicle data not found',
          });
        }
      }

      return NextResponse.json({
        success: failedVehicles.length === 0,
        mode: 'archive',
        archived_count: archivedCount,
        total_requested: vehiclesToProcess.length,
        failed_vehicles: failedVehicles.length > 0 ? failedVehicles : undefined,
      });
    } else {
      // Hard delete mode
      const vehicleIds = itemsToProcess.map(v => v.id);

      // Delete in proper order to avoid FK violations
      const deleteCounts: Record<string, number> = {};

      const reminderTargets = await deleteReminderActionsForFleetItems(adminSupabase, fleetType, vehicleIds);
      deleteCounts.reminder_actions = reminderTargets.actionIds.length;
      deleteCounts.reminders = reminderTargets.reminderCount;

      // First, get all task IDs for these items
      const { data: tasksToDelete } = await adminSupabase
        .from('actions')
        .select('id')
        .in(idColumn, vehicleIds)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

      const taskIds = tasksToDelete?.map(t => t.id) || [];

      // 1. Delete workshop task comments (references actions)
      if (taskIds.length > 0) {
        const { count: commentsCount } = await adminSupabase
          .from('workshop_task_comments')
          .select('id', { count: 'exact', head: true })
          .in('task_id', taskIds);

        deleteCounts.workshop_task_comments = commentsCount || 0;

        if (deleteCounts.workshop_task_comments > 0) {
          const { error: deleteCommentsError } = await adminSupabase
            .from('workshop_task_comments')
            .delete()
            .in('task_id', taskIds);

          if (deleteCommentsError) {
            throw deleteCommentsError;
          }
        }
      } else {
        deleteCounts.workshop_task_comments = 0;
      }

      // 2. Delete workshop task attachments (and responses will cascade)
      if (taskIds.length > 0) {
        const { data: taskAttachments } = await adminSupabase
          .from('workshop_task_attachments')
          .select('id, task_id')
          .in('task_id', taskIds);

        deleteCounts.workshop_attachments = taskAttachments?.length || 0;

        if (taskAttachments && taskAttachments.length > 0) {
          const attachmentIds = taskAttachments.map(a => a.id);

          // Delete attachments
          const { error: deleteAttachmentsError } = await adminSupabase
            .from('workshop_task_attachments')
            .delete()
            .in('id', attachmentIds);

          if (deleteAttachmentsError) {
            throw deleteAttachmentsError;
          }
        }
      } else {
        deleteCounts.workshop_attachments = 0;
      }

      // 3. Delete actions (workshop tasks)
      deleteCounts.workshop_tasks = taskIds.length;

      if (taskIds.length > 0) {
        const { error: deleteActionsError } = await adminSupabase
          .from('actions')
          .delete()
          .in('id', taskIds);

        if (deleteActionsError) {
          throw deleteActionsError;
        }
      }

      // 4. Delete inspections (van_inspections, hgv_inspections, or plant_inspections + children)
      if (fleetType === 'vans') {
        const { count: inspectionsCount } = await adminSupabase
          .from('van_inspections')
          .select('id', { count: 'exact', head: true })
          .in('van_id', vehicleIds);

        deleteCounts.inspections = inspectionsCount || 0;

        if (deleteCounts.inspections > 0) {
          const { error: deleteInspectionsError } = await adminSupabase
            .from('van_inspections')
            .delete()
            .in('van_id', vehicleIds);

          if (deleteInspectionsError) throw deleteInspectionsError;
        }
      } else if (fleetType === 'hgvs') {
        const { data: hgvInspections } = await adminSupabase
          .from('hgv_inspections')
          .select('id')
          .in('hgv_id', vehicleIds);

        const inspectionIds = hgvInspections?.map(i => i.id) || [];
        deleteCounts.inspections = inspectionIds.length;

        if (inspectionIds.length > 0) {
          await adminSupabase.from('inspection_items').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_photos').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_daily_hours').delete().in('inspection_id', inspectionIds);
          const { error: e } = await adminSupabase
            .from('hgv_inspections')
            .delete()
            .in('id', inspectionIds);
          if (e) throw e;
        }
      } else {
        const { data: plantInspections } = await adminSupabase
          .from('plant_inspections')
          .select('id')
          .in('plant_id', vehicleIds);

        const inspectionIds = plantInspections?.map(i => i.id) || [];
        deleteCounts.inspections = inspectionIds.length;

        if (inspectionIds.length > 0) {
          await adminSupabase.from('inspection_items').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_photos').delete().in('inspection_id', inspectionIds);
          await adminSupabase.from('inspection_daily_hours').delete().in('inspection_id', inspectionIds);
          const { error: e } = await adminSupabase
            .from('plant_inspections')
            .delete()
            .in('id', inspectionIds);
          if (e) throw e;
        }
      }

      // 5. Delete maintenance history
      const { count: historyCount } = await adminSupabase
        .from('maintenance_history')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, vehicleIds);

      deleteCounts.maintenance_history = historyCount || 0;

      if (deleteCounts.maintenance_history > 0) {
        const { error: deleteHistoryError } = await adminSupabase
          .from('maintenance_history')
          .delete()
          .in(idColumn, vehicleIds);

        if (deleteHistoryError) throw deleteHistoryError;
      }

      // 6. Delete DVLA sync logs
      const { count: dvlaCount } = await adminSupabase
        .from('dvla_sync_log')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, vehicleIds);

      deleteCounts.dvla_sync_logs = dvlaCount || 0;

      if (deleteCounts.dvla_sync_logs > 0) {
        const { error: deleteDvlaError } = await adminSupabase
          .from('dvla_sync_log')
          .delete()
          .in(idColumn, vehicleIds);

        if (deleteDvlaError) throw deleteDvlaError;
      }

      // 7. Delete MOT test history (road vehicles only, not plant)
      if (fleetType !== 'plant') {
        const { count: motCount } = await adminSupabase
          .from('mot_test_history')
          .select('id', { count: 'exact', head: true })
          .in(idColumn, vehicleIds);

        deleteCounts.mot_test_history = motCount || 0;

        if (deleteCounts.mot_test_history > 0) {
          const { error: deleteMotError } = await adminSupabase
            .from('mot_test_history')
            .delete()
            .in(idColumn, vehicleIds);

          if (deleteMotError) throw deleteMotError;
        }
      }

      // 8. Delete vehicle maintenance
      const { count: maintenanceRecordCount } = await adminSupabase
        .from('vehicle_maintenance')
        .select('id', { count: 'exact', head: true })
        .in(idColumn, vehicleIds);

      deleteCounts.vehicle_maintenance = maintenanceRecordCount || 0;

      if (deleteCounts.vehicle_maintenance > 0) {
        const { error: deleteMaintenanceError } = await adminSupabase
          .from('vehicle_maintenance')
          .delete()
          .in(idColumn, vehicleIds);

        if (deleteMaintenanceError) throw deleteMaintenanceError;
      }

      // 9. Delete vehicle archives (van_archive only; HGVs and plant have no archive table)
      if (fleetType === 'vans') {
        const regNumbers = itemsToProcess.map(v => v.reg_number as string);
        const { count: archiveCount } = await adminSupabase
          .from('van_archive')
          .select('id', { count: 'exact', head: true })
          .in('reg_number', regNumbers);

        deleteCounts.vehicle_archives = archiveCount || 0;

        if (deleteCounts.vehicle_archives > 0) {
          const { error: deleteArchivesError } = await adminSupabase
            .from('van_archive')
            .delete()
            .in('reg_number', regNumbers);

          if (deleteArchivesError) throw deleteArchivesError;
        }
      } else {
        deleteCounts.vehicle_archives = 0;
      }

      // 10. Finally, delete the fleet items themselves
      const { error: vehicleDeleteError } = await adminSupabase
        .from(table)
        .delete()
        .in('id', vehicleIds);

      if (vehicleDeleteError) {
        throw vehicleDeleteError;
      }

      deleteCounts.vehicles = vehicleIds.length;

      return NextResponse.json({
        success: true,
        mode: 'hard_delete',
        deleted_counts: deleteCounts,
        affected_vehicles: vehicleIds.length,
      });
    }
  } catch (error) {
    console.error('Error deleting test vehicles:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'DELETE /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
