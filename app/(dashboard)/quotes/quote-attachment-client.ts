import type { QuoteAttachment } from './types';

interface UploadQuoteAttachmentOptions {
  quoteId: string;
  file: File;
  isClientVisible: boolean;
  attachmentPurpose: QuoteAttachment['attachment_purpose'];
}

interface ReplaceQuoteAttachmentOptions extends UploadQuoteAttachmentOptions {
  attachmentId: string;
}

interface QuoteAttachmentResponse {
  attachment: QuoteAttachment;
}

export function buildQuoteAttachmentStoragePath(
  quoteId: string,
  fileName: string,
  contentSha256: string
): string {
  const sanitizedFilename = fileName.replace(/[^a-z0-9_.-]/gi, '_');
  return `${quoteId}/sha256_${contentSha256}_${sanitizedFilename}`;
}

export function cloneSelectedQuoteFiles(files: FileList | File[]): File[] {
  return Array.from(files).map((file) => new File([file], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  }));
}

export function formatQuoteAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function getQuoteAttachmentUrl(quoteId: string, attachmentId: string) {
  return `/api/quotes/${encodeURIComponent(quoteId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function buildAttachmentResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(payload?.error || fallback);
}

export async function uploadQuoteAttachment({
  quoteId,
  file,
  isClientVisible,
  attachmentPurpose,
}: UploadQuoteAttachmentOptions) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('is_client_visible', String(isClientVisible));
  formData.append('attachment_purpose', attachmentPurpose);

  const response = await fetch(`/api/quotes/${quoteId}/attachments`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw await buildAttachmentResponseError(response, `Failed to upload ${file.name}`);
  }

  const payload = await response.json() as QuoteAttachmentResponse;
  return payload.attachment;
}

export async function deleteQuoteAttachment(quoteId: string, attachmentId: string) {
  const response = await fetch(getQuoteAttachmentUrl(quoteId, attachmentId), { method: 'DELETE' });

  if (!response.ok) {
    throw await buildAttachmentResponseError(response, 'Unable to remove this attachment right now.');
  }
}

export async function replaceQuoteAttachment({
  quoteId,
  attachmentId,
  file,
  isClientVisible,
  attachmentPurpose,
}: ReplaceQuoteAttachmentOptions) {
  const replacement = await uploadQuoteAttachment({
    quoteId,
    file,
    isClientVisible,
    attachmentPurpose,
  });

  await deleteQuoteAttachment(quoteId, attachmentId);
  return replacement;
}
