import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import { generateExcelFile } from '@/lib/utils/excel';
import type { TrainingRecordWithRelations } from '@/types/training';

const TRAINING_EXPORT_PAGE_SIZE = 1000;
const TRAINING_EXPORT_MAX_ROWS = 5000;
const TRAINING_EXPORT_SELECT = `
  employee_name_raw,
  qualification_raw,
  qualification_canonical_proposed,
  qualification_validation_status,
  qualification_group,
  relationship,
  card_number,
  card_type_or_status,
  approved,
  issue_date,
  issue_raw,
  expiry_date,
  expiry_raw,
  cpcs_statuses,
  cpcs_status_meanings,
  comments,
  record_status,
  source_sheet,
  source_row,
  source_record_id,
  person:training_people(id, employee_key, employee_name_raw, profile_id, profile_match_status),
  qualification:training_qualifications(id, qualification_key, canonical_name, validation_status)
`;

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function joinList(value: string[] | null | undefined): string {
  return value?.length ? value.join(', ') : '';
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireTrainingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const admin = createAdminClient();
    const records: TrainingRecordWithRelations[] = [];
    let offset = 0;

    while (records.length <= TRAINING_EXPORT_MAX_ROWS) {
      let query = admin
        .from('training_records')
        .select(TRAINING_EXPORT_SELECT)
        .order('employee_name_raw', { ascending: true })
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .range(offset, offset + TRAINING_EXPORT_PAGE_SIZE - 1);

      if (statusParam === 'active' || statusParam === 'archived') {
        query = query.eq('record_status', statusParam);
      }

      const { data, error } = await query;
      if (error) throw error;

      const pageRecords = (data || []) as unknown as TrainingRecordWithRelations[];
      records.push(...pageRecords);
      if (pageRecords.length < TRAINING_EXPORT_PAGE_SIZE) break;

      offset += TRAINING_EXPORT_PAGE_SIZE;
    }

    if (records.length > TRAINING_EXPORT_MAX_ROWS) {
      return NextResponse.json(
        { error: `Training export is limited to ${TRAINING_EXPORT_MAX_ROWS.toLocaleString('en-GB')} rows. Use a status filter or archive older records before exporting.` },
        { status: 413 }
      );
    }

    const excelRows = records.map((record) => ({
      'Employee': record.employee_name_raw || record.person?.employee_name_raw || '',
      'Profile Match': record.person?.profile_match_status || '',
      'Qualification Raw': record.qualification_raw,
      'Qualification Proposed': record.qualification_canonical_proposed,
      'Validation Status': record.qualification_validation_status,
      'Group': record.qualification_group || '',
      'Relationship': record.relationship || '',
      'Card Number': record.card_number || '',
      'Card Type / Status': record.card_type_or_status || '',
      'Approved': record.approved || '',
      'Issue Date': formatDate(record.issue_date),
      'Issue Raw': record.issue_raw || '',
      'Expiry Date': formatDate(record.expiry_date),
      'Expiry Raw': record.expiry_raw || '',
      'CPCS Status': joinList(record.cpcs_statuses),
      'CPCS Status Meaning': joinList(record.cpcs_status_meanings),
      'Comments': record.comments || '',
      'Record Status': record.record_status,
      'Source Sheet': record.source_sheet,
      'Source Row': record.source_row,
      'Source Record ID': record.source_record_id,
    }));

    const buffer = await generateExcelFile([{
      sheetName: 'Training Records',
      columns: [
        { header: 'Employee', key: 'Employee', width: 24 },
        { header: 'Profile Match', key: 'Profile Match', width: 16 },
        { header: 'Qualification Raw', key: 'Qualification Raw', width: 42 },
        { header: 'Qualification Proposed', key: 'Qualification Proposed', width: 42 },
        { header: 'Validation Status', key: 'Validation Status', width: 24 },
        { header: 'Group', key: 'Group', width: 24 },
        { header: 'Relationship', key: 'Relationship', width: 16 },
        { header: 'Card Number', key: 'Card Number', width: 18 },
        { header: 'Card Type / Status', key: 'Card Type / Status', width: 18 },
        { header: 'Approved', key: 'Approved', width: 12 },
        { header: 'Issue Date', key: 'Issue Date', width: 14 },
        { header: 'Issue Raw', key: 'Issue Raw', width: 16 },
        { header: 'Expiry Date', key: 'Expiry Date', width: 14 },
        { header: 'Expiry Raw', key: 'Expiry Raw', width: 16 },
        { header: 'CPCS Status', key: 'CPCS Status', width: 24 },
        { header: 'CPCS Status Meaning', key: 'CPCS Status Meaning', width: 34 },
        { header: 'Comments', key: 'Comments', width: 36 },
        { header: 'Record Status', key: 'Record Status', width: 14 },
        { header: 'Source Sheet', key: 'Source Sheet', width: 24 },
        { header: 'Source Row', key: 'Source Row', width: 12 },
        { header: 'Source Record ID', key: 'Source Record ID', width: 22 },
      ],
      data: excelRows,
    }]);

    const filename = `Training_Records_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating training export:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/training/export',
      additionalData: { endpoint: '/api/reports/training/export' },
    });
    return NextResponse.json({ error: 'Failed to generate training export' }, { status: 500 });
  }
}
