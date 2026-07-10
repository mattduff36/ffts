/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuoteFormDialog } from '@/app/(dashboard)/quotes/components/QuoteFormDialog';
import type { Quote } from '@/app/(dashboard)/quotes/types';

const mockUseAuth = vi.fn();

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('QuoteFormDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => undefined),
    customers: [
      {
        id: 'customer-1',
        company_name: 'Acme Ltd',
        short_name: null,
        contact_name: 'Alice Example',
        contact_email: 'alice@example.com',
        address_line_1: '1 Example Street',
        address_line_2: null,
        city: 'Nottingham',
        county: 'Nottinghamshire',
        postcode: 'NG1 1AA',
        default_validity_days: 30,
        secondary_contacts: [
          {
            id: 'contact-1',
            customer_id: 'customer-1',
            name: 'Chris CC',
            job_title: 'Buyer',
            email: 'chris@example.com',
            phone: null,
          },
        ],
      },
    ],
    managerOptions: [
      {
        profile_id: 'manager-1',
        initials: 'ME',
        next_number: 42,
        number_start: 1,
        signoff_name: 'Manager Example',
        signoff_title: 'Contracts Manager',
        manager_email: 'manager@example.com',
        approver_profile_id: null,
        is_active: true,
        profile: {
          id: 'manager-1',
          full_name: 'Manager Example',
          email: 'manager@example.com',
        },
        approver: null,
      },
    ],
    approvers: [],
  };

  it('preserves in-progress form values when auth state refreshes while open', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    const { rerender } = render(<QuoteFormDialog {...baseProps} />);

    const subjectInput = screen.getByPlaceholderText(
      'e.g. Supply of Fence Panels & Accessories'
    ) as HTMLInputElement;

    fireEvent.change(subjectInput, {
      target: { value: 'Fence panels for rear compound' },
    });

    expect(subjectInput.value).toBe('Fence panels for rear compound');

    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    rerender(<QuoteFormDialog {...baseProps} />);

    expect(
      (
        screen.getByPlaceholderText(
          'e.g. Supply of Fence Panels & Accessories'
        ) as HTMLInputElement
      ).value
    ).toBe('Fence panels for rear compound');
  });

  it('shows the new client fields and hides auto-populated manager fields', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(<QuoteFormDialog {...baseProps} />);

    expect(screen.getByText('Quote Details')).toBeInTheDocument();
    expect(screen.getByText('Quote Content')).toBeInTheDocument();
    expect(screen.getByText('Title *')).toBeInTheDocument();
    expect(screen.getByText('Summary *')).toBeInTheDocument();
    expect(screen.getByText('Scope *')).toBeInTheDocument();
    expect(screen.getByText('Estimated Duration (days)')).toBeInTheDocument();
    expect(screen.queryByText('Requester Initials')).not.toBeInTheDocument();
    expect(screen.queryByText('Approver')).not.toBeInTheDocument();
    expect(screen.queryByText('Manager Email')).not.toBeInTheDocument();
  });

  it('disables quote detail fields until a customer is selected', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(<QuoteFormDialog {...baseProps} />);

    const validityInput = screen.getByRole('spinbutton', { name: /validity days/i }) as HTMLInputElement;
    const attentionInput = screen.getByRole('textbox', { name: /for the attention of/i }) as HTMLInputElement;

    expect(validityInput).toBeDisabled();
    expect(attentionInput).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /select customer/i }));
    fireEvent.click(screen.getByText('Acme Ltd'));

    expect(validityInput).not.toBeDisabled();
    expect(attentionInput).not.toBeDisabled();
  });

  it('generates and applies a beta AI quote draft', async () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        subject_line: 'Installation of signage posts - Middlebeck Way',
        project_description: 'Install six sets of signage posts along Middlebeck Way, with final positions to be confirmed.',
        scope: '- Mobilise two operatives and HIAB vehicle.\n- Excavate post holes and spread spoil locally.\n- Concrete sleeves and install posts.',
        caveats: ['Confirm final positions before issue.'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuoteFormDialog {...baseProps} />);

    expect(screen.getByText('Beta feature')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open ai helper/i }));
    fireEvent.change(screen.getByLabelText('Customer email'), {
      target: {
        value: 'Would you be able to quote me for installing six sets of posts along Middlebeck Way?',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(await screen.findByText('Installation of signage posts - Middlebeck Way')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /apply to quote/i }));

    expect(
      (screen.getByPlaceholderText('e.g. Supply of Fence Panels & Accessories') as HTMLInputElement).value
    ).toBe('Installation of signage posts - Middlebeck Way');
    expect(
      (screen.getByPlaceholderText('Brief customer-facing summary') as HTMLTextAreaElement).value
    ).toContain('Install six sets of signage posts');
    expect(
      (screen.getByPlaceholderText('Describe the included scope of works') as HTMLTextAreaElement).value
    ).toContain('Mobilise two operatives');
    expect(fetchMock).toHaveBeenCalledWith('/api/quotes/assist', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('adds contact names to duplicate customer names in the customer selector', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(
      <QuoteFormDialog
        {...baseProps}
        customers={[
          {
            ...baseProps.customers[0],
            id: 'customer-1',
            company_name: 'Exolum',
            contact_name: 'Matthew Fitzgerald',
          },
          {
            ...baseProps.customers[0],
            id: 'customer-2',
            company_name: 'Exolum',
            contact_name: 'Julian Posner',
            contact_email: 'julian@example.com',
          },
          {
            ...baseProps.customers[0],
            id: 'customer-3',
            company_name: 'Johnsons Aggregates And Recycling Ltd',
            contact_name: 'Kevin Marshall',
            contact_email: 'kevin@example.com',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /select customer/i }));

    expect(screen.getByText('Exolum [Matthew Fitzgerald]')).toBeInTheDocument();
    expect(screen.getByText('Exolum [Julian Posner]')).toBeInTheDocument();
    expect(screen.getByText('Johnsons Aggregates And Recycling Ltd')).toBeInTheDocument();
  });

  it('filters customer options while typing in the customer selector', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(
      <QuoteFormDialog
        {...baseProps}
        customers={[
          {
            ...baseProps.customers[0],
            id: 'customer-1',
            company_name: 'Acme Ltd',
          },
          {
            ...baseProps.customers[0],
            id: 'customer-2',
            company_name: 'Beta Utilities',
            contact_name: 'Beth Example',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /select customer/i }));
    fireEvent.change(screen.getByPlaceholderText('Search customers...'), {
      target: { value: 'beta' },
    });

    expect(screen.queryByText('Acme Ltd')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Utilities')).toBeInTheDocument();
  });

  it('opens add customer action from the customer selector', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });
    const onAddCustomer = vi.fn();

    render(<QuoteFormDialog {...baseProps} onAddCustomer={onAddCustomer} />);

    fireEvent.click(screen.getByRole('button', { name: /select customer/i }));
    fireEvent.click(screen.getByRole('button', { name: /add new customer/i }));

    expect(onAddCustomer).toHaveBeenCalledTimes(1);
  });

  it('requires a site address before submitting a new quote', async () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });
    const onSubmit = vi.fn(async () => undefined);

    render(
      <QuoteFormDialog
        {...baseProps}
        onSubmit={onSubmit}
        customers={[
          {
            ...baseProps.customers[0],
            address_line_1: null,
            address_line_2: null,
            city: null,
            county: null,
            postcode: null,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /select customer/i }));
    fireEvent.click(screen.getByText('Acme Ltd'));
    fireEvent.click(screen.getByRole('button', { name: /create quote/i }));

    expect(await screen.findByText('Enter the site address for this quote.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits selected secondary customer contacts as additional To recipients', async () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });
    (Element.prototype as unknown as { hasPointerCapture?: (pointerId: number) => boolean }).hasPointerCapture ??= () => false;
    const onSubmit = vi.fn(async () => undefined);

    render(<QuoteFormDialog {...baseProps} initialCustomerId="customer-1" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /alice@example.com/i }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /chris cc/i }));
    expect(screen.getByRole('button', { name: /alice@example.com, plus 1 more/i })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g. Supply of Fence Panels & Accessories'), {
      target: { value: 'Fence repairs' },
    });
    fireEvent.change(screen.getByPlaceholderText('Brief customer-facing summary'), {
      target: { value: 'Repair damaged fence panels.' },
    });
    fireEvent.change(screen.getByPlaceholderText('Describe the included scope of works'), {
      target: { value: 'Replace broken bays and clear waste.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create quote/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          secondary_contact_ids: ['contact-1'],
        }),
        false
      );
    });
  });

  it('shows open, replace, and remove controls for saved client attachments', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    const quote = {
      id: 'quote-1',
      customer_id: 'customer-1',
      requester_id: 'manager-1',
      requester_initials: 'ME',
      quote_date: '2026-05-02',
      subject_line: 'Fence repairs',
      project_description: 'Repair damaged fence panels',
      scope: 'Replace broken bays',
      validity_days: 30,
      pricing_mode: 'attachments_only',
      is_latest_version: true,
      attachments: [
        {
          id: 'attachment-1',
          quote_id: 'quote-1',
          file_name: 'pricing-sheet.pdf',
          file_path: 'quote-1/pricing-sheet.pdf',
          content_type: 'application/pdf',
          file_size: 1024,
          uploaded_by: 'manager-1',
          created_at: '2026-05-02T08:00:00.000Z',
          is_client_visible: true,
          attachment_purpose: 'client_pricing',
        },
      ],
      line_items: [],
    } as unknown as Quote;

    render(<QuoteFormDialog {...baseProps} quote={quote} />);

    expect(screen.getByText('Existing client-visible attachments')).toBeInTheDocument();
    expect(screen.getByText('pricing-sheet.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });
});
