import pg from 'pg';
import { renderToStream } from '@react-pdf/renderer';
import { QuotePDF } from '@/lib/pdf/quote-pdf';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';
import { getQuotesCustomersEmailConfig } from '@/lib/server/quotes-customers-email-config';
import { sendResendEmail } from '@/lib/server/resend';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';
import {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  getInvoiceSummary,
  type InvoiceSummary,
} from '@/lib/utils/quote-workflow';

const { Client } = pg;

export type QuoteRow = Database['public']['Tables']['quotes']['Row'];
export type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];
export type QuoteAttachmentRow = Database['public']['Tables']['quote_attachments']['Row'];
export type QuoteInvoiceRow = Database['public']['Tables']['quote_invoices']['Row'];
export type QuoteInvoiceAllocationRow = Database['public']['Tables']['quote_invoice_allocations']['Row'];
export type QuoteManagerSeriesRow = Database['public']['Tables']['quote_manager_series']['Row'];
export type QuoteTimelineEventRow = Database['public']['Tables']['quote_timeline_events']['Row'];
export type RamsDocumentRow = Database['public']['Tables']['rams_documents']['Row'];

interface QuoteManagerOption {
  profile_id: string;
  initials: string;
  next_number: number;
  number_start: number;
  signoff_name: string | null;
  signoff_title: string | null;
  manager_email: string | null;
  approver_profile_id: string | null;
  is_active: boolean;
  profile?: {
    id: string;
    full_name: string | null;
    email?: string | null;
  } | null;
  approver?: {
    id: string;
    full_name: string | null;
    email?: string | null;
  } | null;
}

export interface QuoteBundle {
  quote: QuoteRow & {
    customer?: {
      id: string;
      company_name: string;
      short_name: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      address_line_1?: string | null;
      address_line_2?: string | null;
      city?: string | null;
      county?: string | null;
      postcode?: string | null;
    } | null;
  };
  lineItems: QuoteLineItemRow[];
  attachments: QuoteAttachmentRow[];
  ramsDocuments: RamsDocumentRow[];
  invoices: Array<QuoteInvoiceRow & { allocations: QuoteInvoiceAllocationRow[] }>;
  versions: QuoteRow[];
  timeline: Array<QuoteTimelineEventRow & { actor?: { id: string; full_name: string | null } | null }>;
  invoiceSummary: InvoiceSummary;
}

export async function appendQuoteTimelineEvent(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    quoteId: string;
    quoteThreadId: string;
    quoteReference: string;
    eventType: string;
    title: string;
    description?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    actorUserId?: string | null;
    createdAt?: string;
  }
) {
  const { error } = await supabase.from('quote_timeline_events').insert({
    quote_id: input.quoteId,
    quote_thread_id: input.quoteThreadId,
    quote_reference: input.quoteReference,
    event_type: input.eventType,
    title: input.title,
    description: input.description ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    actor_user_id: input.actorUserId ?? null,
    created_at: input.createdAt ?? new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to append quote timeline event:', error);
  }
}

function getConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for quote number generation');
  }
  return connectionString;
}

function createPgClient(): pg.Client {
  const url = new URL(getConnectionString());
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

export async function listQuoteManagerOptions(): Promise<QuoteManagerOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('quote_manager_series')
    .select(`
      *,
      profile:profiles!quote_manager_series_profile_id_fkey(id, full_name),
      approver:profiles!quote_manager_series_approver_profile_id_fkey(id, full_name)
    `)
    .order('initials');

  if (error) {
    throw error;
  }

  return (data || []) as QuoteManagerOption[];
}

export async function getQuoteManagerOption(profileId: string): Promise<QuoteManagerOption | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('quote_manager_series')
    .select(`
      *,
      profile:profiles!quote_manager_series_profile_id_fkey(id, full_name),
      approver:profiles!quote_manager_series_approver_profile_id_fkey(id, full_name)
    `)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as QuoteManagerOption | null) || null;
}

