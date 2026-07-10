/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  getLegacyQuoteManagerFilterValue,
  LegacyQuotesTable,
} from '@/app/(dashboard)/quotes/components/LegacyQuotesTable';
import type { LegacyQuote } from '@/app/(dashboard)/quotes/types';

function buildLegacyQuote(overrides: Partial<LegacyQuote>): LegacyQuote {
  return {
    id: overrides.id || 'legacy-1',
    source_row: overrides.source_row || 2,
    quote_reference: overrides.quote_reference || '4000-EX',
    customer_name: overrides.customer_name || 'Default Customer',
    title: overrides.title || 'Legacy Works',
    quote_date: overrides.quote_date || '2026-01-01',
    quote_date_raw: overrides.quote_date_raw ?? null,
    quote_manager_name: overrides.quote_manager_name || 'Example Manager',
    quote_manager_initials: overrides.quote_manager_initials || 'EX',
    quote_value_text: overrides.quote_value_text !== undefined ? overrides.quote_value_text : '£100',
    quote_value_amount: overrides.quote_value_amount !== undefined ? overrides.quote_value_amount : 100,
    comments: overrides.comments || 'Imported quote',
    created_at: overrides.created_at || '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at || '2026-01-01T00:00:00Z',
  };
}

function buildLegacyPaginationQuotes(firstQuoteOverrides: Partial<LegacyQuote> = {}): LegacyQuote[] {
  return Array.from({ length: 51 }, (_, index) => {
    const quoteDate = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);

    return buildLegacyQuote({
      id: `legacy-page-${index}`,
      source_row: index + 2,
      quote_reference: `${(4000 + index).toString()}-EX`,
      quote_date: quoteDate,
      customer_name: `Legacy Customer ${String(index).padStart(3, '0')}`,
      title: `Legacy details ${String(index).padStart(3, '0')}`,
      ...(index === 0 ? firstQuoteOverrides : {}),
    });
  });
}

