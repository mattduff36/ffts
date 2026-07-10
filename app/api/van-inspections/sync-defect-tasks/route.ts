import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';
import { buildRecentCompletedDefectMap } from '@/lib/utils/inspectionRecentCompletedDefects';
import {
  buildInspectionDefectSignature,
  extractInspectionDefectSignature,
  normalizeInspectionDefectSignature,
} from '@/lib/utils/inspectionDefectSignature';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];
type ActionUpdate = Database['public']['Tables']['actions']['Update'];

/**
 * POST /api/van-inspections/sync-defect-tasks
 * 
 * Idempotently creates/updates inspection defect tasks.
 * Uses stable signature (inspection_id + item_number + item_description) for deduplication.
 * 
 * Input: {
 *   inspectionId: string;
 *   vehicleId: string;
 *   createdBy: string;
 *   defects: Array<{
 *     item_number: number;
 *     item_description: string;
 *     days: number[];
 *     comment: string;
 *     primaryInspectionItemId: string;
 *   }>;
 * }
 * 
 * Output: {
 *   created: number;
 *   updated: number;
 *   skipped: number;
 *   duplicates: Array<{ signature, taskIds }>;  // For admin cleanup
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const maintenanceResponse = getVanInspectionsMaintenanceResponse();
    if (maintenanceResponse) {
      return maintenanceResponse;
    }

    // Parse request body
    const body = await request.json();
    const { inspectionId, vehicleId, createdBy, defects, confirmedRepeatDefectSignatures } = body;
    const confirmedRepeatDefectSignatureSet = new Set<string>(
      Array.isArray(confirmedRepeatDefectSignatures)
        ? confirmedRepeatDefectSignatures
            .map((value) => normalizeInspectionDefectSignature(typeof value === 'string' ? value : null))
            .filter((value): value is string => Boolean(value))
        : []
    );

    if (!inspectionId || !vehicleId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, vehicleId, createdBy, defects' },
        { status: 400 }
      );
    }

    if (createdBy !== access.userId) {
      return NextResponse.json(
        { error: 'Forbidden: createdBy must match authenticated user' },
        { status: 403 }
      );
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: inspectionOwner, error: inspectionLookupError } = await supabaseAdmin
      .from('van_inspections')
      .select('user_id, van_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.van_id !== vehicleId) {
      return NextResponse.json(
        { error: 'vehicleId does not match inspection vehicle' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    // Get vehicle registration for task titles
    const { data: vehicle } = await supabaseAdmin
      .from('vans')
      .select('reg_number')
      .eq('id', vehicleId)
      .single();

    const vehicleReg = vehicle?.reg_number || 'Unknown Van';

    // Get preferred taxonomy: Repair → Inspection defects
    const { data: repairCategory } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Repair')
      .eq('applies_to', 'van')
      .eq('is_active', true)
      .single();

    let defaultSubcategoryId: string | null = null;

    if (repairCategory) {
      const { data: inspectionDefectsSubcat } = await supabaseAdmin
        .from('workshop_task_subcategories')
        .select('id')
        .eq('category_id', repairCategory.id)
        .ilike('name', '%inspection%defect%')
        .eq('is_active', true)
        .single();

      defaultSubcategoryId = inspectionDefectsSubcat?.id || null;
    }

    // Fallback: Other → Other (or just null)
    if (!defaultSubcategoryId) {
      const { data: otherCategory } = await supabaseAdmin
        .from('workshop_task_categories')
        .select('id')
        .eq('name', 'Other')
        .eq('applies_to', 'van')
        .eq('is_active', true)
        .single();

      if (otherCategory) {
        const { data: otherSubcat } = await supabaseAdmin
          .from('workshop_task_subcategories')
          .select('id')
          .eq('category_id', otherCategory.id)
          .eq('name', 'Other')
          .eq('is_active', true)
          .single();

        defaultSubcategoryId = otherSubcat?.id || null;
      }
    }

    // CRITICAL: Fetch ALL active tasks for this VEHICLE (not just this inspection)
    // This prevents duplicate task creation when a defect already has an active task from a previous inspection
    const { data: activeVehicleTasks } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        van_id,
        created_at
      `)
      .eq('van_id', vehicleId)
      .eq('action_type', 'inspection_defect')
      .in('status', ['pending', 'logged', 'on_hold', 'in_progress']);

    const { data: completedVehicleTasks } = await supabaseAdmin
      .from('actions')
      .select('description, actioned_at, updated_at')
      .eq('van_id', vehicleId)
      .eq('action_type', 'inspection_defect')
      .eq('status', 'completed')
      .order('actioned_at', { ascending: false, nullsFirst: false })
      .limit(100);

    // Fetch existing actions for this inspection (for updates)
    const { data: existingActions } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        van_id,
        created_at
      `)
      .eq('inspection_id', inspectionId)
      .eq('action_type', 'inspection_defect');

    // Build a map of ACTIVE tasks across ALL inspections for this vehicle
    // This is our primary check to prevent duplicates
    const activeTasksMap = new Map<string, NonNullable<typeof activeVehicleTasks>>();

    if (activeVehicleTasks) {
      for (const action of activeVehicleTasks) {
        const signature = extractInspectionDefectSignature(action.description);
        if (signature) {
          if (!activeTasksMap.has(signature)) {
            activeTasksMap.set(signature, []);
          }
          activeTasksMap.get(signature)!.push(action);
        }
      }
    }

    // Build a map of existing tasks by stable signature (current inspection only)
    // Signature: item_number-item_description (normalized)
    const existingMap = new Map<string, NonNullable<typeof existingActions>>();

    if (existingActions) {
      for (const action of existingActions) {
        const signature = extractInspectionDefectSignature(action.description);
        if (signature) {
          if (!existingMap.has(signature)) {
            existingMap.set(signature, []);
          }
          existingMap.get(signature)!.push(action);
        }
      }
    }

    const recentCompletedDefects = buildRecentCompletedDefectMap(completedVehicleTasks || [], {
      lookbackDays: 7,
    });

    const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const normalizeDayNumbers = (values: unknown): number[] =>
      Array.from(
        new Set(
          (Array.isArray(values) ? values : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
        )
      ).sort((left, right) => left - right);
    const sortTasksByCreatedAt = <T extends { created_at?: string | null; id: string }>(tasks: T[]): T[] =>
      [...tasks].sort((left, right) => {
        const leftTime = left.created_at ? new Date(left.created_at).getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.created_at ? new Date(right.created_at).getTime() : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.id.localeCompare(right.id);
      });
    const extractCommentFromDescription = (description?: string | null): string => {
      if (!description) return '';
      const commentMatch = description.match(/(?:^|\n)Comment:\s*(.+?)(?:\n|$)/);
      return commentMatch?.[1]?.trim() || '';
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const duplicates: Array<{ signature: string; taskIds: string[] }> = [];

    // Process each defect
    for (const defect of defects) {
      const { item_number, item_description, days: rawDays, dayOfWeek, comment, primaryInspectionItemId } = defect;
      const days = normalizeDayNumbers(Array.isArray(rawDays) && rawDays.length > 0 ? rawDays : dayOfWeek ? [dayOfWeek] : []);

      const signature = buildInspectionDefectSignature({
        item_number,
        item_description,
      });

      // Build day range string
      let dayRange: string;
      if (days.length === 1) {
        dayRange = DAY_NAMES[days[0] - 1] || `Day ${days[0]}`;
      } else if (days.length > 1) {
        const firstDay = DAY_NAMES[days[0] - 1] || `Day ${days[0]}`;
        const lastDay = DAY_NAMES[days[days.length - 1] - 1] || `Day ${days[days.length - 1]}`;
        dayRange = `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
      } else {
        dayRange = 'Unknown';
      }

      const commentText = comment ? `\nComment: ${comment}` : '';
      const title = `${vehicleReg} - ${item_description} (${dayRange})`;
      const description = `Van inspection defect found:\nItem ${item_number} - ${item_description} (${dayRange})${commentText}`;
      const buildDescriptionWithComment = (descriptionComment: string) =>
        `Van inspection defect found:\nItem ${item_number} - ${item_description} (${dayRange})${descriptionComment ? `\nComment: ${descriptionComment}` : ''}`;

      // CRITICAL CHECK: First check if there are ANY active tasks for this defect on this vehicle
      // (across ALL inspections, not just the current one)
      const activeTasksForDefect = activeTasksMap.get(signature);

      if (activeTasksForDefect && activeTasksForDefect.length > 0) {
        const keeperTask = sortTasksByCreatedAt(activeTasksForDefect)[0];
        const originalComment = extractCommentFromDescription(keeperTask.description) || comment || '';
        const updates: ActionUpdate = {
          title,
          description: buildDescriptionWithComment(originalComment),
          van_id: vehicleId,
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
          .from('actions')
          .update(updates)
          .eq('id', keeperTask.id);

        if (updateError) {
          console.error(`Error updating active vehicle task ${keeperTask.id}:`, updateError);
          skipped++;
        } else {
          updated++;
        }
        continue;
      }

      if (recentCompletedDefects.has(signature) && !confirmedRepeatDefectSignatureSet.has(signature)) {
        console.log(
          `[sync-defect-tasks] Skipping creation for ${signature}: recently completed task exists and defect was not reconfirmed`
        );
        skipped++;
        continue;
      }

      // Check for existing tasks with this signature in the CURRENT inspection
      const existing = existingMap.get(signature);

      if (existing && existing.length > 0) {
        // Check for duplicates
        if (existing.length > 1) {
          duplicates.push({
            signature,
            taskIds: existing.map(e => e.id)
          });
        }

        // Update first non-completed task
        const activeTask = existing.find(e => e.status !== 'completed');
        
        if (activeTask) {
          const originalComment = extractCommentFromDescription(activeTask.description) || comment || '';
          const updates: ActionUpdate = {
            title,
            description: buildDescriptionWithComment(originalComment),
            van_id: vehicleId,
            updated_at: new Date().toISOString(),
          };

          const { error: updateError } = await supabaseAdmin
            .from('actions')
            .update(updates)
            .eq('id', activeTask.id);

          if (updateError) {
            console.error(`Error updating task ${activeTask.id}:`, updateError);
          } else {
            updated++;
          }
        } else {
          // All tasks are completed. Only recreate when the user has explicitly
          // reconfirmed the same defect after a recent completion.
          if (!confirmedRepeatDefectSignatureSet.has(signature)) {
            skipped++;
            continue;
          }

          const newTask: ActionInsert = {
            action_type: 'inspection_defect',
            inspection_id: inspectionId,
            inspection_item_id: primaryInspectionItemId,
            van_id: vehicleId,
            workshop_subcategory_id: defaultSubcategoryId,
            title,
            description,
            priority: 'high',
            status: 'pending',
            created_by: createdBy,
          } as ActionInsert & { workshop_subcategory_id: string };

          const { error: insertError } = await supabaseAdmin
            .from('actions')
            .insert(newTask as never);

          if (insertError) {
            console.error(`Error recreating task for ${signature}:`, insertError);
          } else {
            created++;
          }
        }
      } else {
        // No active tasks exist anywhere for this vehicle + defect
        // AND no tasks in current inspection
        // Safe to create new task
        const newTask: ActionInsert = {
          action_type: 'inspection_defect',
          inspection_id: inspectionId,
          inspection_item_id: primaryInspectionItemId,
          van_id: vehicleId,
          workshop_subcategory_id: defaultSubcategoryId,
          title,
          description,
          priority: 'high',
          status: 'pending',
          created_by: createdBy,
        } as ActionInsert & { workshop_subcategory_id: string };

        const { error: insertError } = await supabaseAdmin
          .from('actions')
          .insert(newTask as never);

        if (insertError) {
          console.error(`Error creating task for ${signature}:`, insertError);
        } else {
          created++;
        }
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped,
      duplicates,
      message: `Sync complete: ${created} created, ${updated} updated, ${skipped} skipped${duplicates.length > 0 ? `, ${duplicates.length} duplicate groups found` : ''}`
    });
  } catch (error) {
    console.error('Error in sync-defect-tasks endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
