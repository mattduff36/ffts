/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import HelpPage from '@/app/(dashboard)/help/page';
import { templateConfig } from '@/lib/config/template-config';

const replaceMock = vi.fn();
const signOutMock = vi.fn(async () => ({ error: null }));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/help',
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams('tab=install'),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'user-1' },
    isAdmin: false,
    signOut: signOutMock,
  }),
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({
    enabledModuleSet: new Set(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));

describe('Help page install tab', () => {
  function renderHelpPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <HelpPage />
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/faq')) {
        return {
          ok: true,
          json: async () => ({ success: true, articles: [], categories: [] }),
        } as Response;
      }

      if (url.includes('/api/me/permissions')) {
        return {
          ok: true,
          json: async () => ({ enabled_modules: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('shows install tab content from tab query param', async () => {
    renderHelpPage();

    await waitFor(() => {
      expect(
        screen.getByText(`Install ${templateConfig.branding.shortAppName} App`)
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Quick Support Actions')).toBeInTheDocument();
    expect(screen.getByText('Refresh App')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh app now/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /guided cache-clear steps/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /sign out now/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith('/help?tab=faq', { scroll: false });
  });
});

