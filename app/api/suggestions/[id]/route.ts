import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { toSubmitterSuggestion } from '@/lib/utils/suggestion-projections';
import type { Suggestion, SuggestionUpdateWithUser } from '@/types/faq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: suggestion, error: suggestionError } = await admin
      .from('suggestions')
      .select('id, created_by, title, body, page_hint, status, created_at, updated_at')
      .eq('id', id)
      .single();

    if (suggestionError) {
      if (suggestionError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw suggestionError;
    }

    const rawSuggestion = suggestion as Suggestion;
    const isOwner = rawSuggestion.created_by === user.id;
    if (!isOwner) {
      const canManageSuggestions = await canEffectiveRoleAccessModule('suggestions');
      if (!canManageSuggestions) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { data: updates, error: updatesError } = await admin
      .from('suggestion_updates')
      .select('id, suggestion_id, created_by, old_status, new_status, note, created_at')
      .eq('suggestion_id', id)
      .order('created_at', { ascending: true });

    if (updatesError) {
      throw updatesError;
    }

    const rawUpdates = (updates || []) as SuggestionUpdateWithUser[];
    const profileIds = Array.from(new Set([
      rawSuggestion.created_by,
      ...rawUpdates.map((update) => update.created_by),
    ].filter(Boolean)));

    let profileMap = new Map<string, { full_name: string | null }>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', profileIds);

      if (profilesError) {
        throw profilesError;
      }

      profileMap = new Map(
        (profiles || []).map((profile: { id: string; full_name: string | null }) => [
          profile.id,
          { full_name: profile.full_name },
        ])
      );
    }

    return NextResponse.json({
      success: true,
      suggestion: {
        ...toSubmitterSuggestion(rawSuggestion),
        user: profileMap.get(rawSuggestion.created_by) || null,
      },
      updates: rawUpdates.map((update) => ({
        ...update,
        user: profileMap.get(update.created_by) || null,
      })),
    });
  } catch (error) {
    console.error('Error in GET /api/suggestions/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions/[id]',
      additionalData: { endpoint: '/api/suggestions/[id]' },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
