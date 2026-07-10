/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BiometricEnrollmentPrompt } from '@/components/auth/BiometricEnrollmentPrompt';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/lib/webauthn/client', () => ({
  canUsePlatformAuthenticator: vi.fn(async () => true),
  markLocalBiometricLoginEnabled: vi.fn(),
  startBiometricRegistration: vi.fn(),
}));

vi.mock('@/lib/webauthn/device', () => ({
  getOrCreateWebAuthnDeviceId: vi.fn(() => 'test-device-id'),
  getWebAuthnDeviceLabel: vi.fn(() => 'Test device'),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('BiometricEnrollmentPrompt', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('does not show setup loading text when the prompt is dismissed', async () => {
    let resolveDismiss: () => void = () => undefined;
    const dismissRequest = new Promise<Response>((resolve) => {
      resolveDismiss = () => {
        resolve(new Response('{}', { status: 200 }));
      };
    });

    fetchMock
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ credentials_configured: false, prompt_dismissed: false }),
        { status: 200 }
      ))
      .mockReturnValueOnce(dismissRequest);

    render(
      <BiometricEnrollmentPrompt
        profileId="profile-1"
        canCheck={true}
        onOpenChange={vi.fn()}
        onCheckComplete={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Enable Biometric Login?' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.getByRole('button', { name: 'Enable biometric login' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Setting up...' })).not.toBeInTheDocument();

    resolveDismiss();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Enable Biometric Login?' }))
        .not.toBeInTheDocument();
    });
  });
});
