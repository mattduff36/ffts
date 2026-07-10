/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QuotesTable } from '@/app/(dashboard)/quotes/components/QuotesTable';
import { getQuoteManagerNameFilterValue } from '@/app/(dashboard)/quotes/types';
import type { Quote, QuoteListSummary, QuoteStatus } from '@/app/(dashboard)/quotes/types';

const ALL_STATUSES: QuoteStatus[] = [
  'draft',
  'pending_internal_approval',
  'approved',
  'changes_requested',
  'sent',
  'won',
  'lost',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
  'closed',
];

function buildQuote(overrides: Partial<Quote>): Quote {
  const quoteReference = overrides.quote_reference || '50000-LC';

  return {
    id: overrides.id || quoteReference,
    quote_reference: quoteReference,
    base_quote_reference: overrides.base_quote_reference || quoteReference,
    quote_thread_id: overrides.quote_thread_id || quoteReference,
    parent_quote_id: null,
    customer_id: 'customer-1',
    requester_id: overrides.requester_id ?? 'manager-1',
    requester_initials: overrides.requester_initials ?? 'LC',
    quote_date: overrides.quote_date || '2026-06-12',
    attention_name: null,
    attention_email: null,
    subject_line: overrides.subject_line || null,
    project_description: overrides.project_description || 'Drainage works',
    scope: null,
    salutation: null,
    site_address: null,
    validity_days: 30,
    subtotal: overrides.subtotal ?? 100,
    total: overrides.total ?? 100,
    pricing_mode: 'itemized',
    status: overrides.status || 'sent',
    accepted: false,
    po_number: overrides.po_number ?? null,
    po_received_at: null,
    po_value: null,
    started: false,
    start_date: null,
    start_alert_days: null,
    start_alert_sent_at: null,
    estimated_duration_days: null,
    invoice_number: null,
    invoice_notes: null,
    last_invoice_at: null,
    signoff_name: null,
    signoff_title: null,
    custom_footer_text: null,
    revision_number: 0,
    revision_type: 'original',
    version_label: null,
    version_notes: null,
    is_latest_version: true,
    duplicate_source_quote_id: null,
    manager_name: overrides.manager_name ?? 'Louis Cree',
    manager_email: null,
    approver_profile_id: null,
    approved_by: null,
    approved_at: null,
    returned_at: null,
    return_comments: null,
    customer_sent_at: null,
    customer_sent_by: null,
    completion_status: 'not_completed',
    completion_comments: null,
    commercial_status: 'open',
    closed_at: null,
    rams_requested_at: null,
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
    created_by: null,
    updated_by: null,
    sent_at: null,
    accepted_at: null,
    invoiced_at: null,
    sage_posted_at: overrides.sage_posted_at ?? null,
    sage_posted_by: null,
    customer: {
      id: 'customer-1',
      company_name: overrides.customer?.company_name || 'Customer Ltd',
      short_name: null,
    },
    previous_versions: [],
    invoice_summary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: overrides.total ?? 100,
      availableToRequest: overrides.total ?? 100,
      lastInvoiceAt: null,
      status: overrides.invoice_summary?.status || 'not_invoiced',
    },
  };
}

function buildStatusCounts(quotes: Quote[]): QuoteListSummary['status_counts'] {
  const counts = ALL_STATUSES.reduce<Record<QuoteStatus | 'all', number>>(
    (acc, status) => ({ ...acc, [status]: 0 }),
    { all: quotes.length } as Record<QuoteStatus | 'all', number>
  );

  quotes.forEach((quote) => {
    counts[quote.status] += 1;
  });

  return counts;
}

function buildPaginationQuotes(firstQuoteOverrides: Partial<Quote> = {}): Quote[] {
  return Array.from({ length: 51 }, (_, index) => {
    const quoteNumber = String(index).padStart(3, '0');
    const quoteDate = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);

    return buildQuote({
      id: `page-quote-${quoteNumber}`,
      quote_reference: `60${quoteNumber}-LC`,
      quote_date: quoteDate,
      customer: {
        id: `customer-${quoteNumber}`,
        company_name: `Customer ${quoteNumber}`,
        short_name: null,
      },
      po_number: `PO-${quoteNumber}`,
      ...(index === 0 ? firstQuoteOverrides : {}),
    });
  });
}

