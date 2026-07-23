import { createAdminClient } from '@/lib/supabase/admin';
import { loadTagsForScheduleJob } from '@/lib/server/scheduling-tags';
import type { Database } from '@/types/database';
import type {
  QuoteOverviewDetailPayload,
  QuoteOverviewEmployeeSummary,
  QuoteOverviewInvoice,
  QuoteOverviewInvoiceRequest,
  QuoteOverviewItem,
  QuoteOverviewLabourRow,
  QuoteOverviewLineItem,
  QuoteOverviewManualCost,
  QuoteOverviewPayload,
  QuoteOverviewProjectDetail,
  QuoteOverviewQuoteDetail,
  QuoteOverviewRecordKind,
  QuoteOverviewSummary,
} from '@/app/(dashboard)/quotes/overview-types';

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;
type QuoteRow = Database['public']['Tables']['quotes']['Row'];
type ProjectRow = Database['public']['Tables']['quote_project_numbers']['Row'];
type ProjectCostRow = Database['public']['Tables']['quote_project_costs']['Row'];
type QuoteInvoiceRow = Database['public']['Tables']['quote_invoices']['Row'];
type QuoteInvoiceRequestRow = Database['public']['Tables']['quote_invoice_requests']['Row'];
type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];
type TimesheetStatus = Database['public']['Tables']['timesheets']['Row']['status'];

interface CustomerRelation {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

interface ProfileRelation {
  id: string;
  full_name: string | null;
  employee_id?: string | null;
}

interface QuoteSourceRow extends QuoteRow {
  customer?: CustomerRelation | CustomerRelation[] | null;
}

interface QuoteReferenceRelation {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  subject_line: string | null;
  customer?: Pick<CustomerRelation, 'company_name'> | Pick<CustomerRelation, 'company_name'>[] | null;
}

interface ProjectSourceRow extends ProjectRow {
  manager?: ProfileRelation | ProfileRelation[] | null;
  linked_quote?: QuoteReferenceRelation | QuoteReferenceRelation[] | null;
  converted_quote?: QuoteReferenceRelation | QuoteReferenceRelation[] | null;
  costs?: ProjectCostRow[];
}

export interface LabourJobCodeSourceRow {
  timesheet_entry_id: string;
  job_number: string;
  display_order?: number | null;
}

export interface LabourTimesheetSource {
  id: string;
  week_ending: string;
  status: TimesheetStatus;
  timesheet_type: string | null;
  reg_number: string | null;
  site_address: string | null;
  hirer_name: string | null;
  is_hired_plant: boolean | null;
  hired_plant_id_serial: string | null;
  hired_plant_description: string | null;
  hired_plant_hiring_company: string | null;
  user_id: string | null;
  profile?: ProfileRelation | ProfileRelation[] | null;
}

export interface LabourEntrySourceRow {
  id: string;
  daily_total: number | null;
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  remarks: string | null;
  job_number: string | null;
  operator_travel_hours: number | null;
  operator_yard_hours: number | null;
  operator_working_hours: number | null;
  machine_travel_hours: number | null;
  machine_start_time: string | null;
  machine_finish_time: string | null;
  machine_working_hours: number | null;
  machine_standing_hours: number | null;
  machine_operator_hours: number | null;
  maintenance_breakdown_hours: number | null;
  timesheet?: LabourTimesheetSource | LabourTimesheetSource[] | null;
}

interface OverviewOptions {
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

interface DateRange {
  from: string | null;
  to: string | null;
}

export interface OverviewSummaryRecord {
  item: QuoteOverviewItem;
  sourceReferences: string[];
  quoteIds: string[];
}

export interface QuoteLevelInvoiceSource {
  id: string;
  invoice_number: string | null;
  last_invoice_at: string | null;
  invoiced_at: string | null;
  total: number | null;
}

interface OverviewRecord extends OverviewSummaryRecord {
  searchText: string;
  quote: QuoteSourceRow | null;
  project: ProjectSourceRow | null;
}

interface OverviewSources {
  records: OverviewRecord[];
  invoicesByQuoteId: Map<string, QuoteOverviewInvoice[]>;
  labourRowsByReference: Map<string, QuoteOverviewLabourRow[]>;
}

const RECENT_ITEM_LIMIT = 8;

function getSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeReference(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

function normalizeSearch(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeReference).filter(Boolean)));
}

