/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import QuotesPage from '@/app/(dashboard)/quotes/page';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const mockUsePermissionCheck = vi.fn();
const mockUseAuth = vi.fn();
const mockFetchAllPaginatedItems = vi.fn();
const quotesTableMock = vi.fn();
const quoteFormDialogMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  usePathname: () => '/quotes',
  useSearchParams: () => searchParamsMock,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: (moduleName: string, redirectOnFail?: boolean) =>
    mockUsePermissionCheck(moduleName, redirectOnFail),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/client/paginated-fetch', () => ({
  fetchAllPaginatedItems: (...args: unknown[]) => mockFetchAllPaginatedItems(...args),
}));

vi.mock('@/components/layout/AppPageShell', () => ({
  AppPageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/page-loader', () => ({
  PageLoader: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/ui/tabs', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  interface TabsContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  interface TabsProps extends TabsContextValue {
    children: ReactNode;
    className?: string;
  }

  interface TabsTriggerProps {
    value: string;
    children: ReactNode;
    className?: string;
    title?: string;
  }

  interface TabsContentProps {
    value: string;
    children: ReactNode;
    className?: string;
  }

  const TabsContext = React.createContext<TabsContextValue>({});

  return {
    Tabs: ({ children, value, onValueChange, className }: TabsProps) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div className={className}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    TabsTrigger: ({ children, value, className, title }: TabsTriggerProps) => {
      const tabs = React.useContext(TabsContext);

      return (
        <button
          type="button"
          role="tab"
          aria-selected={tabs.value === value}
          className={className}
          title={title}
          onMouseDown={() => tabs.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value, className }: TabsContentProps) => {
      const tabs = React.useContext(TabsContext);
      if (tabs.value !== value) return null;

      return <div className={className}>{children}</div>;
    },
  };
});

vi.mock('@/components/security/SensitiveModuleGate', () => ({
  SensitiveModuleGate: () => <div>Sensitive module gate</div>,
  SensitiveModuleSessionManager: () => null,
  useSensitiveModuleAccess: () => ({
    canAccess: true,
    loading: false,
    status: {
      requiresSensitivePin: false,
      hasPin: true,
      unlocked: true,
      expiresAt: null,
    },
    refreshStatus: vi.fn(),
  }),
}));

vi.mock('@/app/(dashboard)/quotes/components/QuotesTable', () => ({
  QuotesTable: (props: { quotes: Array<{ id: string }>; managerFilter?: string; emptyMessage?: string }) => {
    quotesTableMock(props);
    return <div>Quotes table</div>;
  },
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteDetailsModal', () => ({
  QuoteDetailsModal: () => null,
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteFormDialog', () => ({
  QuoteFormDialog: (props: { open: boolean; customers: Array<{ id: string; company_name: string }> }) => {
    quoteFormDialogMock(props);
    return props.open ? <div data-testid="quote-form-dialog" /> : null;
  },
}));

describe('Quotes page customer access states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock = new URLSearchParams();
    window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
    mockUseAuth.mockReturnValue({
      isAdmin: false,
      isSuperAdmin: false,
      isActualSuperAdmin: false,
    });

    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes') {
        return { hasPermission: true, loading: false };
      }

      if (moduleName === 'customers') {
        return { hasPermission: false, loading: false };
      }

      return { hasPermission: false, loading: false };
    });

    mockFetchAllPaginatedItems.mockResolvedValue({
      items: [],
      firstPagePayload: null,
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('disables the new quote button when the user cannot access customers', async () => {
    render(<QuotesPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Quote' })).toBeDisabled();
    });

    expect(screen.getByText('Customer access is required to create quotes.')).toBeInTheDocument();
    expect(
      mockFetchAllPaginatedItems.mock.calls.some(([endpoint]) => endpoint === '/api/quotes')
    ).toBe(true);
    expect(
      mockFetchAllPaginatedItems.mock.calls.some(([endpoint]) => endpoint === '/api/customers')
    ).toBe(false);
  });

  it('loads customers before opening the new quote form when initial metadata omits them', async () => {
    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes' || moduleName === 'customers') {
        return { hasPermission: true, loading: false };
      }

      return { hasPermission: false, loading: false };
    });

    const customer = {
      id: 'customer-1',
      company_name: 'Acme Ltd',
      short_name: null,
      contact_name: 'Alice Example',
      contact_email: 'alice@example.com',
      address_line_1: '1 Example Street',
      address_line_2: null,
      city: 'Nottingham',
      county: null,
      postcode: 'NG1 1AA',
      default_validity_days: 30,
      secondary_contacts: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/quotes/metadata?include_customers=true') {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
            customers: [customer],
          }),
        } as Response;
      }

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<QuotesPage />);

    const newQuoteButton = await screen.findByRole('button', { name: 'New Quote' });
    await waitFor(() => expect(newQuoteButton).not.toBeDisabled());

    fireEvent.click(newQuoteButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/quotes/metadata?include_customers=true');
      expect(screen.getByTestId('quote-form-dialog')).toBeInTheDocument();
    });
    expect(quoteFormDialogMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      customers: [customer],
    }));
  });

  it('does not log transient customer metadata fetch failures as console errors', async () => {
    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes' || moduleName === 'customers') {
        return { hasPermission: true, loading: false };
      }

      return { hasPermission: false, loading: false };
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/quotes/metadata?include_customers=true') {
        throw new TypeError('Load failed');
      }

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      render(<QuotesPage />);

      const newQuoteButton = await screen.findByRole('button', { name: 'New Quote' });
      await waitFor(() => expect(newQuoteButton).not.toBeDisabled());

      fireEvent.click(newQuoteButton);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/quotes/metadata?include_customers=true');
      });
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'Error fetching quote customers:',
        expect.any(TypeError),
        expect.objectContaining({ errorContextId: 'quotes-fetch-customers-error' })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('renders quote page tabs in the requested order', async () => {
    render(<QuotesPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Quote' })).toBeDisabled();
    });

    const tabNames = screen
      .getAllByRole('tab')
      .map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());

    expect(tabNames.slice(0, 6)).toEqual(['Overview', 'Current', 'Projects', 'Archived', 'Legacy', 'Settings']);
    expect(screen.queryByRole('tab', { name: 'Legacy Quotes' })).not.toBeInTheDocument();
  });

  it('passes only current quotes into the current table', async () => {
    searchParamsMock = new URLSearchParams('tab=current');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'current-open',
            quote_reference: '50001-LC',
            requester_id: 'current-manager',
            manager_name: 'Current Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'archived-commercial',
            quote_reference: '50002-LC',
            requester_id: 'archived-manager',
            manager_name: 'Archived Manager',
            status: 'sent',
            commercial_status: 'closed',
          },
          {
            id: 'archived-status',
            quote_reference: '50003-LC',
            requester_id: 'archived-status-manager',
            manager_name: 'Archived Status Manager',
            status: 'closed',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    render(<QuotesPage />);

    await waitFor(() => {
      expect(quotesTableMock).toHaveBeenCalled();
    });

    const props = quotesTableMock.mock.calls.at(-1)?.[0] as { quotes: Array<{ id: string }> };
    expect(props.quotes.map((quote) => quote.id)).toEqual(['current-open']);
  });

  it('passes only archived quotes into the archived table and manager tabs', async () => {
    searchParamsMock = new URLSearchParams('tab=archived');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'current-open',
            quote_reference: '50001-LC',
            requester_id: 'current-manager',
            manager_name: 'Current Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'archived-commercial',
            quote_reference: '50002-LC',
            requester_id: 'archived-manager',
            manager_name: 'Archived Manager',
            status: 'sent',
            commercial_status: 'closed',
          },
          {
            id: 'archived-status',
            quote_reference: '50003-LC',
            requester_id: 'archived-status-manager',
            manager_name: 'Archived Status Manager',
            status: 'closed',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    render(<QuotesPage />);

    await waitFor(() => {
      expect(quotesTableMock).toHaveBeenCalled();
    });

    const props = quotesTableMock.mock.calls.at(-1)?.[0] as { quotes: Array<{ id: string }>; emptyMessage?: string };
    expect(props.quotes.map((quote) => quote.id)).toEqual(['archived-commercial', 'archived-status']);
    expect(props.emptyMessage).toBe('No archived quotes yet.');
    expect(screen.getByRole('tab', { name: 'Archived Manager' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archived Status Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Current Manager' })).not.toBeInTheDocument();
  });

  it('renders current manager tabs from quotes instead of all manager metadata', async () => {
    searchParamsMock = new URLSearchParams('tab=current');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'quote-with-manager',
            requester_id: 'manager-with-quote',
            requester_initials: 'LC',
            manager_name: 'Louis Cree',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'quote-name-only-manager',
            requester_id: null,
            requester_initials: null,
            manager_name: 'Name Only Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'quote-without-manager-label',
            requester_id: null,
            requester_initials: null,
            manager_name: '   ',
            status: 'sent',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [
              {
                profile_id: 'manager-with-quote',
                initials: 'LC',
                signoff_name: null,
                is_active: true,
                profile: { full_name: 'Louis Cree' },
              },
              {
                profile_id: 'manager-without-quote',
                initials: 'MD',
                signoff_name: null,
                is_active: true,
                profile: { full_name: 'Matt Duffill' },
              },
            ],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    render(<QuotesPage />);

    const louisTab = await screen.findByRole('tab', { name: 'Louis Cree' });
    expect(screen.getByRole('tab', { name: 'All Quotes' })).toBeInTheDocument();
    expect(louisTab).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Name Only Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Matt Duffill' })).not.toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(louisTab, { button: 0, ctrlKey: false });
    });

    expect(replaceMock).toHaveBeenCalledWith('/quotes?tab=current&manager=manager-with-quote', { scroll: false });
  });
});
