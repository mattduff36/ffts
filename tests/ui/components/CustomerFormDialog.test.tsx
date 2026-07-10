/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomerFormDialog } from '@/app/(dashboard)/customers/components/CustomerFormDialog';

describe('CustomerFormDialog', () => {
  it('shows address guidance for single-site customers', () => {
    render(
      <CustomerFormDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />
    );

    expect(
      screen.getByText('Only add an address here if customer only has a single address / site.')
    ).toBeInTheDocument();
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
});
