import { describe, expect, it } from 'vitest';
import {
  buildQuoteDisplayName,
  buildQuotePdfContentDisposition,
  buildQuotePdfFilename,
  getQuoteLocationSegment,
} from '@/lib/quotes/quote-display-name';

describe('quote display names', () => {
  it('builds the client-requested quote name format', () => {
    expect(buildQuoteDisplayName({
      quote_reference: '80000-MD',
      customer: { company_name: 'Acme Ltd' },
      site_address: '1 Road Lane\nSecond line',
      subject_line: 'Concrete repairs',
    })).toBe('80000-MD - Acme Ltd - 1 Road Lane - Concrete repairs');
  });

  it('uses the first non-empty site address line', () => {
    expect(getQuoteLocationSegment('\n  Yard Entrance  \nUnit 4')).toBe('Yard Entrance');
  });

  it('uses stable fallbacks when optional fields are missing', () => {
    expect(buildQuoteDisplayName({
      quote_reference: '80001-CD',
      customer: null,
      site_address: null,
      subject_line: '',
    })).toBe('80001-CD - Customer - Site - Quote');
  });

  it('sanitizes unsafe filename characters and keeps the pdf extension', () => {
    const filename = buildQuotePdfFilename({
      quote_reference: '80002/RB',
      customer: { company_name: 'A&B: Demo <Ltd>' },
      site_address: 'Site / One',
      subject_line: 'Walls * gutters?',
    });

    expect(filename).toBe('80002 RB - A&B Demo Ltd - Site One - Walls gutters.pdf');
  });

  it('builds an HTTP-safe content disposition for unicode filenames', () => {
    const header = buildQuotePdfContentDisposition({
      quote_reference: '80003–MD',
      customer: { company_name: 'Café Repairs Ltd' },
      site_address: 'Main Yard – North',
      subject_line: 'Façade repairs',
    });

    expect(header).toContain('filename="80003 MD - Cafe Repairs Ltd - Main Yard North - Facade repairs.pdf"');
    expect(header).toContain("filename*=UTF-8''80003%E2%80%93MD%20-%20Caf%C3%A9%20Repairs%20Ltd");
    expect([...header].every(char => char.charCodeAt(0) <= 127)).toBe(true);
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow();
  });
});
