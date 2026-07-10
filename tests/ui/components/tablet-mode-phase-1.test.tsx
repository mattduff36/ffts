import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TabletModeProvider, useTabletMode } from '@/components/layout/tablet-mode-context';
import { TabletModeToggleActions } from '@/components/layout/TabletModeToggleActions';
import { DashboardLayoutClient } from '@/components/layout/DashboardLayoutClient';

let mockedUserId: string | null = 'user-default';

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: mockedUserId ? { id: mockedUserId } : null,
    loading: false,
  }),
}));

vi.mock('@/lib/hooks/useClientServiceOutage', () => ({
  useClientServiceOutage: () => false,
}));

vi.mock('@/lib/utils/fetch-with-auth', () => ({
  fetchWithAuth: vi.fn(async () => ({ ok: true })),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/theme/getAccentFromRoute', () => ({
  getAccentFromRoute: () => 'dashboard',
}));

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

vi.mock('@/components/messages/MessageBlockingCheck', () => ({
  MessageBlockingCheck: () => <div data-testid="message-blocking-check" />,
}));

vi.mock('@/components/layout/MobileNavBar', () => ({
  MobileNavBar: () => <div data-testid="mobile-navbar" />,
}));

vi.mock('@/components/layout/PullToRefresh', () => ({
  PullToRefresh: () => <div data-testid="pull-to-refresh" />,
}));

vi.mock('@/components/layout/DashboardContent', () => ({
  DashboardContent: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function TabletModeStateProbe() {
  const { tabletModeEnabled, toggleTabletMode } = useTabletMode();

  return (
    <div>
      <div data-testid="tablet-mode-state">{tabletModeEnabled ? 'on' : 'off'}</div>
      <button type="button" onClick={toggleTabletMode}>
        Toggle Mode
      </button>
    </div>
  );
}

describe('Tablet mode Phase 0/1', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedUserId = 'user-default';
    vi.clearAllMocks();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: Boolean(mockedUserId),
            user: mockedUserId ? { id: mockedUserId } : null,
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to mode off and persists mode-off state', async () => {
    render(
      <TabletModeProvider>
        <TabletModeStateProbe />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('off');
    });

    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('off');
    });
  });

  it('toggles mode on and off', async () => {
    render(
      <TabletModeProvider>
        <TabletModeStateProbe />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('off');
    });
    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('off');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Mode' }));
    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('on');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Mode' }));
    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('off');
    });
  });

  it('hydrates and persists per-user localStorage keys', async () => {
    mockedUserId = 'user-one';
    localStorage.setItem('tablet_mode:user-one', 'on');
    localStorage.setItem('tablet_mode:user-two', 'off');

    const firstRender = render(
      <TabletModeProvider>
        <TabletModeStateProbe />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('on');
    });
    firstRender.unmount();

    mockedUserId = 'user-two';
    render(
      <TabletModeProvider>
        <TabletModeStateProbe />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('off');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Mode' }));
    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('on');
    });

    expect(localStorage.getItem('tablet_mode:user-two')).toBe('on');
    expect(localStorage.getItem('tablet_mode:user-one')).toBe('on');
  });

  it('does not crash if localStorage access is unavailable', async () => {
    mockedUserId = 'blocked-user';
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    render(
      <TabletModeProvider>
        <TabletModeStateProbe />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tablet-mode-state')).toHaveTextContent('off');
    });

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('applies shell mode gate attribute only when enabled', async () => {
    const { container } = render(
      <DashboardLayoutClient>
        <TabletModeToggleActions />
      </DashboardLayoutClient>
    );

    await waitFor(() => {
      expect(screen.getByTitle('Enable Tablet Mode')).toBeInTheDocument();
    });

    const shellRoot = container.firstElementChild as HTMLElement;
    expect(shellRoot.getAttribute('data-tablet-mode')).toBeNull();
    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('off');
    });

    fireEvent.click(screen.getByTitle('Enable Tablet Mode'));
    await waitFor(() => {
      expect(shellRoot.getAttribute('data-tablet-mode')).toBe('on');
    });

    fireEvent.click(screen.getByTitle('Disable Tablet Mode'));
    await waitFor(() => {
      expect(shellRoot.getAttribute('data-tablet-mode')).toBeNull();
    });
  });

  it('supports dashboard toggle flow', async () => {
    render(
      <TabletModeProvider>
        <TabletModeToggleActions />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTitle('Enable Tablet Mode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Enable Tablet Mode'));
    await waitFor(() => {
      expect(screen.getByTitle('Disable Tablet Mode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Disable Tablet Mode'));
    await waitFor(() => {
      expect(screen.getByTitle('Enable Tablet Mode')).toBeInTheDocument();
    });
  });

  it('shows an information modal on first enable and stores acknowledgement', async () => {
    render(
      <DashboardLayoutClient>
        <TabletModeToggleActions />
      </DashboardLayoutClient>
    );

    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('off');
    });

    fireEvent.click(screen.getByTitle('Enable Tablet Mode'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Information' })).toBeInTheDocument();
      expect(
        screen.getByText(/Tablet mode is still under development/i)
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Information' })).not.toBeInTheDocument();
      expect(localStorage.getItem('tablet_mode_info_ack:user-default:v1')).toBe('acknowledged');
    });
  });

  it('does not show information modal again after acknowledgement', async () => {
    localStorage.setItem('tablet_mode_info_ack:user-default:v1', 'acknowledged');

    render(
      <DashboardLayoutClient>
        <TabletModeToggleActions />
      </DashboardLayoutClient>
    );

    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('off');
    });

    fireEvent.click(screen.getByTitle('Enable Tablet Mode'));

    await waitFor(() => {
      expect(localStorage.getItem('tablet_mode:user-default')).toBe('on');
      expect(screen.queryByRole('heading', { name: 'Information' })).not.toBeInTheDocument();
    });
  });
});
