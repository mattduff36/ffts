import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getEntryJobNumbers,
  normalizeCatalogJobCode,
} from '@/lib/utils/timesheet-job-codes';

const PAGE_SIZE = 1_000;
const MUTATION_CHUNK_SIZE = 200;

export type JobCodeCorrectionScope = 'batch' | 'individual';

export interface JobCodeCorrectionInput {
  fromJobCode: string;
  toJobCode: string;
  scope: JobCodeCorrectionScope;
  timesheetIds?: string[];
  deleteOldLegacyQuote?: boolean;
}

export interface JobCodeCorrectionTimesheetSummary {
  id: string;
  userId: string;
  employeeName: string;
  employeeId: string | null;
  email: string | null;
  weekEnding: string;
  status: string;
  jobCodes: string[];
  matchingJobCodeCount: number;
}

export interface JobCodeCorrectionPreview {
  fromJobCode: string;
  toJobCode: string;
  scope: JobCodeCorrectionScope;
  deleteOldLegacyQuote: boolean;
  counts: {
    timesheetChildRows: number;
    timesheetScalarRows: number;
    childRowsToUpdate: number;
    childRowsToDeleteAsDuplicate: number;
    legacyQuoteRows: number;
    targetLegacyQuoteRows: number;
    legacyQuoteRowsToUpdate: number;
    legacyQuoteRowsToDelete: number;
    affectedTimesheets: number;
  };
  affectedTimesheets: JobCodeCorrectionTimesheetSummary[];
  warnings: string[];
}

export interface JobCodeCorrectionApplyResult {
  preview: JobCodeCorrectionPreview;
  applied: {
    childRowsUpdated: number;
    childRowsDeletedAsDuplicates: number;
    scalarRowsUpdated: number;
    legacyQuoteRowsUpdated: number;
    legacyQuoteRowsDeleted: number;
  };
}

export interface JobCodeTimesheetSearchResult extends JobCodeCorrectionTimesheetSummary {
  entries: Array<{
    id: string;
    dayOfWeek: number;
    jobCodes: string[];
  }>;
}

export interface JobCodeCorrectionStoredCodeOption {
  value: string;
  label: string;
  customerName: string | null;
  quoteTitle: string | null;
  source: 'timesheet' | 'legacy_quote';
}

interface ProfileRelation {
  full_name?: string | null;
  employee_id?: string | null;
  email?: string | null;
}

interface TimesheetRow {
  id: string;
  user_id: string;
  week_ending: string;
  status: string | null;
  profile?: ProfileRelation | ProfileRelation[] | null;
}

interface StoredJobCodeCount {
  code: string;
  timesheetRows: number;
  legacyQuoteRows: number;
}

export interface TimesheetEntryRow {
  id: string;
  timesheet_id: string;
  day_of_week: number;
  job_number: string | null;
  timesheet_entry_job_codes?: Array<{
    job_number?: string | null;
    display_order?: number | null;
  }> | null;
}

export interface TimesheetEntryJobCodeRow {
  id: string;
  timesheet_entry_id: string;
  job_number: string;
  display_order: number | null;
}

export interface LegacyQuoteRow {
  id: string;
  quote_reference: string | null;
}

export interface CorrectionRows {
  childRows: TimesheetEntryJobCodeRow[];
  duplicateTargetRows: TimesheetEntryJobCodeRow[];
  scalarRows: TimesheetEntryRow[];
  legacyRows: LegacyQuoteRow[];
  targetLegacyRows: LegacyQuoteRow[];
  affectedTimesheets: JobCodeCorrectionTimesheetSummary[];
}

type AdminClient = ReturnType<typeof createAdminClient>;
type SupabaseMaybeError = { message?: string; details?: string; hint?: string; code?: string };

function throwIfSupabaseError(error: unknown): asserts error is null | undefined {
  if (!error) return;
  if (error instanceof Error) throw error;

  const maybeError = error as SupabaseMaybeError;
  throw new Error(maybeError.message || 'Database query failed.');
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueSearchTerms(query: string): string[] {
  return uniqueValues([
    query.trim(),
    normalizeCatalogJobCode(query),
    query.replace(/\s+/g, '').toUpperCase(),
  ]).filter((term) => term.length >= 3);
}

function chunkValues<T>(values: T[], size = MUTATION_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];

  while (true) {
    const from = rows.length;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryPage(from, to);
    throwIfSupabaseError(error);

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }

  return rows;
}

