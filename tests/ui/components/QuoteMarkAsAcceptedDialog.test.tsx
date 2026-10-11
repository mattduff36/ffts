/** @vitest-environment happy-dom */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuoteMarkAsAcceptedDialog } from '@/app/(dashboard)/quotes/components/QuoteMarkAsAcceptedDialog';

const quoteId = '11111111-1111-4111-8111-111111111111';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('QuoteMarkAsAcceptedDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks whether RAMS are required and offers Yes, No, and Cancel', () => {
    render(
      <QuoteMarkAsAcceptedDialog
        open
        quoteId={quoteId}
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Are RAMS required for this job?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('closes without progressing when Cancel is chosen', () => {
    const onOpenChange = vi.fn();
    const onAcceptWithoutRams = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuoteMarkAsAcceptedDialog
        open
        quoteId={quoteId}
        onOpenChange={onOpenChange}
        onAcceptWithoutRams={onAcceptWithoutRams}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAcceptWithoutRams).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/still being developed/i)).not.toBeInTheDocument();
  });

  it('progresses without RAMS when No is chosen', () => {
    const onAcceptWithoutRams = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuoteMarkAsAcceptedDialog
        open
        quoteId={quoteId}
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={onAcceptWithoutRams}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(onAcceptWithoutRams).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/still being developed/i)).not.toBeInTheDocument();
  });

  it('treats Yes with an email warning as a successful acceptance', async () => {
    const onRamsAccepted = vi.fn();
    const onAcceptWithoutRams = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      action: { id: 'action-1', quote_id: quoteId, status: 'open', email_status: 'failed' },
      created: true,
      email_warning: 'The assignee email could not be sent. The quote acceptance was kept.',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuoteMarkAsAcceptedDialog
        open
        quoteId={quoteId}
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={onAcceptWithoutRams}
        onRamsAccepted={onRamsAccepted}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(await screen.findByText(/The assignee email could not be sent/)).toBeInTheDocument();
    expect(onRamsAccepted).toHaveBeenCalledWith(expect.objectContaining({
      created: true,
      email_warning: 'The assignee email could not be sent. The quote acceptance was kept.',
    }));
    expect(onAcceptWithoutRams).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(`/api/quotes/${quoteId}/rams-action`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'accept' }),
    }));
    expect(screen.queryByText(/still being developed/i)).not.toBeInTheDocument();
  });

  it('asks for a named manager when the requester cannot be assigned', async () => {
    const onRamsAccepted = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(400, {
        error: 'Select an active quote manager.',
        code: 'manager_required',
        eligible_managers: [{ profile_id: 'mgr-1', full_name: 'Alex Manager', initials: 'AM' }],
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        action: { id: 'action-1', quote_id: quoteId, status: 'open', email_status: 'sent' },
        created: true,
        email_warning: null,
      }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuoteMarkAsAcceptedDialog
        open
        quoteId={quoteId}
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={vi.fn()}
        onRamsAccepted={onRamsAccepted}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(await screen.findByRole('option', { name: 'Alex Manager' })).toBeInTheDocument();
    expect(onRamsAccepted).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Select an active quote manager.');

    fireEvent.change(screen.getByLabelText('Quote manager'), { target: { value: 'mgr-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign and accept' }));

    expect(await screen.findByRole('button', { name: 'Assign and accept' })).toBeEnabled();
    expect(onRamsAccepted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/quotes/${quoteId}/rams-action`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'accept', manager_profile_id: 'mgr-1' }),
    }));
  });
});
