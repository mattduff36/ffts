/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const pushMock = vi.fn();
const routerMock = {
  push: pushMock,
};

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import {
  SensitiveModuleSessionManager,
  type SensitiveModuleAccessState,
} from '@/components/security/SensitiveModuleGate';

const heartbeatMs = 5 * 60 * 1000;

async function advanceHeartbeat() {
  await vi.advanceTimersByTimeAsync(heartbeatMs);
  await Promise.resolve();
  await Promise.resolve();
}

function buildAccess(overrides: Partial<SensitiveModuleAccessState> = {}): SensitiveModuleAccessState {
  return {
    loading: false,
    canAccess: true,
    state: {
      module_name: 'quotes',
      required: true,
      unlocked: true,
      expires_at: '2026-05-28T13:20:00.000Z',
      pin_status: {
        configured: true,
        pin_length: 4,
        must_reset: false,
        locked_until: null,
      },
    },
    refresh: vi.fn(),
    unlock: vi.fn(),
    renew: vi.fn(() => true) as unknown as SensitiveModuleAccessState['renew'],
    ...overrides,
  };
}

describe('SensitiveModuleSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
    pushMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews sensitive access on the 5 minute heartbeat while the page is active', async () => {
    const access = buildAccess();

    render(<SensitiveModuleSessionManager moduleLabel="Quotes" access={access} />);

    await act(async () => {
      await advanceHeartbeat();
    });

    expect(access.renew).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Are you still using Quotes/i)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects on the next heartbeat when the warning is ignored', async () => {
    const access = buildAccess();

    render(<SensitiveModuleSessionManager moduleLabel="Quotes" access={access} initialWarningOpen />);
    expect(screen.getByText(/Are you still using Quotes/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    await act(async () => {
      await advanceHeartbeat();
    });

    expect(pushMock).toHaveBeenCalledWith('/dashboard');
  });

  it('renews immediately when the user confirms they are still active', async () => {
    const access = buildAccess();

    render(
      <SensitiveModuleSessionManager
        moduleLabel="Quotes"
        access={access}
        initialWarningOpen
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Yes, I'm still here/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(access.renew).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Are you still using Quotes/i)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
