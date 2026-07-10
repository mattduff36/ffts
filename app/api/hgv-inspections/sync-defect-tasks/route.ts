import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import {
  buildInspectionDefectSignature,
  extractInspectionDefectSignature,
  normalizeInspectionDefectSignature,
} from '@/lib/utils/inspectionDefectSignature';
import { ACTIVE_INSPECTION_DEFECT_STATUSES } from '@/lib/utils/inspectionDefectTaskStatuses';
import { buildRecentCompletedDefectMap } from '@/lib/utils/inspectionRecentCompletedDefects';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];
type ActionUpdate = Database['public']['Tables']['actions']['Update'];

interface HgvInspectionDefectPayload {
  item_number: number;
  item_description: string;
  days?: number[];
  dayOfWeek?: number | null;
  comment?: string;
  primaryInspectionItemId: string;
}

interface ExistingInspectionDefectTask {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  inspection_id: string | null;
  inspection_item_id: string | null;
  hgv_id: string | null;
  created_at: string | null;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_NAME_TO_NUMBER: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

function buildDayRange(days?: number[], dayOfWeek?: number | null): string {
  const normalizedDays = normalizeDayNumbers(Array.isArray(days) && days.length > 0
    ? days
    : dayOfWeek
      ? [dayOfWeek]
      : []);

  if (normalizedDays.length === 0) {
    return '';
  }

  if (normalizedDays.length === 1) {
    return DAY_NAMES[normalizedDays[0] - 1] || `Day ${normalizedDays[0]}`;
  }

  const segments: string[] = [];
  let segmentStart = normalizedDays[0];
  let segmentEnd = normalizedDays[0];

  const formatSegment = (startDay: number, endDay: number): string => {
    const startLabel = (DAY_NAMES[startDay - 1] || `Day ${startDay}`).substring(0, 3);
    const endLabel = (DAY_NAMES[endDay - 1] || `Day ${endDay}`).substring(0, 3);
    return startDay === endDay ? startLabel : `${startLabel}-${endLabel}`;
  };

  for (let i = 1; i < normalizedDays.length; i++) {
    const day = normalizedDays[i];
    if (day === segmentEnd + 1) {
      segmentEnd = day;
      continue;
    }

    segments.push(formatSegment(segmentStart, segmentEnd));
    segmentStart = day;
    segmentEnd = day;
  }

  segments.push(formatSegment(segmentStart, segmentEnd));
  return segments.join(', ');
}

function normalizeDayNumbers(days: number[]): number[] {
  return Array.from(new Set(days.filter((day) => day >= 1 && day <= 7))).sort((a, b) => a - b);
}

function getPayloadDayNumbers(days?: number[], dayOfWeek?: number | null): number[] {
  const normalizedDays = Array.isArray(days) && days.length > 0
    ? days
    : dayOfWeek
      ? [dayOfWeek]
      : [];
  return normalizeDayNumbers(normalizedDays);
}

function parseDayToken(token: string): number[] {
  const cleaned = token.trim().toLowerCase().replace(/\./g, '');

  if (!cleaned) {
    return [];
  }

  if (cleaned.includes('-')) {
    const [startToken, endToken] = cleaned.split('-', 2);
    const startDay = DAY_NAME_TO_NUMBER[startToken.trim()];
    const endDay = DAY_NAME_TO_NUMBER[endToken.trim()];

    if (!startDay || !endDay) {
      return [];
    }

    if (startDay <= endDay) {
      return Array.from({ length: endDay - startDay + 1 }, (_, idx) => startDay + idx);
    }

    return [
      ...Array.from({ length: 8 - startDay }, (_, idx) => startDay + idx),
      ...Array.from({ length: endDay }, (_, idx) => idx + 1),
    ];
  }

  const dayNumber = DAY_NAME_TO_NUMBER[cleaned];
  return dayNumber ? [dayNumber] : [];
}

function extractDayNumbersFromDescription(description?: string | null): number[] {
  if (!description) {
    return [];
  }

  const dayMatch = description.match(/Item\s+\d+\s*-\s*[^\n]*\(([^)]+)\)/i);
  if (!dayMatch) {
    return [];
  }

  const dayTokens = dayMatch[1].split(',');
  const parsedDays = dayTokens.flatMap(parseDayToken);
  return normalizeDayNumbers(parsedDays);
}

function extractCommentFromDescription(description?: string | null): string {
  if (!description) {
    return '';
  }

  const commentMatch = description.match(/(?:^|\n)Comment:\s*(.+?)(?:\n|$)/);
  return commentMatch?.[1]?.trim() || '';
}

function mergeTaskAndPayloadDayNumbers(
  tasks: ExistingInspectionDefectTask[],
  payloadDays: number[]
): number[] {
  const merged = new Set<number>(payloadDays);

  for (const task of tasks) {
    const taskDays = extractDayNumbersFromDescription(task.description);
    for (const day of taskDays) {
      merged.add(day);
    }
  }

  return normalizeDayNumbers(Array.from(merged));
}

