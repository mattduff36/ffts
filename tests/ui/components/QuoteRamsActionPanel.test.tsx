/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuoteRamsActionPanel } from '@/app/(dashboard)/quotes/components/QuoteRamsActionPanel';

const mockUseAuth = vi.fn();

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const quoteId = '22222222-2222-4222-8222-222222222222';

function contextResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      action: {
        id: 'action-1',
        quote_id: quoteId,
        quote_reference: 'Q-100',
        status: 'open',
        assignee_profile_id: 'manager-1',
        assignee_name: 'Alex Manager',
        assigned_by: 'user-1',
        rams_document_id: null,
        requested_by: 'user-1',
        requested_at: '2026-10-11T12:00:00.000Z',
        completed_by: null,
        completed_at: null,
        confirmation_note: null,
        email_status: 'sent',
        email_error: null,
      },
      eligible_managers: [{ profile_id: 'manager-2', full_name: 'Blair Manager', initials: 'BM' }],
      linked_documents: [],
    }),
  };
}

describe('QuoteRamsActionPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hides completion from someone who is not the assignee or an admin', async () => {
    mockUseAuth.mockReturnValue({ profile: { id: 'other-user' }, isAdmin: false, isManager: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(contextResponse()));

    render(<QuoteRamsActionPanel quoteId={quoteId} />);

    expect(await screen.findByText(/Alex Manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm complete' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the assigned manager or an admin can confirm completion/)).toBeInTheDocument();
  });

  it('requires a linked document before the assignee or an admin can confirm completion', async () => {
    mockUseAuth.mockReturnValue({ profile: { id: 'manager-1' }, isAdmin: false, isManager: true });
    const fetchMock = vi.fn().mockResolvedValue(contextResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<QuoteRamsActionPanel quoteId={quoteId} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm complete' }));

    expect(await screen.findByText(/Choose an active RAMS document linked to this quote/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/quotes/${quoteId}/rams-action`);

    mockUseAuth.mockReturnValue({ profile: { id: 'admin-1' }, isAdmin: true, isManager: false });
    rerender(<QuoteRamsActionPanel quoteId={quoteId} />);

    expect(screen.getByRole('button', { name: 'Confirm complete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm complete' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps an email failure warning visible after refreshing the saved action', async () => {
    mockUseAuth.mockReturnValue({ profile: { id: 'manager-1' }, isAdmin: false, isManager: true });
    const initial = contextResponse();
    const body = await initial.json();
    body.action.email_status = 'failed';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ...initial, json: async () => body })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ action: body.action, created: false, email_warning: 'Delivery failed; retry later.' }) })
      .mockResolvedValue({ ...initial, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    render(<QuoteRamsActionPanel quoteId={quoteId} />);
    fireEvent.click(await screen.findByRole('button', { name: /Retry.*email/i }));
    expect(await screen.findByText(/Saved. Delivery failed; retry later./)).toBeInTheDocument();
    expect(await screen.findByText(/Alex Manager/)).toBeInTheDocument();
    expect(screen.getByText(/Saved. Delivery failed; retry later./)).toBeInTheDocument();
  });

  it('shows a quotes access error instead of an empty success state', async () => {
    mockUseAuth.mockReturnValue({ profile: { id: 'manager-1' }, isAdmin: false, isManager: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Quotes access is required.' }),
    }));

    render(<QuoteRamsActionPanel quoteId={quoteId} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Quotes access is required.');
    expect(screen.queryByText(/No RAMS action is recorded/)).not.toBeInTheDocument();
  });
});
