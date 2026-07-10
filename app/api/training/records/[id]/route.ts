import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import { parseTrainingDate } from '@/lib/utils/training-import';
import {
  isTrainingRecordStatus,
  isTrainingValidationStatus,
  type TrainingRecordStatus,
  type TrainingValidationStatus,
} from '@/types/training';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface TrainingRecordUpdateBody {
  employee_name_raw?: string | null;
  qualification_raw?: string;
  qualification_canonical_proposed?: string;
  qualification_validation_status?: TrainingValidationStatus;
  qualification_group?: string | null;
  relationship?: string | null;
  card_number?: string | null;
  card_type_or_status?: string | null;
  approved?: string | null;
  issue_date?: string | null;
  issue_raw?: string | null;
  expiry_date?: string | null;
  expiry_raw?: string | null;
  date_of_birth?: string | null;
  date_of_birth_raw?: string | null;
  comments?: string | null;
  record_status?: TrainingRecordStatus;
  next_review_at?: string | null;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function applyDateUpdate(
  update: Record<string, unknown>,
  dateKey: 'issue_date' | 'expiry_date' | 'date_of_birth' | 'next_review_at',
  rawKey: 'issue_raw' | 'expiry_raw' | 'date_of_birth_raw' | null,
  dateValue: unknown,
  rawValue?: unknown
) {
  const parsed = parseTrainingDate(dateValue);
  update[dateKey] = parsed.date;
  if (rawKey) {
    update[rawKey] = cleanString(rawValue) || parsed.raw;
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as TrainingRecordUpdateBody;
    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.employee_name_raw !== undefined) update.employee_name_raw = cleanString(body.employee_name_raw);
    if (body.qualification_raw !== undefined) {
      const qualificationRaw = cleanString(body.qualification_raw);
      if (!qualificationRaw) {
        return NextResponse.json({ error: 'Qualification is required' }, { status: 400 });
      }
      update.qualification_raw = qualificationRaw;
    }
    if (body.qualification_canonical_proposed !== undefined) {
      const canonicalName = cleanString(body.qualification_canonical_proposed);
      if (!canonicalName && typeof update.qualification_raw !== 'string') {
        return NextResponse.json({ error: 'Proposed qualification name is required' }, { status: 400 });
      }
      update.qualification_canonical_proposed = canonicalName || update.qualification_raw;
    }
    if (body.qualification_validation_status !== undefined) {
      if (!isTrainingValidationStatus(body.qualification_validation_status)) {
        return NextResponse.json({ error: 'Invalid qualification validation status' }, { status: 400 });
      }
      update.qualification_validation_status = body.qualification_validation_status;
    }
    if (body.qualification_group !== undefined) update.qualification_group = cleanString(body.qualification_group);
    if (body.relationship !== undefined) update.relationship = cleanString(body.relationship);
    if (body.card_number !== undefined) update.card_number = cleanString(body.card_number);
    if (body.card_type_or_status !== undefined) update.card_type_or_status = cleanString(body.card_type_or_status);
    if (body.approved !== undefined) update.approved = cleanString(body.approved);
    if (body.issue_date !== undefined || body.issue_raw !== undefined) {
      applyDateUpdate(update, 'issue_date', 'issue_raw', body.issue_date, body.issue_raw);
    }
    if (body.expiry_date !== undefined || body.expiry_raw !== undefined) {
      applyDateUpdate(update, 'expiry_date', 'expiry_raw', body.expiry_date, body.expiry_raw);
    }
    if (body.date_of_birth !== undefined || body.date_of_birth_raw !== undefined) {
      applyDateUpdate(update, 'date_of_birth', 'date_of_birth_raw', body.date_of_birth, body.date_of_birth_raw);
    }
    if (body.comments !== undefined) update.comments = cleanString(body.comments);
    if (body.record_status !== undefined) {
      if (!isTrainingRecordStatus(body.record_status)) {
        return NextResponse.json({ error: 'Invalid record status' }, { status: 400 });
      }
      update.record_status = body.record_status;
    }
    if (body.next_review_at !== undefined) {
      applyDateUpdate(update, 'next_review_at', null, body.next_review_at);
    }

    const { data, error } = await createAdminClient()
      .from('training_records')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        person:training_people(id, employee_key, employee_name_raw, profile_id, profile_match_status),
        qualification:training_qualifications(id, qualification_key, canonical_name, validation_status)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Training record not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, record: data });
  } catch (error) {
    console.error('Error updating training record:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/records/[id]',
      additionalData: { endpoint: '/api/training/records/[id]' },
    });
    return NextResponse.json({ error: 'Failed to update training record' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const { error } = await createAdminClient()
      .from('training_records')
      .update({
        record_status: 'archived',
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error archiving training record:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/records/[id]',
      additionalData: { endpoint: '/api/training/records/[id]' },
    });
    return NextResponse.json({ error: 'Failed to archive training record' }, { status: 500 });
  }
}