describe('QuotesTable filters', () => {
  it('moves workflow status into a multi-select dropdown', () => {
    const quotes = [
      buildQuote({ id: 'draft', quote_reference: '50001-LC', status: 'draft' }),
      buildQuote({ id: 'confirmed', quote_reference: '50002-LC', status: 'sent' }),
      buildQuote({ id: 'accepted', quote_reference: '50003-LC', status: 'po_received' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /All workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All dates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All PO/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All billing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Sage/ })).toBeInTheDocument();
    expect(screen.queryByText('Workflow Status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All workflow/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmed/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Accepted/ }));

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50002-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50003-LC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument();
  });

  it('filters quotes by manager id and normalized manager name fallback', () => {
    const quotes = [
      buildQuote({ id: 'louis', quote_reference: '50001-LC', requester_id: 'manager-louis', manager_name: 'Louis Cree' }),
      buildQuote({ id: 'matt', quote_reference: '50002-MD', requester_id: 'manager-matt', requester_initials: 'MD', manager_name: 'Matt Duffill' }),
      buildQuote({ id: 'name-only', quote_reference: '50003-NO', requester_id: null, requester_initials: null, manager_name: 'Name Only Manager' }),
    ];
    const { container, rerender } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
        managerFilter="manager-matt"
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50002-MD')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50003-NO')).not.toBeInTheDocument();

    rerender(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
        managerFilter={getQuoteManagerNameFilterValue('name only manager')}
      />
    );

    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50002-MD')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50003-NO')).toBeInTheDocument();
  });

  it('shows PO numbers in the invoice area without a PO Number column', () => {
    const quotes = [
      buildQuote({ id: 'with-po', quote_reference: '50001-LC', po_number: 'PO-123456' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    expect(screen.queryByRole('columnheader', { name: /PO Number/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll('thead th')).toHaveLength(7);
    const poLabels = screen.getAllByText('PO# PO-123456');
    expect(poLabels).toHaveLength(2);
    poLabels.forEach((poLabel) => {
      expect(poLabel).toHaveClass('text-muted-foreground');
    });
  });

  it('keeps quote number and customer out of the Details column', () => {
    const quotes = [
      buildQuote({
        id: 'details-cleanup',
        quote_reference: '50001-LC',
        customer: {
          id: 'customer-details',
          company_name: 'Details Customer Ltd',
          short_name: null,
        },
        subject_line: 'Pump station repair',
        project_description: 'Drainage works',
      }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const firstRowCells = container.querySelectorAll('tbody tr:first-child td');
    expect(firstRowCells[2]).toHaveTextContent('Pump station repair');
    expect(firstRowCells[2]).toHaveTextContent('Drainage works');
    expect(firstRowCells[2]).not.toHaveTextContent('50001-LC');
    expect(firstRowCells[2]).not.toHaveTextContent('Details Customer Ltd');
  });

  it('keeps PO filtering and search working after removing the PO column', () => {
    const quotes = [
      buildQuote({ id: 'with-po', quote_reference: '50001-LC', po_number: 'PO-123456' }),
      buildQuote({ id: 'without-po', quote_reference: '50002-LC', po_number: null }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /All PO/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /With PO/ }));

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).getByText('50001-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50002-LC')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reset Filters/ }));
    fireEvent.change(screen.getByPlaceholderText('Search quotes...'), { target: { value: 'PO-123456' } });

    expect(within(tableBody as HTMLElement).getByText('50001-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50002-LC')).not.toBeInTheDocument();
  });

  it('keeps billing filters working without rendering visible billing badges', () => {
    const quotes = [
      buildQuote({
        id: 'ready-to-invoice',
        quote_reference: '50001-LC',
        invoice_summary: {
          invoicedTotal: 0,
          pendingRequestedTotal: 0,
          remainingBalance: 100,
          availableToRequest: 100,
          lastInvoiceAt: null,
          status: 'ready_to_invoice',
        },
      }),
      buildQuote({ id: 'not-invoiced', quote_reference: '50002-LC' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('Ready to invoice')).not.toBeInTheDocument();
    const firstInvoiceCell = tableBody?.querySelector('tr:first-child td:nth-child(7)');
    expect(firstInvoiceCell).toHaveTextContent('£0');

    fireEvent.click(screen.getByRole('button', { name: /All billing/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Ready to invoice/ }));

    expect(within(tableBody as HTMLElement).getByText('50001-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50002-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('Ready to invoice')).not.toBeInTheDocument();
  });

  it('searches the full result set before paginating rows', () => {
    const quotes = buildPaginationQuotes({
      id: 'deep-search-match',
      quote_reference: '59999-LC',
      po_number: 'PO-DEEP-MATCH',
      subject_line: 'Deep search match',
    });
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(screen.getByText('Showing 50 of 51 quotes')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('59999-LC')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search quotes...'), { target: { value: 'PO-DEEP-MATCH' } });

    expect(within(tableBody as HTMLElement).getByText('59999-LC')).toBeInTheDocument();
    expect(screen.queryByText('Showing 50 of 51 quotes')).not.toBeInTheDocument();
  });

  it('filters the full result set before paginating rows', () => {
    const quotes = buildPaginationQuotes({
      id: 'deep-filter-match',
      quote_reference: '59998-LC',
      po_number: null,
    });
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('59998-LC')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All PO/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /No PO/ }));

    expect(within(tableBody as HTMLElement).getByText('59998-LC')).toBeInTheDocument();
    expect(screen.queryByText('Showing 50 of 51 quotes')).not.toBeInTheDocument();
  });

  it('sorts the full result set before paginating rows', () => {
    const quotes = buildPaginationQuotes({
      id: 'deep-sort-match',
      quote_reference: '59997-LC',
      customer: {
        id: 'customer-aardvark',
        company_name: 'Aardvark Utilities',
        short_name: null,
      },
    });
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('59997-LC')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Customer'));

    const firstRow = tableBody?.querySelector('tr');
    expect(firstRow).not.toBeNull();
    expect(within(firstRow as HTMLElement).getByText('59997-LC')).toBeInTheDocument();
    expect(screen.getByText('Showing 50 of 51 quotes')).toBeInTheDocument();
  });

  it('reveals the next quotes batch with Show More', () => {
    const quotes = buildPaginationQuotes();
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(tableBody?.querySelectorAll('tr')).toHaveLength(50);
    expect(within(tableBody as HTMLElement).queryByText('60000-LC')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));

    expect(tableBody?.querySelectorAll('tr')).toHaveLength(51);
    expect(within(tableBody as HTMLElement).getByText('60000-LC')).toBeInTheDocument();
    expect(screen.getByText('Showing all 51 quotes')).toBeInTheDocument();
  });

  it('renders Sage status as accessible icon badges', () => {
    const quotes = [
      buildQuote({ id: 'on-sage', quote_reference: '50001-LC', sage_posted_at: '2026-06-12T09:00:00Z' }),
      buildQuote({ id: 'not-on-sage', quote_reference: '50002-LC', sage_posted_at: null }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    expect(screen.getAllByLabelText('On Sage')).toHaveLength(2);
    expect(screen.getAllByLabelText('Not on Sage')).toHaveLength(2);

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).getByLabelText('On Sage')).toHaveTextContent('S');
    expect(within(tableBody as HTMLElement).getByLabelText('Not on Sage')).toHaveTextContent('S');
    const firstStatusCell = tableBody?.querySelector('tr:first-child td:nth-child(6)');
    const firstStatusBadges = Array.from(firstStatusCell?.querySelector('div')?.children ?? []);
    expect(firstStatusBadges[0]).toHaveAttribute('aria-label', 'On Sage');
    expect(firstStatusBadges[1]).toHaveTextContent('Confirmed');

    fireEvent.click(screen.getByRole('button', { name: /All Sage/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /On Sage/ }));

    expect(within(tableBody as HTMLElement).getByText('50001-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50002-LC')).not.toBeInTheDocument();
  });

  it('filters by date range and places reset before filter dropdowns', () => {
    const quotes = [
      buildQuote({ id: 'early', quote_reference: '50001-LC', quote_date: '2026-06-01' }),
      buildQuote({ id: 'middle', quote_reference: '50002-LC', quote_date: '2026-06-12' }),
      buildQuote({ id: 'late', quote_reference: '50003-LC', quote_date: '2026-06-30' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /All dates/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-20' } });

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50002-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50003-LC')).not.toBeInTheDocument();

    const filterRow = screen.getByRole('button', { name: /Reset Filters/ }).parentElement;
    expect(filterRow?.children[0]).toHaveTextContent('Reset Filters');
    expect(filterRow?.children[1]).toHaveTextContent('2026-06-10 to 2026-06-20');
  });
});
