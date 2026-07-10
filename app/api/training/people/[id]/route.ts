import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import { isTrainingProfileMatchStatus, type TrainingProfileMatchStatus } from '@/types/training';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface TrainingPersonUpdateBody {
  employee_name_raw?: string;
  profile_id?: string | null;
  profile_match_status?: TrainingProfileMatchStatus;
  profile_match_notes?: string | null;
  date_of_births?: string[] | string;
  source_sheets?: string[] | string;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as TrainingPersonUpdateBody;
    const update: Record<string, unknown> = {};

    if (body.employee_name_raw !== undefined) {
      const name = cleanString(body.employee_name_raw);
      if (!name) {
        return NextResponse.json({ error: 'Employee name is required' }, { status: 400 });
      }
      update.employee_name_raw = name;
    }
    if (body.profile_id !== undefined) update.profile_id = cleanString(body.profile_id);
    if (body.profile_match_status !== undefined) {
      if (!isTrainingProfileMatchStatus(body.profile_match_status)) {
        return NextResponse.json({ error: 'Invalid profile match status' }, { status: 400 });
      }
      update.profile_match_status = body.profile_match_status;
    }
    if (body.profile_match_notes !== undefined) update.profile_match_notes = cleanString(body.profile_match_notes);
    if (body.date_of_births !== undefined) update.date_of_births = cleanStringArray(body.date_of_births);
    if (body.source_sheets !== undefined) update.source_sheets = cleanStringArray(body.source_sheets);

    const { data, error } = await createAdminClient()
      .from('training_people')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        profile:profiles(id, full_name, employee_id)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Training person not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, person: data });
  } catch (error) {
    console.error('Error updating training person:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/people/[id]',
      additionalData: { endpoint: '/api/training/people/[id]' },
    });
    return NextResponse.json({ error: 'Failed to update training person' }, { status: 500 });
  }
}