export function normalizeJobCodeCorrectionInput(input: JobCodeCorrectionInput): JobCodeCorrectionInput {
  const fromJobCode = normalizeCatalogJobCode(input.fromJobCode);
  const toJobCode = normalizeCatalogJobCode(input.toJobCode);

  if (!fromJobCode) throw new Error('Enter the job code to change from.');
  if (!toJobCode) throw new Error('Enter the replacement job code.');
  if (fromJobCode === toJobCode) throw new Error('Choose two different job codes.');

  if (input.scope === 'individual' && (!input.timesheetIds || input.timesheetIds.length === 0)) {
    throw new Error('Select at least one weekly timesheet.');
  }

  return {
    ...input,
    fromJobCode,
    toJobCode,
    timesheetIds: uniqueValues(input.timesheetIds || []),
    deleteOldLegacyQuote: Boolean(input.deleteOldLegacyQuote),
  };
}

function getNumberFromStandardCode(value: string): number | null {
  const match = value.match(/^(\d{4,5})-[A-Z]{2}$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function getInitialsFromStandardCode(value: string): string | null {
  const match = value.match(/^\d{4,5}-([A-Z]{2})$/);
  return match?.[1] || null;
}

function getProfile(row: TimesheetRow): ProfileRelation | null {
  if (Array.isArray(row.profile)) return row.profile[0] || null;
  return row.profile || null;
}

function getTimesheetSearchHaystack(row: TimesheetRow): string {
  const profile = getProfile(row);
  return [
    row.week_ending,
    row.status,
    profile?.full_name,
    profile?.employee_id,
    profile?.email,
  ].filter(Boolean).join(' ').toLowerCase();
}

function mapTimesheetSummary(
  row: TimesheetRow,
  entries: TimesheetEntryRow[],
  fromJobCode?: string
): JobCodeTimesheetSearchResult {
  const profile = getProfile(row);
  const entrySummaries = entries
    .filter((entry) => entry.timesheet_id === row.id)
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((entry) => ({
      id: entry.id,
      dayOfWeek: entry.day_of_week,
      jobCodes: getEntryJobNumbers(entry),
    }));
  const jobCodes = Array.from(new Set(entrySummaries.flatMap((entry) => entry.jobCodes)));
  const matchingJobCodeCount = fromJobCode
    ? entrySummaries.reduce((count, entry) => count + entry.jobCodes.filter((code) => code === fromJobCode).length, 0)
    : 0;

  return {
    id: row.id,
    userId: row.user_id,
    employeeName: profile?.full_name || 'Unknown User',
    employeeId: profile?.employee_id || null,
    email: profile?.email || null,
    weekEnding: row.week_ending,
    status: row.status || 'unknown',
    jobCodes,
    matchingJobCodeCount,
    entries: entrySummaries,
  };
}

async function fetchTimesheetRows(admin: AdminClient, timesheetIds: string[]): Promise<TimesheetRow[]> {
  if (timesheetIds.length === 0) return [];

  const rows: TimesheetRow[] = [];
  for (const ids of chunkValues(timesheetIds)) {
    const { data, error } = await admin
      .from('timesheets')
      .select(`
        id,
        user_id,
        week_ending,
        status,
        profile:profiles!timesheets_user_id_fkey(full_name, employee_id)
      `)
      .in('id', ids);
    throwIfSupabaseError(error);
    rows.push(...((data || []) as TimesheetRow[]));
  }

  const order = new Map(timesheetIds.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

async function fetchEntriesForTimesheets(admin: AdminClient, timesheetIds: string[]): Promise<TimesheetEntryRow[]> {
  if (timesheetIds.length === 0) return [];

  const rows: TimesheetEntryRow[] = [];
  for (const ids of chunkValues(timesheetIds)) {
    const { data, error } = await admin
      .from('timesheet_entries')
      .select(`
        id,
        timesheet_id,
        day_of_week,
        job_number,
        timesheet_entry_job_codes(job_number, display_order)
      `)
      .in('timesheet_id', ids);
    throwIfSupabaseError(error);
    rows.push(...((data || []) as TimesheetEntryRow[]));
  }

  return rows;
}

async function fetchEntriesByIds(admin: AdminClient, entryIds: string[]): Promise<TimesheetEntryRow[]> {
  if (entryIds.length === 0) return [];

  const rows: TimesheetEntryRow[] = [];
  for (const ids of chunkValues(entryIds)) {
    const { data, error } = await admin
      .from('timesheet_entries')
      .select('id, timesheet_id, day_of_week, job_number')
      .in('id', ids);
    throwIfSupabaseError(error);
    rows.push(...((data || []) as TimesheetEntryRow[]));
  }

  return rows;
}

async function fetchChildRowsForEntries(
  admin: AdminClient,
  entryIds: string[],
  jobCode: string
): Promise<TimesheetEntryJobCodeRow[]> {
  if (entryIds.length === 0) return [];

  const rows: TimesheetEntryJobCodeRow[] = [];
  for (const ids of chunkValues(entryIds)) {
    const pageRows = await fetchAllRows<TimesheetEntryJobCodeRow>((from, to) =>
      admin
        .from('timesheet_entry_job_codes')
        .select('id, timesheet_entry_id, job_number, display_order')
        .in('timesheet_entry_id', ids)
        .eq('job_number', jobCode)
        .range(from, to)
    );
    rows.push(...pageRows);
  }

  return rows;
}

async function fetchCorrectionRows(
  admin: AdminClient,
  input: JobCodeCorrectionInput
): Promise<CorrectionRows> {
  const normalized = normalizeJobCodeCorrectionInput(input);
  const scopedTimesheetIds = normalized.scope === 'individual' ? normalized.timesheetIds || [] : [];
  const scopedEntries = scopedTimesheetIds.length > 0
    ? await fetchEntriesForTimesheets(admin, scopedTimesheetIds)
    : [];

  const childRows = normalized.scope === 'individual'
    ? await fetchChildRowsForEntries(admin, scopedEntries.map((entry) => entry.id), normalized.fromJobCode)
    : await fetchAllRows<TimesheetEntryJobCodeRow>((from, to) =>
      admin
        .from('timesheet_entry_job_codes')
        .select('id, timesheet_entry_id, job_number, display_order')
        .eq('job_number', normalized.fromJobCode)
        .range(from, to)
    );

  const childEntryIds = uniqueValues(childRows.map((row) => row.timesheet_entry_id));
  const childEntries = normalized.scope === 'individual'
    ? scopedEntries.filter((entry) => childEntryIds.includes(entry.id))
    : await fetchEntriesByIds(admin, childEntryIds);
  const duplicateTargetRows = await fetchChildRowsForEntries(admin, childEntryIds, normalized.toJobCode);

  const scalarRows = normalized.scope === 'individual'
    ? scopedEntries.filter((entry) => normalizeCatalogJobCode(entry.job_number || '') === normalized.fromJobCode)
    : await fetchAllRows<TimesheetEntryRow>((from, to) =>
      admin
        .from('timesheet_entries')
        .select('id, timesheet_id, day_of_week, job_number')
        .eq('job_number', normalized.fromJobCode)
        .range(from, to)
    );

  const [legacyRows, targetLegacyRows] = normalized.scope === 'batch'
    ? await Promise.all([
      fetchAllRows<LegacyQuoteRow>((from, to) =>
        admin
          .from('legacy_quotes')
          .select('id, quote_reference')
          .eq('quote_reference', normalized.fromJobCode)
          .range(from, to)
      ),
      fetchAllRows<LegacyQuoteRow>((from, to) =>
        admin
          .from('legacy_quotes')
          .select('id, quote_reference')
          .eq('quote_reference', normalized.toJobCode)
          .range(from, to)
      ),
    ])
    : [[], []];

  const affectedTimesheetIds = uniqueValues([
    ...childEntries.map((entry) => entry.timesheet_id),
    ...scalarRows.map((entry) => entry.timesheet_id),
  ]);
  const timesheets = await fetchTimesheetRows(admin, affectedTimesheetIds);
  const summaryEntries = await fetchEntriesForTimesheets(admin, affectedTimesheetIds);
  const affectedTimesheets = timesheets.map((timesheet) =>
    mapTimesheetSummary(timesheet, summaryEntries, normalized.fromJobCode)
  );

  return {
    childRows,
    duplicateTargetRows,
    scalarRows,
    legacyRows,
    targetLegacyRows,
    affectedTimesheets,
  };
}

function addStoredCodeCount(
  counts: Map<string, StoredJobCodeCount>,
  value: string | null | undefined,
  source: 'timesheet' | 'legacy_quote'
) {
  const code = normalizeCatalogJobCode(value || '');
  if (!code) return;

  const current = counts.get(code) || {
    code,
    timesheetRows: 0,
    legacyQuoteRows: 0,
  };

  if (source === 'timesheet') current.timesheetRows += 1;
  if (source === 'legacy_quote') current.legacyQuoteRows += 1;
  counts.set(code, current);
}

function formatStoredCodeSource(count: StoredJobCodeCount): string {
  const sources: string[] = [];
  if (count.timesheetRows > 0) sources.push(`${count.timesheetRows} timesheet row(s)`);
  if (count.legacyQuoteRows > 0) sources.push(`${count.legacyQuoteRows} legacy quote row(s)`);
  return sources.join(', ');
}

function mapStoredCodeCountToOption(count: StoredJobCodeCount): JobCodeCorrectionStoredCodeOption {
  const hasTimesheetRows = count.timesheetRows > 0;
  const hasLegacyRows = count.legacyQuoteRows > 0;

  return {
    value: count.code,
    label: count.code,
    customerName: hasTimesheetRows && hasLegacyRows
      ? 'Stored in timesheets and legacy quotes'
      : hasTimesheetRows
        ? 'Stored in timesheets'
        : 'Stored in legacy quotes',
    quoteTitle: formatStoredCodeSource(count),
    source: hasTimesheetRows ? 'timesheet' : 'legacy_quote',
  };
}

export async function searchStoredJobCodeOptions(input: {
  query: string;
  limit?: number;
}, admin: AdminClient = createAdminClient()): Promise<JobCodeCorrectionStoredCodeOption[]> {
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (query.length < 3) return [];

  const counts = new Map<string, StoredJobCodeCount>();
  const searchTerms = uniqueSearchTerms(query);
  const limit = Math.min(Math.max(input.limit || 50, 1), 100);

  for (const term of searchTerms) {
    const [childRows, scalarRows, legacyRows] = await Promise.all([
      fetchAllRows<Pick<TimesheetEntryJobCodeRow, 'job_number'>>((from, to) =>
        admin
          .from('timesheet_entry_job_codes')
          .select('job_number')
          .ilike('job_number', `%${term}%`)
          .range(from, to)
      ),
      fetchAllRows<Pick<TimesheetEntryRow, 'job_number'>>((from, to) =>
        admin
          .from('timesheet_entries')
          .select('job_number')
          .ilike('job_number', `%${term}%`)
          .range(from, to)
      ),
      fetchAllRows<Pick<LegacyQuoteRow, 'quote_reference'>>((from, to) =>
        admin
          .from('legacy_quotes')
          .select('quote_reference')
          .ilike('quote_reference', `%${term}%`)
          .range(from, to)
      ),
    ]);

    childRows.forEach((row) => addStoredCodeCount(counts, row.job_number, 'timesheet'));
    scalarRows.forEach((row) => addStoredCodeCount(counts, row.job_number, 'timesheet'));
    legacyRows.forEach((row) => addStoredCodeCount(counts, row.quote_reference, 'legacy_quote'));
  }

  return buildStoredJobCodeOptionsFromCounts(counts, limit);
}

function buildStoredJobCodeOptionsFromCounts(
  counts: Map<string, StoredJobCodeCount>,
  limit: number
): JobCodeCorrectionStoredCodeOption[] {
  return Array.from(counts.values())
    .sort((left, right) => {
      const totalLeft = left.timesheetRows + left.legacyQuoteRows;
      const totalRight = right.timesheetRows + right.legacyQuoteRows;
      if (totalRight !== totalLeft) return totalRight - totalLeft;
      return left.code.localeCompare(right.code);
    })
    .slice(0, limit)
    .map(mapStoredCodeCountToOption);
}

export function buildStoredJobCodeOptionsFromValues(input: {
  timesheetCodes?: Array<string | null | undefined>;
  legacyQuoteCodes?: Array<string | null | undefined>;
  limit?: number;
}): JobCodeCorrectionStoredCodeOption[] {
  const counts = new Map<string, StoredJobCodeCount>();
  input.timesheetCodes?.forEach((code) => addStoredCodeCount(counts, code, 'timesheet'));
  input.legacyQuoteCodes?.forEach((code) => addStoredCodeCount(counts, code, 'legacy_quote'));
  return buildStoredJobCodeOptionsFromCounts(counts, Math.min(Math.max(input.limit || 50, 1), 100));
}

export function getChildJobCodeMutationPlan(
  childRows: TimesheetEntryJobCodeRow[],
  duplicateTargetRows: TimesheetEntryJobCodeRow[]
) {
  const entriesWithTargetCode = new Set(duplicateTargetRows.map((row) => row.timesheet_entry_id));

  return {
    rowsToUpdate: childRows.filter((row) => !entriesWithTargetCode.has(row.timesheet_entry_id)),
    rowsToDelete: childRows.filter((row) => entriesWithTargetCode.has(row.timesheet_entry_id)),
  };
}

export function getLegacyQuoteMutationPlan(input: {
  legacyRows: LegacyQuoteRow[];
  targetLegacyRows: LegacyQuoteRow[];
  deleteOldLegacyQuote: boolean;
}) {
  const shouldDeleteOldRows = input.deleteOldLegacyQuote && input.targetLegacyRows.length > 0;

  return {
    rowsToUpdate: shouldDeleteOldRows ? [] : input.legacyRows,
    rowsToDelete: shouldDeleteOldRows ? input.legacyRows : [],
  };
}

export async function buildJobCodeCorrectionPreview(
  input: JobCodeCorrectionInput,
  admin: AdminClient = createAdminClient()
): Promise<JobCodeCorrectionPreview> {
  const normalized = normalizeJobCodeCorrectionInput(input);
  const rows = await fetchCorrectionRows(admin, normalized);
  return buildJobCodeCorrectionPreviewFromRows(normalized, rows);
}

export function buildJobCodeCorrectionPreviewFromRows(
  input: JobCodeCorrectionInput,
  rows: CorrectionRows
): JobCodeCorrectionPreview {
  const normalized = normalizeJobCodeCorrectionInput(input);
  const childPlan = getChildJobCodeMutationPlan(rows.childRows, rows.duplicateTargetRows);
  const legacyPlan = getLegacyQuoteMutationPlan({
    legacyRows: rows.legacyRows,
    targetLegacyRows: rows.targetLegacyRows,
    deleteOldLegacyQuote: Boolean(normalized.deleteOldLegacyQuote),
  });
  const warnings: string[] = [];

  if (childPlan.rowsToDelete.length > 0) {
    warnings.push(`${childPlan.rowsToDelete.length} duplicate timesheet job-code row(s) will be deleted because the replacement code already exists on the same day.`);
  }

  if (normalized.scope === 'batch' && rows.targetLegacyRows.length > 0 && !normalized.deleteOldLegacyQuote) {
    warnings.push(`The legacy quotes archive already contains ${normalized.toJobCode}; changing ${normalized.fromJobCode} will create duplicate archive references.`);
  }

  if (normalized.scope === 'batch' && rows.targetLegacyRows.length > 0 && normalized.deleteOldLegacyQuote) {
    warnings.push(`${rows.legacyRows.length} old legacy quote row(s) for ${normalized.fromJobCode} will be deleted because ${normalized.toJobCode} already exists.`);
  }

  return {
    fromJobCode: normalized.fromJobCode,
    toJobCode: normalized.toJobCode,
    scope: normalized.scope,
    deleteOldLegacyQuote: Boolean(normalized.deleteOldLegacyQuote),
    counts: {
      timesheetChildRows: rows.childRows.length,
      timesheetScalarRows: rows.scalarRows.length,
      childRowsToUpdate: childPlan.rowsToUpdate.length,
      childRowsToDeleteAsDuplicate: childPlan.rowsToDelete.length,
      legacyQuoteRows: rows.legacyRows.length,
      targetLegacyQuoteRows: rows.targetLegacyRows.length,
      legacyQuoteRowsToUpdate: legacyPlan.rowsToUpdate.length,
      legacyQuoteRowsToDelete: legacyPlan.rowsToDelete.length,
      affectedTimesheets: rows.affectedTimesheets.length,
    },
    affectedTimesheets: rows.affectedTimesheets,
    warnings,
  };
}

async function updateRowsByIds(
  admin: AdminClient,
  table: 'timesheet_entry_job_codes' | 'timesheet_entries' | 'legacy_quotes',
  ids: string[],
  values: Record<string, unknown>
): Promise<number> {
  let updated = 0;
  for (const chunk of chunkValues(ids)) {
    const { error } = await admin.from(table).update(values).in('id', chunk);
    throwIfSupabaseError(error);
    updated += chunk.length;
  }
  return updated;
}

async function deleteRowsByIds(
  admin: AdminClient,
  table: 'timesheet_entry_job_codes' | 'legacy_quotes',
  ids: string[]
): Promise<number> {
  let deleted = 0;
  for (const chunk of chunkValues(ids)) {
    const { error } = await admin.from(table).delete().in('id', chunk);
    throwIfSupabaseError(error);
    deleted += chunk.length;
  }
  return deleted;
}

export async function applyJobCodeCorrection(
  input: JobCodeCorrectionInput,
  admin: AdminClient = createAdminClient()
): Promise<JobCodeCorrectionApplyResult> {
  const normalized = normalizeJobCodeCorrectionInput(input);
  const rows = await fetchCorrectionRows(admin, normalized);
  const childPlan = getChildJobCodeMutationPlan(rows.childRows, rows.duplicateTargetRows);
  const legacyPlan = getLegacyQuoteMutationPlan({
    legacyRows: rows.legacyRows,
    targetLegacyRows: rows.targetLegacyRows,
    deleteOldLegacyQuote: Boolean(normalized.deleteOldLegacyQuote),
  });
  const preview = buildJobCodeCorrectionPreviewFromRows(normalized, rows);

  const childRowsDeletedAsDuplicates = await deleteRowsByIds(
    admin,
    'timesheet_entry_job_codes',
    childPlan.rowsToDelete.map((row) => row.id)
  );
  const childRowsUpdated = await updateRowsByIds(
    admin,
    'timesheet_entry_job_codes',
    childPlan.rowsToUpdate.map((row) => row.id),
    { job_number: normalized.toJobCode }
  );
  const scalarRowsUpdated = await updateRowsByIds(
    admin,
    'timesheet_entries',
    rows.scalarRows.map((row) => row.id),
    { job_number: normalized.toJobCode }
  );
  const legacyQuoteRowsDeleted = await deleteRowsByIds(
    admin,
    'legacy_quotes',
    legacyPlan.rowsToDelete.map((row) => row.id)
  );
  const legacyQuoteRowsUpdated = await updateRowsByIds(
    admin,
    'legacy_quotes',
    legacyPlan.rowsToUpdate.map((row) => row.id),
    {
      quote_reference: normalized.toJobCode,
      quote_number: getNumberFromStandardCode(normalized.toJobCode),
      quote_suffix: getInitialsFromStandardCode(normalized.toJobCode),
    }
  );

  return {
    preview,
    applied: {
      childRowsUpdated,
      childRowsDeletedAsDuplicates,
      scalarRowsUpdated,
      legacyQuoteRowsUpdated,
      legacyQuoteRowsDeleted,
    },
  };
}

async function fetchProfileMatchedTimesheetIds(admin: AdminClient, query: string): Promise<string[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .or(`full_name.ilike.%${query}%,employee_id.ilike.%${query}%`)
    .limit(100);
  throwIfSupabaseError(error);

  const profileIds = ((data || []) as Array<{ id: string }>).map((row) => row.id);
  if (profileIds.length === 0) return [];

  const timesheetIds: string[] = [];
  for (const ids of chunkValues(profileIds)) {
    const { data: timesheets, error: timesheetError } = await admin
      .from('timesheets')
      .select('id')
      .in('user_id', ids)
      .order('week_ending', { ascending: false })
      .limit(100);
    throwIfSupabaseError(timesheetError);
    timesheetIds.push(...((timesheets || []) as Array<{ id: string }>).map((row) => row.id));
  }

  return timesheetIds;
}

async function fetchJobCodeMatchedTimesheetIds(admin: AdminClient, normalizedQuery: string): Promise<string[]> {
  const scalarRows = await fetchAllRows<TimesheetEntryRow>((from, to) =>
    admin
      .from('timesheet_entries')
      .select('id, timesheet_id, day_of_week, job_number')
      .ilike('job_number', `%${normalizedQuery}%`)
      .range(from, to)
  );
  const childRows = await fetchAllRows<TimesheetEntryJobCodeRow>((from, to) =>
    admin
      .from('timesheet_entry_job_codes')
      .select('id, timesheet_entry_id, job_number, display_order')
      .ilike('job_number', `%${normalizedQuery}%`)
      .range(from, to)
  );
  const childEntries = await fetchEntriesByIds(admin, childRows.map((row) => row.timesheet_entry_id));

  return uniqueValues([
    ...scalarRows.map((row) => row.timesheet_id),
    ...childEntries.map((row) => row.timesheet_id),
  ]);
}

async function fetchWeekEndingMatchedTimesheetIds(admin: AdminClient, query: string): Promise<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query)) return [];

  const { data, error } = await admin
    .from('timesheets')
    .select('id')
    .eq('week_ending', query)
    .limit(100);
  throwIfSupabaseError(error);

  return ((data || []) as Array<{ id: string }>).map((row) => row.id);
}

export async function searchJobCodeTimesheets(input: {
  query: string;
  fromJobCode?: string;
  limit?: number;
}, admin: AdminClient = createAdminClient()): Promise<JobCodeTimesheetSearchResult[]> {
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (query.length < 3) return [];

  const normalizedJobCodeQuery = normalizeCatalogJobCode(query);
  const candidateIds = uniqueValues([
    ...(await fetchProfileMatchedTimesheetIds(admin, query)),
    ...(await fetchWeekEndingMatchedTimesheetIds(admin, query)),
    ...(await fetchJobCodeMatchedTimesheetIds(admin, normalizedJobCodeQuery || query.toUpperCase())),
  ]);
  if (candidateIds.length === 0) return [];

  const timesheets = await fetchTimesheetRows(admin, candidateIds);
  const entries = await fetchEntriesForTimesheets(admin, candidateIds);
  const normalizedTextQuery = query.toLowerCase();
  const fromJobCode = input.fromJobCode ? normalizeCatalogJobCode(input.fromJobCode) : '';

  return timesheets
    .map((timesheet) => mapTimesheetSummary(timesheet, entries, fromJobCode))
    .filter((timesheet) => {
      const sourceRow = timesheets.find((row) => row.id === timesheet.id);
      const textMatch = sourceRow ? getTimesheetSearchHaystack(sourceRow).includes(normalizedTextQuery) : false;
      const jobCodeMatch = timesheet.jobCodes.some((jobCode) =>
        jobCode.toLowerCase().includes(normalizedTextQuery) ||
        Boolean(normalizedJobCodeQuery && jobCode.includes(normalizedJobCodeQuery))
      );
      return textMatch || jobCodeMatch;
    })
    .sort((a, b) => b.weekEnding.localeCompare(a.weekEnding))
    .slice(0, Math.min(Math.max(input.limit || 25, 1), 100));
}
