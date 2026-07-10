import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const access = await requireTrainingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const noteType = searchParams.get('note_type');

    let query = createAdminClient()
      .from('training_workbook_notes')
      .select('*')
      .order('source_sheet', { ascending: true })
      .order('source_row', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (noteType === 'workbook_note' || noteType === 'likely_misc_note') {
      query = query.eq('note_type', noteType);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      notes: data || [],
      pagination: {
        offset,
        limit,
        has_more: (data?.length || 0) === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching training workbook notes:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/notes',
      additionalData: { endpoint: '/api/training/notes' },
    });
    return NextResponse.json({ error: 'Failed to fetch training notes' }, { status: 500 });
  }
}