describe('LegacyQuotesTable', () => {
  it('normalizes manager whitespace under the same filter', () => {
    render(
      <LegacyQuotesTable
        managerFilter={getLegacyQuoteManagerFilterValue('Example Manager')}
        legacyQuotes={[
          buildLegacyQuote({ id: 'correct', quote_reference: '4001-EX', quote_manager_name: 'Example Manager' }),
          buildLegacyQuote({ id: 'spaced', quote_reference: '4002-EX', quote_manager_name: ' Example   Manager ' }),
          buildLegacyQuote({ id: 'other', quote_reference: '4003-OT', quote_manager_name: 'Other Manager' }),
        ]}
      />
    );

    expect(screen.getAllByText('4001-EX').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4002-EX').length).toBeGreaterThan(0);
    expect(screen.queryByText('4003-OT')).not.toBeInTheDocument();
  });

  it('reveals legacy quotes with Show More', () => {
    const legacyQuotes = buildLegacyPaginationQuotes();

    const { container } = render(<LegacyQuotesTable legacyQuotes={legacyQuotes} />);
    const tableBody = container.querySelector('tbody');
    expect(tableBody?.querySelectorAll('tr')).toHaveLength(50);
    expect(screen.getByText('Showing 50 of 51 legacy quotes')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('4000-EX')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));

    expect(tableBody?.querySelectorAll('tr')).toHaveLength(51);
    expect(within(tableBody as HTMLElement).getByText('4000-EX')).toBeInTheDocument();
    expect(screen.getByText('Showing all 51 legacy quotes')).toBeInTheDocument();
  });

  it('sorts by clickable column headers and uses overview-style details and total columns', () => {
    const { container } = render(
      <LegacyQuotesTable
        legacyQuotes={[
          buildLegacyQuote({ id: 'b', quote_reference: '4002-EX', customer_name: 'Beta Customer', quote_date: '2026-01-02' }),
          buildLegacyQuote({ id: 'a', quote_reference: '4001-EX', customer_name: 'Alpha Customer', quote_date: '2026-01-01' }),
        ]}
      />
    );

    const tableHead = container.querySelector('thead');
    expect(tableHead).not.toBeNull();
    expect(within(tableHead as HTMLElement).getByRole('button', { name: /Details/ })).toBeInTheDocument();
    expect(within(tableHead as HTMLElement).getByRole('button', { name: /Total/ })).toBeInTheDocument();
    expect(within(tableHead as HTMLElement).queryByText('Comments')).not.toBeInTheDocument();

    fireEvent.click(within(tableHead as HTMLElement).getByRole('button', { name: /Customer/ }));

    const firstRow = container.querySelector('tbody tr');
    expect(firstRow).not.toBeNull();
    expect(within(firstRow as HTMLElement).getByText('Alpha Customer')).toBeInTheDocument();
  });

  it('keeps quote number and customer out of legacy Details cells', () => {
    const { container } = render(
      <LegacyQuotesTable
        legacyQuotes={[
          buildLegacyQuote({
            id: 'details-cleanup',
            quote_reference: '4001-EX',
            customer_name: 'Alpha Customer',
            title: '4001-EX - Alpha Customer - Pump overhaul',
          }),
        ]}
      />
    );

    const firstRowCells = container.querySelectorAll('tbody tr:first-child td');
    expect(firstRowCells[2]).toHaveTextContent('Pump overhaul');
    expect(firstRowCells[2]).not.toHaveTextContent('4001-EX');
    expect(firstRowCells[2]).not.toHaveTextContent('Alpha Customer');
  });

  it('searches the full legacy result set before slicing visible rows', () => {
    const legacyQuotes = buildLegacyPaginationQuotes({
      id: 'hidden-search',
      quote_reference: '3999-GH',
      title: 'Hidden pump station works',
    });
    const { container } = render(<LegacyQuotesTable legacyQuotes={legacyQuotes} />);
    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('3999-GH')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search quotes...'), { target: { value: 'Hidden pump station' } });

    expect(within(tableBody as HTMLElement).getByText('3999-GH')).toBeInTheDocument();
    expect(screen.queryByText('Showing 50 of 51 legacy quotes')).not.toBeInTheDocument();
  });

  it('filters the full legacy result set before slicing visible rows', () => {
    const legacyQuotes = buildLegacyPaginationQuotes({
      id: 'hidden-date',
      quote_reference: '3998-GH',
      quote_date: '2025-12-31',
    });
    const { container } = render(<LegacyQuotesTable legacyQuotes={legacyQuotes} />);
    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('3998-GH')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All dates/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-12-31' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-12-31' } });

    expect(within(tableBody as HTMLElement).getByText('3998-GH')).toBeInTheDocument();
    expect(screen.queryByText('Showing 50 of 51 legacy quotes')).not.toBeInTheDocument();
  });

  it('sorts the full legacy result set before slicing visible rows', () => {
    const legacyQuotes = buildLegacyPaginationQuotes({
      id: 'hidden-sort',
      quote_reference: '3997-GH',
      customer_name: 'Aardvark Legacy Customer',
    });
    const { container } = render(<LegacyQuotesTable legacyQuotes={legacyQuotes} />);
    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('3997-GH')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Customer/ }));

    const firstRow = tableBody?.querySelector('tr');
    expect(firstRow).not.toBeNull();
    expect(within(firstRow as HTMLElement).getByText('3997-GH')).toBeInTheDocument();
    expect(screen.getByText('Showing 50 of 51 legacy quotes')).toBeInTheDocument();
  });

  it('leaves the total cell blank when the original CSV total value is blank', () => {
    const { container } = render(
      <LegacyQuotesTable
        legacyQuotes={[
          buildLegacyQuote({
            id: 'blank-total',
            quote_reference: '4001-EX',
            quote_value_text: null,
            quote_value_amount: null,
          }),
        ]}
      />
    );

    const firstRowCells = container.querySelectorAll('tbody tr:first-child td');
    expect(firstRowCells).toHaveLength(6);
    expect(firstRowCells[5]).toHaveTextContent('');
  });

  it('keeps legacy quote edit actions hidden by default', () => {
    render(<LegacyQuotesTable legacyQuotes={[buildLegacyQuote({ id: 'read-only' })]} />);

    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Legacy Quote/ })).not.toBeInTheDocument();
  });

  it('lets admins submit legacy quote edits', async () => {
    const onLegacyQuoteUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <LegacyQuotesTable
        legacyQuotes={[buildLegacyQuote({ id: 'editable', quote_reference: '4001-EX' })]}
        canEditLegacyQuotes
        onLegacyQuoteUpdate={onLegacyQuoteUpdate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Updated Customer' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Updated details' } });
    fireEvent.change(screen.getByLabelText('Total'), { target: { value: '£250.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => {
      expect(onLegacyQuoteUpdate).toHaveBeenCalledWith('editable', {
        quote_reference: '4001-EX',
        customer_name: 'Updated Customer',
        title: 'Updated details',
        quote_date: '2026-01-01',
        quote_manager_name: 'Example Manager',
        quote_value_text: '£250.00',
        comments: 'Imported quote',
      });
    });
  });

  it('filters legacy quotes by date range with overview-style filter controls', () => {
    const { container } = render(
      <LegacyQuotesTable
        legacyQuotes={[
          buildLegacyQuote({ id: 'early', quote_reference: '4001-EX', quote_date: '2026-01-01' }),
          buildLegacyQuote({ id: 'middle', quote_reference: '4002-EX', quote_date: '2026-01-15' }),
          buildLegacyQuote({ id: 'late', quote_reference: '4003-EX', quote_date: '2026-01-31' }),
        ]}
      />
    );

    expect(screen.getByRole('button', { name: /All dates/ })).toBeInTheDocument();
    expect(screen.queryByText('Legacy Quotes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All dates/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-20' } });

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('4001-EX')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('4002-EX')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('4003-EX')).not.toBeInTheDocument();
  });
});
