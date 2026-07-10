import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';
import {
  appendQuoteTimelineEvent,
  calculateQuoteTotals,
  generateQuoteReferenceForManager,
  getInitialsFromName,
  getQuoteManagerOption,
} from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { syncProjectNumberSiteLocation } from '@/lib/server/inventory-site-location-sync';

type QuoteProjectNumberRow = Database['public']['Tables']['quote_project_numbers']['Row'];
type QuoteProjectCostRow = Database['public']['Tables']['quote_project_costs']['Row'];
type QuoteLineItemInsert = Database['public']['Tables']['quote_line_items']['Insert'];
type QuoteInsert = Database['public']['Tables']['quotes']['Insert'];

const PROJECT_COST_CATEGORIES = ['materials', 'subcontractor', 'plant', 'labour', 'other'] as const;
type ProjectCostCategory = (typeof PROJECT_COST_CATEGORIES)[number];

interface ProjectLabourSummary {
  total_hours: number;
  entry_count: number;
  timesheet_count: number;
  employee_count: number;
  first_week_ending: string | null;
  last_week_ending: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCostCategory(value: unknown): ProjectCostCategory {
  if (typeof value !== 'string') return 'other';
  return PROJECT_COST_CATEGORIES.includes(value as ProjectCostCategory)
    ? (value as ProjectCostCategory)
    : 'other';
}

function buildAddress(customer: {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
} | null): string {
  if (!customer) return '';
  return [
    customer.address_line_1,
    customer.address_line_2,
    [customer.city, customer.county].filter(Boolean).join(', ') || null,
    customer.postcode,
  ].filter(Boolean).join('\n');
}

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

async function loadLabourSummaries(
  admin: ReturnType<typeof createAdminClient>,
  references: string[]
): Promise<Map<string, ProjectLabourSummary>> {
  const summaries = new Map<string, ProjectLabourSummary>();
  references.forEach(reference => summaries.set(reference, {
    total_hours: 0,
    entry_count: 0,
    timesheet_count: 0,
    employee_count: 0,
    first_week_ending: null,
    last_week_ending: null,
  }));

  if (references.length === 0) return summaries;

  const { data: jobCodeRows, error: jobCodeError } = await admin
    .from('timesheet_entry_job_codes')
    .select('timesheet_entry_id, job_number')
    .in('job_number', references);
  if (jobCodeError) throw jobCodeError;

  const entryIds = Array.from(new Set((jobCodeRows || []).map(row => row.timesheet_entry_id)));
  if (entryIds.length === 0) return summaries;

  const entryToReferences = new Map<string, string[]>();
  (jobCodeRows || []).forEach((row) => {
    const refs = entryToReferences.get(row.timesheet_entry_id) || [];
    refs.push(row.job_number);
    entryToReferences.set(row.timesheet_entry_id, refs);
  });

  const { data: entries, error: entriesError } = await admin
    .from('timesheet_entries')
    .select(`
      id,
      daily_total,
      timesheet:timesheets(id, week_ending, user_id)
    `)
    .in('id', entryIds);
  if (entriesError) throw entriesError;

  const timesheetsByReference = new Map<string, Set<string>>();
  const employeesByReference = new Map<string, Set<string>>();

  (entries || []).forEach((entry) => {
    const refs = entryToReferences.get(entry.id) || [];
    const timesheet = Array.isArray(entry.timesheet) ? entry.timesheet[0] : entry.timesheet;

    refs.forEach((reference) => {
      const summary = summaries.get(reference);
      if (!summary) return;

      summary.total_hours += Number(entry.daily_total || 0);
      summary.entry_count += 1;

      if (timesheet?.id) {
        const set = timesheetsByReference.get(reference) || new Set<string>();
        set.add(timesheet.id);
        timesheetsByReference.set(reference, set);
      }

      if (timesheet?.user_id) {
        const set = employeesByReference.get(reference) || new Set<string>();
        set.add(timesheet.user_id);
        employeesByReference.set(reference, set);
      }

      if (timesheet?.week_ending) {
        if (!summary.first_week_ending || timesheet.week_ending < summary.first_week_ending) {
          summary.first_week_ending = timesheet.week_ending;
        }
        if (!summary.last_week_ending || timesheet.week_ending > summary.last_week_ending) {
          summary.last_week_ending = timesheet.week_ending;
        }
      }
    });
  });

  summaries.forEach((summary, reference) => {
    summary.timesheet_count = timesheetsByReference.get(reference)?.size || 0;
    summary.employee_count = employeesByReference.get(reference)?.size || 0;
    summary.total_hours = Math.round(summary.total_hours * 100) / 100;
  });

  return summaries;
}

function calculateManualTotals(costs: QuoteProjectCostRow[]) {
  return costs.reduce((acc, cost) => {
    const amount = Number(cost.amount || 0);
    acc.manual_cost_total += amount;
    if (!cost.linked_quote_id) acc.unlinked_manual_cost_total += amount;
    return acc;
  }, { manual_cost_total: 0, unlinked_manual_cost_total: 0 });
}

async function listProjectNumbers(admin: ReturnType<typeof createAdminClient>) {
  const { data: projects, error } = await admin
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

  const rows = (projects || []) as Array<QuoteProjectNumberRow & {
    costs?: QuoteProjectCostRow[];
    [key: string]: unknown;
  }>;
  const summaries = await loadLabourSummaries(admin, rows.map(row => row.project_reference));

  return rows.map((row) => {
    const costs = row.costs || [];
    const totals = calculateManualTotals(costs);
    return {
      ...row,
      ...totals,
      costs,
      labour_summary: summaries.get(row.project_reference) || null,
    };
  });
}

async function createProjectNumber(admin: ReturnType<typeof createAdminClient>, body: Record<string, unknown>, userId: string) {
  const title = normalizeOptionalString(body.title);
  const managerProfileId = normalizeOptionalString(body.manager_profile_id);
  const fieldErrors: Record<string, string> = {};

  if (!title) fieldErrors.title = 'Enter a project title.';
  if (!managerProfileId) fieldErrors.manager_profile_id = 'Select a manager.';
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  const managerOption = await getQuoteManagerOption(managerProfileId!);
  const { data: managerProfile, error: managerError } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('id', managerProfileId)
    .single();
  if (managerError || !managerProfile) throw managerError || new Error('Unable to load manager profile');

  const fallbackInitials = managerOption?.initials || getInitialsFromName(managerProfile.full_name || '');
  const { quoteReference, initials } = await generateQuoteReferenceForManager({
    managerProfileId: managerProfileId!,
    fallbackInitials,
  });

  const { data, error } = await admin
    .from('quote_project_numbers')
    .insert({
      project_reference: quoteReference,
      manager_profile_id: managerProfileId!,
      requester_initials: initials,
      title,
      description: normalizeOptionalString(body.description),
      notes: normalizeOptionalString(body.notes),
      created_by: userId,
      updated_by: userId,
    })
    .select('*')
    .single();
  if (error) throw error;

  return { project: data };
}

async function addProjectCost(admin: ReturnType<typeof createAdminClient>, body: Record<string, unknown>, userId: string) {
  const projectNumberId = normalizeOptionalString(body.project_number_id);
  const description = normalizeOptionalString(body.description);
  const amount = Number(body.amount || 0);
  const fieldErrors: Record<string, string> = {};

  if (!projectNumberId) fieldErrors.project_number_id = 'Select a project number.';
  if (!description) fieldErrors.description = 'Enter a cost description.';
  if (!Number.isFinite(amount) || amount < 0) fieldErrors.amount = 'Enter a valid cost amount.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const { data, error } = await admin
    .from('quote_project_costs')
    .insert({
      project_number_id: projectNumberId!,
      cost_date: normalizeOptionalString(body.cost_date) || new Date().toISOString().slice(0, 10),
      category: normalizeCostCategory(body.category),
      supplier: normalizeOptionalString(body.supplier),
      description: description!,
      amount,
      notes: normalizeOptionalString(body.notes),
      created_by: userId,
      updated_by: userId,
    })
    .select('*')
    .single();
  if (error) throw error;

  return { cost: data };
}

function getSelectedCosts(project: { costs?: QuoteProjectCostRow[] }, costIds: unknown): QuoteProjectCostRow[] {
  const selectedIds = Array.isArray(costIds)
    ? new Set(costIds.filter((id): id is string => typeof id === 'string'))
    : new Set<string>();
  const costs = project.costs || [];
  const selected = selectedIds.size > 0
    ? costs.filter(cost => selectedIds.has(cost.id))
    : costs.filter(cost => !cost.linked_quote_id);
  return selected.filter(cost => !cost.linked_quote_id);
}

function buildLineItemRows(quoteId: string, projectReference: string, costs: QuoteProjectCostRow[]): QuoteLineItemInsert[] {
  return costs.map((cost, index) => ({
    id: crypto.randomUUID(),
    quote_id: quoteId,
    description: `[${projectReference}] ${cost.description}`,
    quantity: 1,
    unit: cost.category,
    unit_rate: Number(cost.amount || 0),
    line_total: Number(cost.amount || 0),
    sort_order: index,
  }));
}

async function loadProjectWithCosts(admin: ReturnType<typeof createAdminClient>, projectNumberId: string) {
  const { data, error } = await admin
    .from('quote_project_numbers')
    .select('*, costs:quote_project_costs(*)')
    .eq('id', projectNumberId)
    .single();
  if (error) throw error;
  return data as QuoteProjectNumberRow & { costs?: QuoteProjectCostRow[] };
}

async function linkCostsToExistingQuote(admin: ReturnType<typeof createAdminClient>, body: Record<string, unknown>, userId: string) {
  const projectNumberId = normalizeOptionalString(body.project_number_id);
  const quoteId = normalizeOptionalString(body.quote_id);
  const fieldErrors: Record<string, string> = {};

  if (!projectNumberId) fieldErrors.project_number_id = 'Select a project number.';
  if (!quoteId) fieldErrors.quote_id = 'Select a quote.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const [project, quoteResult, lineItemsResult] = await Promise.all([
    loadProjectWithCosts(admin, projectNumberId!),
    admin.from('quotes').select('*').eq('id', quoteId).single(),
    admin.from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order'),
  ]);
  if (quoteResult.error || !quoteResult.data) throw quoteResult.error || new Error('Unable to load quote');
  if (lineItemsResult.error) throw lineItemsResult.error;
  if (!quoteResult.data.is_latest_version) {
    return { fieldErrors: { quote_id: 'Select the latest quote version.' } };
  }

  const selectedCosts = getSelectedCosts(project, body.cost_ids);
  if (selectedCosts.length === 0) return { fieldErrors: { cost_ids: 'Select at least one unlinked cost.' } };

  const existingItems = (lineItemsResult.data || []).map((item, index) => ({
    description: item.description,
    quantity: Number(item.quantity || 0),
    unit: item.unit || '',
    unit_rate: Number(item.unit_rate || 0),
    sort_order: item.sort_order ?? index,
  }));
  const newRows = buildLineItemRows(quoteId!, project.project_reference, selectedCosts)
    .map((row, index) => ({
      ...row,
      sort_order: existingItems.length + index,
    }));
  const totals = calculateQuoteTotals([
    ...existingItems,
    ...newRows.map(row => ({
      description: row.description,
      quantity: Number(row.quantity || 0),
      unit: row.unit || '',
      unit_rate: Number(row.unit_rate || 0),
      sort_order: row.sort_order || 0,
    })),
  ]);

  const { error: lineError } = await admin.from('quote_line_items').insert(newRows);
  if (lineError) throw lineError;

  const { error: quoteUpdateError } = await admin
    .from('quotes')
    .update({ subtotal: totals.subtotal, total: totals.total, updated_by: userId })
    .eq('id', quoteId);
  if (quoteUpdateError) throw quoteUpdateError;

  await Promise.all(selectedCosts.map((cost, index) => admin
    .from('quote_project_costs')
    .update({
      linked_quote_id: quoteId,
      linked_quote_line_item_id: newRows[index].id,
      linked_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', cost.id)));

  const { data: updatedProject, error: projectUpdateError } = await admin
    .from('quote_project_numbers')
    .update({
      status: 'linked',
      linked_quote_id: quoteId,
      linked_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', projectNumberId)
    .select('*')
    .single();
  if (projectUpdateError) throw projectUpdateError;

  await appendQuoteTimelineEvent(admin, {
    quoteId: quoteId!,
    quoteThreadId: quoteResult.data.quote_thread_id,
    quoteReference: quoteResult.data.quote_reference,
    eventType: 'project_costs_linked',
    title: 'Project costs added',
    description: `${selectedCosts.length} cost row(s) added from ${project.project_reference}.`,
    actorUserId: userId,
  });

  return { project: updatedProject };
}

async function convertProjectToQuote(admin: ReturnType<typeof createAdminClient>, body: Record<string, unknown>, userId: string) {
  const projectNumberId = normalizeOptionalString(body.project_number_id);
  const customerId = normalizeOptionalString(body.customer_id);
  const siteAddress = normalizeOptionalString(body.site_address);
  const fieldErrors: Record<string, string> = {};

  if (!projectNumberId) fieldErrors.project_number_id = 'Select a project number.';
  if (!customerId) fieldErrors.customer_id = 'Select a customer.';
  if (!siteAddress) fieldErrors.site_address = 'Enter the site address.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const project = await loadProjectWithCosts(admin, projectNumberId!);
  if (project.status === 'converted') {
    return { fieldErrors: { project_number_id: 'This project number has already been converted.' } };
  }
  const selectedCosts = getSelectedCosts(project, body.cost_ids);
  if (selectedCosts.length === 0) return { fieldErrors: { cost_ids: 'Select at least one unlinked cost.' } };

  const [{ data: customer, error: customerError }, { data: managerProfile, error: managerError }] = await Promise.all([
    admin.from('customers').select('*').eq('id', customerId).single(),
    admin.from('profiles').select('id, full_name').eq('id', project.manager_profile_id).single(),
  ]);
  if (customerError || !customer) throw customerError || new Error('Unable to load customer');
  if (managerError || !managerProfile) throw managerError || new Error('Unable to load manager profile');

  const managerOption = await getQuoteManagerOption(project.manager_profile_id);
  const quoteId = crypto.randomUUID();
  const lineRows = buildLineItemRows(quoteId, project.project_reference, selectedCosts);
  const totals = calculateQuoteTotals(lineRows.map(row => ({
    description: row.description,
    quantity: Number(row.quantity || 0),
    unit: row.unit || '',
    unit_rate: Number(row.unit_rate || 0),
    sort_order: row.sort_order || 0,
  })));
  const today = new Date().toISOString().slice(0, 10);
  const subjectLine = normalizeOptionalString(body.subject_line) || project.title;
  const summary = normalizeOptionalString(body.project_description) || project.description || `Costs converted from project number ${project.project_reference}.`;
  const scope = normalizeOptionalString(body.scope) || selectedCosts.map(cost => `- ${cost.description}`).join('\n');

  const quotePayload: QuoteInsert = {
    id: quoteId,
    quote_reference: project.project_reference,
    base_quote_reference: project.project_reference,
    quote_thread_id: quoteId,
    parent_quote_id: null,
    revision_number: 0,
    revision_type: 'original',
    version_label: 'Original',
    requester_id: project.manager_profile_id,
    requester_initials: project.requester_initials,
    customer_id: customerId!,
    quote_date: normalizeOptionalString(body.quote_date) || today,
    attention_name: normalizeOptionalString(body.attention_name) || customer.contact_name || customer.company_name,
    attention_email: normalizeOptionalString(body.attention_email) || customer.contact_email || '',
    site_address: siteAddress || buildAddress(customer),
    subject_line: subjectLine,
    project_description: summary,
    scope,
    salutation: customer.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '',
    validity_days: Number(body.validity_days || customer.default_validity_days || 30),
    pricing_mode: 'itemized',
    subtotal: totals.subtotal,
    total: totals.total,
    status: 'draft',
    commercial_status: 'open',
    manager_name: managerOption?.profile?.full_name || managerOption?.signoff_name || managerProfile.full_name,
    manager_email: managerOption?.manager_email || null,
    approver_profile_id: managerOption?.approver_profile_id || project.manager_profile_id,
    signoff_name: managerOption?.signoff_name || managerProfile.full_name,
    signoff_title: managerOption?.signoff_title || null,
    created_by: userId,
    updated_by: userId,
  };

  const { error: quoteError } = await admin.from('quotes').insert(quotePayload);
  if (quoteError) throw quoteError;
  const { error: lineError } = await admin.from('quote_line_items').insert(lineRows);
  if (lineError) throw lineError;

  await Promise.all(selectedCosts.map((cost, index) => admin
    .from('quote_project_costs')
    .update({
      linked_quote_id: quoteId,
      linked_quote_line_item_id: lineRows[index].id,
      linked_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', cost.id)));

  const { data: updatedProject, error: projectUpdateError } = await admin
    .from('quote_project_numbers')
    .update({
      status: 'converted',
      converted_quote_id: quoteId,
      converted_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', projectNumberId)
    .select('*')
    .single();
  if (projectUpdateError) throw projectUpdateError;

  await appendQuoteTimelineEvent(admin, {
    quoteId,
    quoteThreadId: quoteId,
    quoteReference: project.project_reference,
    eventType: 'project_number_converted',
    title: 'Project number converted',
    description: `${selectedCosts.length} cost row(s) converted from provisional project number.`,
    toStatus: 'draft',
    actorUserId: userId,
  });

  return { project: updatedProject, quote_id: quoteId };
}

export async function GET() {
  try {
    const { user } = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const project_numbers = await listProjectNumbers(admin);
    return NextResponse.json({ project_numbers });
  } catch (error) {
    console.error('Error fetching quote project numbers:', error);
    return NextResponse.json({ error: 'Unable to load project numbers right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json() as Record<string, unknown>;
    const action = normalizeOptionalString(body.action) || 'create_project';
    const admin = createAdminClient();

    const result = action === 'add_cost'
      ? await addProjectCost(admin, body, user.id)
      : await createProjectNumber(admin, body, user.id);

    if ('fieldErrors' in result && result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields and try again.', field_errors: result.fieldErrors },
        { status: 400 }
      );
    }

    if ('project' in result && result.project) {
      await syncProjectNumberSiteLocation(admin, result.project as QuoteProjectNumberRow, user.id);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating quote project number:', error);
    return NextResponse.json({ error: 'Unable to save project number right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json() as Record<string, unknown>;
    const action = normalizeOptionalString(body.action);
    const admin = createAdminClient();
    let result: Record<string, unknown>;

    if (action === 'link_existing_quote') {
      result = await linkCostsToExistingQuote(admin, body, user.id);
    } else if (action === 'convert_to_quote') {
      result = await convertProjectToQuote(admin, body, user.id);
    } else {
      return NextResponse.json({ error: 'Unsupported project number action.' }, { status: 400 });
    }

    if ('fieldErrors' in result && result.fieldErrors && Object.keys(result.fieldErrors as Record<string, string>).length > 0) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields and try again.', field_errors: result.fieldErrors },
        { status: 400 }
      );
    }

    if ('project' in result && result.project) {
      await syncProjectNumberSiteLocation(admin, result.project as QuoteProjectNumberRow, user.id);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating quote project number:', error);
    return NextResponse.json({ error: 'Unable to update project number right now.' }, { status: 500 });
  }
}
