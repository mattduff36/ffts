/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QuoteCreationHost } from '@/app/(dashboard)/quotes/components/QuoteCreationHost';

vi.mock('@/app/(dashboard)/quotes/components/QuoteFormDialog', () => ({
  QuoteFormDialog: (props: { onAddCustomer: () => void; createdCustomerId: string; customers: Array<{ id: string }> }) => <>
    <input aria-label="Quote draft" defaultValue="Preserved scope" />
    <button onClick={props.onAddCustomer}>New customer</button>
    <output>{props.customers.some(customer => customer.id === props.createdCustomerId) ? props.createdCustomerId : ''}</output>
  </>,
}));
vi.mock('@/app/(dashboard)/customers/components/CustomerFormDialog', () => ({
  CustomerFormDialog: (props: { onSubmit: (data: object) => Promise<void>; onClose: () => void }) => <>
    <button onClick={() => void props.onSubmit({ company_name: 'New test customer' }).then(props.onClose)}>Save customer</button>
    <button onClick={props.onClose}>Cancel customer</button>
  </>,
}));
afterEach(() => vi.unstubAllGlobals());

it('selects a newly created customer without unmounting the quote draft', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/customers'
    ? { customer: { id: 'new-customer', company_name: 'New test customer' } } : { customers: [], managerOptions: [], approvers: [] } })));
  render(<QuoteCreationHost open onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Quote draft'), { target: { value: 'Keep my work' } });
  fireEvent.click(screen.getByText('New customer'));
  fireEvent.click(screen.getByText('Cancel customer'));
  expect(screen.getByLabelText('Quote draft')).toHaveValue('Keep my work');
  fireEvent.click(screen.getByText('New customer'));
  fireEvent.click(screen.getByText('Save customer'));
  await waitFor(() => expect(screen.getByText('new-customer')).toBeInTheDocument());
  expect(screen.getByLabelText('Quote draft')).toHaveValue('Keep my work');
});
