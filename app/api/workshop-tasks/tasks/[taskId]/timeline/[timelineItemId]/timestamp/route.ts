import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { syncWorkshopTaskCompletionDependents, type RelatedName } from '@/lib/server/workshop-task-completion-sync';
import {
  AdjustWorkshopTaskTimestampSchema,
  UUIDSchema,
  validateRequest,
  validateParams,
} from '@/lib/validation/schemas';
import {
  buildWorkshopTaskTimelineItems,
  ensureMilestoneStatusHistory,
  getLatestCompletedEvent,
  getLatestStartedEvent,
  resolveMilestoneStatusEvent,
  type WorkshopTaskTimelineComment,
  type WorkshopTaskTimelineTask,
} from '@/lib/utils/workshopTaskTimeline';
import { validateWorkshopTaskTimestampAdjustment } from '@/lib/utils/workshop-task-timestamp-validation';
import type { Database } from '@/types/database';

const TimelineTimestampParamsSchema = z.object({
  taskId: UUIDSchema,
  timelineItemId: z.string().min(1, 'Timeline item ID is required').max(200, 'Timeline item ID is too long'),
});

type ActionRow = Pick<
  Database['public']['Tables']['actions']['Row'],
  | 'id'
  | 'action_type'
  | 'title'
  | 'description'
  | 'workshop_comments'
  | 'created_at'
  | 'created_by'
  | 'logged_at'
  | 'logged_by'
  | 'logged_comment'
  | 'actioned'
  | 'actioned_at'
  | 'actioned_by'
  | 'actioned_comment'
  | 'actioned_signature_data'
  | 'actioned_signed_at'
  | 'status_history'
  | 'van_id'
  | 'hgv_id'
  | 'plant_id'
> & {
  workshop_task_categories: RelatedName | RelatedName[] | null;
  workshop_task_subcategories: RelatedName | RelatedName[] | null;
};

type ActionUpdate = Database['public']['Tables']['actions']['Update'];

interface ProfileShape {
  id: string;
  full_name: string;
}

