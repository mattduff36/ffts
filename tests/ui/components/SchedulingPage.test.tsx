/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulingPage from '@/app/(dashboard)/scheduling/page';
import {
  SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
  SCHEDULING_MOBILE_MAX_WIDTH_PX,
} from '@/app/(dashboard)/scheduling/components/scheduling-viewport-fit';

const { mockFetchContext, mockPermissionCheck } = vi.hoisted(() => ({
  mockFetchContext: vi.fn(),
  mockPermissionCheck: vi.fn(),
}));

vi.mock('@/lib/client/scheduling', () => ({
  fetchSchedulingContext: mockFetchContext,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: mockPermissionCheck,
}));

vi.mock('@/app/(dashboard)/scheduling/components/SchedulingManagerBoard', () => ({
  SchedulingManagerBoard: ({ userId }: { userId: string }) => (
    <div>Manager scheduling board for {userId}</div>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SchedulingPage />
    </QueryClientProvider>
  );
}

describe('SchedulingPage access states', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.clearAllMocks();
    mockPermissionCheck.mockReturnValue({
      hasPermission: true,
      loading: false,
      serviceUnavailable: false,
    });
    mockFetchContext.mockResolvedValue({
      user_id: 'manager-1',
      access_level: 4,
      is_manager_or_admin: true,
      role_name: 'manager',
      role_class: 'manager',
      team_id: 'team-1',
      team_name: 'Arborists',
    });
  });

  it('explains team or user permission configuration instead of rendering a blank page', () => {
    mockPermissionCheck.mockReturnValue({
      hasPermission: false,
      loading: false,
      serviceUnavailable: false,
    });

    renderPage();

    expect(screen.getByText('Scheduling is not enabled for your account')).toBeInTheDocument();
    expect(screen.getByText(/team and individual scheduling permissions/i)).toBeInTheDocument();
  });

  it('scopes the management board to the scheduling context user', async () => {
    renderPage();

    expect(
      await screen.findByText('Manager scheduling board for manager-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('scheduling-page-shell')).toHaveClass(
      'h-[calc(100dvh-var(--top-nav-h,68px)-4rem)]',
      'min-h-0',
      'flex-col',
      'overflow-hidden'
    );
    expect(screen.getByTestId('scheduling-viewport')).toHaveClass(
      'h-full',
      'min-h-0',
      'flex-1'
    );
    expect(screen.getByTestId('scheduling-viewport').style.height).toBe('');
    expect(screen.getByTestId('scheduling-scaled-content')).toHaveClass(
      'h-full',
      'min-h-0',
      'flex-1'
    );
  });

  it('asks for a wider screen on mobile instead of rendering the board', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes(`max-width: ${SCHEDULING_MOBILE_MAX_WIDTH_PX}px`),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    renderPage();

    expect(
      await screen.findByText('Job Scheduling needs a wider screen')
    ).toBeInTheDocument();
    expect(screen.getByTestId('schedule-wide-screen-required')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-wide-screen-required')).toHaveClass('w-fit');
    expect(screen.getByTestId('schedule-wide-screen-layout')).toHaveClass(
      'flex-1',
      'flex-col'
    );
    expect(screen.getByTestId('schedule-wide-screen-layout').querySelector('.flex-1.items-center.justify-center')).toBeTruthy();
    expect(
      screen.queryByText('Manager scheduling board for manager-1')
    ).not.toBeInTheDocument();
  });

  it('scales the manager board when the content area is between 67% and 100% of min width', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return Math.round(SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX * 0.8);
      },
    });

    try {
      renderPage();
      expect(
        await screen.findByText('Manager scheduling board for manager-1')
      ).toBeInTheDocument();
      expect(screen.getByTestId('scheduling-viewport')).toHaveAttribute('data-fit-mode', 'scaled');
      expect(screen.getByTestId('scheduling-viewport').style.height).toBe('');
      expect(screen.getByTestId('scheduling-scaled-content')).toHaveStyle({
        transform: 'scale(0.8)',
        height: '125%',
      });
    } finally {
      if (originalWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });

  it('asks for a wider screen when zoom would drop below 67%', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return Math.round(SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX * 0.66);
      },
    });

    try {
      renderPage();
      expect(
        await screen.findByText('Job Scheduling needs a wider screen')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Manager scheduling board for manager-1')
      ).not.toBeInTheDocument();
    } finally {
      if (originalWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });

  it('shows a retryable error when scheduling context fails', async () => {
    mockFetchContext.mockRejectedValue(new Error('Unable to verify scheduling access right now.'));

    renderPage();

    expect(
      await screen.findByText('Scheduling access could not be checked')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass(
      'bg-[#0f172a]',
      'text-[#f1f5f9]',
      'hover:bg-[#334155]',
      'hover:text-[#ffffff]'
    );
  });

  it('explains insufficient manager-level scheduling access', async () => {
    mockFetchContext.mockResolvedValue({
      user_id: 'manager-1',
      access_level: 3,
      is_manager_or_admin: false,
      role_name: 'manager',
      role_class: 'manager',
      team_id: 'team-1',
      team_name: 'Arborists',
    });

    renderPage();

    expect(await screen.findByText('Management access is not enabled')).toBeInTheDocument();
    expect(screen.getByText(/requires Level 4 scheduling access/i)).toBeInTheDocument();
  });
});
