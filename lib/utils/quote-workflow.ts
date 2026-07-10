export interface InvoiceSummary {
  invoicedTotal: number;
  pendingRequestedTotal: number;
  remainingBalance: number;
  availableToRequest: number;
  lastInvoiceAt: string | null;
  status: 'not_invoiced' | 'ready_to_invoice' | 'partially_invoiced' | 'invoiced';
}

export function calculateQuoteTotals(lineItems: Array<{ quantity: number; unit_rate: number }>) {
  const subtotal = Math.round(
    lineItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_rate || 0), 0) * 100
  ) / 100;

  return {
    subtotal,
    total: subtotal,
  };
}

export function buildVersionLabel(revisionType: string, revisionNumber: number): string {
  if (revisionType === 'original' || revisionNumber <= 0) {
    return 'Original';
  }

  const labelMap: Record<string, string> = {
    revision: 'Rev',
    extra: 'Extra',
    variation: 'Var',
    future_work: 'Future',
    duplicate: 'Copy',
  };

  return `${labelMap[revisionType] || revisionType} ${revisionNumber}`;
}

export function buildVersionReference(baseReference: string, revisionType: string, revisionNumber: number): string {
  if (revisionType === 'original' || revisionNumber <= 0) {
    return baseReference;
  }

  const suffixMap: Record<string, string> = {
    revision: 'REV',
    extra: 'EXT',
    variation: 'VAR',
    future_work: 'FW',
    duplicate: 'COPY',
  };

  return `${baseReference}-${suffixMap[revisionType] || 'V'}${revisionNumber}`;
}

export function getInvoiceSummary(input: {
  total: number;
  invoices: Array<{ amount: number; invoice_date?: string | null }>;
  invoiceRequests?: Array<{ requested_amount: number; status?: string | null }>;
}): InvoiceSummary {
  const invoicedTotal = Math.round(
    input.invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0) * 100
  ) / 100;
  const pendingRequestedTotal = Math.round(
    (input.invoiceRequests || [])
      .filter(request => (request.status || 'pending') === 'pending')
      .reduce((sum, request) => sum + Number(request.requested_amount || 0), 0) * 100
  ) / 100;
  const remainingBalance = Math.round((Number(input.total || 0) - invoicedTotal) * 100) / 100;
  const availableToRequest = Math.max(0, Math.round((remainingBalance - pendingRequestedTotal) * 100) / 100);
  const lastInvoiceAt = input.invoices.length > 0
    ? input.invoices
        .map(invoice => invoice.invoice_date || null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null
    : null;

  return {
    invoicedTotal,
    pendingRequestedTotal,
    remainingBalance,
    availableToRequest,
    lastInvoiceAt,
    status: remainingBalance <= 0
      ? 'invoiced'
      : pendingRequestedTotal > 0
        ? 'ready_to_invoice'
        : invoicedTotal > 0
          ? 'partially_invoiced'
          : 'not_invoiced',
  };
}
