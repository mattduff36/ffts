import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('quote PDF defaults', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('adds the VAT notice to the default quote footer while preserving custom footer overrides', () => {
    const src = readSource('lib/pdf/quote-pdf.tsx');

    expect(src).toContain("import { QUOTE_VAT_RATE_NOTICE } from '@/lib/quotes/quote-vat-notice';");
    expect(src).toContain('value={customFooterText || `Quotation valid for ${validityDays} days.\\n${QUOTE_VAT_RATE_NOTICE}`}');
  });
});