function uniqueIdentifiers(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => (value || '').trim()).filter(Boolean)));
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function getEntryDate(weekEnding: string | null | undefined, dayOfWeek: number): string | null {
  if (!weekEnding || dayOfWeek < 1 || dayOfWeek > 7) return null;
  const date = new Date(`${weekEnding}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - (7 - dayOfWeek));
  return date.toISOString().slice(0, 10);
}

function isWithinDateRange(value: string | null | undefined, range: DateRange): boolean {
  if (!value) return false;
  const date = value.slice(0, 10);
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function getLatestDate(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter((value): value is string => Boolean(value)).sort((a, b) => b.localeCompare(a));
  return sorted[0] || null;
}

export function getLatestLabourActivityDate(rows: Array<Pick<QuoteOverviewLabourRow, 'entry_date' | 'week_ending'>>): string | null {
  return getLatestDate(rows.map(row => row.entry_date || row.week_ending));
}

function getQuoteReferences(quote: Pick<QuoteRow, 'quote_reference' | 'base_quote_reference'>): string[] {
  return uniqueValues([quote.quote_reference, quote.base_quote_reference]);
}

function getProjectQuoteIds(project: ProjectSourceRow | null): string[] {
  if (!project) return [];
  return uniqueIdentifiers([project.linked_quote_id, project.converted_quote_id]);
}

export function buildOverviewQuoteIds(
  quoteId: string | null | undefined,
  projectQuoteIds: Array<string | null | undefined> = []
): string[] {
  return uniqueIdentifiers([quoteId, ...projectQuoteIds]);
}

function getInvoicesForQuoteIds(invoicesByQuoteId: Map<string, QuoteOverviewInvoice[]>, quoteIds: string[]) {
  return quoteIds.flatMap(quoteId => invoicesByQuoteId.get(quoteId) || []);
}

function getInvoiceOverviewDate(invoice: QuoteOverviewInvoice): string {
  return invoice.created_at || invoice.invoice_date;
}

function getLabourRowsForReferences(
  labourRowsByReference: Map<string, QuoteOverviewLabourRow[]>,
  references: string[]
): QuoteOverviewLabourRow[] {
  return references.flatMap(reference => labourRowsByReference.get(reference) || []);
}

function calculateManualCostTotal(project: ProjectSourceRow | null): number {
  return roundHours((project?.costs || []).reduce((sum, cost) => sum + Number(cost.amount || 0), 0));
}

function buildSearchText(values: Array<string | number | null | undefined>): string {
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function toInvoice(row: QuoteInvoiceRow): QuoteOverviewInvoice {
  return {
    id: row.id,
    quote_id: row.quote_id,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    amount: Number(row.amount || 0),
    invoice_scope: row.invoice_scope,
    comments: row.comments,
    created_at: row.created_at,
  };
}

export function buildQuoteLevelInvoiceFallback(quote: QuoteLevelInvoiceSource): QuoteOverviewInvoice | null {
  const invoiceNumber = quote.invoice_number?.trim();
  const createdAt = quote.invoiced_at || quote.last_invoice_at;
  const invoiceDate = (quote.last_invoice_at || quote.invoiced_at || '').slice(0, 10);

  if (!invoiceNumber || !createdAt || !invoiceDate) return null;

  return {
    id: `quote-level-${quote.id}`,
    quote_id: quote.id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    amount: Number(quote.total || 0),
    invoice_scope: 'full',
    comments: null,
    created_at: createdAt,
  };
}

function toManualCost(row: ProjectCostRow): QuoteOverviewManualCost {
  return {
    id: row.id,
    project_number_id: row.project_number_id,
    cost_date: row.cost_date,
    category: row.category,
    supplier: row.supplier,
    description: row.description,
    amount: Number(row.amount || 0),
    notes: row.notes,
    linked_quote_id: row.linked_quote_id,
  };
}

function toLineItem(row: QuoteLineItemRow): QuoteOverviewLineItem {
  return {
    id: row.id,
    quote_id: row.quote_id,
    description: row.description,
    quantity: Number(row.quantity || 0),
    unit: row.unit,
    unit_rate: Number(row.unit_rate || 0),
    line_total: Number(row.line_total || 0),
    sort_order: row.sort_order,
  };
}

function toInvoiceRequest(row: QuoteInvoiceRequestRow): QuoteOverviewInvoiceRequest {
  return {
    id: row.id,
    quote_id: row.quote_id,
    requested_amount: Number(row.requested_amount || 0),
    requested_invoice_date: row.requested_invoice_date,
    requested_invoice_scope: row.requested_invoice_scope,
    status: row.status,
    manager_comments: row.manager_comments,
    requested_at: row.requested_at,
  };
}

function toQuoteDetail(quote: QuoteSourceRow | null): QuoteOverviewQuoteDetail | null {
  if (!quote) return null;
  const customer = getSingleRelation(quote.customer);

  return {
    id: quote.id,
    quote_reference: quote.quote_reference,
    base_quote_reference: quote.base_quote_reference,
    quote_date: quote.quote_date,
    subject_line: quote.subject_line,
    project_description: quote.project_description,
    scope: quote.scope,
    site_address: quote.site_address,
    attention_name: quote.attention_name,
    attention_email: quote.attention_email,
    subtotal: quote.subtotal,
    total: quote.total,
    status: quote.status,
    commercial_status: quote.commercial_status,
    po_number: quote.po_number,
    manager_name: quote.manager_name,
    customer: customer ? {
      id: customer.id,
      company_name: customer.company_name,
      short_name: customer.short_name,
      contact_name: customer.contact_name,
      contact_email: customer.contact_email,
    } : null,
  };
}

function toProjectDetail(project: ProjectSourceRow | null): QuoteOverviewProjectDetail | null {
  if (!project) return null;
  const manager = getSingleRelation(project.manager);

  return {
    id: project.id,
    project_reference: project.project_reference,
    title: project.title,
    description: project.description,
    status: project.status,
    notes: project.notes,
    linked_quote_id: project.linked_quote_id,
    converted_quote_id: project.converted_quote_id,
    created_at: project.created_at,
    updated_at: project.updated_at,
    manager: manager ? {
      id: manager.id,
      full_name: manager.full_name,
    } : null,
  };
}

export function buildAllocatedLabourRows(
  entries: LabourEntrySourceRow[],
  jobCodeRows: LabourJobCodeSourceRow[],
  references: string[]
): Map<string, QuoteOverviewLabourRow[]> {
  const referenceSet = new Set(references.map(normalizeReference).filter(Boolean));
  const codesByEntryId = new Map<string, string[]>();

  jobCodeRows
    .slice()
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .forEach((row) => {
      const jobNumber = normalizeReference(row.job_number);
      if (!jobNumber) return;
      const codes = codesByEntryId.get(row.timesheet_entry_id) || [];
      if (!codes.includes(jobNumber)) codes.push(jobNumber);
      codesByEntryId.set(row.timesheet_entry_id, codes);
    });

  const rowsByReference = new Map<string, QuoteOverviewLabourRow[]>();
  references.forEach(reference => rowsByReference.set(normalizeReference(reference), []));

  for (const entry of entries) {
    const timesheet = getSingleRelation(entry.timesheet);
    if (!timesheet || timesheet.status === 'rejected') continue;

    const jobNumbers = codesByEntryId.get(entry.id) || uniqueValues([entry.job_number]);
    const matchedReferences = jobNumbers.filter(jobNumber => referenceSet.has(jobNumber));
    if (matchedReferences.length === 0) continue;

    const splitDivisor = Math.max(jobNumbers.length, 1);
    const allocatedHours = roundHours(Number(entry.daily_total || 0) / splitDivisor);
    const profile = getSingleRelation(timesheet.profile);
    const entryDate = getEntryDate(timesheet.week_ending, entry.day_of_week);

    for (const reference of matchedReferences) {
      const row: QuoteOverviewLabourRow = {
        id: `${entry.id}:${reference}`,
        reference,
        timesheet_id: timesheet.id,
        timesheet_entry_id: entry.id,
        employee_id: profile?.id || timesheet.user_id,
        employee_name: profile?.full_name || 'Unknown employee',
        employee_number: profile?.employee_id || null,
        timesheet_status: timesheet.status,
        timesheet_type: timesheet.timesheet_type,
        week_ending: timesheet.week_ending,
        entry_date: entryDate,
        day_of_week: entry.day_of_week,
        job_numbers: jobNumbers,
        allocated_hours: allocatedHours,
        raw_daily_total: Number(entry.daily_total || 0),
        time_started: entry.time_started,
        time_finished: entry.time_finished,
        remarks: entry.remarks,
        reg_number: timesheet.reg_number,
        site_address: timesheet.site_address,
        hirer_name: timesheet.hirer_name,
        is_hired_plant: timesheet.is_hired_plant,
        hired_plant_id_serial: timesheet.hired_plant_id_serial,
        hired_plant_description: timesheet.hired_plant_description,
        hired_plant_hiring_company: timesheet.hired_plant_hiring_company,
        machine_start_time: entry.machine_start_time,
        machine_finish_time: entry.machine_finish_time,
        machine_working_hours: entry.machine_working_hours,
        machine_travel_hours: entry.machine_travel_hours,
        machine_standing_hours: entry.machine_standing_hours,
        machine_operator_hours: entry.machine_operator_hours,
        operator_travel_hours: entry.operator_travel_hours,
        operator_yard_hours: entry.operator_yard_hours,
        operator_working_hours: entry.operator_working_hours,
        maintenance_breakdown_hours: entry.maintenance_breakdown_hours,
      };

      rowsByReference.get(reference)?.push(row);
    }
  }

  rowsByReference.forEach((rows) => {
    rows.sort((a, b) => {
      const dateCompare = (b.entry_date || b.week_ending).localeCompare(a.entry_date || a.week_ending);
      if (dateCompare !== 0) return dateCompare;
      return a.employee_name.localeCompare(b.employee_name);
    });
  });

  return rowsByReference;
}

export function buildEmployeeSummaries(rows: QuoteOverviewLabourRow[]): QuoteOverviewEmployeeSummary[] {
  const summaries = new Map<string, {
    employee_id: string | null;
    employee_name: string;
    employee_number: string | null;
    total_hours: number;
    timesheet_ids: Set<string>;
    entry_count: number;
  }>();

  rows.forEach((row) => {
    const key = row.employee_id || row.employee_name;
    const summary = summaries.get(key) || {
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      employee_number: row.employee_number,
      total_hours: 0,
      timesheet_ids: new Set<string>(),
      entry_count: 0,
    };

    summary.total_hours += row.allocated_hours;
    summary.timesheet_ids.add(row.timesheet_id);
    summary.entry_count += 1;
    summaries.set(key, summary);
  });

  return [...summaries.values()]
    .map(summary => ({
      employee_id: summary.employee_id,
      employee_name: summary.employee_name,
      employee_number: summary.employee_number,
      total_hours: roundHours(summary.total_hours),
      timesheet_count: summary.timesheet_ids.size,
      entry_count: summary.entry_count,
    }))
    .sort((a, b) => b.total_hours - a.total_hours || a.employee_name.localeCompare(b.employee_name));
}

export function buildOverviewSummary(params: {
  records: OverviewSummaryRecord[];
  invoicesByQuoteId: Map<string, QuoteOverviewInvoice[]>;
  labourRowsByReference: Map<string, QuoteOverviewLabourRow[]>;
  dateRange?: DateRange;
}): QuoteOverviewSummary {
  const employeeIds = new Set<string>();
  const timesheetIds = new Set<string>();
  let invoiceCount = 0;
  let invoiceTotal = 0;
  let workedHours = 0;
  let manualCostTotal = 0;

  params.records.forEach((record) => {
    manualCostTotal += record.item.manual_cost_total;

    getInvoicesForQuoteIds(params.invoicesByQuoteId, record.quoteIds)
      .filter(invoice => params.dateRange ? isWithinDateRange(getInvoiceOverviewDate(invoice), params.dateRange) : true)
      .forEach((invoice) => {
        invoiceCount += 1;
        invoiceTotal += invoice.amount;
      });

    getLabourRowsForReferences(params.labourRowsByReference, record.sourceReferences)
      .filter(row => params.dateRange ? isWithinDateRange(row.entry_date || row.week_ending, params.dateRange) : true)
      .forEach((row) => {
        workedHours += row.allocated_hours;
        if (row.employee_id) employeeIds.add(row.employee_id);
        timesheetIds.add(row.timesheet_id);
      });
  });

  return {
    item_count: params.records.length,
    quote_count: params.records.filter(record => record.item.kind === 'quote').length,
    project_count: params.records.filter(record => record.item.kind === 'project').length,
    invoice_count: invoiceCount,
    invoice_total: Math.round(invoiceTotal * 100) / 100,
    worked_hours: roundHours(workedHours),
    employee_count: employeeIds.size,
    timesheet_count: timesheetIds.size,
    manual_cost_total: Math.round(manualCostTotal * 100) / 100,
  };
}

async function loadQuotes(admin: SupabaseAdminClient): Promise<QuoteSourceRow[]> {
  const { data, error } = await admin
    .from('quotes')
    .select(`
      *,
      customer:customers(
        id,
        company_name,
        short_name,
        contact_name,
        contact_email
      )
    `)
    .eq('is_latest_version', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as QuoteSourceRow[];
}

async function loadProjects(admin: SupabaseAdminClient): Promise<ProjectSourceRow[]> {
  const { data, error } = await admin
    .from('quote_project_numbers')
    .select(`
      *,
      manager:profiles!quote_project_numbers_manager_profile_id_fkey(id, full_name),
      linked_quote:quotes!quote_project_numbers_linked_quote_id_fkey(
        id,
        quote_reference,
        base_quote_reference,
        subject_line,
        customer:customers(company_name)
      ),
      converted_quote:quotes!quote_project_numbers_converted_quote_id_fkey(
        id,
        quote_reference,
        base_quote_reference,
        subject_line,
        customer:customers(company_name)
      ),
      costs:quote_project_costs(*)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as ProjectSourceRow[];
}

async function loadInvoices(
  admin: SupabaseAdminClient,
  quoteIds: string[],
  quotes: QuoteLevelInvoiceSource[]
): Promise<Map<string, QuoteOverviewInvoice[]>> {
  const invoicesByQuoteId = new Map<string, QuoteOverviewInvoice[]>();
  quoteIds.forEach(quoteId => invoicesByQuoteId.set(quoteId, []));
  if (quoteIds.length === 0) return invoicesByQuoteId;

  const { data, error } = await admin
    .from('quote_invoices')
    .select('id, quote_id, invoice_number, invoice_date, amount, invoice_scope, comments, created_by, created_at, updated_at, invoice_request_id')
    .in('quote_id', quoteIds);

  if (error) throw error;

  (data || []).forEach((row) => {
    const invoice = toInvoice(row as QuoteInvoiceRow);
    const invoices = invoicesByQuoteId.get(invoice.quote_id) || [];
    invoices.push(invoice);
    invoicesByQuoteId.set(invoice.quote_id, invoices);
  });

  quotes.forEach((quote) => {
    const invoices = invoicesByQuoteId.get(quote.id) || [];
    if (invoices.length > 0) return;

    const fallbackInvoice = buildQuoteLevelInvoiceFallback(quote);
    if (!fallbackInvoice) return;

    invoicesByQuoteId.set(quote.id, [fallbackInvoice]);
  });

  invoicesByQuoteId.forEach(invoices => invoices.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)));
  return invoicesByQuoteId;
}