export async function generateQuoteReferenceForManager(params: {
  managerProfileId: string;
  fallbackInitials?: string | null;
}): Promise<{ quoteReference: string; initials: string }> {
  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from('quote_manager_series')
    .select('*')
    .eq('profile_id', params.managerProfileId)
    .single();

  if (error || !config) {
    const fallbackInitials = (params.fallbackInitials || 'XX').toUpperCase().slice(0, 10);
    const legacyReference = await generateLegacyQuoteReference(fallbackInitials);
    return { quoteReference: legacyReference, initials: fallbackInitials };
  }

  const client = createPgClient();
  await client.connect();

  try {
    const result = await client.query<{ issued_number: number }>(
      `
      UPDATE quote_manager_series
      SET
        next_number = next_number + 1,
        updated_at = NOW()
      WHERE profile_id = $1
      RETURNING next_number - 1 AS issued_number
      `,
      [params.managerProfileId]
    );

    const issued = result.rows[0]?.issued_number;
    if (typeof issued !== 'number') {
      throw new Error('Failed to allocate manager quote number');
    }

    return {
      quoteReference: `${issued}-${config.initials}`,
      initials: config.initials,
    };
  } finally {
    await client.end();
  }
}

async function generateLegacyQuoteReference(initials: string): Promise<string> {
  const key = initials.toUpperCase().slice(0, 10);
  const client = createPgClient();
  await client.connect();

  try {
    const result = await client.query<{ issued_number: number }>(
      `
      WITH upsert AS (
        INSERT INTO quote_sequences (requester_initials, next_number)
        VALUES ($1, 6001)
        ON CONFLICT (requester_initials)
        DO UPDATE
        SET
          next_number = quote_sequences.next_number + 1,
          updated_at = NOW()
        RETURNING next_number
      )
      SELECT
        CASE
          WHEN next_number = 6001 THEN 6000
          ELSE next_number - 1
        END AS issued_number
      FROM upsert
      `,
      [key]
    );

    const issued = result.rows[0]?.issued_number;
    if (typeof issued !== 'number') {
      throw new Error('Failed to allocate quote sequence number');
    }

    return `${issued}-${key}`;
  } finally {
    await client.end();
  }
}

export function getInitialsFromName(fullName: string): string {
  const normalizedName = fullName.trim();
  if (!normalizedName) return 'XX';
  const parts = normalizedName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  return `${parts[0]?.[0] || ''}${parts[parts.length - 1]?.[0] || ''}`.toUpperCase();
}

