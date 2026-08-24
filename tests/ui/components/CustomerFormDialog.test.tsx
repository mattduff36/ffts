/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomerFormDialog } from '@/app/(dashboard)/customers/components/CustomerFormDialog';

describe('CustomerFormDialog', () => {
  it('distinguishes the correspondence address from saved work sites', () => {
    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />
    );

    expect(
      screen.getByText(/Use this for the customer's correspondence address/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved sites can be selected on quotes/i)).toBeInTheDocument();
  });

  it('submits secondary contact rows with the customer payload', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const onClose = vi.fn();

    render(
      <CustomerFormDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Company Name *'), {
      target: { value: 'Acme Ltd' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add another contact/i }));
    fireEvent.change(screen.getByLabelText('Contact Name', { selector: '#secondary_contact_name_0' }), {
      target: { value: 'Chris CC' },
    });
    fireEvent.change(screen.getByLabelText('Email', { selector: '#secondary_contact_email_0' }), {
      target: { value: 'chris@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        company_name: 'Acme Ltd',
        secondary_contacts: [
          expect.objectContaining({
            name: 'Chris CC',
            email: 'chris@example.com',
          }),
        ],
      }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('adds and deactivates a structured customer site', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Company Name *'), {
      target: { value: 'Acme Ltd' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Site' }));
    fireEvent.change(screen.getByLabelText('Site Name *'), {
      target: { value: 'North depot' },
    });
    fireEvent.change(screen.getByLabelText('Address Line 1 *'), {
      target: { value: '10 North Road' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        sites: [
          expect.objectContaining({
            site_name: 'North depot',
            address_line_1: '10 North Road',
            is_active: false,
            is_default: false,
          }),
        ],
      }));
    });
  });

  it('copies the customer address into the only site address', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByRole('button', { name: /copy customer address/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Company Name *'), {
      target: { value: 'Acme Ltd' },
    });
    fireEvent.change(screen.getByLabelText('Address Line 1'), {
      target: { value: '12 Correspondence Row' },
    });
    fireEvent.change(screen.getByLabelText('Address Line 2'), {
      target: { value: 'Unit 4' },
    });
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Leeds' },
    });
    fireEvent.change(screen.getByLabelText('County'), {
      target: { value: 'West Yorkshire' },
    });
    fireEvent.change(screen.getByLabelText('Postcode'), {
      target: { value: 'LS1 1AA' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Site' }));
    fireEvent.change(screen.getByLabelText('Site Name *'), {
      target: { value: 'Main site' },
    });

    fireEvent.click(screen.getByRole('button', { name: /copy customer address/i }));
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        address_line_1: '12 Correspondence Row',
        sites: [
          expect.objectContaining({
            site_name: 'Main site',
            address_line_1: '12 Correspondence Row',
            address_line_2: 'Unit 4',
            city: 'Leeds',
            county: 'West Yorkshire',
            postcode: 'LS1 1AA',
          }),
        ],
      }));
    });
  });

  it('moves focus to the next field on Enter instead of submitting', () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const companyName = screen.getByLabelText('Company Name *');
    const shortName = screen.getByLabelText('Short Name');
    companyName.focus();
    fireEvent.keyDown(companyName, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(shortName).toHaveFocus();
  });

  it('hides the copy-address button once a second site is added', () => {
    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Site' }));
    expect(screen.getByRole('button', { name: /copy customer address/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Site' }));
    expect(screen.queryByRole('button', { name: /copy customer address/i })).not.toBeInTheDocument();
  });

  it('keeps dirty customer values after tab hide, a customer refetch, and discard is required', () => {
    const onClose = vi.fn();
    const customer = {
      id: 'customer-1',
      company_name: 'Acme Ltd',
      short_name: 'Acme',
      contact_name: 'Alice',
      contact_email: 'alice@example.com',
      contact_phone: '',
      contact_job_title: '',
      address_line_1: '',
      address_line_2: '',
      city: '',
      county: '',
      postcode: '',
      payment_terms_days: 30,
      default_validity_days: 30,
      status: 'active' as const,
      notes: '',
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      created_by: null,
      updated_by: null,
      secondary_contacts: [],
      sites: [],
    };

    const { rerender } = render(
      <CustomerFormDialog
        open
        onClose={onClose}
        onSubmit={vi.fn(async () => undefined)}
        customer={customer}
      />
    );

    fireEvent.change(screen.getByLabelText('Company Name *'), {
      target: { value: 'Acme Holdings' },
    });

    rerender(
      <CustomerFormDialog
        open
        onClose={onClose}
        onSubmit={vi.fn(async () => undefined)}
        customer={{ ...customer }}
      />
    );

    expect((screen.getByLabelText('Company Name *') as HTMLInputElement).value).toBe('Acme Holdings');
    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Company Name *') as HTMLInputElement).value).toBe('Acme Holdings');

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