async function loadLabourRowsByReference(
  admin: SupabaseAdminClient,
  references: string[]
): Promise<Map<string, QuoteOverviewLabourRow[]>> {
  const normalizedReferences = uniqueValues(references);
  const emptyMap = new Map<string, QuoteOverviewLabourRow[]>();
  normalizedReferences.forEach(reference => emptyMap.set(reference, []));
  if (normalizedReferences.length === 0) return emptyMap;

  const { data: matchingJobCodes, error: matchingJobCodesError } = await admin
    .from('timesheet_entry_job_codes')
    .select('timesheet_entry_id, job_number, display_order')
    .in('job_number', normalizedReferences);

  if (matchingJobCodesError) throw matchingJobCodesError;

  const entryIds = Array.from(new Set((matchingJobCodes || []).map(row => row.timesheet_entry_id).filter(Boolean)));
  if (entryIds.length === 0) return emptyMap;

  const [{ data: allJobCodes, error: allJobCodesError }, { data: entries, error: entriesError }] = await Promise.all([
    admin
      .from('timesheet_entry_job_codes')
      .select('timesheet_entry_id, job_number, display_order')
      .in('timesheet_entry_id', entryIds),
    admin
      .from('timesheet_entries')
      .select(`
        id,
        daily_total,
        day_of_week,
        time_started,
        time_finished,
        remarks,
        job_number,
        operator_travel_hours,
        operator_yard_hours,
        operator_working_hours,
        machine_travel_hours,
        machine_start_time,
        machine_finish_time,
        machine_working_hours,
        machine_standing_hours,
        machine_operator_hours,
        maintenance_breakdown_hours,
        timesheet:timesheets(
          id,
          week_ending,
          status,
          timesheet_type,
          reg_number,
          site_address,
          hirer_name,
          is_hired_plant,
          hired_plant_id_serial,
          hired_plant_description,
          hired_plant_hiring_company,
          user_id,
          profile:profiles!timesheets_user_id_fkey(id, full_name, employee_id)
        )
      `)
      .in('id', entryIds),
  ]);

  if (allJobCodesError) throw allJobCodesError;
  if (entriesError) throw entriesError;

  return buildAllocatedLabourRows(
    (entries || []) as LabourEntrySourceRow[],
    (allJobCodes || []) as LabourJobCodeSourceRow[],
    normalizedReferences
  );
}

