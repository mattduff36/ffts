import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyAuthenticationResponseMock,
  consumeWebAuthnChallengeMock,
  getCredentialPublicKeyMock,
  getWebAuthnCredentialByCredentialIdMock,
  updateWebAuthnCredentialCounterMock,
  issueAppSessionMock,
  revokeAppSessionMock,
  validateAppSessionMock,
  getAppAuthProfileMock,
} = vi.hoisted(() => ({
  verifyAuthenticationResponseMock: vi.fn(),
  consumeWebAuthnChallengeMock: vi.fn(),
  getCredentialPublicKeyMock: vi.fn(),
  getWebAuthnCredentialByCredentialIdMock: vi.fn(),
  updateWebAuthnCredentialCounterMock: vi.fn(),
  issueAppSessionMock: vi.fn(),
  revokeAppSessionMock: vi.fn(),
  validateAppSessionMock: vi.fn(),
  getAppAuthProfileMock: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: verifyAuthenticationResponseMock,
}));

vi.mock('@/lib/server/webauthn/config', () => ({
  isWebAuthnConfigured: vi.fn(() => true),
  WEBAUTHN_DISABLED_MESSAGE: 'Biometric sign-in is not configured for this deployment',
  getWebAuthnRequestConfig: vi.fn(async () => ({
    rpName: 'FOREST FARM',
    rpID: 'localhost',
    origin: 'http://localhost',
    expectedOrigins: ['http://localhost'],
  })),
}));

vi.mock('@/lib/server/webauthn/credentials', () => ({
  consumeWebAuthnChallenge: consumeWebAuthnChallengeMock,
  getCredentialPublicKey: getCredentialPublicKeyMock,
  getWebAuthnCredentialByCredentialId: getWebAuthnCredentialByCredentialIdMock,
  updateWebAuthnCredentialCounter: updateWebAuthnCredentialCounterMock,
}));

vi.mock('@/lib/server/app-auth/cookies', () => ({
  setAppSessionCookieInResponse: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/response', () => ({
  clearAllAuthCookies: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  issueAppSession: issueAppSessionMock,
  revokeAppSession: revokeAppSessionMock,
  validateAppSession: validateAppSessionMock,
}));

vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: getAppAuthProfileMock,
}));

vi.mock('@/lib/server/webauthn/audit', () => ({
  createWebAuthnAuditEvent: vi.fn(),
}));

import { POST as verifyPost } from '@/app/api/auth/webauthn/login/verify/route';

describe('auth webauthn login verify route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWebAuthnCredentialByCredentialIdMock.mockResolvedValue({
      credential_id: 'credential-1',
      profile_id: 'profile-1',
      public_key: 'public-key',
      counter: 1,
      transports: ['internal'],
    });
    getCredentialPublicKeyMock.mockReturnValue(new Uint8Array([1, 2, 3]));
    consumeWebAuthnChallengeMock.mockResolvedValue({
      challenge: 'challenge-1',
    });
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 2,
      },
    });
    validateAppSessionMock.mockResolvedValue({ session: null });
    issueAppSessionMock.mockResolvedValue({
      row: { id: 'session-1' },
      cookieValue: 'cookie-value',
      cookieExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    revokeAppSessionMock.mockResolvedValue(undefined);
    updateWebAuthnCredentialCounterMock.mockResolvedValue(undefined);
    getAppAuthProfileMock.mockResolvedValue({
      id: 'profile-1',
      email: 'person@example.com',
      full_name: 'Person One',
      phone_number: null,
      employee_id: null,
      avatar_url: null,
      must_change_password: false,
      role: null,
      team: null,
    });
  });

  it('verifies the credential and issues a biometric app session', async () => {
    const request = new Request('http://localhost/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge: 'challenge-1',
        rememberMe: true,
        deviceId: 'device-1234567890abcdef',
        deviceLabel: 'Browser (Windows)',
        response: {
          id: 'credential-1',
          rawId: 'credential-1',
          type: 'public-key',
          response: {
            authenticatorData: 'authenticator-data',
            clientDataJSON: 'client-data',
            signature: 'signature',
            userHandle: 'user-handle',
          },
          clientExtensionResults: {},
        },
      }),
    });

    const response = await verifyPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(issueAppSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'profile-1',
        source: 'biometric_login',
        rememberMe: true,
        rawDeviceId: 'device-1234567890abcdef',
      })
    );
    expect(updateWebAuthnCredentialCounterMock).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      counter: 2,
    });
  });
});
