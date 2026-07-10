import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { UUIDSchema, ListCommentsQuerySchema } from '@/lib/validation/schemas';

// Timeline item types
type StatusEvent = {
  id: string;
  type: 'status_event';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  meta: {
    status: string;
    signature_data?: string;
    signed_at?: string;
  };
};

type Comment = {
  id: string;
  type: 'comment';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  can_edit: boolean;
  can_delete: boolean;
};

type TimelineItem = StatusEvent | Comment;

interface StatusHistoryEvent {
  id?: string;
  created_at?: string;
  status?: string;
  author_id?: string;
  author_name?: string;
  body?: string;
  meta?: {
    signature_data?: string;
    signed_at?: string;
  };
}

interface ProfileShape {
  id: string;
  full_name: string;
}

function pickProfile(profile: ProfileShape | ProfileShape[] | null | undefined): ProfileShape | null {
  if (!profile) return null;
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

/**
 * GET /api/workshop-tasks/tasks/:taskId/comments
 * Returns unified timeline: status events + comments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate taskId
    const { taskId } = await params;
    const taskIdValidation = UUIDSchema.safeParse(taskId);
    if (!taskIdValidation.success) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Check workshop-tasks permission
    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: workshop-tasks permission required' },
        { status: 403 }
      );
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const queryValidation = ListCommentsQuerySchema.safeParse({
      cursor: searchParams.get('cursor') || undefined,
      limit: parseInt(searchParams.get('limit') || '20'),
      order: searchParams.get('order') || 'asc',
    });

    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }

    const { limit, order } = queryValidation.data;

    // Fetch the task (verify it exists and is a workshop task)
    const { data: task, error: taskError } = await supabase
      .from('actions')
      .select('id, action_type, created_at, created_by, logged_at, logged_by, logged_comment, actioned_at, actioned_by, actioned_comment, actioned_signature_data, actioned_signed_at, status_history')
      .eq('id', taskId)
      .single();
    const typedTask = task as {
      id: string;
      action_type: string;
      created_at: string;
      created_by: string | null;
      logged_at: string | null;
      logged_by: string | null;
      logged_comment: string | null;
      actioned_at: string | null;
      actioned_by: string | null;
      actioned_comment: string | null;
      actioned_signature_data: string | null;
      actioned_signed_at: string | null;
      status_history: unknown;
    } | null;

    if (taskError || !typedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes(typedTask.action_type)) {
      return NextResponse.json(
        { error: 'Task is not a workshop task' },
        { status: 400 }
      );
    }

    // Fetch comments
    const { data: comments, error: commentsError } = await supabase
      .from('workshop_task_comments')
      .select(`
        id,
        body,
        created_at,
        author_id,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: order === 'asc' })
      .limit(limit);
    const typedComments = (comments || []) as Array<{
      id: string;
      body: string;
      created_at: string;
      author_id: string;
      profiles: ProfileShape | ProfileShape[] | null;
    }>;

    if (commentsError) {
      throw commentsError;
    }

    // Build timeline items array
    const timelineItems: TimelineItem[] = [];

    const statusHistory: StatusHistoryEvent[] = Array.isArray(typedTask.status_history)
      ? (typedTask.status_history as StatusHistoryEvent[])
      : [];
    const historyAuthorIds = [...new Set(
      statusHistory
        .map((event) => event?.author_id)
        .filter((authorId): authorId is string => Boolean(authorId))
    )];

    let statusAuthorMap = new Map<string, { id: string; full_name: string }>();
    if (historyAuthorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', historyAuthorIds);
      const typedProfiles = (profiles || []) as Array<{ id: string; full_name: string }>;
      statusAuthorMap = new Map(typedProfiles.map((p) => [p.id, p]));
    }

    if (statusHistory.length > 0) {
      for (const event of statusHistory) {
        if (!event?.created_at || !event?.status) continue;
        const authorProfile = event.author_id
          ? statusAuthorMap.get(event.author_id) || null
          : null;
        timelineItems.push({
          id: event.id || `status:${event.status}:${typedTask.id}:${event.created_at}`,
          type: 'status_event',
          created_at: event.created_at,
          author: event.author_name
            ? { id: event.author_id || '', full_name: event.author_name }
            : authorProfile,
          body: event.body || 'Status updated',
          meta: {
            status: event.status,
            signature_data: event.meta?.signature_data,
            signed_at: event.meta?.signed_at,
          },
        });
      }
    } else {
      // Fallback: derive from logged/actioned fields
      if (typedTask.logged_at && typedTask.logged_by) {
        const { data: loggedByProfile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', typedTask.logged_by)
          .single();

        timelineItems.push({
          id: `status:logged:${typedTask.id}`,
          type: 'status_event',
          created_at: typedTask.logged_at,
          author: loggedByProfile || null,
          body: typedTask.logged_comment || 'Marked as In Progress',
          meta: { status: 'logged' },
        });
      }

      if (typedTask.actioned_at && typedTask.actioned_by) {
        const { data: actionedByProfile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', typedTask.actioned_by)
          .single();

        timelineItems.push({
          id: `status:completed:${typedTask.id}`,
          type: 'status_event',
          created_at: typedTask.actioned_at,
          author: actionedByProfile || null,
          body: typedTask.actioned_comment || 'Marked as Complete',
          meta: {
            status: 'completed',
            signature_data: typedTask.actioned_signature_data || undefined,
            signed_at: typedTask.actioned_signed_at || undefined,
          },
        });
      }
    }

    // Add freeform comments
    if (typedComments.length > 0) {
      for (const comment of typedComments) {
        timelineItems.push({
          id: comment.id,
          type: 'comment',
          created_at: comment.created_at,
          author: pickProfile(comment.profiles)
            ? {
                id: pickProfile(comment.profiles)?.id ?? '',
                full_name: pickProfile(comment.profiles)?.full_name ?? 'Unknown',
              }
            : null,
          body: comment.body,
          can_edit: comment.author_id === user.id,
          can_delete: comment.author_id === user.id,
        });
      }
    }

    // Sort timeline by created_at
    timelineItems.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return order === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return NextResponse.json({
      success: true,
      taskId,
      items: timelineItems,
      // nextCursor: undefined, // TODO: Implement pagination if needed
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/comments',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/tasks/[taskId]/comments',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/tasks/:taskId/comments
 * Create a new comment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate taskId
    const { taskId } = await params;
    const taskIdValidation = UUIDSchema.safeParse(taskId);
    if (!taskIdValidation.success) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Check workshop-tasks permission
    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: workshop-tasks permission required' },
        { status: 403 }
      );
    }

    // Parse and validate body
    const body = await request.json().catch(() => null) as { body?: unknown } | null;
    if (!body || typeof body.body !== 'string') {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    }

    const bodyText = body.body.trim();

    if (!bodyText || bodyText.length < 1) {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    }

    if (bodyText.length > 1000) {
      return NextResponse.json({ error: 'Comment must be less than 1000 characters' }, { status: 400 });
    }

    // Verify task exists and is a workshop task
    const { data: task, error: taskError } = await supabase
      .from('actions')
      .select('id, action_type')
      .eq('id', taskId)
      .single();
    const typedTask = task as { id: string; action_type: string } | null;

    if (taskError || !typedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes(typedTask.action_type)) {
      return NextResponse.json(
        { error: 'Task is not a workshop task' },
        { status: 400 }
      );
    }

    // Insert comment
    const { data: comment, error: insertError } = await supabase
      .from('workshop_task_comments')
      .insert({
        task_id: taskId,
        author_id: user.id,
        body: bodyText,
      } as never)
      .select(`
        id,
        task_id,
        body,
        created_at,
        author_id,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .single();
    const typedComment = comment as {
      id: string;
      body: string;
      created_at: string;
      profiles: ProfileShape | ProfileShape[] | null;
    } | null;

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      comment: {
        id: typedComment?.id || '',
        type: 'comment',
        created_at: typedComment?.created_at,
        author: pickProfile(typedComment?.profiles)
          ? {
              id: pickProfile(typedComment?.profiles)?.id ?? '',
              full_name: pickProfile(typedComment?.profiles)?.full_name ?? 'Unknown',
            }
          : null,
        body: typedComment?.body || '',
        can_edit: true,
        can_delete: true,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating comment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/comments',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/tasks/[taskId]/comments',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
