/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MySchedulePage from '@/app/(dashboard)/scheduling/my/page';

const { mockAuth, mockPermissionCheck } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPermissionCheck: vi.fn(),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: mockAuth,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: mockPermissionCheck,
}));

vi.mock('@/app/(dashboard)/scheduling/components/SchedulingEmployeeView', () => ({
  SchedulingEmployeeView: () => <div>Employee schedule board</div>,
}));

describe('MySchedulePage access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockReturnValue({ user: { id: 'employee-1' }, loading: false });
    mockPermissionCheck.mockReturnValue({ hasPermission: true, loading: false });
  });

  it('shows the loader and does not render the board while permission is loading', () => {
    mockPermissionCheck.mockReturnValue({ hasPermission: false, loading: true });

    render(<MySchedulePage />);

    expect(mockPermissionCheck).toHaveBeenCalledWith('scheduling');
    expect(screen.getByText('Loading your schedule...')).toBeInTheDocument();
    expect(screen.queryByText('Employee schedule board')).not.toBeInTheDocument();
    expect(screen.queryByText('My Schedule')).not.toBeInTheDocument();
  });

  it('renders nothing when the scheduling matrix denies the page', () => {
    mockPermissionCheck.mockReturnValue({ hasPermission: false, loading: false });

    const { container } = render(<MySchedulePage />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Employee schedule board')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no authenticated user', () => {
    mockAuth.mockReturnValue({ user: null, loading: false });

    const { container } = render(<MySchedulePage />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the schedule once scheduling permission is granted', () => {
    render(<MySchedulePage />);

    expect(screen.getByText('My Schedule')).toBeInTheDocument();
    expect(screen.getByText('Employee schedule board')).toBeInTheDocument();
  });
});
