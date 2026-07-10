import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAccess, requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import { parseTrainingDate } from '@/lib/utils/training-import';
import {
  isTrainingRecordStatus,
  isTrainingValidationStatus,
  type TrainingRecordStatus,
  type TrainingValidationStatus,
} from '@/types/training';

interface TrainingRecordRequestBody {
  employee_name_raw?: string;
  qualification_raw?: string;
  qualification_canonical_proposed?: string;
  qualification_validation_status?: TrainingValidationStatus;
  qualification_group?: string;
  relationship?: string;
  card_number?: string;
  card_type_or_status?: string;
  approved?: string;
  issue_date?: string | null;
  issue_raw?: string | null;
  expiry_date?: string | null;
  expiry_raw?: string | null;
  date_of_birth?: string | null;
  date_of_birth_raw?: string | null;
  comments?: string;
  record_status?: TrainingRecordStatus;
  next_review_at?: string | null;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function cleanDate(value: unknown, rawFallback?: unknown): { date: string | null; raw: string | null } {
  const parsed = parseTrainingDate(value);
  return {
    date: parsed.date,
    raw: cleanString(rawFallback) || parsed.raw,
  };
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireTrainingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const statusParam = searchParams.get('status');
    const admin = createAdminClient();

    let query = admin
      .from('training_records')
      .select(`
        *,
        person:training_people(id, employee_key, employee_name_raw, profile_id, profile_match_status),
        qualification:training_qualifications(id, qualification_key, canonical_name, validation_status)
      `)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('employee_name_raw', { ascending: true })
      .range(offset, offset + limit - 1);

    if (statusParam === 'active' || statusParam === 'archived') {
      query = query.eq('record_status', statusParam);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      records: data || [],
      pagination: {
        offset,
        limit,
        has_more: (data?.length || 0) === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching training records:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/records',
      additionalData: { endpoint: '/api/training/records' },
    });
    return NextResponse.json({ error: 'Failed to fetch training records' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as TrainingRecordRequestBody;
    const qualificationRaw = cleanString(body.qualification_raw);
    if (!qualificationRaw) {
      return NextResponse.json({ error: 'Qualification is required' }, { status: 400 });
    }

    const validationStatus = body.qualification_validation_status || 'needs_manual_review';
    if (!isTrainingValidationStatus(validationStatus)) {
      return NextResponse.json({ error: 'Invalid qualification validation status' }, { status: 400 });
    }

    const recordStatus = body.record_status || 'active';
    if (!isTrainingRecordStatus(recordStatus)) {
      return NextResponse.json({ error: 'Invalid record status' }, { status: 400 });
    }

    const issue = cleanDate(body.issue_date, body.issue_raw);
    const expiry = cleanDate(body.expiry_date, body.expiry_raw);
    const dateOfBirth = cleanDate(body.date_of_birth, body.date_of_birth_raw);
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('training_records')
      .insert({
        source_record_id: `manual-${randomUUID()}`,
        employee_name_raw: cleanString(body.employee_name_raw),
        qualification_raw: qualificationRaw,
        qualification_canonical_proposed: cleanString(body.qualification_canonical_proposed) || qualificationRaw,
        qualification_validation_status: validationStatus,
        qualification_group: cleanString(body.qualification_group),
        relationship: cleanString(body.relationship),
        card_number: cleanString(body.card_number),
        card_type_or_status: cleanString(body.card_type_or_status),
        approved: cleanString(body.approved),
        issue_date: issue.date,
        issue_raw: issue.raw,
        expiry_date: expiry.date,
        expiry_raw: expiry.raw,
        date_of_birth: dateOfBirth.date,
        date_of_birth_raw: dateOfBirth.raw,
        comments: cleanString(body.comments),
        record_status: recordStatus,
        next_review_at: parseTrainingDate(body.next_review_at).date,
        source_sheet: 'Manual Entry',
        source_row: 0,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select(`
        *,
        person:training_people(id, employee_key, employee_name_raw, profile_id, profile_match_status),
        qualification:training_qualifications(id, qualification_key, canonical_name, validation_status)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, record: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating training record:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/records',
      additionalData: { endpoint: '/api/training/records' },
    });
    return NextResponse.json({ error: 'Failed to create training record' }, { status: 500 });
  }
}
