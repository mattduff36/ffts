import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  appendQuoteTimelineEvent,
  createQuoteNotification,
  fetchQuoteBundle,
  getQuoteInvoiceNotificationRecipientIds,
} from '@/lib/server/quote-workflow';
import { buildInvoiceAddedTimelineDescription } from '@/lib/quotes/quote-timeline-comments';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { buildQuoteDisplayName } from '@/lib/quotes/quote-display-name';
import { renderConfiguredQuoteEmailTemplate } from '@/lib/server/quote-email-templates';

type InvoiceFieldErrors = Record<string, string>;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    const bundle = await fetchQuoteBundle(createAdminClient(), id);
    return NextResponse.json({
      invoices: bundle.invoices,
      invoice_requests: bundle.invoiceRequests,
      invoice_summary: bundle.invoiceSummary,
    });
  } catch (error) {
    console.error('Error fetching quote invoices:', error);
    return NextResponse.json({ error: 'Unable to load invoices right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    const body = await request.json() as {
      invoice_request_id?: string;
      invoice_number?: string;
      invoice_date?: string;
      amount?: number;
      invoice_scope?: 'full' | 'partial';
      confirm_matches_request?: boolean;
      comments?: string;
      allocations?: Array<{
        quote_line_item_id?: string | null;
        quantity_invoiced?: number | null;
        amount_invoiced: number;
        comments?: string | null;
      }>;
    };

    const fieldErrors: InvoiceFieldErrors = {};
    const normalizedInvoiceNumber = typeof body.invoice_number === 'string' ? body.invoice_number.trim() : '';
    const normalizedComments = typeof body.comments === 'string' ? body.comments.trim() || null : null;
    const normalizedInvoiceDate = typeof body.invoice_date === 'string' && body.invoice_date.trim()
      ? body.invoice_date.trim()
      : new Date().toISOString().slice(0, 10);
    const normalizedAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const normalizedInvoiceScope = body.invoice_scope === 'full' ? 'full' : 'partial';

    if (!normalizedInvoiceNumber) {
      fieldErrors.invoice_number = 'Enter an invoice number.';
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      fieldErrors.amount = 'Enter an invoice amount greater than 0.';
    }

    if (!normalizedInvoiceDate) {
      fieldErrors.invoice_date = 'Enter an invoice date.';
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

    const bundleBeforeInsert = await fetchQuoteBundle(admin, id);
    if (!bundleBeforeInsert.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can be invoiced.' }, { status: 400 });
    }

    const quoteInvoiceRequests = bundleBeforeInsert.invoiceRequests || [];
    const linkedRequest = body.invoice_request_id
      ? quoteInvoiceRequests.find(request => request.id === body.invoice_request_id)
      : null;

    if (body.invoice_request_id && !linkedRequest) {
      return NextResponse.json({ error: 'Invoice request not found for this quote.' }, { status: 400 });
    }

    if (linkedRequest) {
      if (linkedRequest.status !== 'pending') {
        return NextResponse.json({ error: 'This invoice request has already been processed.' }, { status: 400 });
      }

      if (body.confirm_matches_request !== true) {
        return NextResponse.json(
          {
            error: 'Confirm the invoice details match the manager request before adding them.',
            field_errors: {
              confirm_matches_request: 'Confirm the invoice details match the manager request.',
            },
          },
          { status: 400 }
        );
      }

      const requestedAmount = Number(linkedRequest.requested_amount || 0);
      if (Math.abs(normalizedAmount - requestedAmount) > 0.005) {
        return NextResponse.json(
          {
            error: 'Invoice amount must match the manager request.',
            field_errors: {
              amount: `Requested amount is £${requestedAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}.`,
            },
          },
          { status: 400 }
        );
      }

      if (normalizedInvoiceDate !== linkedRequest.requested_invoice_date) {
        return NextResponse.json(
          {
            error: 'Invoice date must match the manager request.',
            field_errors: {
              invoice_date: `Requested date is ${linkedRequest.requested_invoice_date}.`,
            },
          },
          { status: 400 }
        );
      }

      if (normalizedInvoiceScope !== linkedRequest.requested_invoice_scope) {
        return NextResponse.json(
          {
            error: 'Invoice scope must match the manager request.',
            field_errors: {
              invoice_scope: `Requested scope is ${linkedRequest.requested_invoice_scope}.`,
            },
          },
          { status: 400 }
        );
      }
    }

    const remainingBalance = Number(bundleBeforeInsert.invoiceSummary.remainingBalance || 0);

    if (normalizedAmount - remainingBalance > 0.005) {
      return NextResponse.json(
        {
          error: 'Invoice amount cannot be more than the remaining balance. Create a new version first if the amount has increased.',
          field_errors: {
            amount: `This quote has £${remainingBalance.toLocaleString('en-GB', { minimumFractionDigits: 2 })} remaining.`,
          },
        },
        { status: 400 }
      );
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('quote_invoices')
      .insert({
        quote_id: id,
        invoice_request_id: linkedRequest?.id || null,
        invoice_number: normalizedInvoiceNumber,
        invoice_date: normalizedInvoiceDate,
        amount: normalizedAmount,
        invoice_scope: normalizedInvoiceScope,
        comments: normalizedComments,
        created_by: user.id,
      })
      .select()
      .single();

    if (invoiceError || !invoice) throw invoiceError;

    if (body.allocations?.length) {
      const { error: allocationError } = await supabase
        .from('quote_invoice_allocations')
        .insert(
          body.allocations.map(allocation => ({
            quote_invoice_id: invoice.id,
            quote_line_item_id: allocation.quote_line_item_id || null,
            quantity_invoiced: allocation.quantity_invoiced ?? null,
            amount_invoiced: allocation.amount_invoiced,
            comments: allocation.comments || null,
          }))
        );

      if (allocationError) throw allocationError;
    }

    if (linkedRequest) {
      const fulfilledAt = new Date().toISOString();
      const { error: requestUpdateError } = await supabase
        .from('quote_invoice_requests')
        .update({
          status: 'fulfilled',
          fulfilled_invoice_id: invoice.id,
          fulfilled_by: user.id,
          fulfilled_at: fulfilledAt,
        })
        .eq('id', linkedRequest.id)
        .eq('status', 'pending');

      if (requestUpdateError) {
        await admin
          .from('quote_invoices')
          .delete()
          .eq('id', invoice.id);

        throw requestUpdateError;
      }
    }

    const bundleAfterInsert = await fetchQuoteBundle(admin, id);
    const isFullyInvoiced = bundleAfterInsert.invoiceSummary.remainingBalance <= 0;

    const { error: quoteUpdateError } = await supabase
      .from('quotes')
      .update({
        invoice_number: invoice.invoice_number,
        invoice_notes: invoice.comments,
        last_invoice_at: invoice.invoice_date,
        invoiced_at: isFullyInvoiced ? new Date().toISOString() : bundleBeforeInsert.quote.invoiced_at,
        updated_by: user.id,
      })
      .eq('id', id);

    if (quoteUpdateError) {
      // Best-effort compensation: remove the invoice we just created so the quote
      // does not end up with invoice rows but unchanged status metadata.
      await admin
        .from('quote_invoices')
        .delete()
        .eq('id', invoice.id);

      if (linkedRequest) {
        await admin
          .from('quote_invoice_requests')
          .update({
            status: 'pending',
            fulfilled_invoice_id: null,
            fulfilled_by: null,
            fulfilled_at: null,
          })
          .eq('id', linkedRequest.id);
      }

      throw quoteUpdateError;
    }

    const refreshedBundle = await fetchQuoteBundle(admin, id);
    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: refreshedBundle.quote.quote_thread_id,
      quoteReference: refreshedBundle.quote.quote_reference,
      eventType: 'invoice_added',
      title: 'Invoice added',
      description: buildInvoiceAddedTimelineDescription({
        invoiceNumber: invoice.invoice_number,
        amount: Number(invoice.amount),
        comments: invoice.comments,
      }),
      fromStatus: bundleBeforeInsert.quote.status,
      toStatus: bundleBeforeInsert.quote.status,
      actorUserId: user.id,
      createdAt: invoice.created_at,
    });

    const managerRecipientId = refreshedBundle.quote.requester_id || linkedRequest?.requested_by || null;
    const additionalRecipientIds = await getQuoteInvoiceNotificationRecipientIds(admin, 'invoice_added', [
      user.id,
      managerRecipientId,
    ]);
    const invoiceAddedTemplate = await renderConfiguredQuoteEmailTemplate(admin, 'invoice_added', {
      quote_reference: refreshedBundle.quote.quote_reference,
      quote_name: buildQuoteDisplayName(refreshedBundle.quote),
      customer_name: refreshedBundle.quote.customer?.company_name || 'Unknown customer',
      invoice_number: invoice.invoice_number,
      invoice_amount: `£${Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
      invoice_date: invoice.invoice_date,
      invoice_scope: invoice.invoice_scope === 'full' ? 'Full invoice' : 'Partial invoice',
      invoice_comments: invoice.comments || '',
      invoice_comments_block: invoice.comments ? `Comments: ${invoice.comments}` : '',
    });
    if (managerRecipientId && managerRecipientId !== user.id) {
      try {
        await createQuoteNotification({
          senderId: user.id,
          recipientIds: [managerRecipientId],
          subject: invoiceAddedTemplate.subject,
          body: invoiceAddedTemplate.bodyText,
          sendEmail: true,
          emailCcType: 'quote_invoice_added_copy',
        });
      } catch (notificationError) {
        console.error('Failed to notify quote manager about invoice details:', notificationError);
      }
    }

    if (additionalRecipientIds.length > 0) {
      try {
        await createQuoteNotification({
          senderId: user.id,
          recipientIds: additionalRecipientIds,
          subject: invoiceAddedTemplate.subject,
          body: invoiceAddedTemplate.bodyText,
          sendEmail: true,
          emailCcType: 'quote_invoice_added_copy',
        });
      } catch (notificationError) {
        console.error('Failed to notify quote invoice notification recipients:', notificationError);
      }
    }

    return NextResponse.json({
      invoices: refreshedBundle.invoices,
      invoice_requests: refreshedBundle.invoiceRequests,
      invoice_summary: refreshedBundle.invoiceSummary,
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding quote invoice:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to add this invoice right now.' },
      { status: 500 }
    );
  }
}