function buildOverviewRecords(params: {
  quotes: QuoteSourceRow[];
  projects: ProjectSourceRow[];
  invoicesByQuoteId: Map<string, QuoteOverviewInvoice[]>;
  labourRowsByReference: Map<string, QuoteOverviewLabourRow[]>;
}): OverviewRecord[] {
  const quoteByReference = new Map<string, QuoteSourceRow>();
  const projectByReference = new Map<string, ProjectSourceRow>();
  const orderedReferences: string[] = [];

  params.quotes.forEach((quote) => {
    getQuoteReferences(quote).forEach((reference) => {
      if (!quoteByReference.has(reference)) {
        quoteByReference.set(reference, quote);
        orderedReferences.push(reference);
      }
    });
  });

  params.projects.forEach((project) => {
    const reference = normalizeReference(project.project_reference);
    if (!reference) return;
    if (!projectByReference.has(reference)) projectByReference.set(reference, project);
    if (!orderedReferences.includes(reference)) orderedReferences.push(reference);
  });

  return orderedReferences.map((reference) => {
    const quote = quoteByReference.get(reference) || null;
    const project = projectByReference.get(reference) || null;
    const customer = quote ? getSingleRelation(quote.customer) : null;
    const manager = project ? getSingleRelation(project.manager) : null;
    const sourceReferences = uniqueValues([
      reference,
      ...(quote ? getQuoteReferences(quote) : []),
      project?.project_reference,
    ]);
    const quoteIds = buildOverviewQuoteIds(quote?.id, getProjectQuoteIds(project));
    const invoices = getInvoicesForQuoteIds(params.invoicesByQuoteId, quoteIds);
    const labourRows = getLabourRowsForReferences(params.labourRowsByReference, sourceReferences);
    const employeeIds = new Set(labourRows.map(row => row.employee_id).filter(Boolean));
    const timesheetIds = new Set(labourRows.map(row => row.timesheet_id));
    const invoiceTotal = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    const workedHours = labourRows.reduce((sum, row) => sum + row.allocated_hours, 0);
    const kind: QuoteOverviewRecordKind = quote ? 'quote' : 'project';
    const title = quote?.subject_line || quote?.project_description || project?.title || 'Untitled job';
    const projectLinkedQuote = getSingleRelation(project?.linked_quote);
    const projectConvertedQuote = getSingleRelation(project?.converted_quote);
    const customerName = customer?.company_name
      || getSingleRelation(projectConvertedQuote?.customer)?.company_name
      || getSingleRelation(projectLinkedQuote?.customer)?.company_name
      || null;
    const item: QuoteOverviewItem = {
      id: quote?.id || project?.id || reference,
      kind,
      reference,
      title,
      customer_name: customerName,
      contact_name: customer?.contact_name || null,
      manager_name: quote?.manager_name || manager?.full_name || null,
      status: quote?.status || project?.status || null,
      commercial_status: quote?.commercial_status || null,
      quote_id: quote?.id || project?.converted_quote_id || project?.linked_quote_id || null,
      project_number_id: project?.id || null,
      quote_total: Number(quote?.total || 0),
      manual_cost_total: calculateManualCostTotal(project),
      invoice_total: Math.round(invoiceTotal * 100) / 100,
      invoice_count: invoices.length,
      worked_hours: roundHours(workedHours),
      employee_count: employeeIds.size,
      timesheet_count: timesheetIds.size,
      latest_activity_at: getLatestDate([
        quote?.updated_at,
        quote?.created_at,
        quote?.quote_date,
        project?.updated_at,
        project?.created_at,
        ...invoices.map(getInvoiceOverviewDate),
        ...(project?.costs || []).flatMap(cost => [cost.updated_at, cost.created_at, cost.linked_at, cost.cost_date]),
        getLatestLabourActivityDate(labourRows),
      ]),
      href: `/quotes/overview/${encodeURIComponent(reference)}`,
    };

    return {
      item,
      searchText: buildSearchText([
        reference,
        quote?.quote_reference,
        quote?.base_quote_reference,
        quote?.attention_name,
        quote?.subject_line,
        quote?.project_description,
        quote?.manager_name,
        customer?.company_name,
        customer?.short_name,
        customer?.contact_name,
        project?.title,
        project?.description,
        project?.requester_initials,
        manager?.full_name,
      ]),
      sourceReferences,
      quoteIds,
      quote,
      project,
    };
  }).sort((a, b) => {
    const dateCompare = (b.item.latest_activity_at || '').localeCompare(a.item.latest_activity_at || '');
    if (dateCompare !== 0) return dateCompare;
    return b.item.reference.localeCompare(a.item.reference);
  });
}

