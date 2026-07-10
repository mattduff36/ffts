/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Navbar } from '@/components/layout/Navbar';

const authMockState = {
  user: { id: 'user-1' },
  profile: { id: 'user-1', full_name: 'Test User' },
  signOut: vi.fn(async () => ({ error: null })),
  isAdmin: false,
  isManager: false,
  isActualSuperAdmin: false,
  isViewingAs: false,
};

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => ({ id: 'test-channel' })),
      };
      return channel;
    }),
    removeChannel: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authMockState,
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({
    enabledModuleSet: new Set(['timesheets', 'absence', 'help']),
  }),
}));

vi.mock('@/lib/hooks/useNavMetrics', () => ({
  useRamsAssignmentSummary: () => ({ data: { hasAssignments: false, pendingCount: 0 } }),
  usePendingAbsenceCount: () => ({ count: 0 }),
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: false,
    toggleTabletMode: vi.fn(),
  }),
}));

vi.mock('@/components/layout/TabletModeToggleActions', () => ({
  TabletModeToggleActions: () => <span>Tablet toggle</span>,
}));

vi.mock('@/components/layout/SidebarNav', () => ({
  SidebarNav: () => null,
}));

vi.mock('@/components/messages/NotificationPanel', () => ({
  NotificationPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="notification-panel-open">panel open</div> : null,
}));

describe('Navbar desktop burger menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(authMockState, {
      user: { id: 'user-1' },
      profile: { id: 'user-1', full_name: 'Test User' },
      isAdmin: false,
      isManager: false,
      isActualSuperAdmin: false,
      isViewingAs: false,
    });

    // @ts-expect-error - tests provide a lightweight ResizeObserver mock.
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/superadmin/active-users')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            activeWindowMinutes: 5,
            generatedAt: '2026-03-30T12:00:00.000Z',
            activeNowUsers: [],
            recentUsers: [
              {
                userId: 'u1',
                fullName: 'User One',
                lastVisitedAt: '2026-03-30T11:59:00.000Z',
                path: '/dashboard',
                roleDisplayName: 'Admin',
                teamName: 'HQ',
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, unread_count: 2 }),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('renders expected desktop burger actions and opens notifications panel', async () => {
    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByTitle('Menu')).toBeInTheDocument();
      expect(screen.getByTestId('desktop-burger-notification-badge')).toBeInTheDocument();
    });

    const menuButton = screen.getByTitle('Menu');
    fireEvent.pointerDown(menuButton);
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Lock / Switch' })).toBeNull();
      expect(screen.getByText('Notifications')).toBeTruthy();
      expect(screen.getByTestId('desktop-menu-notification-link-badge')).toBeInTheDocument();
      expect(screen.getByText('Help')).toBeTruthy();
      expect(screen.getByText('Sign Out')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Notifications'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-panel-open')).toBeInTheDocument();
    });
  });

  it('shows mobile Active Now for superadmin and opens dialog', async () => {
    Object.assign(authMockState, {
      isActualSuperAdmin: true,
      isViewingAs: false,
    });

    render(<Navbar />);
    const mobileMenuButton = screen.getByRole('button', { name: /open navigation menu/i });
    await waitFor(() => {
      expect(screen.getByTestId('mobile-burger-notification-badge')).toBeInTheDocument();
    });

    fireEvent.click(mobileMenuButton as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Active Now')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Lock / Switch' })).toBeNull();
      expect(screen.getByTestId('mobile-menu-notification-link-badge')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Active Now'));

    await waitFor(() => {
      expect(screen.getAllByText('Active Now').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/users active within the last/i)).toBeInTheDocument();
    });
  });

  it('opens the PWA install prompt from mobile menu', async () => {
    const promptMock = vi.fn(async () => {});
    const beforeInstallEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByTitle('Menu')).toBeInTheDocument();
    });

    window.dispatchEvent(beforeInstallEvent as Event);

    const mobileMenuButton = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(mobileMenuButton as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Install App')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Install App'));

    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledTimes(1);
    });
  });

  it('hides mobile developer links when viewing as another role', async () => {
    Object.assign(authMockState, {
      isActualSuperAdmin: true,
      isViewingAs: true,
    });

    render(<Navbar />);
    const mobileMenuButton = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(mobileMenuButton as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.queryByText('Debug Console')).not.toBeInTheDocument();
      expect(screen.queryByText('Active Now')).not.toBeInTheDocument();
    });
  });
});

