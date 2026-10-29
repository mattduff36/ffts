import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteBundle } from '@/lib/server/quote-workflow';

vi.mock('server-only', () => ({}));

const boundary = vi.hoisted(() => ({
  rendererLoads: 0,
  templateLoads: 0,
  renderToStream: vi.fn(),
  quotePdf: vi.fn(() => ({ type: 'quote-pdf' })),
  loadTemplateLogoDataUrl: vi.fn(async () => 'data:image/png;base64,logo'),
  createAdminClient: vi.fn(),
  getUsersWithModuleAccess: vi.fn(),
  getHiddenSystemTestAccountIds: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class MockPgClient {},
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: boundary.createAdminClient,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getUsersWithModuleAccess: boundary.getUsersWithModuleAccess,
}));

vi.mock('@/lib/server/system-test-accounts', () => ({
  getHiddenSystemTestAccountIds: boundary.getHiddenSystemTestAccountIds,
}));

vi.mock('@/lib/pdf/template-logo', () => ({
  loadTemplateLogoDataUrl: boundary.loadTemplateLogoDataUrl,
}));

function installPdfModuleMocks() {
  vi.doMock('@react-pdf/renderer', () => {
    boundary.rendererLoads += 1;
    return { renderToStream: boundary.renderToStream };
  });

  vi.doMock('@/lib/pdf/quote-pdf', () => {
    boundary.templateLoads += 1;
    return { QuotePDF: boundary.quotePdf };
  });
}

const originalFetch = global.fetch;
const EXPECTED_FILENAME = 'Q-001 - Acme Ltd - West Woodland - Concrete repairs.pdf';
const EXPECTED_CONTENT = Buffer.from('pdf').toString('base64');

function pdfStream() {
  return (async function* streamPdf() {
    yield Buffer.from('pdf');
  })();
}

function buildQuoteBundle(): QuoteBundle {
  return {
    quote: {
      quote_reference: 'Q-001',
      base_quote_reference: 'Q-001',
      quote_date: '2026-05-26',
      attention_name: 'Alex Customer',
      attention_email: 'alex@example.com',
      salutation: 'Dear Alex,',
      project_description: 'Repair works',
      subject_line: 'Concrete repairs',
      scope: 'Repair the concrete.',
      site_address: '1 Road Lane',
      customer_site: { site_name: 'West Woodland' },
      manager_email: 'stored-manager@example.test',
      pricing_mode: 'itemized',
      total: 120,
      validity_days: 30,
      signoff_name: 'Example Manager',
      signoff_title: 'Contracts Manager',
      version_label: 'Original',
      revision_type: 'original',
      revision_number: 0,
      custom_footer_text: null,
      customer: {
        id: 'customer-1',
        company_name: 'Acme Ltd',
        short_name: 'Acme',
        contact_name: 'Alex Customer',
        contact_email: 'alex@example.com',
      },
    },
    lineItems: [
      {
        description: 'Concrete',
        quantity: 2,
        unit: 'm2',
        unit_rate: 60,
        line_total: 120,
      },
    ],
    attachments: [],
    ramsDocuments: [],
    invoices: [],
    invoiceRequests: [],
    versions: [],
    timeline: [],
    selectedSecondaryContacts: [],
    invoiceSummary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: 0,
      availableToRequest: 0,
      lastInvoiceAt: null,
      status: 'not_invoiced',
    },
  } as QuoteBundle;
}

async function loadWorkflow() {
  return import('@/lib/server/quote-workflow');
}

beforeEach(() => {
  boundary.rendererLoads = 0;
  boundary.templateLoads = 0;
  boundary.renderToStream.mockReset();
  boundary.renderToStream.mockImplementation(async () => pdfStream());
  boundary.quotePdf.mockReset();
  boundary.quotePdf.mockReturnValue({ type: 'quote-pdf' });
  boundary.loadTemplateLogoDataUrl.mockReset();
  boundary.loadTemplateLogoDataUrl.mockResolvedValue('data:image/png;base64,logo');
  boundary.createAdminClient.mockReset();
  boundary.getUsersWithModuleAccess.mockReset();
  boundary.getHiddenSystemTestAccountIds.mockReset();
  global.fetch = vi.fn(async () => {
    throw new Error('unexpected network call from lazy PDF test');
  }) as typeof fetch;
  vi.resetModules();
  installPdfModuleMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetModules();
});