function addTaskToSignatureMap(
  map: Map<string, ExistingInspectionDefectTask[]>,
  signature: string,
  task: ExistingInspectionDefectTask
) {
  if (!map.has(signature)) {
    map.set(signature, []);
  }

  map.get(signature)!.push(task);
}

function getTaskCreatedAt(task: ExistingInspectionDefectTask): number {
  if (!task.created_at) {
    return Number.MAX_SAFE_INTEGER;
  }
  const timestamp = new Date(task.created_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function sortByCreatedAtThenId(tasks: ExistingInspectionDefectTask[]): ExistingInspectionDefectTask[] {
  return [...tasks].sort((a, b) => {
    const timeDiff = getTaskCreatedAt(a) - getTaskCreatedAt(b);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id.localeCompare(b.id);
  });
}

async function closeDuplicateTask(
  supabaseAdmin: SupabaseClient,
  duplicateTaskId: string,
  keeperTaskId: string,
  createdBy: string
): Promise<boolean> {
  const updates: ActionUpdate = {
    status: 'completed',
    actioned: true,
    actioned_at: new Date().toISOString(),
    actioned_by: createdBy,
    actioned_comment: `Auto-closed duplicate inspection defect task. Kept oldest task ${keeperTaskId}.`,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('actions')
    .update(updates)
    .eq('id', duplicateTaskId);

  if (error) {
    console.error(`Error auto-closing duplicate HGV defect task ${duplicateTaskId}:`, error);
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inspectionId, hgvId, createdBy, defects, confirmedRepeatDefectSignatures } = body as {
      inspectionId?: string;
      hgvId?: string;
      createdBy?: string;
      defects?: HgvInspectionDefectPayload[];
      confirmedRepeatDefectSignatures?: string[];
    };
    const confirmedRepeatDefectSignatureSet = new Set(
      Array.isArray(confirmedRepeatDefectSignatures)
        ? confirmedRepeatDefectSignatures
            .map((value) => normalizeInspectionDefectSignature(typeof value === 'string' ? value : null))
            .filter((value): value is string => Boolean(value))
        : []
    );

    if (!inspectionId || !hgvId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, hgvId, createdBy, defects' },
        { status: 400 }
      );
    }

    if (createdBy !== access.userId) {
      return NextResponse.json(
        { error: 'Forbidden: createdBy must match authenticated user' },
        { status: 403 }
      );
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: inspectionOwner, error: inspectionLookupError } = await supabaseAdmin
      .from('hgv_inspections')
      .select('user_id, hgv_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.hgv_id !== hgvId) {
      return NextResponse.json(
        { error: 'hgvId does not match inspection vehicle' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    const { data: hgv } = await supabaseAdmin
      .from('hgvs')
      .select('reg_number')
      .eq('id', hgvId)
      .single();

    const hgvReg = hgv?.reg_number || 'Unknown HGV';

    const { data: repairCategory } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Repair')
      .eq('applies_to', 'hgv')
      .eq('is_active', true)
      .single();

    const { data: activeVehicleTasks } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        hgv_id,
        created_at
      `)
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .in('status', ACTIVE_INSPECTION_DEFECT_STATUSES as unknown as string[]);

    const { data: existingInspectionTasks } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        hgv_id,
        created_at
      `)
      .eq('inspection_id', inspectionId)
      .eq('action_type', 'inspection_defect');

    const { data: completedVehicleTasks } = await supabaseAdmin
      .from('actions')
      .select('description, actioned_at, updated_at')
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .eq('status', 'completed')
      .order('actioned_at', { ascending: false, nullsFirst: false })
      .limit(100);

    const activeTasksMap = new Map<string, ExistingInspectionDefectTask[]>();
    const existingInspectionMap = new Map<string, ExistingInspectionDefectTask[]>();

    for (const task of (activeVehicleTasks || []) as ExistingInspectionDefectTask[]) {
      const signature = extractInspectionDefectSignature(task.description);
      if (signature) {
        addTaskToSignatureMap(activeTasksMap, signature, task);
      }
    }

    for (const task of (existingInspectionTasks || []) as ExistingInspectionDefectTask[]) {
      const signature = extractInspectionDefectSignature(task.description);
      if (signature) {
        addTaskToSignatureMap(existingInspectionMap, signature, task);
      }
    }

    const recentCompletedDefects = buildRecentCompletedDefectMap(completedVehicleTasks || [], {
      lookbackDays: 7,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let dedupedClosed = 0;
    const duplicates: Array<{ signature: string; taskIds: string[] }> = [];
    const autoClosedTaskIds = new Set<string>();

    for (const defect of defects) {
      const signature = buildInspectionDefectSignature({
        item_number: defect.item_number,
        item_description: defect.item_description,
      });
      const payloadDays = getPayloadDayNumbers(defect.days, defect.dayOfWeek);
      let activeTasksForDefect = activeTasksMap.get(signature) || [];
      const existingTasksForInspection = existingInspectionMap.get(signature) || [];
      const mergedDays = mergeTaskAndPayloadDayNumbers(activeTasksForDefect, payloadDays);
      const dayRange = buildDayRange(mergedDays);
      const daySuffix = dayRange ? ` (${dayRange})` : '';
      const commentText = defect.comment ? `\nComment: ${defect.comment}` : '';
      const title = `${hgvReg} - ${defect.item_description}${daySuffix}`;
      const description = `HGV inspection defect found:\nItem ${defect.item_number} - ${defect.item_description}${daySuffix}${commentText}`;
      const buildDescriptionWithComment = (comment: string) =>
        `HGV inspection defect found:\nItem ${defect.item_number} - ${defect.item_description}${daySuffix}${comment ? `\nComment: ${comment}` : ''}`;

      if (activeTasksForDefect.length > 1) {
        const sortedTasks = sortByCreatedAtThenId(activeTasksForDefect);
        const keeperTask = sortedTasks[0];
        const duplicateTasks = sortedTasks.slice(1);

        duplicates.push({
          signature,
          taskIds: sortedTasks.map((task) => task.id),
        });

        for (const duplicateTask of duplicateTasks) {
          const closed = await closeDuplicateTask(
            supabaseAdmin,
            duplicateTask.id,
            keeperTask.id,
            createdBy
          );

          if (closed) {
            dedupedClosed++;
            duplicateTask.status = 'completed';
            autoClosedTaskIds.add(duplicateTask.id);
          }
        }

        activeTasksForDefect = [keeperTask];
        activeTasksMap.set(signature, activeTasksForDefect);
      }

      const currentInspectionTask = existingTasksForInspection.find(
        (task) => task.status !== 'completed' && !autoClosedTaskIds.has(task.id)
      );

      if (currentInspectionTask) {
        const originalComment = extractCommentFromDescription(currentInspectionTask.description) || defect.comment || '';
        const updates: ActionUpdate = {
          title,
          description: buildDescriptionWithComment(originalComment),
          hgv_id: hgvId,
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
          .from('actions')
          .update(updates)
          .eq('id', currentInspectionTask.id);

        if (updateError) {
          console.error(`Error updating HGV defect task ${currentInspectionTask.id}:`, updateError);
        } else {
          updated++;
        }
        continue;
      }

      if (activeTasksForDefect.length > 0) {
        const keeperTask = sortByCreatedAtThenId(activeTasksForDefect)[0];
        const originalComment = extractCommentFromDescription(keeperTask.description) || defect.comment || '';
        const updates: ActionUpdate = {
          title,
          description: buildDescriptionWithComment(originalComment),
          hgv_id: hgvId,
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
          .from('actions')
          .update(updates)
          .eq('id', keeperTask.id);

        if (updateError) {
          console.error(`Error updating oldest HGV defect task ${keeperTask.id}:`, updateError);
          skipped++;
        } else {
          updated++;
        }
        continue;
      }

      if (recentCompletedDefects.has(signature) && !confirmedRepeatDefectSignatureSet.has(signature)) {
        skipped++;
        continue;
      }

      const taskData: ActionInsert = {
        action_type: 'inspection_defect',
        hgv_id: hgvId,
        title,
        description,
        status: 'pending',
        created_by: createdBy,
        inspection_id: inspectionId,
        inspection_item_id: defect.primaryInspectionItemId,
        workshop_category_id: repairCategory?.id || null,
      };

      const { data: insertedTask, error: insertError } = await supabaseAdmin
        .from('actions')
        .insert([taskData])
        .select(`
          id,
          status,
          title,
          description,
          inspection_id,
          inspection_item_id,
          hgv_id,
          created_at
        `)
        .single();

      if (!insertError) {
        created++;

        if (insertedTask) {
          addTaskToSignatureMap(activeTasksMap, signature, insertedTask as ExistingInspectionDefectTask);
          addTaskToSignatureMap(existingInspectionMap, signature, insertedTask as ExistingInspectionDefectTask);
        }
      } else {
        console.error(`Error creating HGV defect task for ${signature}:`, insertError);
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped,
      dedupedClosed,
      duplicates,
      message: `Sync complete: ${created} created, ${updated} updated, ${skipped} skipped, ${dedupedClosed} duplicates auto-closed${duplicates.length > 0 ? `, ${duplicates.length} duplicate groups found` : ''}`,
    });
  } catch (error) {
    console.error('Error in hgv sync-defect-tasks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
