import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import { isTrainingValidationStatus, type TrainingValidationStatus } from '@/types/training';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface TrainingQualificationUpdateBody {
  canonical_name?: string;
  validation_status?: TrainingValidationStatus;
  validation_notes?: string | null;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as TrainingQualificationUpdateBody;
    const update: Record<string, unknown> = {};

    if (body.canonical_name !== undefined) {
      const canonicalName = cleanString(body.canonical_name);
      if (!canonicalName) {
        return NextResponse.json({ error: 'Canonical name is required' }, { status: 400 });
      }
      update.canonical_name = canonicalName;
    }
    if (body.validation_status !== undefined) {
      if (!isTrainingValidationStatus(body.validation_status)) {
        return NextResponse.json({ error: 'Invalid validation status' }, { status: 400 });
      }
      update.validation_status = body.validation_status;
    }
    if (body.validation_notes !== undefined) update.validation_notes = cleanString(body.validation_notes);

    const { data, error } = await createAdminClient()
      .from('training_qualifications')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Training qualification not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, qualification: data });
  } catch (error) {
    console.error('Error updating training qualification:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/qualifications/[id]',
      additionalData: { endpoint: '/api/training/qualifications/[id]' },
    });
    return NextResponse.json({ error: 'Failed to update training qualification' }, { status: 500 });
  }
}