async function loadOverviewSources(admin: SupabaseAdminClient): Promise<OverviewSources> {
  const [quotes, projects] = await Promise.all([
    loadQuotes(admin),
    loadProjects(admin),
  ]);

  const quoteIds = uniqueIdentifiers([
    ...quotes.map(quote => quote.id),
    ...projects.flatMap(project => [project.linked_quote_id, project.converted_quote_id]),
  ]);
  const references = uniqueValues([
    ...quotes.flatMap(getQuoteReferences),
    ...projects.map(project => project.project_reference),
  ]);

  const [invoicesByQuoteId, labourRowsByReference] = await Promise.all([
    loadInvoices(admin, quoteIds, quotes),
    loadLabourRowsByReference(admin, references),
  ]);

  return {
    records: buildOverviewRecords({ quotes, projects, invoicesByQuoteId, labourRowsByReference }),
    invoicesByQuoteId,
    labourRowsByReference,
  };
}

export async function getQuotesOverview(
  admin: SupabaseAdminClient,
  options: OverviewOptions = {}
): Promise<QuoteOverviewPayload> {
  const sources = await loadOverviewSources(admin);
  const search = normalizeSearch(options.search);
  const records = search
    ? sources.records.filter(record => record.searchText.includes(search))
    : sources.records;
  const dateRange: DateRange = {
    from: options.dateFrom || null,
    to: options.dateTo || null,
  };

  return {
    items: records.map(record => record.item),
    recent_items: sources.records.slice(0, RECENT_ITEM_LIMIT).map(record => record.item),
    summary: buildOverviewSummary({
      records,
      invoicesByQuoteId: sources.invoicesByQuoteId,
      labourRowsByReference: sources.labourRowsByReference,
    }),
    date_range_summary: buildOverviewSummary({
      records,
      invoicesByQuoteId: sources.invoicesByQuoteId,
      labourRowsByReference: sources.labourRowsByReference,
      dateRange,
    }),
    search: options.search?.trim() || '',
    date_from: dateRange.from,
    date_to: dateRange.to,
  };
}

