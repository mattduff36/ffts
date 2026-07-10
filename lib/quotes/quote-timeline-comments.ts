interface TimelineEventWithDescription {
  quote_id: string;
  event_type: string;
  description: string | null;
  created_at: string;
}

interface InvoiceRequestCommentSource {
  quote_id: string;
  requested_at: string;
  manager_comments: string | null;
}

interface InvoiceCommentSource {
  quote_id: string;
  created_at: string;
  comments: string | null;
}

export interface InvoiceRequestTimelineDescriptionInput {
  requestedScope: 'full' | 'partial';
  requestedAmount: number;
  comments?: string | null;
}

export interface InvoiceAddedTimelineDescriptionInput {
  invoiceNumber: string;
  amount: number;
  comments?: string | null;
}

function normalizeComment(value: string | null | undefined): string | null {
  const comment = value?.trim();
  return comment ? comment : null;
}

function formatCurrency(value: number): string {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
}

function getTimelineSourceKey(quoteId: string, timestamp: string): string {
  const parsedTimestamp = Date.parse(timestamp);
  const normalizedTimestamp = Number.isNaN(parsedTimestamp) ? timestamp : String(parsedTimestamp);
  return `${quoteId}:${normalizedTimestamp}`;
}

function appendCommentLine(description: string | null, comment: string | null | undefined): string | null {
  const normalizedComment = normalizeComment(comment);
  if (!normalizedComment) return description;

  const baseDescription = description?.trim() || '';
  const commentLine = `Comments: ${normalizedComment}`;

  if (!baseDescription) return commentLine;
  if (baseDescription.includes(normalizedComment)) return baseDescription;

  return `${baseDescription}\n${commentLine}`;
}

export function buildInvoiceRequestTimelineDescription({
  requestedScope,
  requestedAmount,
  comments,
}: InvoiceRequestTimelineDescriptionInput): string {
  return appendCommentLine(
    `Requested ${requestedScope} invoice • ${formatCurrency(requestedAmount)}`,
    comments
  ) || '';
}

export function buildInvoiceAddedTimelineDescription({
  invoiceNumber,
  amount,
  comments,
}: InvoiceAddedTimelineDescriptionInput): string {
  return appendCommentLine(
    `${invoiceNumber} • ${formatCurrency(amount)}`,
    comments
  ) || '';
}

export function enrichQuoteTimelineEventDescriptions<TEvent extends TimelineEventWithDescription>(
  events: TEvent[],
  sources: {
    invoiceRequests: InvoiceRequestCommentSource[];
    invoices: InvoiceCommentSource[];
  }
): TEvent[] {
  const invoiceRequestComments = new Map(
    sources.invoiceRequests.map(request => [
      getTimelineSourceKey(request.quote_id, request.requested_at),
      request.manager_comments,
    ])
  );
  const invoiceComments = new Map(
    sources.invoices.map(invoice => [
      getTimelineSourceKey(invoice.quote_id, invoice.created_at),
      invoice.comments,
    ])
  );

  return events.map(event => {
    const eventKey = getTimelineSourceKey(event.quote_id, event.created_at);
    const comment = event.event_type === 'invoice_requested'
      ? invoiceRequestComments.get(eventKey)
      : event.event_type === 'invoice_added'
        ? invoiceComments.get(eventKey)
        : null;

    const description = appendCommentLine(event.description, comment);
    if (description === event.description) return event;

    return {
      ...event,
      description,
    };
  });
}