export async function fetchQuoteBundle(supabase: ReturnType<typeof createAdminClient>, quoteId: string): Promise<QuoteBundle> {
  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(
        id,
        company_name,
        short_name,
        contact_name,
        contact_email,
        address_line_1,
        address_line_2,
        city,
        county,
        postcode
      )
    `)
    .eq('id', quoteId)
    .single();

  if (error || !quote) {
    throw error || new Error('Quote not found');
  }

  const typedQuote = quote as QuoteBundle['quote'];

  const [lineItemsResult, attachmentsResult, ramsDocumentsResult, versionsResult, invoicesResult, timelineResult] = await Promise.all([
    supabase.from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order', { ascending: true }),
    supabase.from('quote_attachments').select('*').eq('quote_id', quoteId).order('created_at', { ascending: false }),
    supabase.from('rams_documents').select('*').eq('quote_id', quoteId).order('created_at', { ascending: false }),
    supabase.from('quotes').select('*').eq('quote_thread_id', typedQuote.quote_thread_id).order('created_at', { ascending: false }),
    supabase.from('quote_invoices').select('*').eq('quote_id', quoteId).order('invoice_date', { ascending: false }),
    supabase
      .from('quote_timeline_events')
      .select(`
        *,
        actor:profiles!quote_timeline_events_actor_user_id_fkey(id, full_name)
      `)
      .eq('quote_thread_id', typedQuote.quote_thread_id)
      .order('created_at', { ascending: false }),
  ]);

  if (lineItemsResult.error) throw lineItemsResult.error;
  if (attachmentsResult.error) throw attachmentsResult.error;
  if (ramsDocumentsResult.error) throw ramsDocumentsResult.error;
  if (versionsResult.error) throw versionsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;
  if (timelineResult.error) throw timelineResult.error;

  const invoices = (invoicesResult.data || []) as QuoteInvoiceRow[];
  const invoiceIds = invoices.map(invoice => invoice.id);
  const allocationsByInvoice = new Map<string, QuoteInvoiceAllocationRow[]>();

  if (invoiceIds.length > 0) {
    const { data: allocations, error: allocationsError } = await supabase
      .from('quote_invoice_allocations')
      .select('*')
      .in('quote_invoice_id', invoiceIds);

    if (allocationsError) throw allocationsError;

    for (const allocation of (allocations || []) as QuoteInvoiceAllocationRow[]) {
      const list = allocationsByInvoice.get(allocation.quote_invoice_id) || [];
      list.push(allocation);
      allocationsByInvoice.set(allocation.quote_invoice_id, list);
    }
  }

  const invoiceSummary = getInvoiceSummary({
    total: Number(typedQuote.total || 0),
    invoices,
  });

  return {
    quote: typedQuote,
    lineItems: (lineItemsResult.data || []) as QuoteLineItemRow[],
    attachments: (attachmentsResult.data || []) as QuoteAttachmentRow[],
    ramsDocuments: (ramsDocumentsResult.data || []) as RamsDocumentRow[],
    versions: (versionsResult.data || []) as QuoteRow[],
    timeline: (timelineResult.data || []) as QuoteBundle['timeline'],
    invoices: invoices.map(invoice => ({
      ...invoice,
      allocations: allocationsByInvoice.get(invoice.id) || [],
    })),
    invoiceSummary,
  };
}

interface EmailAttachment {
  filename: string;
  content: string;
}

async function sendEmail(params: {
  from?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ success: boolean; error?: string }> {
  const { apiKey, fromEmail } = getQuotesCustomersEmailConfig();
  if (!apiKey) {
    return { success: false, error: 'Email service not configured' };
  }

  const response = await sendResendEmail({
    apiKey,
    payload: {
      from: params.from || fromEmail,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments,
    },
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    return { success: false, error: error.message || 'Failed to send email' };
  }

  return { success: true };
}

function getDefaultFromEmail(): string {
  return getQuotesCustomersEmailConfig().fromEmail;
}

export async function renderQuotePdfAttachment(bundle: QuoteBundle): Promise<EmailAttachment> {
  const logoSrc = await loadTemplateLogoDataUrl();

  const pdfDocument = QuotePDF({
    quoteReference: bundle.quote.quote_reference,
    baseQuoteReference: bundle.quote.base_quote_reference,
    quoteDate: bundle.quote.quote_date,
    attentionName: bundle.quote.attention_name || '',
    attentionEmail: bundle.quote.attention_email || '',
    salutation: bundle.quote.salutation || '',
    projectDescription: bundle.quote.project_description || '',
    subjectLine: bundle.quote.subject_line || '',
    scope: bundle.quote.scope || '',
    siteAddress: bundle.quote.site_address || '',
    managerEmail: bundle.quote.manager_email || '',
    lineItems: bundle.lineItems.map(item => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unit_rate: Number(item.unit_rate),
      line_total: Number(item.line_total),
    })),
    total: Number(bundle.quote.total),
    pricingMode: bundle.quote.pricing_mode || 'itemized',
    validityDays: bundle.quote.validity_days || 30,
    signoffName: bundle.quote.signoff_name || '',
    signoffTitle: bundle.quote.signoff_title || '',
    versionLabel: bundle.quote.version_label || buildVersionLabel(bundle.quote.revision_type, bundle.quote.revision_number),
    customFooterText: bundle.quote.custom_footer_text || undefined,
    logoSrc,
  });

  const stream = await renderToStream(pdfDocument);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    filename: `Quote_${bundle.quote.quote_reference.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`,
    content: Buffer.concat(chunks).toString('base64'),
  };
}

async function renderClientVisibleQuoteAttachments(bundle: QuoteBundle): Promise<EmailAttachment[]> {
  const admin = createAdminClient();
  const clientVisibleAttachments = bundle.attachments.filter(attachment => attachment.is_client_visible);

  const attachments = await Promise.all(clientVisibleAttachments.map(async (attachment) => {
    const { data, error } = await admin.storage
      .from('quote-attachments')
      .download(attachment.file_path);

    if (error || !data) {
      throw error || new Error(`Unable to download attachment ${attachment.file_name}`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      filename: attachment.file_name,
      content: buffer.toString('base64'),
    };
  }));

  return attachments;
}

export async function sendQuoteToCustomerEmail(bundle: QuoteBundle, cc: string[]) {
  const quotePdfAttachment = await renderQuotePdfAttachment(bundle);
  const clientAttachments = await renderClientVisibleQuoteAttachments(bundle);
  const customerEmail = bundle.quote.attention_email?.trim() || bundle.quote.customer?.contact_email?.trim() || '';
  if (!customerEmail) {
    return { success: false, error: 'Quote cannot be sent because the customer does not have a contact email.' };
  }

  const customerName = bundle.quote.attention_name || bundle.quote.customer?.contact_name || 'there';
  const subject = `Quotation ${bundle.quote.quote_reference} - ${bundle.quote.subject_line || bundle.quote.customer?.company_name || 'FieldOps Template'}`;
  const pricingCopy = bundle.quote.pricing_mode === 'attachments_only'
    ? '<p>Pricing and supporting details are included in the attached documents.</p>'
    : '';
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Quotation ${bundle.quote.quote_reference}</h2>
        <p>Hello ${customerName},</p>
        <p>Please find attached our quotation for <strong>${bundle.quote.subject_line || 'the requested works'}</strong>.</p>
        ${pricingCopy}
        <p>If you have any queries, please reply to this email and we will be happy to help.</p>
        <p>Kind regards,<br>${bundle.quote.signoff_name || 'FieldOps Template'}${bundle.quote.signoff_title ? `<br>${bundle.quote.signoff_title}` : ''}</p>
      </body>
    </html>
  `;

  return sendEmail({
    from: getDefaultFromEmail(),
    to: [customerEmail],
    cc: cc.filter(Boolean),
    subject,
    html,
    attachments: [quotePdfAttachment, ...clientAttachments],
  });
}

export async function sendQuoteApprovalRequestEmail(params: {
  approverEmail: string;
  managerName: string;
  quoteReference: string;
  customerName: string;
  subjectLine: string;
}) {
  return sendEmail({
    to: [params.approverEmail],
    subject: `Quote approval required: ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>Quote approval required</h2>
          <p>${params.managerName} has submitted quote <strong>${params.quoteReference}</strong> for approval.</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>Scope:</strong> ${params.subjectLine}</p>
        </body>
      </html>
    `,
  });
}

export async function sendQuoteRamsRequestEmail(params: {
  quoteReference: string;
  customerName: string;
  subjectLine: string;
  scope?: string | null;
  poNumber: string;
  managerName: string;
  internalNotes?: string | null;
  completionComments?: string | null;
  siteAddress?: string | null;
  startDate?: string | null;
  estimatedDurationDays?: number | null;
  ramsComments?: string | null;
}) {
  return sendEmail({
    to: ['conway@example.com'],
    subject: `RAMS required for ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>RAMS requested</h2>
          <p>The following job now requires RAMS to be produced.</p>
          <p><strong>Quote:</strong> ${params.quoteReference}</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>PO Number:</strong> ${params.poNumber}</p>
          <p><strong>Title:</strong> ${params.subjectLine}</p>
          ${params.scope ? `<p><strong>Scope:</strong><br>${params.scope.replace(/\n/g, '<br>')}</p>` : ''}
          <p><strong>Manager:</strong> ${params.managerName}</p>
          ${params.siteAddress ? `<p><strong>Site Address:</strong><br>${params.siteAddress.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.startDate ? `<p><strong>Start Date:</strong> ${params.startDate}</p>` : ''}
          ${params.estimatedDurationDays !== null && typeof params.estimatedDurationDays !== 'undefined' ? `<p><strong>Estimated Duration:</strong> ${params.estimatedDurationDays} day(s)</p>` : ''}
          ${params.internalNotes ? `<p><strong>Internal Notes:</strong><br>${params.internalNotes.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.completionComments ? `<p><strong>Completion Notes:</strong><br>${params.completionComments.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.ramsComments ? `<p><strong>Additional RAMS Comments:</strong><br>${params.ramsComments.replace(/\n/g, '<br>')}</p>` : ''}
        </body>
      </html>
    `,
  });
}

export async function sendQuoteStartAlertEmail(params: {
  to: string;
  managerName: string;
  quoteReference: string;
  customerName: string;
  subjectLine: string;
  startDate: string;
}) {
  return sendEmail({
    to: [params.to],
    subject: `Upcoming job start: ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>Job start reminder</h2>
          <p>Hello ${params.managerName},</p>
          <p>This is a reminder that quote <strong>${params.quoteReference}</strong> is due to start on <strong>${params.startDate}</strong>.</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>Scope:</strong> ${params.subjectLine}</p>
        </body>
      </html>
    `,
  });
}

export async function createQuoteNotification(params: {
  senderId: string;
  recipientIds: string[];
  subject: string;
  body: string;
}) {
  if (params.recipientIds.length === 0) {
    return;
  }

  const admin = createAdminClient();
  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      priority: 'HIGH',
      subject: params.subject,
      body: params.body,
      sender_id: params.senderId,
    })
    .select()
    .single();

  if (messageError || !message) {
    throw messageError || new Error('Failed to create notification');
  }

  const { error: recipientsError } = await admin
    .from('message_recipients')
    .insert(params.recipientIds.map(recipientId => ({
      message_id: message.id,
      user_id: recipientId,
      status: 'PENDING',
    })));

  if (recipientsError) {
    throw recipientsError;
  }
}

export {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  getInvoiceSummary,
};
