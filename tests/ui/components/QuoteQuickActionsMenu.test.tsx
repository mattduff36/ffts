/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QuoteQuickActionsMenu } from '@/app/(dashboard)/quotes/components/QuoteQuickActionsMenu';
import type { Quote } from '@/app/(dashboard)/quotes/types';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    asChild,
    title,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    asChild?: boolean;
    title?: string;
  }) => {
    if (asChild) {
      return <div role="menuitem">{children}</div>;
    }

    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={title}
        onClick={() => {
          if (!disabled) onSelect?.();
        }}
      >
        {children}
      </button>
    );
  },
}));

function buildQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    quote_reference: '50000-LC',
    base_quote_reference: '50000-LC',
    quote_thread_id: 'thread-1',
    parent_quote_id: null,
    customer_id: 'customer-1',
    customer_site_id: null,
    requester_id: 'manager-1',
    requester_initials: 'LC',
    quote_date: '2026-06-12',
    attention_name: 'Alex',
    attention_email: 'alex@example.com',
    subject_line: 'Drainage',
    project_description: null,
    scope: null,
    salutation: null,
    site_address: null,
    validity_days: 30,
    subtotal: 100,
    total: 100,
    pricing_mode: 'itemized',
    status: 'draft',
    accepted: false,
    po_number: null,
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
    manager_name: 'Louis Cree',
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
    sage_posted_at: null,
    sage_posted_by: null,
    customer: {
      id: 'customer-1',
      company_name: 'Customer Ltd',
      short_name: null,
      contact_email: 'billing@example.com',
    },
    ...overrides,
  };
}

function renderMenu(quote: Quote) {
  const onViewDetails = vi.fn();
  const onEdit = vi.fn();
  const onWorkflowAction = vi.fn();

  render(
    <QuoteQuickActionsMenu
      quote={quote}
      onViewDetails={onViewDetails}
      onEdit={onEdit}
      onWorkflowAction={onWorkflowAction}
    />
  );

  return { onViewDetails, onEdit, onWorkflowAction };
}

describe('QuoteQuickActionsMenu', () => {
  it('shows Mark as Sent, download, edit, and details for a draft quote', () => {
    const { onWorkflowAction, onViewDetails, onEdit } = renderMenu(buildQuote({ status: 'draft' }));

    expect(screen.getByRole('button', { name: 'Quick actions for 50000-LC' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mark as Sent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/quotes/quote-1/pdf');
    expect(screen.getByRole('menuitem', { name: 'View details' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cost overview' })).toHaveAttribute('href', '/quotes/overview/50000-LC');
    expect(screen.queryByRole('menuitem', { name: 'Request PO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Accepted' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Sent' }));
    expect(onWorkflowAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'quote-1' }), 'mark_as_sent');

    fireEvent.click(screen.getByRole('menuitem', { name: 'View details' }));
    expect(onViewDetails).toHaveBeenCalledWith('quote-1');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'quote-1' }));
  });

  it('names Mark as Accepted as the next confirmed step and keeps Request PO available', () => {
    const { onWorkflowAction } = renderMenu(buildQuote({
      status: 'sent',
      sent_at: '2026-06-13T00:00:00Z',
    }));

    expect(screen.getByRole('menuitem', { name: 'Mark as Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Request PO' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Sent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Accepted' }));
    expect(onWorkflowAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }), 'mark_as_accepted');
  });

  it('hides next-status for invoiced quotes and still offers download and archive', () => {
    renderMenu(buildQuote({ status: 'invoiced' }));

    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive Quote' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Sent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Accepted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark Complete' })).not.toBeInTheDocument();
  });
});
