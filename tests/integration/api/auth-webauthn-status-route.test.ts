import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCurrentAuthenticatedProfileMock,
  getActiveWebAuthnCredentialsForProfileMock,
  isBiometricPromptDismissedMock,
  isWebAuthnConfiguredMock,
} = vi.hoisted(() => ({
  getCurrentAuthenticatedProfileMock: vi.fn(),
  getActiveWebAuthnCredentialsForProfileMock: vi.fn(),
  isBiometricPromptDismissedMock: vi.fn(),
  isWebAuthnConfiguredMock: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: getCurrentAuthenticatedProfileMock,
}));

vi.mock('@/lib/server/webauthn/credentials', () => ({
  getActiveWebAuthnCredentialsForProfile: getActiveWebAuthnCredentialsForProfileMock,
  isBiometricPromptDismissed: isBiometricPromptDismissedMock,
}));

vi.mock('@/lib/server/webauthn/config', () => ({
  isWebAuthnConfigured: isWebAuthnConfiguredMock,
}));

import { GET as statusGet } from '@/app/api/auth/webauthn/status/route';

describe('auth webauthn status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAuthenticatedProfileMock.mockResolvedValue({
      profile: {
        id: 'profile-1',
      },
    });
    isWebAuthnConfiguredMock.mockReturnValue(true);
    getActiveWebAuthnCredentialsForProfileMock.mockResolvedValue([]);
    isBiometricPromptDismissedMock.mockResolvedValue(false);
  });

  it('reports biometrics as disabled without resolving device credentials when WebAuthn is not configured', async () => {
    isWebAuthnConfiguredMock.mockReturnValue(false);

    const response = await statusGet(
      new NextRequest('http://localhost/api/auth/webauthn/status?deviceId=device-1234567890abcdef')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      webauthn_configured: false,
      credentials_configured: false,
      credential_count: 0,
      prompt_dismissed: true,
    });
    expect(getActiveWebAuthnCredentialsForProfileMock).not.toHaveBeenCalled();
    expect(isBiometricPromptDismissedMock).not.toHaveBeenCalled();
  });

  it('loads credential status when WebAuthn is configured', async () => {
    getActiveWebAuthnCredentialsForProfileMock.mockResolvedValue([{ id: 'credential-1' }]);
    isBiometricPromptDismissedMock.mockResolvedValue(true);

    const response = await statusGet(
      new NextRequest('http://localhost/api/auth/webauthn/status?deviceId=device-1234567890abcdef')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      webauthn_configured: true,
      credentials_configured: true,
      credential_count: 1,
      prompt_dismissed: true,
    });
    expect(getActiveWebAuthnCredentialsForProfileMock).toHaveBeenCalledWith({
      profileId: 'profile-1',
      rawDeviceId: 'device-1234567890abcdef',
    });
  });
});
