import type { createAdminClient } from '@/lib/supabase/admin';
import { QUOTE_VAT_RATE_NOTICE } from '@/lib/quotes/quote-vat-notice';
import type { Database } from '@/types/database';

export const QUOTE_EMAIL_TEMPLATE_KEYS = [
  'customer_quote',
  'po_request',
  'approval_request',
  'rams_request',
  'start_alert',
  'quote_returned',
  'invoice_request',
  'invoice_added',
  'start_alert_copy',
] as const;

export type QuoteEmailTemplateKey = typeof QUOTE_EMAIL_TEMPLATE_KEYS[number];

export interface QuoteEmailTemplateDefinition {
  template_key: QuoteEmailTemplateKey;
  label: string;
  description: string;
  placeholders: string[];
  sample_context: Record<string, string>;
  default_subject_template: string;
  default_body_template: string;
}

export interface QuoteEmailTemplateView extends QuoteEmailTemplateDefinition {
  subject_template: string;
  body_template: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface RenderedQuoteEmailTemplate {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

type QuoteEmailTemplateRow = Database['public']['Tables']['quote_email_templates']['Row'];
type SupabaseAdmin = ReturnType<typeof createAdminClient>;

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

export const QUOTE_EMAIL_TEMPLATE_DEFINITIONS: QuoteEmailTemplateDefinition[] = [
  {
    template_key: 'customer_quote',
    label: 'Customer quote email',
    description: 'Sent to customer contacts when a quote is confirmed and sent.',
    placeholders: ['quote_reference', 'quote_name', 'contact_name', 'customer_name', 'subject_line', 'pricing_note', 'signoff_name', 'signoff_title'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      contact_name: 'Alex Customer',
      customer_name: 'Example Customer',
      subject_line: 'Concrete Bund Wall Repairs',
      pricing_note: 'Pricing and supporting details are included in the attached documents.',
      signoff_name: 'Example Manager',
      signoff_title: 'Contracts Manager',
    },
    default_subject_template: '{quote_name}',
    default_body_template: [
      'Hello {contact_name},',
      '',
      'Please find attached our quotation for {subject_line}.',
      '{pricing_note}',
      QUOTE_VAT_RATE_NOTICE,
      'If you have any queries, please reply to this email and we will be happy to help.',
      '',
      'Kind regards,',
      '{signoff_name}',
      '{signoff_title}',
    ].join('\n'),
  },
  {
    template_key: 'po_request',
    label: 'Purchase order request',
    description: 'Sent to selected customer contacts from the quote details modal.',
    placeholders: ['quote_reference', 'quote_name', 'contact_name', 'customer_name', 'sender_name'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      contact_name: 'Alex Customer',
      customer_name: 'Example Customer',
      sender_name: 'Example Manager',
    },
    default_subject_template: '{quote_name}',
    default_body_template: [
      'Hello {contact_name},',
      '',
      'Please can I have a purchase order for the attached quotation.',
      QUOTE_VAT_RATE_NOTICE,
      '',
      'Kind Regards',
      '{sender_name}',
    ].join('\n'),
  },
  {
    template_key: 'approval_request',
    label: 'Quote approval request',
    description: 'Sent to an approver when a quote manager submits a quote for approval.',
    placeholders: ['quote_reference', 'quote_name', 'manager_name', 'customer_name', 'subject_line'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      manager_name: 'Example Manager',
      customer_name: 'Example Customer',
      subject_line: 'Concrete Bund Wall Repairs',
    },
    default_subject_template: 'Quote approval required: {quote_reference}',
    default_body_template: [
      '{manager_name} has submitted quote {quote_reference} for approval.',
      '',
      'Customer: {customer_name}',
      'Scope: {subject_line}',
    ].join('\n'),
  },
  {
    template_key: 'rams_request',
    label: 'RAMS request',
    description: 'Sent internally when RAMS are requested for a quote.',
    placeholders: [
      'quote_reference',
      'quote_name',
      'customer_name',
      'po_number',
      'subject_line',
      'scope',
      'scope_block',
      'manager_name',
      'site_address',
      'site_address_block',
      'start_date',
      'start_date_block',
      'estimated_duration_days',
      'estimated_duration_block',
      'internal_notes',
      'internal_notes_block',
      'completion_comments',
      'completion_comments_block',
      'rams_comments',
      'rams_comments_block',
    ],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      customer_name: 'Example Customer',
      po_number: '967934102',
      subject_line: 'Concrete Bund Wall Repairs',
      scope: 'Prepare site and complete concrete repairs.',
      scope_block: 'Scope:\nPrepare site and complete concrete repairs.',
      manager_name: 'Example Manager',
      site_address: '1 Example Road',
      site_address_block: 'Site Address:\n1 Example Road',
      start_date: '2026-06-15',
      start_date_block: 'Start Date: 2026-06-15',
      estimated_duration_days: '3 day(s)',
      estimated_duration_block: 'Estimated Duration: 3 day(s)',
      internal_notes: 'Gate access required.',
      internal_notes_block: 'Internal Notes:\nGate access required.',
      completion_comments: 'Approved in full.',
      completion_comments_block: 'Completion Notes:\nApproved in full.',
      rams_comments: 'Include traffic management.',
      rams_comments_block: 'Additional RAMS Comments:\nInclude traffic management.',
    },
    default_subject_template: 'RAMS required for {quote_reference}',
    default_body_template: [
      'The following job now requires RAMS to be produced.',
      '',
      'Quote: {quote_reference}',
      'Customer: {customer_name}',
      'PO Number: {po_number}',
      'Title: {subject_line}',
      '{scope_block}',
      'Manager: {manager_name}',
      '{site_address_block}',
      '{start_date_block}',
      '{estimated_duration_block}',
      '{internal_notes_block}',
      '{completion_comments_block}',
      '{rams_comments_block}',
    ].join('\n'),
  },
  {
    template_key: 'start_alert',
    label: 'Job start alert',
    description: 'Sent to the quote manager when a scheduled job start is approaching.',
    placeholders: ['quote_reference', 'quote_name', 'manager_name', 'customer_name', 'subject_line', 'start_date'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      manager_name: 'Example Manager',
      customer_name: 'Example Customer',
      subject_line: 'Concrete Bund Wall Repairs',
      start_date: '2026-06-15',
    },
    default_subject_template: 'Upcoming job start: {quote_reference}',
    default_body_template: [
      'Hello {manager_name},',
      '',
      'This is a reminder that quote {quote_reference} is due to start on {start_date}.',
      '',
      'Customer: {customer_name}',
      'Scope: {subject_line}',
    ].join('\n'),
  },
  {
    template_key: 'quote_returned',
    label: 'Quote returned for changes',
    description: 'Sent to the quote requester when an approver returns a quote for changes.',
    placeholders: ['quote_reference', 'quote_name', 'return_comments'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      return_comments: 'Please update the scope before sending.',
    },
    default_subject_template: 'Quote returned: {quote_reference}',
    default_body_template: '{return_comments}',
  },
  {
    template_key: 'invoice_request',
    label: 'Ready to invoice',
    description: 'Sent to Accounts/copy recipients when a quote is marked ready to invoice.',
    placeholders: ['quote_reference', 'quote_name', 'customer_name', 'invoice_amount', 'invoice_date', 'invoice_scope', 'invoice_comments', 'invoice_comments_block'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      customer_name: 'Example Customer',
      invoice_amount: '£4,000.00',
      invoice_date: '2026-06-03',
      invoice_scope: 'Partial invoice',
      invoice_comments: 'Please invoice the first phase.',
      invoice_comments_block: 'Comments: Please invoice the first phase.',
    },
    default_subject_template: 'Ready to invoice: {quote_reference}',
    default_body_template: [
      'Quote {quote_reference} is ready to invoice.',
      '',
      'Customer: {customer_name}',
      'Amount: {invoice_amount}',
      'Date: {invoice_date}',
      'Scope: {invoice_scope}',
      '{invoice_comments_block}',
    ].join('\n'),
  },
  {
    template_key: 'invoice_added',
    label: 'Invoice details added',
    description: 'Sent to the quote manager/copy recipients when Accounts add invoice details.',
    placeholders: ['quote_reference', 'quote_name', 'customer_name', 'invoice_number', 'invoice_amount', 'invoice_date', 'invoice_scope', 'invoice_comments', 'invoice_comments_block'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      customer_name: 'Example Customer',
      invoice_number: 'INV-1001',
      invoice_amount: '£4,000.00',
      invoice_date: '2026-06-03',
      invoice_scope: 'Partial invoice',
      invoice_comments: 'Invoice added by Accounts.',
      invoice_comments_block: 'Comments: Invoice added by Accounts.',
    },
    default_subject_template: 'Invoice details added: {quote_reference}',
    default_body_template: [
      'Invoice details have been added for quote {quote_reference}.',
      '',
      'Customer: {customer_name}',
      'Invoice: {invoice_number}',
      'Amount: {invoice_amount}',
      'Date: {invoice_date}',
      'Scope: {invoice_scope}',
      '{invoice_comments_block}',
    ].join('\n'),
  },
  {
    template_key: 'start_alert_copy',
    label: 'Job start alert copy',
    description: 'Sent to configured copy recipients when a start alert is generated.',
    placeholders: ['quote_reference', 'quote_name', 'start_date', 'customer_name', 'subject_line'],
    sample_context: {
      quote_reference: '40001-EX',
      quote_name: '40001-EX - Example Customer - 1 Example Road - Concrete Bund Wall Repairs',
      start_date: '2026-06-15',
      customer_name: 'Example Customer',
      subject_line: 'Concrete Bund Wall Repairs',
    },
    default_subject_template: 'Job start reminder: {quote_reference}',
    default_body_template: 'Quote {quote_reference} is due to start on {start_date}.',
  },
];

const DEFINITION_BY_KEY = new Map(QUOTE_EMAIL_TEMPLATE_DEFINITIONS.map(definition => [definition.template_key, definition]));

export function isQuoteEmailTemplateKey(value: unknown): value is QuoteEmailTemplateKey {
  return typeof value === 'string' && QUOTE_EMAIL_TEMPLATE_KEYS.includes(value as QuoteEmailTemplateKey);
}

export function getQuoteEmailTemplateDefinition(templateKey: QuoteEmailTemplateKey): QuoteEmailTemplateDefinition {
  return DEFINITION_BY_KEY.get(templateKey)!;
}

function extractPlaceholders(value: string): string[] {
  return Array.from(value.matchAll(PLACEHOLDER_PATTERN)).map(match => match[1]);
}

export function validateQuoteEmailTemplateInput(input: {
  template_key: QuoteEmailTemplateKey;
  subject_template: string;
  body_template: string;
}): string[] {
  const errors: string[] = [];
  const definition = getQuoteEmailTemplateDefinition(input.template_key);
  const subject = input.subject_template.trim();
  const body = input.body_template.trim();

  if (!subject) {
    errors.push('Subject is required.');
  }

  if (!body) {
    errors.push('Body wording is required.');
  }

  if (subject.length > MAX_SUBJECT_LENGTH) {
    errors.push(`Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.`);
  }

  if (body.length > MAX_BODY_LENGTH) {
    errors.push(`Body wording must be ${MAX_BODY_LENGTH} characters or fewer.`);
  }

  const allowed = new Set(definition.placeholders);
  const unknown = Array.from(new Set([...extractPlaceholders(subject), ...extractPlaceholders(body)]))
    .filter(placeholder => !allowed.has(placeholder));

  if (unknown.length > 0) {
    errors.push(`Unsupported placeholder${unknown.length === 1 ? '' : 's'} for this template: ${unknown.map(item => `{${item}}`).join(', ')}.`);
  }

  return errors;
}

function toTemplateView(
  definition: QuoteEmailTemplateDefinition,
  row?: QuoteEmailTemplateRow
): QuoteEmailTemplateView {
  return {
    ...definition,
    subject_template: row?.subject_template ?? definition.default_subject_template,
    body_template: row?.body_template ?? definition.default_body_template,
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

export async function loadQuoteEmailTemplates(supabase: SupabaseAdmin): Promise<QuoteEmailTemplateView[]> {
  const { data, error } = await supabase
    .from('quote_email_templates')
    .select('*');

  if (error) {
    throw error;
  }

  const rowByKey = new Map((data || []).map(row => [row.template_key, row as QuoteEmailTemplateRow]));
  return QUOTE_EMAIL_TEMPLATE_DEFINITIONS.map(definition => toTemplateView(definition, rowByKey.get(definition.template_key)));
}

export async function saveQuoteEmailTemplate(
  supabase: SupabaseAdmin,
  input: {
    template_key: QuoteEmailTemplateKey;
    subject_template: string;
    body_template: string;
  },
  actorUserId: string
) {
  const errors = validateQuoteEmailTemplateInput(input);
  if (errors.length > 0) {
    return { errors };
  }

  const { error } = await supabase
    .from('quote_email_templates')
    .upsert({
      template_key: input.template_key,
      subject_template: input.subject_template.trim(),
      body_template: input.body_template.trim(),
      updated_by: actorUserId,
    });

  if (error) {
    throw error;
  }

  return { errors: [] };
}

export async function resetQuoteEmailTemplate(
  supabase: SupabaseAdmin,
  templateKey: QuoteEmailTemplateKey,
  actorUserId: string
) {
  const definition = getQuoteEmailTemplateDefinition(templateKey);
  return saveQuoteEmailTemplate(
    supabase,
    {
      template_key: templateKey,
      subject_template: definition.default_subject_template,
      body_template: definition.default_body_template,
    },
    actorUserId
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanRenderedPlainText(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderStringTemplate(template: string, context: Record<string, string | number | null | undefined>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = context[key];
    if (value === null || typeof value === 'undefined') {
      return '';
    }

    return String(value);
  });
}

export function plainQuoteEmailTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function renderQuoteEmailTemplate(
  template: Pick<QuoteEmailTemplateView, 'subject_template' | 'body_template'>,
  context: Record<string, string | number | null | undefined>
): RenderedQuoteEmailTemplate {
  const subject = cleanRenderedPlainText(renderStringTemplate(template.subject_template, context)).replace(/\s+/g, ' ');
  const bodyText = cleanRenderedPlainText(renderStringTemplate(template.body_template, context));

  return {
    subject,
    bodyText,
    bodyHtml: plainQuoteEmailTextToHtml(bodyText),
  };
}

export async function renderConfiguredQuoteEmailTemplate(
  supabase: SupabaseAdmin,
  templateKey: QuoteEmailTemplateKey,
  context: Record<string, string | number | null | undefined>
): Promise<RenderedQuoteEmailTemplate> {
  const templates = await loadQuoteEmailTemplates(supabase);
  const template = templates.find(item => item.template_key === templateKey) || toTemplateView(getQuoteEmailTemplateDefinition(templateKey));
  return renderQuoteEmailTemplate(template, context);
}
