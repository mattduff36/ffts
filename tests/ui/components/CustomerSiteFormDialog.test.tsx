/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerSiteFormDialog } from '@/app/(dashboard)/customers/components/CustomerSiteFormDialog';

describe('CustomerSiteFormDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves a failed draft, retries one insert, and selects the saved site', async () => {
    const site = { id: 'site-new', customer_id: 'customer-1', site_name: 'North depot' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Permission denied' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ site }) });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CustomerSiteFormDialog open customerId="customer-1" onCreated={onCreated} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Site Name *'), { target: { value: 'North depot' } });
    fireEvent.change(screen.getByLabelText('Address Line 1 *'), { target: { value: '10 Test Lane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByLabelText('Site Name *')).toHaveValue('North depot');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(site));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.sites).toHaveLength(1);
    expect(request.sites[0]).toMatchObject({ site_name: 'North depot', address_line_1: '10 Test Lane' });
  });

  it('ignores a second submit while saving and allows cancellation without saving', async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const first = render(<CustomerSiteFormDialog open customerId="customer-1" onCreated={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    first.unmount();
    render(<CustomerSiteFormDialog open customerId="customer-1" onCreated={vi.fn()} onClose={vi.fn()} />);
    const form = screen.getByRole('button', { name: 'Add site' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
  });
});
