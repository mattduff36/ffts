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
  generateQuoteReferenceForManager,
  getInitialsFromName,
  getQuoteEmailCcEmails,
  getQuoteManagerOption,
  sendQuotePoRequestEmail,
  sendQuoteRamsRequestEmail,
  sendQuoteToCustomerEmail,
} from '@/lib/server/quote-workflow';
import { buildQuoteDisplayName } from '@/lib/quotes/quote-display-name';
import { renderConfiguredQuoteEmailTemplate } from '@/lib/server/quote-email-templates';
import {
  copyQuoteCustomerContactRecipients,
  normalizeSecondaryContactIds,
  replaceQuoteCustomerContactRecipients,
  validateSecondaryContactIdsForCustomer,
} from '@/lib/server/quote-recipient-contacts';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { canManageQuoteSage } from '@/lib/server/quote-sage-access';
import { syncQuoteSiteLocation } from '@/lib/server/inventory-site-location-sync';
import { resolveCustomerSiteSelection } from '@/lib/server/customer-sites';

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

function getCustomerRecipientDescription(primaryEmail: string, secondaryContacts: Array<{ email: string | null }>) {
  const additionalToEmails = Array.from(new Set(
    secondaryContacts
      .map(contact => contact.email?.trim())
      .filter((email): email is string => Boolean(email))
  ));

  return [primaryEmail, ...additionalToEmails].join(', ');
}

function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim();
  return email && email.includes('@') ? email : null;
}

function normalizeEmailList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const emails: string[] = [];
  value.forEach(item => {
    const email = normalizeEmailAddress(item);
    if (!email) return;

    const key = email.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    emails.push(email);
  });

  return emails;
}

function getQuoteCustomerRecipientEmails(current: Awaited<ReturnType<typeof fetchQuoteBundle>>): string[] {
  const emails = normalizeEmailList([
    current.quote.attention_email,
    current.quote.customer?.contact_email,
    ...current.selectedSecondaryContacts.map(contact => contact.email),
  ]);

  return emails;
}