export async function getQuoteOverviewDetail(
  admin: SupabaseAdminClient,
  reference: string
): Promise<QuoteOverviewDetailPayload | null> {
  const normalizedReference = normalizeReference(decodeURIComponent(reference));
  if (!normalizedReference) return null;

  const sources = await loadOverviewSources(admin);
  const record = sources.records.find(candidate =>
    candidate.item.reference === normalizedReference || candidate.sourceReferences.includes(normalizedReference)
  );
  if (!record) return null;

  const [lineItemsResult, invoiceRequestsResult] = await Promise.all([
    record.quote?.id
      ? admin
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', record.quote.id)
        .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    record.quoteIds.length > 0
      ? admin
        .from('quote_invoice_requests')
        .select('*')
        .in('quote_id', record.quoteIds)
        .order('requested_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (lineItemsResult.error) throw lineItemsResult.error;
  if (invoiceRequestsResult.error) throw invoiceRequestsResult.error;

  const labourRows = getLabourRowsForReferences(sources.labourRowsByReference, record.sourceReferences);
  const invoices = getInvoicesForQuoteIds(sources.invoicesByQuoteId, record.quoteIds);
  let scheduleJob: QuoteOverviewDetailPayload['schedule_job'] = null;
  const scheduleJobFilters = [
    record.quote?.id ? { column: 'quote_id', value: record.quote.id } : null,
    record.project?.id
      ? { column: 'quote_project_number_id', value: record.project.id }
      : null,
  ].filter((filter): filter is { column: string; value: string } => Boolean(filter));
  for (const filter of scheduleJobFilters) {
    const scheduleJobResult = await admin
      .from('schedule_jobs')
      .select('id, is_drop_on_ready')
      .eq(filter.column, filter.value)
      .maybeSingle();
    if (scheduleJobResult.error) throw scheduleJobResult.error;
    if (scheduleJobResult.data) {
      scheduleJob = {
        id: scheduleJobResult.data.id,
        is_drop_on_ready: scheduleJobResult.data.is_drop_on_ready === true,
        tags: await loadTagsForScheduleJob(admin, scheduleJobResult.data.id),
      };
      break;
    }
  }

  return {
    item: record.item,
    quote: toQuoteDetail(record.quote),
    project: toProjectDetail(record.project),
    line_items: ((lineItemsResult.data || []) as QuoteLineItemRow[]).map(toLineItem),
    invoices,
    invoice_requests: ((invoiceRequestsResult.data || []) as QuoteInvoiceRequestRow[]).map(toInvoiceRequest),
    manual_costs: (record.project?.costs || []).map(toManualCost),
    labour_rows: labourRows,
    labour_by_employee: buildEmployeeSummaries(labourRows),
    summary: buildOverviewSummary({
      records: [record],
      invoicesByQuoteId: sources.invoicesByQuoteId,
      labourRowsByReference: sources.labourRowsByReference,
    }),
    schedule_job: scheduleJob,
  };
}
