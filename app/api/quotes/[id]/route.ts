import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACTIVE_QUOTE_STATUS_ORDER } from '@/app/(dashboard)/quotes/types';
import type { Database } from '@/types/database';
import {
  appendQuoteTimelineEvent,
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  createQuoteNotification,
  fetchQuoteBundle,
  sendQuoteRamsRequestEmail,
  sendQuoteToCustomerEmail,
} from '@/lib/server/quote-workflow';

type QuoteFieldErrors = Record<string, string>;

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const bundle = await fetchQuoteBundle(admin, id);

    return NextResponse.json({
      quote: {
        ...bundle.quote,
        line_items: bundle.lineItems,
        attachments: bundle.attachments,
        rams_documents: bundle.ramsDocuments,
        invoices: bundle.invoices,
        versions: bundle.versions,
        timeline: bundle.timeline,
        invoice_summary: bundle.invoiceSummary,
      },
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    return NextResponse.json({ error: 'Unable to load quote details right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const body = await request.json();
    const { action, line_items, manager_profile_id, approver_profile_id, ...quoteUpdates } = body as {
      action?: string;
      manager_profile_id?: string;
      approver_profile_id?: string;
      line_items?: Array<{ description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }>;
      revision_type?: 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate';
      version_notes?: string;
      return_comments?: string;
      po_number?: string | null;
      po_value?: number | null;
      completion_comments?: string | null;
      completion_status?: 'approved_in_full' | 'approved_in_part';
      start_date?: string | null;
      start_alert_days?: number | null;
      estimated_duration_days?: number | null;
      pricing_mode?: 'itemized' | 'attachments_only';
      rams_comments?: string | null;
      [key: string]: unknown;
    };

    const current = await fetchQuoteBundle(admin, id);
    if (!current.quote.is_latest_version) {
      return NextResponse.json(
        { error: 'Only the latest quote version can be changed.' },
        { status: 400 }
      );
    }
    const normalizedPoNumber = typeof quoteUpdates.po_number === 'string'
      ? quoteUpdates.po_number.trim() || null
      : quoteUpdates.po_number ?? null;
    const normalizedPoValue = typeof quoteUpdates.po_value === 'number'
      ? quoteUpdates.po_value
      : quoteUpdates.po_value ?? null;
    const normalizedStartAlertDays = normalizeOptionalInteger(quoteUpdates.start_alert_days);
    const normalizedEstimatedDurationDays = normalizeOptionalInteger(quoteUpdates.estimated_duration_days);
    const pricingMode = quoteUpdates.pricing_mode === 'attachments_only' ? 'attachments_only' : 'itemized';

    if (action === 'submit_for_approval' || action === 'confirm_and_send') {
      const customerEmail = current.quote.attention_email?.trim() || current.quote.customer?.contact_email?.trim() || '';
      if (!customerEmail) {
        return NextResponse.json(
          { error: 'Add a customer contact email before confirming this quote.' },
          { status: 400 }
        );
      }

      if (current.quote.pricing_mode === 'attachments_only' && !current.attachments.some(attachment => attachment.is_client_visible)) {
        return NextResponse.json(
          { error: 'Add at least one client-visible attachment before confirming this quote.' },
          { status: 400 }
        );
      }

      const emailResult = await sendQuoteToCustomerEmail(current, [
        current.quote.manager_email || '',
        'rob@example.com',
        'debug.user@example.com',
      ]);

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send quote email' }, { status: 500 });
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'sent',
          approved_by: user.id,
          approved_at: now,
          sent_at: now,
          customer_sent_at: now,
          customer_sent_by: user.id,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'confirmed_and_sent',
        title: 'Confirmed and sent',
        description: `Quote emailed to ${customerEmail}.`,
        fromStatus: current.quote.status,
        toStatus: 'sent',
        actorUserId: user.id,
        createdAt: now,
      });
    } else if (action === 'return_for_changes') {
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'changes_requested',
          returned_at: new Date().toISOString(),
          return_comments: quoteUpdates.return_comments || null,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;

      if (current.quote.requester_id) {
        await createQuoteNotification({
          senderId: user.id,
          recipientIds: [current.quote.requester_id],
          subject: `Quote returned: ${current.quote.quote_reference}`,
          body: String(quoteUpdates.return_comments || 'This quote has been returned for changes.'),
        });
      }
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'returned_for_changes',
        title: 'Returned for changes',
        description: typeof quoteUpdates.return_comments === 'string' && quoteUpdates.return_comments.trim()
          ? quoteUpdates.return_comments.trim()
          : 'Quote returned for changes.',
        fromStatus: current.quote.status,
        toStatus: 'changes_requested',
        actorUserId: user.id,
      });
    } else if (action === 'approve_and_send') {
      const customerEmail = current.quote.attention_email?.trim() || current.quote.customer?.contact_email?.trim() || '';
      if (!customerEmail) {
        return NextResponse.json(
          { error: 'Add a customer contact email before sending this quote.' },
          { status: 400 }
        );
      }

      const emailResult = await sendQuoteToCustomerEmail(current, [
        current.quote.manager_email || '',
        'rob@example.com',
        'debug.user@example.com',
      ]);

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send quote email' }, { status: 500 });
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'sent',
          approved_by: user.id,
          approved_at: now,
          sent_at: now,
          customer_sent_at: now,
          customer_sent_by: user.id,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'approved_and_sent',
        title: 'Approved and sent',
        description: `Quote emailed to ${customerEmail}.`,
        fromStatus: current.quote.status,
        toStatus: 'sent',
        actorUserId: user.id,
        createdAt: now,
      });
    } else if (action === 'save_po_details') {
      const now = new Date().toISOString();
      const hasPoDetails = normalizedPoNumber !== null || normalizedPoValue !== null;

      const { error } = await supabase
        .from('quotes')
        .update({
          po_number: normalizedPoNumber,
          po_value: normalizedPoValue,
          po_received_at: hasPoDetails ? (current.quote.po_received_at || now) : current.quote.po_received_at,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'po_details_saved',
        title: 'PO details updated',
        description: [
          normalizedPoNumber ? `PO: ${normalizedPoNumber}` : null,
          normalizedPoValue !== null ? `Value: £${Number(normalizedPoValue).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : null,
        ].filter(Boolean).join(' • ') || 'PO details were updated.',
        actorUserId: user.id,
        createdAt: now,
      });
    } else if (action === 'trigger_rams') {
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'po_received',
          rams_requested_at: now,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;

      await sendQuoteRamsRequestEmail({
        quoteReference: current.quote.quote_reference,
        customerName: current.quote.customer?.company_name || 'Unknown customer',
        subjectLine: current.quote.subject_line || 'No subject provided',
        scope: current.quote.scope || null,
        poNumber: String(normalizedPoNumber || current.quote.po_number || 'Not supplied'),
        managerName: current.quote.manager_name || 'Unknown manager',
        internalNotes: current.quote.version_notes || null,
        completionComments: current.quote.completion_comments || null,
        siteAddress: current.quote.site_address || null,
        startDate: current.quote.start_date || null,
        estimatedDurationDays: current.quote.estimated_duration_days || null,
        ramsComments: normalizeOptionalString(quoteUpdates.rams_comments),
      });
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'rams_triggered',
        title: 'RAMS triggered',
        description: normalizeOptionalString(quoteUpdates.rams_comments) || 'Status changed to Accepted.',
        fromStatus: current.quote.status,
        toStatus: 'po_received',
        actorUserId: user.id,
        createdAt: now,
      });
    } else if (action === 'set_job_schedule') {
      if (Number.isNaN(normalizedStartAlertDays)) {
        return NextResponse.json(
          {
            error: 'Please correct the highlighted fields and try again.',
            field_errors: {
              start_alert_days: 'Alert days before start must be a whole number.',
            },
          },
          { status: 400 }
        );
      }

      const nextStatus = current.quote.status === 'po_received' ? 'in_progress' : current.quote.status;
      const { error } = await supabase
        .from('quotes')
        .update({
          start_date: normalizeOptionalString(quoteUpdates.start_date),
          start_alert_days: normalizedStartAlertDays,
          status: nextStatus,
          started: Boolean(normalizeOptionalString(quoteUpdates.start_date)),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'schedule_updated',
        title: nextStatus === 'in_progress' && current.quote.status !== nextStatus ? 'Schedule saved and quote started' : 'Schedule updated',
        description: [
          normalizeOptionalString(quoteUpdates.start_date) ? `Start date: ${normalizeOptionalString(quoteUpdates.start_date)}` : null,
          normalizedStartAlertDays !== null ? `Alert days: ${normalizedStartAlertDays}` : null,
        ].filter(Boolean).join(' • ') || 'Job schedule updated.',
        fromStatus: current.quote.status,
        toStatus: nextStatus,
        actorUserId: user.id,
      });
    } else if (action === 'mark_complete') {
      const completionStatus = quoteUpdates.completion_status || 'approved_in_full';
      const status = completionStatus === 'approved_in_part' ? 'completed_part' : 'completed_full';

      const { error } = await supabase
        .from('quotes')
        .update({
          status,
          completion_status: completionStatus,
          completion_comments: quoteUpdates.completion_comments || null,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'marked_complete',
        title: 'Marked complete',
        description: quoteUpdates.completion_comments ? String(quoteUpdates.completion_comments) : 'Completion status updated.',
        fromStatus: current.quote.status,
        toStatus: status,
        actorUserId: user.id,
      });
    } else if (action === 'toggle_closed') {
      const nextCommercialStatus = current.quote.commercial_status === 'closed' ? 'open' : 'closed';
      const { error } = await supabase
        .from('quotes')
        .update({
          commercial_status: nextCommercialStatus,
          closed_at: nextCommercialStatus === 'closed' ? new Date().toISOString() : null,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: nextCommercialStatus === 'closed' ? 'quote_closed' : 'quote_reopened',
        title: nextCommercialStatus === 'closed' ? 'Quote closed' : 'Quote reopened',
        description: nextCommercialStatus === 'closed'
          ? 'Commercial status changed to closed.'
          : 'Commercial status changed to open.',
        actorUserId: user.id,
      });
    } else if (action === 'create_revision' || action === 'duplicate') {
      const revisionType = action === 'duplicate' ? 'duplicate' : (quoteUpdates.revision_type || 'revision');
      const nextRevisionNumber = current.quote.revision_number + 1;
      const newQuoteId = crypto.randomUUID();
      const isDuplicate = action === 'duplicate';
      const baseReference = isDuplicate ? buildVersionReference(current.quote.base_quote_reference, 'duplicate', nextRevisionNumber) : current.quote.base_quote_reference;
      const quoteReference = isDuplicate
        ? baseReference
        : buildVersionReference(current.quote.base_quote_reference, revisionType, nextRevisionNumber);

      const insertPayload = {
        ...current.quote,
        id: newQuoteId,
        quote_reference: quoteReference,
        base_quote_reference: isDuplicate ? quoteReference : current.quote.base_quote_reference,
        quote_thread_id: isDuplicate ? newQuoteId : current.quote.quote_thread_id,
        parent_quote_id: current.quote.id,
        revision_number: isDuplicate ? 0 : nextRevisionNumber,
        revision_type: revisionType,
        version_label: isDuplicate ? 'Original' : buildVersionLabel(revisionType, nextRevisionNumber),
        version_notes: quoteUpdates.version_notes || null,
        is_latest_version: true,
        duplicate_source_quote_id: current.quote.id,
        status: 'draft',
        return_comments: null,
        returned_at: null,
        approved_at: null,
        approved_by: null,
        sent_at: null,
        customer_sent_at: null,
        customer_sent_by: null,
        po_number: null,
        po_value: null,
        po_received_at: null,
        rams_requested_at: null,
        started: false,
        start_alert_sent_at: null,
        completion_status: 'not_completed',
        completion_comments: null,
        commercial_status: 'open',
        closed_at: null,
        invoice_number: null,
        invoice_notes: null,
        last_invoice_at: null,
        accepted: false,
        accepted_at: null,
        invoiced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: user.id,
        updated_by: user.id,
      };

      delete (insertPayload as { customer?: unknown }).customer;

      const { error: insertError } = await supabase
        .from('quotes')
        .insert(insertPayload as Database['public']['Tables']['quotes']['Insert']);
      if (insertError) throw insertError;

      if (!isDuplicate) {
        const { error: previousVersionError } = await supabase
          .from('quotes')
          .update({ is_latest_version: false, updated_by: user.id })
          .eq('quote_thread_id', current.quote.quote_thread_id)
          .neq('id', newQuoteId);

        if (previousVersionError) throw previousVersionError;
      }

      if (current.lineItems.length > 0) {
        const { error: lineError } = await supabase.from('quote_line_items').insert(
          current.lineItems.map((item, index) => ({
            quote_id: newQuoteId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_rate: item.unit_rate,
            line_total: item.line_total,
            sort_order: item.sort_order ?? index,
          }))
        );

        if (lineError) throw lineError;
      }

      await appendQuoteTimelineEvent(admin, {
        quoteId: newQuoteId,
        quoteThreadId: isDuplicate ? newQuoteId : current.quote.quote_thread_id,
        quoteReference,
        eventType: isDuplicate ? 'quote_duplicated' : 'version_created',
        title: isDuplicate ? 'Quote duplicated' : 'New version created',
        description: quoteUpdates.version_notes ? String(quoteUpdates.version_notes) : null,
        toStatus: 'draft',
        actorUserId: user.id,
      });

      const bundle = await fetchQuoteBundle(admin, newQuoteId);
      return NextResponse.json({
        quote: {
          ...bundle.quote,
          line_items: bundle.lineItems,
          attachments: bundle.attachments,
          invoices: bundle.invoices,
          versions: bundle.versions,
          timeline: bundle.timeline,
          invoice_summary: bundle.invoiceSummary,
        },
      });
    } else if (action) {
      return NextResponse.json({ error: `Unsupported quote action: ${action}` }, { status: 400 });
    } else {
      const updates = { ...quoteUpdates, updated_by: user.id } as Record<string, unknown>;
      const fieldErrors: QuoteFieldErrors = {};
      const normalizedManagerProfileId = typeof manager_profile_id === 'string' ? manager_profile_id.trim() : '';
      const normalizedApproverProfileId = typeof approver_profile_id === 'string' && approver_profile_id.trim()
        ? approver_profile_id.trim()
        : null;
      const customerId = typeof quoteUpdates.customer_id === 'string' ? quoteUpdates.customer_id.trim() : '';

      if ('customer_id' in quoteUpdates && !customerId) {
        fieldErrors.customer_id = 'Select a customer.';
      }

      if (typeof manager_profile_id !== 'undefined' && !normalizedManagerProfileId) {
        fieldErrors.manager_profile_id = 'Select a manager.';
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
        : null;

      if (pricingMode === 'itemized') {
        normalizedItems?.forEach((item) => {
          if (isMeaningfulLineItem(item) && !item.description) {
            fieldErrors[`line_items.${item.originalIndex}.description`] = 'Enter a description for this line item.';
          }
        });
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

      if ('customer_id' in quoteUpdates) {
        updates.customer_id = customerId;
      }

      if ('quote_date' in quoteUpdates) {
        updates.quote_date = normalizeOptionalString(quoteUpdates.quote_date) || undefined;
      }

      if ('attention_name' in quoteUpdates) {
        updates.attention_name = normalizeOptionalString(quoteUpdates.attention_name);
      }

      if ('attention_email' in quoteUpdates) {
        updates.attention_email = normalizeOptionalString(quoteUpdates.attention_email);
      }

      if ('site_address' in quoteUpdates) {
        updates.site_address = normalizeOptionalString(quoteUpdates.site_address);
      }

      if ('subject_line' in quoteUpdates) {
        updates.subject_line = normalizeOptionalString(quoteUpdates.subject_line);
      }

      if ('project_description' in quoteUpdates) {
        updates.project_description = normalizeOptionalString(quoteUpdates.project_description);
      }

      if ('scope' in quoteUpdates) {
        updates.scope = normalizeOptionalString(quoteUpdates.scope);
      }

      if ('salutation' in quoteUpdates) {
        updates.salutation = normalizeOptionalString(quoteUpdates.salutation);
      }

      if ('manager_name' in quoteUpdates) {
        updates.manager_name = normalizeOptionalString(quoteUpdates.manager_name);
      }

      if ('manager_email' in quoteUpdates) {
        updates.manager_email = normalizeOptionalString(quoteUpdates.manager_email);
      }

      if ('signoff_name' in quoteUpdates) {
        updates.signoff_name = normalizeOptionalString(quoteUpdates.signoff_name);
      }

      if ('signoff_title' in quoteUpdates) {
        updates.signoff_title = normalizeOptionalString(quoteUpdates.signoff_title);
      }

      if ('custom_footer_text' in quoteUpdates) {
        updates.custom_footer_text = normalizeOptionalString(quoteUpdates.custom_footer_text);
      }

      if ('version_notes' in quoteUpdates) {
        updates.version_notes = normalizeOptionalString(quoteUpdates.version_notes);
      }

      if ('start_date' in quoteUpdates) {
        updates.start_date = normalizeOptionalString(quoteUpdates.start_date);
      }

      if ('start_alert_days' in quoteUpdates) {
        updates.start_alert_days = normalizedStartAlertDays;
      }

      if ('estimated_duration_days' in quoteUpdates) {
        updates.estimated_duration_days = normalizedEstimatedDurationDays;
      }

      if ('pricing_mode' in quoteUpdates) {
        updates.pricing_mode = pricingMode;
      }

      if (typeof manager_profile_id !== 'undefined' && normalizedManagerProfileId) {
        const managerOption = await admin
          .from('quote_manager_series')
          .select('profile_id, initials, signoff_name, signoff_title, manager_email, approver_profile_id')
          .eq('profile_id', normalizedManagerProfileId)
          .maybeSingle();

        if (managerOption.error) {
          throw managerOption.error;
        }

        const { data: managerProfile, error: managerProfileError } = await admin
          .from('profiles')
          .select('id, full_name')
          .eq('id', normalizedManagerProfileId)
          .single();

        if (managerProfileError || !managerProfile) {
          throw managerProfileError || new Error('Unable to load manager profile');
        }

        updates.requester_id = normalizedManagerProfileId;
        updates.requester_initials = managerOption.data?.initials || current.quote.requester_initials;
        updates.manager_name = normalizeOptionalString(quoteUpdates.manager_name)
          || managerOption.data?.signoff_name
          || managerProfile.full_name;
        updates.manager_email = normalizeOptionalString(quoteUpdates.manager_email)
          || managerOption.data?.manager_email
          || null;
        updates.approver_profile_id = normalizedApproverProfileId
          || managerOption.data?.approver_profile_id
          || normalizedManagerProfileId;
        updates.signoff_name = normalizeOptionalString(quoteUpdates.signoff_name)
          || managerOption.data?.signoff_name
          || managerProfile.full_name;
        updates.signoff_title = normalizeOptionalString(quoteUpdates.signoff_title)
          || managerOption.data?.signoff_title
          || null;
      } else if (typeof approver_profile_id !== 'undefined') {
        updates.approver_profile_id = normalizedApproverProfileId;
      }

      if (typeof updates.status === 'string' && !ACTIVE_QUOTE_STATUS_ORDER.includes(updates.status as typeof ACTIVE_QUOTE_STATUS_ORDER[number])) {
        return NextResponse.json({ error: `Unsupported quote status: ${updates.status}` }, { status: 400 });
      }

      if (normalizedItems) {
        const meaningfulItems = pricingMode === 'attachments_only' ? [] : normalizedItems
          .filter(item => isMeaningfulLineItem(item))
          .map(({ originalIndex: _originalIndex, ...item }) => item);
        const totals = calculateQuoteTotals(meaningfulItems);
        updates.subtotal = totals.subtotal;
        updates.total = totals.total;
      }

      const { error } = await supabase.from('quotes').update(updates).eq('id', id);
      if (error) throw error;

      if (normalizedItems) {
        const { error: deleteLineItemsError } = await supabase
          .from('quote_line_items')
          .delete()
          .eq('quote_id', id);
        if (deleteLineItemsError) throw deleteLineItemsError;

        const meaningfulItems = pricingMode === 'attachments_only' ? [] : normalizedItems
          .filter(item => isMeaningfulLineItem(item))
          .map(({ originalIndex: _originalIndex, ...item }) => item);

        if (meaningfulItems.length > 0) {
          const rows = meaningfulItems.map((item, index) => ({
            quote_id: id,
            description: item.description || '',
            quantity: Number(item.quantity || 0),
            unit: item.unit || '',
            unit_rate: Number(item.unit_rate || 0),
            line_total: Math.round(Number(item.quantity || 0) * Number(item.unit_rate || 0) * 100) / 100,
            sort_order: item.sort_order ?? index,
          }));

          const { error: lineInsertError } = await supabase.from('quote_line_items').insert(rows);
          if (lineInsertError) throw lineInsertError;
        }
      }

      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'quote_updated',
        title: 'Quote updated',
        description: 'Quote details were edited.',
        actorUserId: user.id,
      });
    }

    const bundle = await fetchQuoteBundle(admin, id);
    return NextResponse.json({
      quote: {
        ...bundle.quote,
        line_items: bundle.lineItems,
        attachments: bundle.attachments,
        invoices: bundle.invoices,
        versions: bundle.versions,
        timeline: bundle.timeline,
        invoice_summary: bundle.invoiceSummary,
      },
    });
  } catch (error) {
    console.error('Error updating quote:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update this quote right now.' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const bundle = await fetchQuoteBundle(admin, id);
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest draft version can be deleted.' }, { status: 400 });
    }

    if (bundle.quote.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft quotes can be deleted.' }, { status: 400 });
    }

    if (bundle.attachments.length > 0) {
      await admin.storage.from('quote-attachments').remove(
        bundle.attachments.map((attachment) => attachment.file_path)
      );
    }

    let nextLatestVersionId: string | null = null;
    const { data: remainingVersions, error: remainingVersionsError } = await admin
      .from('quotes')
      .select('id')
      .eq('quote_thread_id', bundle.quote.quote_thread_id)
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (remainingVersionsError) {
      throw remainingVersionsError;
    }

    nextLatestVersionId = remainingVersions?.[0]?.id ?? null;

    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error) throw error;

    if (nextLatestVersionId) {
      const { error: promoteError } = await supabase
        .from('quotes')
        .update({ is_latest_version: true, updated_by: user.id })
        .eq('id', nextLatestVersionId);

      if (promoteError) {
        throw promoteError;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote:', error);
    return NextResponse.json({ error: 'Unable to delete this quote right now.' }, { status: 500 });
  }
}
