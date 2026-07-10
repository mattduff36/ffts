import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSuggestionNotificationCreatedVia } from '@/lib/utils/suggestion-notifications';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { SUGGESTION_STATUS_LABELS } from '@/types/faq';
import type { UpdateSuggestionRequest, Suggestion, SuggestionUpdateWithUser } from '@/types/faq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/management/suggestions/[id]
 * Get a single suggestion with its update history
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('suggestions');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - suggestions access required' }, { status: 403 });
    }

    // Fetch suggestion first, then resolve creator profile separately.
    // suggestions.created_by does not have a direct PostgREST relationship to profiles.
    const { data: suggestion, error: suggestionError } = await supabase
      .from('suggestions')
      .select('id, created_by, title, body, page_hint, status, admin_notes, created_at, updated_at')
      .eq('id', id)
      .single();

    if (suggestionError) {
      if (suggestionError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw suggestionError;
    }

    // Fetch update history
    const { data: updates, error: updatesError } = await supabase
      .from('suggestion_updates')
      .select('id, suggestion_id, created_by, old_status, new_status, note, created_at')
      .eq('suggestion_id', id)
      .order('created_at', { ascending: false });

    if (updatesError) {
      throw updatesError;
    }

    const rawSuggestion = suggestion as Suggestion;
    const rawUpdates = (updates || []) as SuggestionUpdateWithUser[];
    const creatorIds = [...new Set([
      rawSuggestion.created_by,
      ...rawUpdates.map((update) => update.created_by),
    ].filter(Boolean))];

    let profileMap = new Map<string, { full_name: string | null }>();
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', creatorIds);

      if (profiles) {
        profileMap = new Map(
          profiles.map((profile: { id: string; full_name: string | null }) => [
            profile.id,
            { full_name: profile.full_name },
          ])
        );
      }
    }

    return NextResponse.json({
      success: true,
      suggestion: {
        ...rawSuggestion,
        user: profileMap.get(rawSuggestion.created_by) || null,
      } as Suggestion & { user?: { full_name: string | null } },
      updates: rawUpdates.map((update) => ({
        ...update,
        user: profileMap.get(update.created_by) || null,
      })) as SuggestionUpdateWithUser[],
    });

  } catch (error) {
    console.error('Error in GET /api/management/suggestions/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/suggestions/[id]',
      additionalData: { endpoint: '/api/management/suggestions/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/management/suggestions/[id]
 * Update a suggestion (status, admin_notes)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('suggestions');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - suggestions access required' }, { status: 403 });
    }

    const body: UpdateSuggestionRequest = await request.json();

    // Get current suggestion state
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: currentSuggestion, error: fetchError } = await supabase
      .from('suggestions')
      .select('status, created_by, title')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw fetchError;
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (body.status !== undefined) {
      updateData.status = body.status;
    }
    if (body.admin_notes !== undefined) {
      updateData.admin_notes = body.admin_notes;
    }

    // Update suggestion
    const { data: suggestion, error: updateError } = await supabase
      .from('suggestions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    const statusChanged = Boolean(body.status && body.status !== currentSuggestion?.status);
    const trimmedNote = body.note?.trim() || '';
    const hasResponseNote = trimmedNote.length > 0;

    // Create update record if status changed or note provided
    if (statusChanged || hasResponseNote) {
      await supabase
        .from('suggestion_updates')
        .insert({
          suggestion_id: id,
          created_by: user.id,
          old_status: currentSuggestion?.status,
          new_status: body.status || currentSuggestion?.status,
          note: trimmedNote || null,
        });
    }

    // Send in-app notification to both the suggestion author and responder.
    // This lets the responder verify the exact user-facing notification copy.
    if ((statusChanged || hasResponseNote) && currentSuggestion?.created_by) {
      try {
        const adminSupabase = createAdminClient();
        const oldStatus = currentSuggestion.status as keyof typeof SUGGESTION_STATUS_LABELS;
        const nextStatus = (body.status || currentSuggestion.status) as keyof typeof SUGGESTION_STATUS_LABELS;
        const oldLabel = SUGGESTION_STATUS_LABELS[oldStatus] || currentSuggestion.status;
        const newLabel = SUGGESTION_STATUS_LABELS[nextStatus] || (body.status || currentSuggestion.status);
        const suggestionTitle = currentSuggestion.title?.substring(0, 80) || 'Your suggestion';
        const subject = statusChanged
          ? `Suggestion Updated to ${newLabel}`
          : 'Suggestion Response Added';

        const bodyParts = [
          `Suggestion: "${suggestionTitle}"`,
          '',
        ];
        if (statusChanged) {
          bodyParts.push(`Status: ${oldLabel} -> ${newLabel}`, '');
        }
        if (hasResponseNote) {
          bodyParts.push(`Update note: ${trimmedNote}`, '');
        }
        bodyParts.push('---', 'Tip: You can review your suggestion status on the Help page.');

        const { data: message, error: messageError } = await adminSupabase
          .from('messages')
          .insert({
            type: 'NOTIFICATION',
            priority: 'HIGH',
            subject,
            body: bodyParts.join('\n'),
            sender_id: user.id,
            created_via: buildSuggestionNotificationCreatedVia(id),
            module_key: 'suggestions',
          })
          .select('id')
          .single();

        if (messageError) throw messageError;

        const recipientIds = Array.from(new Set([currentSuggestion.created_by, user.id].filter(Boolean)));
        if (recipientIds.length > 0) {
          const { error: recipientError } = await adminSupabase
            .from('message_recipients')
            .insert(
              recipientIds.map((recipientId) => ({
                message_id: message.id,
                user_id: recipientId,
                status: 'PENDING' as const,
              }))
            );

          if (recipientError) throw recipientError;
        }
      } catch (notifyError) {
        console.error('Failed to send suggestion update notification:', notifyError);
      }
    }

    return NextResponse.json({
      success: true,
      suggestion,
    });

  } catch (error) {
    console.error('Error in PATCH /api/management/suggestions/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/suggestions/[id]',
      additionalData: { endpoint: '/api/management/suggestions/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
