import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCanEffectiveRoleAccessModule,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCanEffectiveRoleAccessModule: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanEffectiveRoleAccessModule,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

interface QuoteJobCodeTestRow {
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  customer: {
    status: string | null;
    company_name: string | null;
  } | null;
}

interface LegacyQuoteJobCodeTestRow {
  quote_reference: string | null;
  customer_name: string | null;
  title: string | null;
}

interface ProjectNumberJobCodeTestRow {
  project_reference: string | null;
  title: string | null;
  description: string | null;
}

function normalizePages<T>(rowsOrPages: T[] | T[][]): T[][] {
  if (Array.isArray(rowsOrPages[0])) return rowsOrPages as T[][];
  return [rowsOrPages as T[]];
}

function createRangeMock<T>(rowsOrPages: T[] | T[][]) {
  const range = vi.fn();
  for (const rows of normalizePages(rowsOrPages)) {
    range.mockResolvedValueOnce({ data: rows, error: null });
  }
  range.mockResolvedValue({ data: [], error: null });
  return range;
}

function createQuoteQuery(rowsOrPages: QuoteJobCodeTestRow[] | QuoteJobCodeTestRow[][]) {
  const range = createRangeMock(rowsOrPages);
  const order = vi.fn().mockReturnValue({ range });
  const query = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order,
  };

  return { query, order, range };
}

function createLegacyQuoteQuery(rowsOrPages: LegacyQuoteJobCodeTestRow[] | LegacyQuoteJobCodeTestRow[][]) {
  const range = createRangeMock(rowsOrPages);
  const order = vi.fn().mockReturnValue({ range });
  const query = {
    not: vi.fn().mockReturnThis(),
    order,
  };

  return { query, order, range };
}

function createProjectNumberQuery(rowsOrPages: ProjectNumberJobCodeTestRow[] | ProjectNumberJobCodeTestRow[][]) {
  const range = createRangeMock(rowsOrPages);
  const order = vi.fn().mockReturnValue({ range });
  const query = {
    eq: vi.fn().mockReturnThis(),
    order,
  };

  return { query, order, range };
}

describe('GET /api/timesheets/job-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
    mockCanEffectiveRoleAccessModule.mockResolvedValue(true);
  });

  it('returns catalogued live and legacy job codes with customer context', async () => {
    const quoteQuery = createQuoteQuery([
      {
        base_quote_reference: '40001-GH',
        quote_reference: '40001-GH',
        subject_line: 'Cable repairs',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Omexom' },
      },
      {
        base_quote_reference: '40001-GH',
        quote_reference: '40001-GH-REV2',
        subject_line: 'Duplicate revision',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Omexom' },
      },
      {
        base_quote_reference: '1234-AB',
        quote_reference: '1234-AB',
        subject_line: 'Legacy-shaped live quote',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Legacy Customer' },
      },
      {
        base_quote_reference: '50001-LC',
        quote_reference: '50001-LC',
        subject_line: null,
        project_description: 'Concrete works',
        site_address: null,
        customer: { status: 'active', company_name: 'Saint Gobain' },
      },
    ]);
    const legacyQuoteQuery = createLegacyQuoteQuery([
      { quote_reference: '4323-GH', customer_name: 'Omexom', title: 'ATV hire' },
      { quote_reference: 'P500', customer_name: 'Arena Racing', title: 'Arena Racing' },
      { quote_reference: 'WORKSHOP', customer_name: 'Internal Use Only', title: 'Workshop sales' },
      { quote_reference: '40001-GH', customer_name: 'Duplicate Legacy', title: 'Ignored duplicate' },
    ]);
    const projectNumberQuery = createProjectNumberQuery([
      { project_reference: '60001-MD', title: 'Emergency enabling works', description: null },
    ]);
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === 'quotes') return quoteQuery.query;
        if (table === 'legacy_quotes') return legacyQuoteQuery.query;
        if (table === 'quote_project_numbers') return projectNumberQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    }));

    mockCreateAdminClient.mockReturnValue({
      from,
    });

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job_codes).toEqual([
      {
        value: '40001-GH',
        label: '40001-GH',
        customerName: 'Omexom',
        quoteTitle: 'Cable repairs',
        source: 'live_quote',
      },
      {
        value: '50001-LC',
        label: '50001-LC',
        customerName: 'Saint Gobain',
        quoteTitle: 'Concrete works',
        source: 'live_quote',
      },
      {
        value: '4323-GH',
        label: '4323-GH',
        customerName: 'Omexom',
        quoteTitle: 'ATV hire',
        source: 'legacy_quote',
      },
      {
        value: 'P500',
        label: 'P500',
        customerName: 'Arena Racing',
        quoteTitle: 'Arena Racing',
        source: 'legacy_quote',
      },
      {
        value: 'WORKSHOP',
        label: 'WORKSHOP',
        customerName: 'Internal Use Only',
        quoteTitle: 'Workshop sales',
        source: 'legacy_quote',
      },
      {
        value: '60001-MD',
        label: '60001-MD',
        customerName: 'Project number',
        quoteTitle: 'Emergency enabling works',
        source: 'project_number',
      },
    ]);
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('commercial_status', 'open');
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('customer.status', 'active');
    expect(quoteQuery.query.in).toHaveBeenCalledWith('status', [
      'sent',
      'won',
      'ready_to_invoice',
      'po_received',
      'in_progress',
      'completed_part',
      'completed_full',
      'partially_invoiced',
      'invoiced',
    ]);
    expect(legacyQuoteQuery.query.not).toHaveBeenCalledWith('quote_reference', 'is', null);
    expect(projectNumberQuery.query.eq).toHaveBeenCalledWith('status', 'open');
  });

  it('paginates legacy job codes so codes beyond the first Supabase page are searchable', async () => {
    const quoteQuery = createQuoteQuery([]);
    const legacyQuoteQuery = createLegacyQuoteQuery([
      Array.from({ length: 1_000 }, (_, index) => ({
        quote_reference: `1000-AA-${index}`,
        customer_name: 'Earlier legacy row',
        title: 'Earlier page',
      })),
      [
        {
          quote_reference: '5388-LC',
          customer_name: 'Saint Gobain East Leake',
          title: 'day works',
        },
      ],
    ]);
    const projectNumberQuery = createProjectNumberQuery([]);
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === 'quotes') return quoteQuery.query;
        if (table === 'legacy_quotes') return legacyQuoteQuery.query;
        if (table === 'quote_project_numbers') return projectNumberQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    }));

    mockCreateAdminClient.mockReturnValue({
      from,
    });

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes?q=5388'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job_codes).toEqual([
      {
        value: '5388-LC',
        label: '5388-LC',
        customerName: 'Saint Gobain East Leake',
        quoteTitle: 'day works',
        source: 'legacy_quote',
      },
    ]);
    expect(legacyQuoteQuery.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(legacyQuoteQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('requires timesheets access', async () => {
    mockCanEffectiveRoleAccessModule.mockResolvedValue(false);

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));

    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
