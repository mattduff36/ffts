import { describe, expect, it } from 'vitest';
import {
  buildQuoteAttachmentStoragePath,
  cloneSelectedQuoteFiles,
  formatQuoteAttachmentSize,
} from '@/app/(dashboard)/quotes/quote-attachment-client';

describe('quote attachment staging', () => {
  it('quote-attachment-xlsx-staged clones selected spreadsheets into the pending list', () => {
    const spreadsheet = new File(['sheet'], 'quote.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const cloned = cloneSelectedQuoteFiles([spreadsheet]);
    expect(cloned).toHaveLength(1);
    expect(cloned[0]).not.toBe(spreadsheet);
    expect(cloned[0].name).toBe('quote.xlsx');
    expect(cloned[0].size).toBe(spreadsheet.size);
    expect(formatQuoteAttachmentSize(cloned[0].size)).toMatch(/KB/);
  });

  it('reuses a content-addressed path so retries do not create a second file', () => {
    const first = buildQuoteAttachmentStoragePath('quote-1', 'pricing.xlsx', 'abc123');
    const second = buildQuoteAttachmentStoragePath('quote-1', 'pricing.xlsx', 'abc123');
    const changed = buildQuoteAttachmentStoragePath('quote-1', 'pricing.xlsx', 'def456');
    expect(first).toBe('quote-1/sha256_abc123_pricing.xlsx');
    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });
});