function getQuoteCustomerCopyExclusionIds(requesterId?: string | null): string[] {
  return requesterId ? [requesterId] : [];
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

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const bundle = await fetchQuoteBundle(admin, id);
    await syncQuoteSiteLocation(admin, bundle.quote, user.id);
    const canManageSage = await canManageQuoteSage();

    return NextResponse.json({
      quote: {
        ...bundle.quote,
        can_manage_sage: canManageSage,
        line_items: bundle.lineItems,
        attachments: bundle.attachments,
        rams_documents: bundle.ramsDocuments,
        invoices: bundle.invoices,
        invoice_requests: bundle.invoiceRequests,
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

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json();
    const { action, line_items, manager_profile_id, approver_profile_id, secondary_contact_ids, ...quoteUpdates } = body as {
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
      on_sage?: boolean;
      secondary_contact_ids?: unknown;
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
    const normalizedSecondaryContactIds = normalizeSecondaryContactIds(secondary_contact_ids);

    if (action === 'submit_for_approval' || action === 'confirm_and_send') {
      const customerEmail = current.quote.attention_email?.trim() || current.quote.customer?.contact_email?.trim() || '';
      if (!customerEmail) {
        return NextResponse.json(
          { error: 'Add a primary customer contact email before confirming this quote.' },
          { status: 400 }
        );
      }

      if (current.quote.pricing_mode === 'attachments_only' && !current.attachments.some(attachment => attachment.is_client_visible)) {
        return NextResponse.json(
          { error: 'Add at least one client-visible attachment before confirming this quote.' },
          { status: 400 }
        );
      }

      const quoteCopyEmails = await getQuoteEmailCcEmails(
        admin,
        'quote_customer_email_copy',
        getQuoteCustomerCopyExclusionIds(current.quote.requester_id)
      );
      const emailResult = await sendQuoteToCustomerEmail(current, [
        current.quote.manager_email || '',
        ...quoteCopyEmails,
      ], user.email);

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send quote email' }, { status: 500 });
      }
      const recipientDescription = getCustomerRecipientDescription(customerEmail, current.selectedSecondaryContacts);

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
        description: `Quote emailed to customer recipient(s): ${recipientDescription}.`,
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
        const returnComments = String(quoteUpdates.return_comments || 'This quote has been returned for changes.');
        const notificationTemplate = await renderConfiguredQuoteEmailTemplate(admin, 'quote_returned', {
          quote_reference: current.quote.quote_reference,
          quote_name: buildQuoteDisplayName(current.quote),
          return_comments: returnComments,
        });
        await createQuoteNotification({
          senderId: user.id,
          recipientIds: [current.quote.requester_id],
          subject: notificationTemplate.subject,
          body: notificationTemplate.bodyText,
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
          { error: 'Add a primary customer contact email before sending this quote.' },
          { status: 400 }
        );
      }

      const quoteCopyEmails = await getQuoteEmailCcEmails(
        admin,
        'quote_customer_email_copy',
        getQuoteCustomerCopyExclusionIds(current.quote.requester_id)
      );
      const emailResult = await sendQuoteToCustomerEmail(current, [
        current.quote.manager_email || '',
        ...quoteCopyEmails,
      ], user.email);

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send quote email' }, { status: 500 });
      }
      const recipientDescription = getCustomerRecipientDescription(customerEmail, current.selectedSecondaryContacts);

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
        description: `Quote emailed to customer recipient(s): ${recipientDescription}.`,
        fromStatus: current.quote.status,
        toStatus: 'sent',
        actorUserId: user.id,
        createdAt: now,
      });
    } else if (action === 'request_po') {
      if (!current.quote.is_latest_version) {
        return NextResponse.json({ error: 'Only the latest quote version can request a PO.' }, { status: 400 });
      }

      if (!current.quote.sent_at && !current.quote.customer_sent_at && current.quote.status !== 'sent') {
        return NextResponse.json({ error: 'Send this quote to the customer before requesting a PO.' }, { status: 400 });
      }

      if (current.quote.po_number) {
        return NextResponse.json({ error: 'A PO number has already been saved for this quote.' }, { status: 400 });
      }

      const selectedRecipientEmails = normalizeEmailList(quoteUpdates.po_request_recipient_emails);
      if (selectedRecipientEmails.length === 0) {
        return NextResponse.json({ error: 'Select at least one customer recipient for the PO request.' }, { status: 400 });
      }

      const allowedRecipientEmails = getQuoteCustomerRecipientEmails(current);
      const allowedRecipientKeys = new Set(allowedRecipientEmails.map(email => email.toLowerCase()));
      const invalidRecipientEmails = selectedRecipientEmails.filter(email => !allowedRecipientKeys.has(email.toLowerCase()));
      if (invalidRecipientEmails.length > 0) {
        return NextResponse.json({ error: 'PO request recipients must be saved customer contacts on this quote.' }, { status: 400 });
      }

      const { data: senderProfile } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      const emailResult = await sendQuotePoRequestEmail({
        bundle: current,
        recipientEmails: selectedRecipientEmails,
        cc: await getQuoteEmailCcEmails(admin, 'quote_po_request_copy', [user.id]),
        senderEmail: user.email,
        senderName: senderProfile?.full_name || null,
      });

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send PO request email.' }, { status: 500 });
      }

      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: 'po_request_sent',
        title: 'PO request sent',
        description: `PO request emailed to ${selectedRecipientEmails.join(', ')}.`,
        fromStatus: current.quote.status,
        toStatus: current.quote.status,
        actorUserId: user.id,
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
        .eq('quote_thread_id', current.quote.quote_thread_id);

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
    } else if (action === 'toggle_sage') {
      if (!await canManageQuoteSage()) {
        return NextResponse.json({ error: 'Only Accounts or admin users can update Sage status.' }, { status: 403 });
      }

      if (typeof quoteUpdates.on_sage !== 'boolean') {
        return NextResponse.json({ error: 'Choose whether this quote is on Sage.' }, { status: 400 });
      }

      const now = new Date().toISOString();
      const nextSagePostedAt = quoteUpdates.on_sage ? now : null;
      const { error } = await supabase
        .from('quotes')
        .update({
          sage_posted_at: nextSagePostedAt,
          sage_posted_by: nextSagePostedAt ? user.id : null,
          updated_by: user.id,
        })
        .eq('quote_thread_id', current.quote.quote_thread_id);

      if (error) throw error;
      await appendQuoteTimelineEvent(admin, {
        quoteId: id,
        quoteThreadId: current.quote.quote_thread_id,
        quoteReference: current.quote.quote_reference,
        eventType: nextSagePostedAt ? 'quote_marked_on_sage' : 'quote_removed_from_sage',
        title: nextSagePostedAt ? 'Quote marked on Sage' : 'Quote removed from Sage',
        description: buildQuoteDisplayName(current.quote),
        fromStatus: current.quote.status,
        toStatus: current.quote.status,
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
        cc: await getQuoteEmailCcEmails(admin, 'quote_rams_request_copy', [user.id]),
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
      const duplicateManagerProfileId = isDuplicate
        ? (typeof manager_profile_id === 'string' && manager_profile_id.trim()
          ? manager_profile_id.trim()
          : current.quote.requester_id || user.id)
        : null;
      let duplicateManagerName = current.quote.manager_name;
      let duplicateManagerEmail = current.quote.manager_email;
      let duplicateRequesterInitials = current.quote.requester_initials;
      let duplicateSignoffName = current.quote.signoff_name;
      let duplicateSignoffTitle = current.quote.signoff_title;

      const quoteReference = isDuplicate
        ? await (async () => {
          const managerOption = await getQuoteManagerOption(duplicateManagerProfileId!);
          const { data: managerProfile, error: managerProfileError } = await admin
            .from('profiles')
            .select('id, full_name')
            .eq('id', duplicateManagerProfileId)
            .single();

          if (managerProfileError || !managerProfile) {
            throw managerProfileError || new Error('Unable to load manager profile');
          }

          const generated = await generateQuoteReferenceForManager({
            managerProfileId: duplicateManagerProfileId!,
            fallbackInitials: managerOption?.initials
              || current.quote.requester_initials
              || getInitialsFromName(managerProfile.full_name || ''),
          });

          duplicateRequesterInitials = generated.initials;
          duplicateManagerName = managerOption?.profile?.full_name || managerProfile.full_name || current.quote.manager_name;
          duplicateManagerEmail = managerOption?.manager_email || current.quote.manager_email;
          duplicateSignoffName = managerOption?.signoff_name || managerProfile.full_name || current.quote.signoff_name;
          duplicateSignoffTitle = managerOption?.signoff_title || current.quote.signoff_title;

          return generated.quoteReference;
        })()
        : buildVersionReference(current.quote.base_quote_reference, revisionType, nextRevisionNumber);
      const baseReference = isDuplicate ? quoteReference : current.quote.base_quote_reference;

      const insertPayload = {
        ...current.quote,
        id: newQuoteId,
        quote_reference: quoteReference,
        base_quote_reference: baseReference,
        quote_thread_id: isDuplicate ? newQuoteId : current.quote.quote_thread_id,
        parent_quote_id: current.quote.id,
        revision_number: isDuplicate ? 0 : nextRevisionNumber,
        revision_type: isDuplicate ? 'original' : revisionType,
        version_label: isDuplicate ? 'Original' : buildVersionLabel(revisionType, nextRevisionNumber),
        version_notes: quoteUpdates.version_notes || null,
        is_latest_version: true,
        duplicate_source_quote_id: current.quote.id,
        requester_id: isDuplicate ? duplicateManagerProfileId : current.quote.requester_id,
        requester_initials: isDuplicate ? duplicateRequesterInitials : current.quote.requester_initials,
        manager_name: isDuplicate ? duplicateManagerName : current.quote.manager_name,
        manager_email: isDuplicate ? duplicateManagerEmail : current.quote.manager_email,
        signoff_name: isDuplicate ? duplicateSignoffName : current.quote.signoff_name,
        signoff_title: isDuplicate ? duplicateSignoffTitle : current.quote.signoff_title,
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
        sage_posted_at: isDuplicate ? null : current.quote.sage_posted_at,
        sage_posted_by: isDuplicate ? null : current.quote.sage_posted_by,
        accepted: false,
        accepted_at: null,
        invoiced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: user.id,
        updated_by: user.id,
      };

      delete (insertPayload as { customer?: unknown }).customer;
      delete (insertPayload as { selected_secondary_contact_ids?: unknown }).selected_secondary_contact_ids;
      delete (insertPayload as { selected_secondary_contacts?: unknown }).selected_secondary_contacts;

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

      await copyQuoteCustomerContactRecipients(
        supabase,
        newQuoteId,
        current.selectedSecondaryContacts,
        user.id
      );

      await appendQuoteTimelineEvent(admin, {
        quoteId: newQuoteId,
        quoteThreadId: isDuplicate ? newQuoteId : current.quote.quote_thread_id,
        quoteReference,
        eventType: isDuplicate ? 'quote_duplicated' : 'version_created',
        title: isDuplicate ? 'Quote duplicated' : 'New version created',
        description: isDuplicate
          ? `Duplicated from ${current.quote.quote_reference}.${quoteUpdates.version_notes ? ` ${String(quoteUpdates.version_notes)}` : ''}`
          : (quoteUpdates.version_notes ? String(quoteUpdates.version_notes) : null),
        toStatus: 'draft',
        actorUserId: user.id,
      });

      const bundle = await fetchQuoteBundle(admin, newQuoteId);
      return NextResponse.json({
        quote: {
          ...bundle.quote,
          can_manage_sage: await canManageQuoteSage(),
          line_items: bundle.lineItems,
          attachments: bundle.attachments,
          invoices: bundle.invoices,
          invoice_requests: bundle.invoiceRequests,
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
      const recipientCustomerId = customerId || current.quote.customer_id;
      const selectedSiteId = 'customer_site_id' in quoteUpdates
        ? normalizeOptionalString(quoteUpdates.customer_site_id)
        : current.quote.customer_site_id;
      const shouldResolveSite = (
        'customer_id' in quoteUpdates
        || 'customer_site_id' in quoteUpdates
        || 'site_address' in quoteUpdates
      );
      const resolvedSite = shouldResolveSite
        ? await resolveCustomerSiteSelection(admin, {
          customerId: recipientCustomerId,
          customerSiteId: selectedSiteId,
          siteAddress: 'site_address' in quoteUpdates
            ? quoteUpdates.site_address
            : current.quote.site_address,
          allowInactive: selectedSiteId === current.quote.customer_site_id,
        })
        : null;
      if (resolvedSite) Object.assign(fieldErrors, resolvedSite.fieldErrors);

      if ('customer_id' in quoteUpdates && !customerId) {
        fieldErrors.customer_id = 'Select a customer.';
      }

      if (typeof manager_profile_id !== 'undefined' && !normalizedManagerProfileId) {
        fieldErrors.manager_profile_id = 'Select a manager.';
      }

      if ('quote_date' in quoteUpdates && !normalizeOptionalString(quoteUpdates.quote_date)) {
        fieldErrors.quote_date = 'Select a quote date.';
      }

      if ('validity_days' in quoteUpdates) {
        const normalizedValidityDays = Number(quoteUpdates.validity_days);
        if (!Number.isFinite(normalizedValidityDays) || normalizedValidityDays < 1) {
          fieldErrors.validity_days = 'Enter quote validity in days.';
        }
      }

      if ('attention_name' in quoteUpdates && !normalizeOptionalString(quoteUpdates.attention_name)) {
        fieldErrors.attention_name = 'Enter who this quote is for the attention of.';
      }

      if ('attention_email' in quoteUpdates && !normalizeOptionalString(quoteUpdates.attention_email)) {
        fieldErrors.attention_email = 'Enter the contact email.';
      }

      if (Number.isNaN(normalizedStartAlertDays)) {
        fieldErrors.start_alert_days = 'Alert days before start must be a whole number.';
      }

      if (Number.isNaN(normalizedEstimatedDurationDays)) {
        fieldErrors.estimated_duration_days = 'Estimated duration must be a whole number.';
      }

      if ('site_address' in quoteUpdates && !resolvedSite?.siteAddress) {
        fieldErrors.site_address = 'Enter the site address for this quote.';
      }

      if ('subject_line' in quoteUpdates && !normalizeOptionalString(quoteUpdates.subject_line)) {
        fieldErrors.subject_line = 'Enter a quote title.';
      }

      if ('project_description' in quoteUpdates && !normalizeOptionalString(quoteUpdates.project_description)) {
        fieldErrors.project_description = 'Enter a quote summary.';
      }

      if ('scope' in quoteUpdates && !normalizeOptionalString(quoteUpdates.scope)) {
        fieldErrors.scope = 'Enter the quote scope.';
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

      if (
        (typeof secondary_contact_ids !== 'undefined' || 'customer_id' in quoteUpdates)
        && recipientCustomerId
        && normalizedSecondaryContactIds.length > 0
      ) {
        Object.assign(
          fieldErrors,
          await validateSecondaryContactIdsForCustomer(admin, recipientCustomerId, normalizedSecondaryContactIds)
        );
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

      if (resolvedSite) {
        updates.customer_site_id = resolvedSite.customerSiteId;
        updates.site_address = resolvedSite.siteAddress;
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
        const managerOption = await getQuoteManagerOption(normalizedManagerProfileId);
        const { data: managerProfile, error: managerProfileError } = await admin
          .from('profiles')
          .select('id, full_name')
          .eq('id', normalizedManagerProfileId)
          .single();

        if (managerProfileError || !managerProfile) {
          throw managerProfileError || new Error('Unable to load manager profile');
        }

        updates.requester_id = normalizedManagerProfileId;
        updates.requester_initials = managerOption?.initials || current.quote.requester_initials;
        updates.manager_name = normalizeOptionalString(quoteUpdates.manager_name)
          || managerOption?.signoff_name
          || managerProfile.full_name;
        updates.manager_email = managerOption?.manager_email || null;
        updates.approver_profile_id = normalizedApproverProfileId
          || managerOption?.approver_profile_id
          || normalizedManagerProfileId;
        updates.signoff_name = normalizeOptionalString(quoteUpdates.signoff_name)
          || managerOption?.signoff_name
          || managerProfile.full_name;
        updates.signoff_title = normalizeOptionalString(quoteUpdates.signoff_title)
          || managerOption?.signoff_title
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

      if (typeof secondary_contact_ids !== 'undefined' || 'customer_id' in quoteUpdates) {
        const recipientFieldErrors = await replaceQuoteCustomerContactRecipients(
          supabase,
          id,
          recipientCustomerId,
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
    const canManageSage = await canManageQuoteSage();
    return NextResponse.json({
      quote: {
        ...bundle.quote,
        can_manage_sage: canManageSage,
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

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

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
