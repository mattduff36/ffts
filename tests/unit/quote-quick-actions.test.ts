import { describe, expect, it } from 'vitest';
import {
  canEditQuote,
  canRequestQuotePo,
  canTriggerQuoteRams,
  getQuoteNextWorkflowAction,
  getQuoteRecipientEmail,
} from '@/app/(dashboard)/quotes/quote-quick-actions';
import type { Quote } from '@/app/(dashboard)/quotes/types';

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

describe('quote quick actions', () => {
  it('prefers the quote attention email over the customer contact email', () => {
    expect(getQuoteRecipientEmail(buildQuote())).toBe('alex@example.com');
    expect(getQuoteRecipientEmail(buildQuote({
      attention_email: null,
    }))).toBe('billing@example.com');
  });

  it('labels the next draft step as Mark as Sent and disables it without a recipient', () => {
    const ready = getQuoteNextWorkflowAction(buildQuote({ status: 'draft' }));
    expect(ready).toEqual(expect.objectContaining({
      key: 'mark_as_sent',
      label: 'Mark as Sent',
      mode: 'immediate',
      disabled: false,
    }));

    const blocked = getQuoteNextWorkflowAction(buildQuote({
      status: 'changes_requested',
      attention_email: null,
      customer: { id: 'customer-1', company_name: 'Customer Ltd', short_name: null },
    }));
    expect(blocked).toEqual(expect.objectContaining({
      key: 'mark_as_sent',
      label: 'Mark as Sent',
      disabled: true,
    }));
  });

  it('labels the next confirmed step as Mark as Accepted and keeps Request PO as a separate capability', () => {
    const quote = buildQuote({
      status: 'sent',
      sent_at: '2026-06-13T00:00:00Z',
    });

    expect(getQuoteNextWorkflowAction(quote)).toEqual(expect.objectContaining({
      key: 'mark_as_accepted',
      label: 'Mark as Accepted',
      mode: 'confirm',
      disabled: false,
    }));
    expect(canTriggerQuoteRams(quote)).toBe(true);
    expect(canRequestQuotePo(quote)).toBe(true);
    expect(canEditQuote(quote)).toBe(false);
  });

  it('labels the next accepted or in-progress step as Mark Complete', () => {
    expect(getQuoteNextWorkflowAction(buildQuote({ status: 'po_received' }))).toEqual(
      expect.objectContaining({ key: 'mark_complete', label: 'Mark Complete', mode: 'open_details' })
    );
    expect(getQuoteNextWorkflowAction(buildQuote({ status: 'in_progress' }))).toEqual(
      expect.objectContaining({ key: 'mark_complete', label: 'Mark Complete' })
    );
  });

  it('hides next-status for archived, historical, and terminal quotes', () => {
    expect(getQuoteNextWorkflowAction(buildQuote({
      status: 'draft',
      commercial_status: 'closed',
    }))).toBeNull();
    expect(getQuoteNextWorkflowAction(buildQuote({
      status: 'draft',
      is_latest_version: false,
    }))).toBeNull();
    expect(getQuoteNextWorkflowAction(buildQuote({ status: 'invoiced' }))).toBeNull();
    expect(getQuoteNextWorkflowAction(buildQuote({ status: 'completed_full' }))).toBeNull();
  });
});