function pickProfile(
  profile: ProfileShape | ProfileShape[] | null | undefined
): ProfileShape | null {
  if (!profile) return null;
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

function sortStatusHistory(history: ReturnType<typeof ensureMilestoneStatusHistory>) {
  return [...history].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id.localeCompare(b.id);
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; timelineItemId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: workshop-tasks permission required' },
        { status: 403 }
      );
    }

    const paramsValidation = validateParams(await params, TimelineTimestampParamsSchema);
    if (!paramsValidation.success) {
      return NextResponse.json({ error: paramsValidation.error }, { status: 400 });
    }

    const bodyValidation = await validateRequest(request, AdjustWorkshopTaskTimestampSchema);
    if (!bodyValidation.success) {
      return NextResponse.json({ error: bodyValidation.error }, { status: 400 });
    }

    const { taskId, timelineItemId } = paramsValidation.data;
    const { itemType, timestamp } = bodyValidation.data;

    const supabaseAdmin = createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: task, error: taskError } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        action_type,
        title,
        description,
        workshop_comments,
        created_at,
        created_by,
        logged_at,
        logged_by,
        logged_comment,
        actioned,
        actioned_at,
        actioned_by,
        actioned_comment,
        actioned_signature_data,
        actioned_signed_at,
        status_history,
        van_id,
        hgv_id,
        plant_id,
        workshop_task_categories (
          name
        ),
        workshop_task_subcategories (
          name
        )
      `)
      .eq('id', taskId)
      .single();

    const typedTask = task as ActionRow | null;

    if (taskError || !typedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes(typedTask.action_type)) {
      return NextResponse.json({ error: 'Task is not a workshop task' }, { status: 400 });
    }

    const { data: comments, error: commentsError } = await supabaseAdmin
      .from('workshop_task_comments')
      .select(`
        id,
        body,
        created_at,
        updated_at,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (commentsError) {
      throw commentsError;
    }

    const typedComments = ((comments || []) as Array<{
      id: string;
      body: string;
      created_at: string;
      updated_at: string | null;
      profiles: ProfileShape | ProfileShape[] | null;
    }>).map(
      (comment): WorkshopTaskTimelineComment => ({
        id: comment.id,
        body: comment.body,
        created_at: comment.created_at ?? '',
        updated_at: comment.updated_at,
        author: pickProfile(comment.profiles),
      })
    );

    const taskForTimeline: WorkshopTaskTimelineTask = {
      ...typedTask,
      created_at: typedTask.created_at ?? '',
      status_history: Array.isArray(typedTask.status_history)
        ? typedTask.status_history
        : null,
      profiles_created: null,
      profiles: null,
    };
    const taskForValidation: WorkshopTaskTimelineTask = {
      ...taskForTimeline,
      status_history: ensureMilestoneStatusHistory(taskForTimeline),
    };
    const timelineItems = buildWorkshopTaskTimelineItems(taskForValidation, typedComments).map((item) => ({
      timelineItemId: item.timelineItemId,
      type: item.type,
      created_at: item.created_at,
    }));

    const aliasedStatusEvent =
      itemType === 'status_event' && (timelineItemId === 'started' || timelineItemId === 'completed')
        ? resolveMilestoneStatusEvent(taskForValidation, timelineItemId)
        : null;

    if (itemType === 'status_event' && (timelineItemId === 'started' || timelineItemId === 'completed') && !aliasedStatusEvent) {
      return NextResponse.json({ error: 'Status timeline item not found' }, { status: 404 });
    }

    const validationTargetId =
      itemType === 'created'
        ? 'created'
        : aliasedStatusEvent
          ? timelineItemId
          : timelineItemId;

    const validationTimelineItems =
      aliasedStatusEvent
        ? timelineItems.map((item) => {
            if (item.type === 'status' && item.timelineItemId === aliasedStatusEvent.id) {
              return { ...item, timelineItemId };
            }
            return item;
          })
        : timelineItems;

    const validationError = validateWorkshopTaskTimestampAdjustment(
      validationTimelineItems,
      validationTargetId,
      timestamp
    );

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (itemType === 'created') {
      if (timelineItemId !== 'created') {
        return NextResponse.json({ error: 'Invalid created timeline target' }, { status: 400 });
      }

      const updates: ActionUpdate = {
        created_at: timestamp,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabaseAdmin
        .from('actions')
        .update(updates)
        .eq('id', taskId);

      if (updateError) {
        throw updateError;
      }

      return NextResponse.json({
        success: true,
        taskId,
        timelineItemId: 'created',
        itemType,
        timestamp,
      });
    }

    if (itemType === 'comment') {
      const matchingComment = typedComments.find((comment) => comment.id === timelineItemId);
      if (!matchingComment) {
        return NextResponse.json({ error: 'Comment timeline item not found' }, { status: 404 });
      }

      const { error: updateError } = await supabaseAdmin
        .from('workshop_task_comments')
        .update({ created_at: timestamp })
        .eq('id', matchingComment.id)
        .eq('task_id', taskId);

      if (updateError) {
        throw updateError;
      }

      return NextResponse.json({
        success: true,
        taskId,
        timelineItemId: matchingComment.id,
        itemType,
        timestamp,
      });
    }

    const normalizedHistory = ensureMilestoneStatusHistory(taskForValidation);
    const targetStatusEvent = resolveMilestoneStatusEvent(taskForValidation, timelineItemId);

    if (!targetStatusEvent) {
      return NextResponse.json({ error: 'Status timeline item not found' }, { status: 404 });
    }

    const nextStatusHistory = sortStatusHistory(
      normalizedHistory.map((event) =>
        event.id === targetStatusEvent.id
          ? {
              ...event,
              created_at: timestamp,
              meta: event.status === 'completed'
                ? {
                    ...event.meta,
                    signed_at: timestamp,
                    timestamp_adjusted: true,
                  }
                : event.meta
                  ? {
                      ...event.meta,
                      timestamp_adjusted: true,
                    }
                  : {
                      timestamp_adjusted: true,
                    },
            }
          : event
      )
    );

    const latestStartedEvent = getLatestStartedEvent(nextStatusHistory);
    const latestCompletedEvent = getLatestCompletedEvent(nextStatusHistory);

    const actionUpdates: ActionUpdate = {
      status_history: nextStatusHistory,
      logged_at: latestStartedEvent?.created_at ?? null,
      logged_by: latestStartedEvent?.author_id ?? null,
      logged_comment: latestStartedEvent?.body ?? null,
      actioned: Boolean(latestCompletedEvent),
      actioned_at: latestCompletedEvent?.created_at ?? null,
      actioned_by: latestCompletedEvent?.author_id ?? null,
      actioned_comment: latestCompletedEvent?.body ?? null,
      actioned_signature_data: latestCompletedEvent?.meta?.signature_data ?? null,
      actioned_signed_at: latestCompletedEvent?.meta?.signed_at ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabaseAdmin
      .from('actions')
      .update(actionUpdates)
      .eq('id', taskId);

    if (updateError) {
      throw updateError;
    }

    const didAdjustLatestCompletedEvent =
      targetStatusEvent.status === 'completed' &&
      latestCompletedEvent?.id === targetStatusEvent.id &&
      Boolean(latestCompletedEvent.created_at);

    if (didAdjustLatestCompletedEvent) {
      await syncWorkshopTaskCompletionDependents({
        supabaseAdmin,
        task: typedTask,
        completedAt: latestCompletedEvent.created_at,
        userId: user.id,
        historyComment: `Updated from workshop task completed timestamp adjustment: ${typedTask.title || 'Task'}`,
      });
    }

    return NextResponse.json({
      success: true,
      taskId,
      timelineItemId: targetStatusEvent.id,
      itemType,
      timestamp,
    });
  } catch (error) {
    console.error('Error adjusting workshop task timestamp:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp',
      additionalData: {
        endpoint: 'PATCH /api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp',
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
