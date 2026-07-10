/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectNumbersTab } from '@/app/(dashboard)/quotes/components/ProjectNumbersTab';
import type { QuoteProjectNumber } from '@/app/(dashboard)/quotes/types';

function buildProjectNumber(overrides: Partial<QuoteProjectNumber> = {}): QuoteProjectNumber {
  return {
    id: 'project-1',
    project_reference: '60001-MD',
    manager_profile_id: 'manager-1',
    requester_initials: 'MD',
    title: 'Emergency enabling works',
    description: 'Track costs before customer confirmation',
    status: 'open',
    linked_quote_id: null,
    linked_at: null,
    converted_quote_id: null,
    converted_at: null,
    cancelled_at: null,
    notes: null,
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
    manager: {
      id: 'manager-1',
      full_name: 'Matt Duffill',
    },
    costs: [
      {
        id: 'cost-1',
        project_number_id: 'project-1',
        cost_date: '2026-06-14',
        category: 'materials',
        supplier: 'Supplier Ltd',
        description: 'Temporary materials',
        amount: 125.5,
        notes: null,
        linked_quote_id: null,
        linked_quote_line_item_id: null,
        linked_at: null,
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-06-14T10:00:00Z',
        updated_at: '2026-06-14T10:00:00Z',
      },
    ],
    manual_cost_total: 125.5,
    unlinked_manual_cost_total: 125.5,
    labour_summary: {
      total_hours: 7.5,
      entry_count: 1,
      timesheet_count: 1,
      employee_count: 1,
      first_week_ending: '2026-06-19',
      last_week_ending: '2026-06-19',
    },
    ...overrides,
  };
}

describe('ProjectNumbersTab', () => {
  it('shows project number costs and labour-hour summary', () => {
    render(
      <ProjectNumbersTab
        projectNumbers={[buildProjectNumber()]}
        managerOptions={[]}
        quotes={[]}
        customers={[]}
        canViewCustomers
        onRefresh={vi.fn()}
        onOpenQuote={vi.fn()}
      />
    );

    expect(screen.getByText('Project Numbers')).toBeInTheDocument();
    expect(screen.getByText('60001-MD')).toBeInTheDocument();
    expect(screen.getByText('Emergency enabling works')).toBeInTheDocument();
    expect(screen.getAllByText('£125.50').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('7.50 hrs')).toBeInTheDocument();
    expect(screen.getAllByText('Temporary materials').length).toBeGreaterThanOrEqual(1);
  });
});
