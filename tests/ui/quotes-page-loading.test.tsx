/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import QuotesPage from '@/app/(dashboard)/quotes/page';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const routerMock = { push: pushMock, replace: replaceMock };
const originalFetch = global.fetch;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;
const mockUsePermissionCheck = vi.fn();
const mockUseAuth = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function quoteListItem(id: string, reference: string) {
  return {
    id,
    quote_reference: reference,
    base_quote_reference: reference,
    quote_thread_id: id,
    customer_id: 'customer-9',
    quote_date: '2026-03-24',
    total: 1200,
    status: 'sent',
    commercial_status: 'open',
    subject_line: `${reference} drainage`,
    customer: { company_name: reference === 'Q-ALPHA' ? 'Alpha Civils' : 'Beta Civils' },
    previous_versions: [],
  };
}

describe('Quotes page list loading', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock = new URLSearchParams('customer_id=customer-9&tab=current');
    window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
    mockUseAuth.mockReturnValue({
      isAdmin: false,
      isSuperAdmin: false,
      isActualSuperAdmin: false,
    });
    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes' || moduleName === 'customers') {
        return { hasPermission: true, loading: false };
      }

      return { hasPermission: false, loading: false };
    });

    const pages: Record<string, { quotes: ReturnType<typeof quoteListItem>[]; pagination: { offset: number; limit: number; has_more: boolean } }> = {
      '0': {
        quotes: [quoteListItem('quote-1', 'Q-ALPHA')],
        pagination: { offset: 0, limit: 250, has_more: true },
      },
      '250': {
        quotes: [quoteListItem('quote-2', 'Q-BETA')],
        pagination: { offset: 250, limit: 250, has_more: false },
      },
    };

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const path = url.split('?')[0];

      if (path.endsWith('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
            customers: [],
          }),
        } as Response;
      }

      if (path.endsWith('/api/quotes')) {
        const offset = new URL(url, 'http://localhost').searchParams.get('offset') || '0';
        const page = pages[offset];
        if (!page) {
          throw new Error(`Unexpected quotes page offset: ${url}`);
        }

        return {
          ok: true,
          json: async () => page,
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it('opts every quotes page out of the global summary and still shows rows and search', async () => {
    render(<QuotesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Q-ALPHA').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Q-BETA').length).toBeGreaterThan(0);
    });

    const listUrls = vi.mocked(fetch).mock.calls
      .map(([input]) => requestUrl(input as RequestInfo | URL))
      .filter((url) => url.split('?')[0].endsWith('/api/quotes'));

    expect(listUrls).toHaveLength(2);
    const offsets = listUrls.map((url) => {
      const params = new URL(url, 'http://localhost').searchParams;
      expect(params.get('include_summary')).toBe('false');
      expect(params.get('customer_id')).toBe('customer-9');
      expect(params.get('limit')).toBe('250');
      return params.get('offset');
    });
    expect(offsets).toEqual(['0', '250']);

    fireEvent.change(screen.getByPlaceholderText('Search quotes...'), {
      target: { value: 'ALPHA' },
    });

    expect(screen.getAllByText('Q-ALPHA').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Q-BETA')).toHaveLength(0);
    expect(screen.getAllByText('Alpha Civils').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Beta Civils')).toHaveLength(0);
  });
});
