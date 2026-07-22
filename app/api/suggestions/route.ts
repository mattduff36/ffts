import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { toSubmitterSuggestion } from '@/lib/utils/suggestion-projections';
import type { CreateSuggestionRequest, Suggestion } from '@/types/faq';

/**
 * GET /api/suggestions
 * Get current user's own suggestions
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Fetch user's own suggestions
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: suggestions, error } = await supabase
      .from('suggestions')
      .select('id, created_by, title, body, page_hint, status, created_at, updated_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      suggestions: ((suggestions || []) as Suggestion[]).map(toSubmitterSuggestion),
      pagination: {
        offset,
        limit,
        has_more: (suggestions || []).length === limit,
      },
    });

  } catch (error) {
    console.error('Error in GET /api/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions',
      additionalData: { endpoint: '/api/suggestions' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/suggestions
 * Create a new suggestion
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateSuggestionRequest = await request.json();

    // Validate required fields
    if (!body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json({ 
        error: 'Title and description are required' 
      }, { status: 400 });
    }

    // Create suggestion
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: suggestion, error } = await supabase
      .from('suggestions')
      .insert({
        created_by: user.id,
        title: body.title.trim(),
        body: body.body.trim(),
        page_hint: body.page_hint?.trim() || null,
        status: 'new',
      })
      .select('id, created_by, title, body, page_hint, status, created_at, updated_at')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      suggestion: toSubmitterSuggestion(suggestion as Suggestion),
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions',
      additionalData: { endpoint: '/api/suggestions' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
