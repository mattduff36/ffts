interface QuoteDisplayCustomer {
  company_name?: string | null;
}

export interface QuoteDisplayNameInput {
  quote_reference?: string | null;
  customer?: QuoteDisplayCustomer | null;
  site_address?: string | null;
  subject_line?: string | null;
}

const MAX_FILENAME_BASE_LENGTH = 150;

function normalizeSegment(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildAsciiFilenameFallback(fileName: string): string {
  const baseName = fileName
    .replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_FILENAME_BASE_LENGTH)
    .replace(/[. ]+$/g, '');

  return `${baseName || 'Quote'}.pdf`;
}

export function getQuoteLocationSegment(siteAddress: string | null | undefined): string {
  return siteAddress
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || '';
}

export function buildQuoteDisplayName(quote: QuoteDisplayNameInput): string {
  return [
    normalizeSegment(quote.quote_reference, 'Quote'),
    normalizeSegment(quote.customer?.company_name, 'Customer'),
    normalizeSegment(getQuoteLocationSegment(quote.site_address), 'Site'),
    normalizeSegment(quote.subject_line, 'Quote'),
  ].join(' - ');
}

export function buildQuotePdfFilename(quote: QuoteDisplayNameInput): string {
  const baseName = buildQuoteDisplayName(quote)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_FILENAME_BASE_LENGTH)
    .replace(/[. ]+$/g, '');

  return `${baseName || 'Quote'}.pdf`;
}

export function buildQuotePdfContentDisposition(quote: QuoteDisplayNameInput): string {
  const fileName = buildQuotePdfFilename(quote);
  const fallbackFileName = buildAsciiFilenameFallback(fileName);

  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeRfc5987Value(fileName)}`;
}
