/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulingPage from '@/app/(dashboard)/scheduling/page';

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
  SchedulingManagerBoard: () => <div>Manager scheduling board</div>,
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
  beforeEach(() => {
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

  it('shows a retryable error when scheduling context fails', async () => {
    mockFetchContext.mockRejectedValue(new Error('Unable to verify scheduling access right now.'));

    renderPage();

    expect(
      await screen.findByText('Scheduling access could not be checked')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
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
