import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCEPTED_QUOTE_STATUSES, ACTIVE_QUOTE_STATUS_ORDER, type QuoteStatus } from '@/app/(dashboard)/quotes/types';
import type { Database } from '@/types/database';
import {
  appendQuoteTimelineEvent,
  calculateQuoteTotals,
  fetchQuoteBundle,
  generateQuoteReferenceForManager,
  getInitialsFromName,
  getInvoiceSummary,
  getQuoteManagerOption,
  loadQuoteModuleSettings,
} from '@/lib/server/quote-workflow';
import {
  normalizeSecondaryContactIds,
  replaceQuoteCustomerContactRecipients,
  validateSecondaryContactIdsForCustomer,
} from '@/lib/server/quote-recipient-contacts';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

type QuoteFieldErrors = Record<string, string>;
type QuoteSageStatus = 'not_on_sage' | 'on_sage';

function getQuoteSageStatus(quote: { sage_posted_at?: string | null }): QuoteSageStatus {
  return quote.sage_posted_at ? 'on_sage' : 'not_on_sage';
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === '' || value === null || typeof value === 'undefined') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function isMeaningfulLineItem(item: { description?: string; unit?: string; quantity?: number; unit_rate?: number }) {
  return Boolean(
    item.description?.trim()
    || item.unit?.trim()
    || Number(item.unit_rate || 0) !== 0
    || Number(item.quantity || 1) !== 1
  );
}

