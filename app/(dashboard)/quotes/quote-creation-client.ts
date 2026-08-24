import { uploadQuoteAttachment } from './quote-attachment-client';
import type { Quote, QuoteFormData } from './types';

export async function markQuoteAsSent(quoteId: string): Promise<Quote> {
  const response = await fetch(`/api/quotes/${quoteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mark_as_sent' }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Failed to mark quote as sent');
  return payload.quote;
}

export function buildQuoteCreatePayload(data: QuoteFormData) {
  const { attachment_files: _attachmentFiles, ...payload } = data;
  return payload;
}

export async function uploadClientQuoteAttachments(quoteId: string, files?: File[]) {
  if (!files?.length) return;
  await Promise.all(files.map((file) => uploadQuoteAttachment({
    quoteId,
    file,
    isClientVisible: true,
    attachmentPurpose: 'client_pricing',
  })));
}

export async function createQuoteWithAttachments(
  data: QuoteFormData
): Promise<Quote> {
  const response = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildQuoteCreatePayload(data)),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Failed to create quote');
  await uploadClientQuoteAttachments(payload.quote.id, data.attachment_files);
  return payload.quote;
}