describe('lazy quote PDF imports', () => {
  it('loads non-PDF helpers without initialising the renderer or template', async () => {
    const workflow = await loadWorkflow();

    expect(workflow.getInitialsFromName('Alex Customer')).toBe('AC');
    expect(workflow.quoteCustomerEmailTimelineDescription({
      suppressed: false,
      emailedDescription: 'Quote emailed.',
    })).toBe('Quote emailed.');
    expect(workflow.calculateQuoteTotals([{ quantity: 2, unit_rate: 60 }])).toEqual({
      subtotal: 120,
      total: 120,
    });
    expect(boundary.rendererLoads).toBe(0);
    expect(boundary.templateLoads).toBe(0);
    expect(boundary.quotePdf).not.toHaveBeenCalled();
    expect(boundary.renderToStream).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('initialises both PDF modules on render and returns the same filename and base64 twice', async () => {
    const { renderQuotePdfAttachment } = await loadWorkflow();
    const bundle = buildQuoteBundle();

    expect(boundary.rendererLoads).toBe(0);
    expect(boundary.templateLoads).toBe(0);

    const first = await renderQuotePdfAttachment(bundle, 'sender@example.test');
    const second = await renderQuotePdfAttachment(bundle, 'sender@example.test');

    expect(boundary.rendererLoads).toBe(1);
    expect(boundary.templateLoads).toBe(1);
    expect(first).toEqual({ filename: EXPECTED_FILENAME, content: EXPECTED_CONTENT });
    expect(second).toEqual({ filename: EXPECTED_FILENAME, content: EXPECTED_CONTENT });
    expect(boundary.quotePdf).toHaveBeenCalledTimes(2);
    expect(boundary.renderToStream).toHaveBeenCalledTimes(2);
    expect(boundary.quotePdf).toHaveBeenCalledWith(expect.objectContaining({
      quoteReference: 'Q-001',
      baseQuoteReference: 'Q-001',
      managerEmail: 'sender@example.test',
      logoSrc: 'data:image/png;base64,logo',
      pricingMode: 'itemized',
      total: 120,
      versionLabel: 'Original',
      lineItems: [{
        description: 'Concrete',
        quantity: 2,
        unit: 'm2',
        unit_rate: 60,
        line_total: 120,
      }],
    }));
    expect(boundary.renderToStream).toHaveBeenCalledWith({ type: 'quote-pdf' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves an import failure and does not reuse it after the module can load', async () => {
    const importError = new Error('quote renderer import failed');
    const { renderQuotePdfAttachment } = await loadWorkflow();
    vi.doMock('@react-pdf/renderer', () => {
      boundary.rendererLoads += 1;
      throw importError;
    });

    // Vitest wraps a failing module factory; the import promise itself rejects.
    await expect(renderQuotePdfAttachment(buildQuoteBundle())).rejects.toMatchObject({ cause: importError });
    expect(boundary.renderToStream).not.toHaveBeenCalled();

    // Replace only the failed module; keep the same workflow function instance.
    vi.doMock('@react-pdf/renderer', () => {
      boundary.rendererLoads += 1;
      return { renderToStream: boundary.renderToStream };
    });
    const attachment = await renderQuotePdfAttachment(buildQuoteBundle(), 'sender@example.test');

    expect(attachment).toEqual({ filename: EXPECTED_FILENAME, content: EXPECTED_CONTENT });
    expect(boundary.rendererLoads).toBe(2);
    expect(boundary.templateLoads).toBe(1);
  });

  it('preserves a render failure and does not reuse it on the next call', async () => {
    const renderError = new Error('quote pdf render failed');
    const { renderQuotePdfAttachment } = await loadWorkflow();
    boundary.renderToStream.mockRejectedValueOnce(renderError);

    await expect(renderQuotePdfAttachment(buildQuoteBundle())).rejects.toBe(renderError);

    const attachment = await renderQuotePdfAttachment(buildQuoteBundle(), 'sender@example.test');

    expect(attachment).toEqual({ filename: EXPECTED_FILENAME, content: EXPECTED_CONTENT });
    expect(boundary.renderToStream).toHaveBeenCalledTimes(2);
    expect(boundary.rendererLoads).toBe(1);
    expect(boundary.templateLoads).toBe(1);
  });
});