function getQuoteListCustomerSelect(includeCustomerContacts: boolean) {
  const baseFields = `
    id,
    company_name,
    short_name,
    contact_name,
    contact_email,
    address_line_1,
    address_line_2,
    city,
    county,
    postcode,
    default_validity_days
  `;

  return includeCustomerContacts
    ? `${baseFields}, secondary_contacts:customer_contacts(*)`
    : baseFields;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    const includeVersions = searchParams.get('include_versions') === 'true';
    const includeCustomerContacts = searchParams.get('include_customer_contacts') === 'true';
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 250);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const customerSelect = getQuoteListCustomerSelect(includeCustomerContacts);

    let query = supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(${customerSelect})
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    if (!includeVersions) {
      query = query.eq('is_latest_version', true);
    }

    let summaryQuery = supabase
      .from('quotes')
      .select('status, total');

    if (customerId) {
      summaryQuery = summaryQuery.eq('customer_id', customerId);
    }

    if (!includeVersions) {
      summaryQuery = summaryQuery.eq('is_latest_version', true);
    }

    const [{ data, error }, { data: summaryRows, error: summaryError }] = await Promise.all([
      query,
      summaryQuery,
    ]);
    if (error) throw error;
    if (summaryError) throw summaryError;

    const quotes = data || [];
    const threadIds = quotes.map(quote => quote.quote_thread_id).filter(Boolean);
    let previousVersionsByThreadId = new Map<string, typeof quotes>();
    let previousVersions: typeof quotes = [];

    if (!includeVersions && threadIds.length > 0) {
      const { data: olderVersions, error: olderVersionsError } = await supabase
        .from('quotes')
        .select(`
          *,
          customer:customers(${customerSelect})
        `)
        .in('quote_thread_id', threadIds)
        .eq('is_latest_version', false)
        .order('created_at', { ascending: false });

      if (olderVersionsError) {
        throw olderVersionsError;
      }

      previousVersions = olderVersions || [];
      previousVersionsByThreadId = previousVersions.reduce((acc, version) => {
        const existing = acc.get(version.quote_thread_id) || [];
        existing.push(version);
        acc.set(version.quote_thread_id, existing);
        return acc;
      }, new Map<string, typeof quotes>());
    }

    const summaries = new Map<string, ReturnType<typeof getInvoiceSummary>>();
    const allVisibleQuotes = [...quotes, ...previousVersions];
    const summaryQuoteIds = allVisibleQuotes.map(quote => quote.id);
    if (summaryQuoteIds.length > 0) {
      const [
        { data: invoices, error: invoiceError },
        { data: invoiceRequests, error: invoiceRequestError },
      ] = await Promise.all([
        supabase
          .from('quote_invoices')
          .select('quote_id, amount, invoice_date')
          .in('quote_id', summaryQuoteIds),
        supabase
          .from('quote_invoice_requests')
          .select('quote_id, requested_amount, status')
          .in('quote_id', summaryQuoteIds),
      ]);

      if (invoiceError) {
        throw invoiceError;
      }
      if (invoiceRequestError) {
        throw invoiceRequestError;
      }

      const invoicesByQuoteId = new Map<string, Array<{ quote_id: string; amount: number; invoice_date: string | null }>>();
      (invoices || []).forEach((invoice) => {
        if (!invoicesByQuoteId.has(invoice.quote_id)) {
          invoicesByQuoteId.set(invoice.quote_id, []);
        }
        invoicesByQuoteId.get(invoice.quote_id)!.push(invoice);
      });

      const invoiceRequestsByQuoteId = new Map<string, Array<{ quote_id: string; requested_amount: number; status: string | null }>>();
      (invoiceRequests || []).forEach((request) => {
        if (!invoiceRequestsByQuoteId.has(request.quote_id)) {
          invoiceRequestsByQuoteId.set(request.quote_id, []);
        }
        invoiceRequestsByQuoteId.get(request.quote_id)!.push(request);
      });

      for (const quote of allVisibleQuotes) {
        summaries.set(
          quote.id,
          getInvoiceSummary({
            total: Number(quote.total || 0),
            invoices: invoicesByQuoteId.get(quote.id) || [],
            invoiceRequests: invoiceRequestsByQuoteId.get(quote.id) || [],
          })
        );
      }
    }

    const statusCounts = ACTIVE_QUOTE_STATUS_ORDER.reduce<Record<string, number>>(
      (acc, status) => ({ ...acc, [status]: 0 }),
      { all: 0 }
    );
    let acceptedQuotes = 0;
    let acceptedValue = 0;

    (summaryRows || []).forEach((quote) => {
      const status = quote.status ?? 'draft';
      statusCounts.all += 1;
      if (status in statusCounts) {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      if (ACCEPTED_QUOTE_STATUSES.has(status as QuoteStatus)) {
        acceptedQuotes += 1;
        acceptedValue += Number(quote.total || 0);
      }
    });

    return NextResponse.json({
      quotes: quotes.map(quote => ({
        ...quote,
        invoice_summary: summaries.get(quote.id) || getInvoiceSummary({ total: Number(quote.total || 0), invoices: [] }),
        sage_status: getQuoteSageStatus(quote),
        previous_versions: (previousVersionsByThreadId.get(quote.quote_thread_id) || []).map(version => ({
          ...version,
          invoice_summary: summaries.get(version.id) || getInvoiceSummary({ total: Number(version.total || 0), invoices: [] }),
          sage_status: getQuoteSageStatus(version),
        })),
      })),
      summary: {
        total_quotes: statusCounts.all,
        status_counts: statusCounts,
        accepted_quotes: acceptedQuotes,
        accepted_value: acceptedValue,
      },
      pagination: {
        offset,
        limit,
        has_more: quotes.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return NextResponse.json({ error: 'Unable to load quotes right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json();
    const {
      manager_profile_id,
      approver_profile_id,
      line_items,
      secondary_contact_ids,
      ...quoteData
    } = body as {
      manager_profile_id?: string;
      approver_profile_id?: string;
      requester_initials?: string;
      manager_name?: string;
      manager_email?: string;
      signoff_name?: string;
      signoff_title?: string;
      line_items?: Array<{ description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }>;
      secondary_contact_ids?: unknown;
      [key: string]: unknown;
    };

    const fieldErrors: QuoteFieldErrors = {};
    const customerId = typeof quoteData.customer_id === 'string' ? quoteData.customer_id.trim() : '';
    const managerProfileId = typeof manager_profile_id === 'string' ? manager_profile_id.trim() : '';
    const normalizedApproverProfileId = typeof approver_profile_id === 'string' && approver_profile_id.trim()
      ? approver_profile_id.trim()
      : null;
    const normalizedStartAlertDays = normalizeOptionalInteger(quoteData.start_alert_days);
    const normalizedEstimatedDurationDays = normalizeOptionalInteger(quoteData.estimated_duration_days);
    const normalizedValidityDays = Number(quoteData.validity_days);
    const pricingMode = quoteData.pricing_mode === 'attachments_only' ? 'attachments_only' : 'itemized';
    const normalizedSecondaryContactIds = normalizeSecondaryContactIds(secondary_contact_ids);

    if (!customerId) {
      fieldErrors.customer_id = 'Select a customer.';
    }

    if (!normalizeOptionalString(quoteData.quote_date)) {
      fieldErrors.quote_date = 'Select a quote date.';
    }

    if (!Number.isFinite(normalizedValidityDays) || normalizedValidityDays < 1) {
      fieldErrors.validity_days = 'Enter quote validity in days.';
    }

    if (!normalizeOptionalString(quoteData.attention_name)) {
      fieldErrors.attention_name = 'Enter who this quote is for the attention of.';
    }

    if (!normalizeOptionalString(quoteData.attention_email)) {
      fieldErrors.attention_email = 'Enter the contact email.';
    }

    if (!normalizeOptionalString(quoteData.site_address)) {
      fieldErrors.site_address = 'Enter the site address for this quote.';
    }

    if (!managerProfileId) {
      fieldErrors.manager_profile_id = 'Select a manager.';
    }

    if (!normalizeOptionalString(quoteData.subject_line)) {
      fieldErrors.subject_line = 'Enter a quote title.';
    }

    if (!normalizeOptionalString(quoteData.project_description)) {
      fieldErrors.project_description = 'Enter a quote summary.';
    }

    if (!normalizeOptionalString(quoteData.scope)) {
      fieldErrors.scope = 'Enter the quote scope.';
    }

    if (Number.isNaN(normalizedStartAlertDays)) {
      fieldErrors.start_alert_days = 'Alert days before start must be a whole number.';
    }

    if (Number.isNaN(normalizedEstimatedDurationDays)) {
      fieldErrors.estimated_duration_days = 'Estimated duration must be a whole number.';
    }

    const normalizedItems = Array.isArray(line_items)
      ? line_items.map((item, index) => ({
        originalIndex: index,
        description: item.description?.trim() || '',
        quantity: Number(item.quantity || 0),
        unit: item.unit?.trim() || '',
        unit_rate: Number(item.unit_rate || 0),
        sort_order: item.sort_order ?? index,
      }))
      : [];

    if (pricingMode === 'itemized') {
      normalizedItems.forEach((item) => {
        if (isMeaningfulLineItem(item) && !item.description) {
          fieldErrors[`line_items.${item.originalIndex}.description`] = 'Enter a description for this line item.';
        }
      });
    }

    if (customerId && normalizedSecondaryContactIds.length > 0) {
      Object.assign(fieldErrors, await validateSecondaryContactIdsForCustomer(admin, customerId, normalizedSecondaryContactIds));
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: 'Please correct the highlighted fields and try again.',
          field_errors: fieldErrors,
        },
        { status: 400 }
      );
    }

    const managerOption = await getQuoteManagerOption(managerProfileId);

    const { data: managerProfile, error: managerProfileError } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('id', managerProfileId)
      .single();

    if (managerProfileError || !managerProfile) {
      throw managerProfileError || new Error('Unable to load manager profile');
    }

    const initials = managerOption?.initials
      || quoteData.requester_initials
      || getInitialsFromName(managerProfile.full_name || '');

    const { quoteReference } = await generateQuoteReferenceForManager({
      managerProfileId,
      fallbackInitials: initials,
    });

    const moduleSettings = await loadQuoteModuleSettings(admin);
    const startAlertDays = normalizedStartAlertDays ?? moduleSettings.default_start_alert_days;
    const estimatedDurationDays = normalizedEstimatedDurationDays ?? moduleSettings.default_estimated_duration_days;
    const items = pricingMode === 'attachments_only' ? [] : normalizedItems
      .filter(item => isMeaningfulLineItem(item))
      .map(({ originalIndex: _originalIndex, ...item }) => item);
    const totals = calculateQuoteTotals(items);
    const quoteId = crypto.randomUUID();

    const insertPayload = {
      ...quoteData,
      customer_id: customerId,
      id: quoteId,
      quote_reference: quoteReference,
      base_quote_reference: quoteReference,
      quote_thread_id: quoteId,
      parent_quote_id: null,
      revision_number: 0,
      revision_type: 'original',
      version_label: 'Original',
      requester_id: managerProfileId,
      requester_initials: initials,
      quote_date: normalizeOptionalString(quoteData.quote_date) || undefined,
      attention_name: normalizeOptionalString(quoteData.attention_name),
      attention_email: normalizeOptionalString(quoteData.attention_email),
      site_address: normalizeOptionalString(quoteData.site_address),
      subject_line: normalizeOptionalString(quoteData.subject_line),
      project_description: normalizeOptionalString(quoteData.project_description),
      scope: normalizeOptionalString(quoteData.scope),
      salutation: normalizeOptionalString(quoteData.salutation),
      validity_days: normalizedValidityDays,
      manager_name: quoteData.manager_name || managerOption?.profile?.full_name || managerProfile.full_name,
      manager_email: managerOption?.manager_email || null,
      approver_profile_id: normalizedApproverProfileId || managerOption?.approver_profile_id || managerProfileId,
      signoff_name: quoteData.signoff_name || managerOption?.signoff_name || managerProfile.full_name,
      signoff_title: normalizeOptionalString(quoteData.signoff_title) || managerOption?.signoff_title || null,
      custom_footer_text: normalizeOptionalString(quoteData.custom_footer_text),
      version_notes: normalizeOptionalString(quoteData.version_notes),
      start_date: normalizeOptionalString(quoteData.start_date),
      start_alert_days: startAlertDays,
      estimated_duration_days: estimatedDurationDays,
      pricing_mode: pricingMode,
      subtotal: totals.subtotal,
      total: totals.total,
      status: (quoteData.status || 'draft') as QuoteStatus,
      commercial_status: 'open',
      created_by: user.id,
      updated_by: user.id,
    };

    const { error: insertError } = await supabase
      .from('quotes')
      .insert(insertPayload as Database['public']['Tables']['quotes']['Insert']);
    if (insertError) throw insertError;

    if (items.length > 0) {
      const rows = items.map((item, index) => ({
        quote_id: quoteId,
        description: item.description || '',
        quantity: Number(item.quantity || 0),
        unit: item.unit || '',
        unit_rate: Number(item.unit_rate || 0),
        line_total: Math.round(Number(item.quantity || 0) * Number(item.unit_rate || 0) * 100) / 100,
        sort_order: item.sort_order ?? index,
      }));

      const { error: lineItemError } = await supabase.from('quote_line_items').insert(rows);
      if (lineItemError) throw lineItemError;
    }

    if (normalizedSecondaryContactIds.length > 0) {
      const recipientFieldErrors = await replaceQuoteCustomerContactRecipients(
        supabase,
        quoteId,
        customerId,
        normalizedSecondaryContactIds,
        user.id
      );
      if (Object.keys(recipientFieldErrors).length > 0) {
        return NextResponse.json(
          {
            error: 'Please correct the highlighted fields and try again.',
            field_errors: recipientFieldErrors,
          },
          { status: 400 }
        );
      }
    }

    await appendQuoteTimelineEvent(admin, {
      quoteId,
      quoteThreadId: quoteId,
      quoteReference,
      eventType: 'quote_created',
      title: 'Quote created',
      description: 'Initial draft created.',
      toStatus: String(insertPayload.status),
      actorUserId: user.id,
    });

    const bundle = await fetchQuoteBundle(admin, quoteId);
    return NextResponse.json({
      quote: {
        ...bundle.quote,
        line_items: bundle.lineItems,
        invoice_summary: bundle.invoiceSummary,
        timeline: bundle.timeline,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating quote:', error);
    const message = error instanceof Error ? error.message : 'Unable to create this quote right now.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
