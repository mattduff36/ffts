import type { Quote, QuoteStatus } from './types';

export const QUOTE_MARK_AS_SENT_STATUSES = new Set<QuoteStatus>([
  'draft',
  'changes_requested',
  'pending_internal_approval',
]);

export const QUOTE_PO_EDITABLE_STATUSES = new Set<QuoteStatus>([
  'sent',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
]);

export type QuoteImmediateWorkflowAction = 'mark_as_sent' | 'mark_as_accepted';
export type QuoteDetailsWorkflowAction = 'mark_complete' | 'request_po' | 'schedule';
export type QuoteQuickWorkflowAction =
  | QuoteImmediateWorkflowAction
  | QuoteDetailsWorkflowAction
  | 'toggle_closed';

export interface QuoteNextWorkflowAction {
  key: 'mark_as_sent' | 'mark_as_accepted' | 'mark_complete';
  label: string;
  mode: 'immediate' | 'open_details' | 'confirm';
  disabled: boolean;
  disabledReason?: string;
}

export function getQuoteRecipientEmail(quote: Pick<Quote, 'attention_email' | 'customer'>): string {
  return quote.attention_email?.trim() || quote.customer?.contact_email?.trim() || '';
}

export function canEditQuote(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return Boolean(quote.is_latest_version && QUOTE_MARK_AS_SENT_STATUSES.has(quote.status));
}

export function canDeleteQuoteDraft(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return Boolean(quote.is_latest_version && quote.status === 'draft');
}

export function canEditQuotePoDetails(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return Boolean(quote.is_latest_version && QUOTE_PO_EDITABLE_STATUSES.has(quote.status));
}

export function canTriggerQuoteRams(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return Boolean(quote.is_latest_version && quote.status === 'sent');
}

export function canMarkQuoteAsAccepted(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return canTriggerQuoteRams(quote);
}

export function canManageQuoteSchedule(quote: Pick<Quote, 'is_latest_version' | 'status'>): boolean {
  return Boolean(quote.is_latest_version && (quote.status === 'po_received' || quote.status === 'in_progress'));
}

export function canRequestQuotePo(quote: Pick<Quote, 'is_latest_version' | 'po_number' | 'sent_at' | 'customer_sent_at' | 'status' | 'attention_email' | 'customer'>): boolean {
  return Boolean(
    quote.is_latest_version
    && !quote.po_number
    && getQuoteRecipientEmail(quote)
    && (quote.sent_at || quote.customer_sent_at || quote.status === 'sent')
  );
}

export function canToggleQuoteArchive(quote: Pick<Quote, 'is_latest_version'>): boolean {
  return Boolean(quote.is_latest_version);
}

export function getQuoteCostOverviewHref(quote: Pick<Quote, 'quote_reference' | 'base_quote_reference'>): string {
  return `/quotes/overview/${encodeURIComponent(quote.base_quote_reference || quote.quote_reference)}`;
}

export function getQuotePdfHref(quoteId: string): string {
  return `/api/quotes/${quoteId}/pdf`;
}

export function openQuotePdf(quoteId: string): void {
  window.open(getQuotePdfHref(quoteId), '_blank', 'noopener,noreferrer');
}

export function getQuoteNextWorkflowAction(quote: Quote): QuoteNextWorkflowAction | null {
  if (!quote.is_latest_version) return null;
  if (quote.commercial_status === 'closed' || quote.status === 'closed') return null;

  if (QUOTE_MARK_AS_SENT_STATUSES.has(quote.status)) {
    const recipientEmail = getQuoteRecipientEmail(quote);
    return {
      key: 'mark_as_sent',
      label: 'Mark as Sent',
      mode: 'immediate',
      disabled: !recipientEmail,
      disabledReason: recipientEmail
        ? undefined
        : 'Add a primary customer contact email before marking this quote as sent.',
    };
  }

  if (canMarkQuoteAsAccepted(quote)) {
    return {
      key: 'mark_as_accepted',
      label: 'Mark as Accepted',
      mode: 'confirm',
      disabled: false,
    };
  }

  if (canManageQuoteSchedule(quote)) {
    return {
      key: 'mark_complete',
      label: 'Mark Complete',
      mode: 'open_details',
      disabled: false,
    };
  }

  return null;
}
