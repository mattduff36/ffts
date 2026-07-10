import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { z } from 'zod';

const REPORTS_PAGE_HINT = '/reports';
const createReportSuggestionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title must be 160 characters or fewer'),
  body: z.string().trim().min(1, 'Description is required').max(4000, 'Description must be 4000 characters or fewer'),
});

interface ReportSuggestionRow {
  id: string;
  created_by: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('reports');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - reports access required' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 250);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const admin = createAdminClient();
    const { data: rawSuggestions, error } = await admin
      .from('suggestions')
      .select('id, created_by, title, body, created_at, updated_at')
      .eq('page_hint', REPORTS_PAGE_HINT)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const creatorIds = [...new Set(((rawSuggestions || []) as ReportSuggestionRow[]).map((row) => row.created_by).filter(Boolean))];
    let creatorNameById = new Map<string, string | null>();

    if (creatorIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', creatorIds);

      if (profilesError) {
        throw profilesError;
      }

      creatorNameById = new Map(
        ((profiles || []) as Array<{ id: string; full_name: string | null }>).map((row) => [row.id, row.full_name])
      );
    }

    const suggestions = ((rawSuggestions || []) as ReportSuggestionRow[]).map((row) => ({
      ...row,
      user: {
        full_name: creatorNameById.get(row.created_by) || null,
      },
    }));

    return NextResponse.json({
      success: true,
      suggestions,
      pagination: {
        offset,
        limit,
        has_more: (rawSuggestions || []).length === limit,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/reports/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/suggestions',
      additionalData: { endpoint: '/api/reports/suggestions' },
    });

    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('reports');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - reports access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createReportSuggestionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Please correct the highlighted fields and try again.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { title, body: description } = parsed.data;

    const admin = createAdminClient();
    const { data: suggestion, error } = await admin
      .from('suggestions')
      .insert({
        created_by: user.id,
        title,
        body: description,
        page_hint: REPORTS_PAGE_HINT,
        status: 'new',
      })
      .select('id, created_by, title, body, created_at, updated_at')
      .single();

    if (error) {
      throw error;
    }

    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();

    return NextResponse.json(
      {
        success: true,
        suggestion: {
          ...(suggestion as ReportSuggestionRow),
          user: {
            full_name: profile?.full_name || null,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/reports/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/suggestions',
      additionalData: { endpoint: '/api/reports/suggestions' },
    });

    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
