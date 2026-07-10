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
    const validationStatus = searchParams.get('validation_status');

    let query = createAdminClient()
      .from('training_qualifications')
      .select('*')
      .order('record_count', { ascending: false })
      .order('qualification_raw', { ascending: true })
      .range(offset, offset + limit - 1);

    if (validationStatus && validationStatus !== 'all') {
      query = query.eq('validation_status', validationStatus);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      qualifications: data || [],
      pagination: {
        offset,
        limit,
        has_more: (data?.length || 0) === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching training qualifications:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/qualifications',
      additionalData: { endpoint: '/api/training/qualifications' },
    });
    return NextResponse.json({ error: 'Failed to fetch training qualifications' }, { status: 500 });
  }
}
