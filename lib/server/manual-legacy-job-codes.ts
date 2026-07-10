import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeCatalogJobCode } from '@/lib/utils/timesheet-job-codes';

const MANUAL_LEGACY_SOURCE_FILE = 'debug/manual-legacy-job-codes';
const MANUAL_LEGACY_BATCH_HASH = createHash('sha256')
  .update(MANUAL_LEGACY_SOURCE_FILE)
  .digest('hex');
const MANUAL_LEGACY_SOURCE_ROW_OFFSET = 3_000_000;

export interface ManualLegacyJobCodeInput {
  jobCode: string;
  name: string;
  customer: string;
  createdBy?: string | null;
}

export interface ManualLegacyJobCodeResult {
  id: string;
  quote_reference: string | null;
  customer_name: string;
  title: string;
  source_row: number;
  wasExisting: boolean;
}

function getInitialsFromStandardCode(value: string): string | null {
  const match = value.match(/^\d{4,5}-([A-Z]{2})$/);
  return match?.[1] || null;
}

function getNumberFromStandardCode(value: string): number | null {
  const match = value.match(/^(\d{4,5})-[A-Z]{2}$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeInputText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildRawData(input: ManualLegacyJobCodeInput, quoteReference: string) {
  return {
    source: MANUAL_LEGACY_SOURCE_FILE,
    'Job Number': quoteReference,
    Name: normalizeInputText(input.name),
    Customer: normalizeInputText(input.customer),
    created_by: input.createdBy || null,
  };
}

async function getManualImportBatchId(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from('legacy_quote_import_batches')
    .upsert({
      source_file: MANUAL_LEGACY_SOURCE_FILE,
      source_hash: MANUAL_LEGACY_BATCH_HASH,
      imported_at: new Date().toISOString(),
      metadata: {
        source: 'debug_manual_tool',
        mode: 'append_missing_only',
        sourceRowOffset: MANUAL_LEGACY_SOURCE_ROW_OFFSET,
      },
    }, { onConflict: 'source_hash' })
    .select('id')
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error('Unable to create manual legacy job-code import batch.');
  return data.id;
}

async function getNextManualSourceRow(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from('legacy_quotes')
    .select('source_row')
    .gte('source_row', MANUAL_LEGACY_SOURCE_ROW_OFFSET)
    .order('source_row', { ascending: false })
    .limit(1);

  if (error) throw error;
  const currentMax = data?.[0]?.source_row;
  return typeof currentMax === 'number'
    ? currentMax + 1
    : MANUAL_LEGACY_SOURCE_ROW_OFFSET + 1;
}

export async function addManualLegacyJobCode(input: ManualLegacyJobCodeInput): Promise<ManualLegacyJobCodeResult> {
  const quoteReference = normalizeCatalogJobCode(input.jobCode);
  const title = normalizeInputText(input.name);
  const customerName = normalizeInputText(input.customer);

  if (!quoteReference) {
    throw new Error('Enter a job code.');
  }
  if (!title) {
    throw new Error('Enter a name/description.');
  }
  if (!customerName) {
    throw new Error('Enter a customer.');
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from('legacy_quotes')
    .select('id, quote_reference, customer_name, title, source_row')
    .eq('quote_reference', quoteReference)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    return {
      ...existing,
      wasExisting: true,
    };
  }

  const importBatchId = await getManualImportBatchId(admin);
  const sourceRow = await getNextManualSourceRow(admin);
  const rawData = buildRawData(input, quoteReference);
  const sourceHash = createHash('sha256')
    .update(JSON.stringify(rawData))
    .digest('hex');

  const { data, error } = await admin
    .from('legacy_quotes')
    .insert({
      import_batch_id: importBatchId,
      source_row: sourceRow,
      source_hash: sourceHash,
      quote_reference: quoteReference,
      quote_number: getNumberFromStandardCode(quoteReference),
      quote_suffix: getInitialsFromStandardCode(quoteReference),
      customer_name: customerName,
      title,
      quote_manager_name: 'Manual Debug Entry',
      quote_manager_initials: null,
      raw_data: rawData,
    })
    .select('id, quote_reference, customer_name, title, source_row')
    .single();

  if (error) throw error;
  if (!data) throw new Error('Unable to create legacy job code.');

  return {
    ...data,
    wasExisting: false,
  };
}
