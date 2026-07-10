import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  browserSupportsWebAuthnMock,
  platformAuthenticatorIsAvailableMock,
  startRegistrationMock,
  startAuthenticationMock,
} = vi.hoisted(() => ({
  browserSupportsWebAuthnMock: vi.fn(),
  platformAuthenticatorIsAvailableMock: vi.fn(),
  startRegistrationMock: vi.fn(),
  startAuthenticationMock: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: browserSupportsWebAuthnMock,
  platformAuthenticatorIsAvailable: platformAuthenticatorIsAvailableMock,
  startRegistration: startRegistrationMock,
  startAuthentication: startAuthenticationMock,
}));

describe('biometric browser helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    browserSupportsWebAuthnMock.mockReturnValue(true);
    platformAuthenticatorIsAvailableMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('hides biometric UI when the WebAuthn browser API is unavailable', async () => {
    const { canUsePlatformAuthenticator } = await import('@/lib/webauthn/client');

    await expect(canUsePlatformAuthenticator()).resolves.toBe(false);
    expect(browserSupportsWebAuthnMock).not.toHaveBeenCalled();
  });

  it('requires a platform authenticator before offering biometric login', async () => {
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
    platformAuthenticatorIsAvailableMock.mockResolvedValue(false);

    const { canUsePlatformAuthenticator } = await import('@/lib/webauthn/client');

    await expect(canUsePlatformAuthenticator()).resolves.toBe(false);
    expect(browserSupportsWebAuthnMock).toHaveBeenCalled();
    expect(platformAuthenticatorIsAvailableMock).toHaveBeenCalled();
  });

  it('delegates registration and authentication ceremonies to SimpleWebAuthn', async () => {
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
    startRegistrationMock.mockResolvedValue({ id: 'registration-response' });
    startAuthenticationMock.mockResolvedValue({ id: 'authentication-response' });

    const {
      startBiometricAuthentication,
      startBiometricRegistration,
    } = await import('@/lib/webauthn/client');

    const registrationOptions = { challenge: 'registration-challenge' };
    const authenticationOptions = { challenge: 'authentication-challenge' };

    await expect(
      startBiometricRegistration(registrationOptions as never)
    ).resolves.toEqual({ id: 'registration-response' });
    await expect(
      startBiometricAuthentication(authenticationOptions as never)
    ).resolves.toEqual({ id: 'authentication-response' });

    expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: registrationOptions });
    expect(startAuthenticationMock).toHaveBeenCalledWith({ optionsJSON: authenticationOptions });
  });

  it('stores the most recently enabled local biometric profile first', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });

    const {
      clearLocalBiometricLoginProfile,
      getLocalBiometricLoginProfileIds,
      hasLocalBiometricLoginProfile,
      markLocalBiometricLoginEnabled,
    } = await import('@/lib/webauthn/client');

    markLocalBiometricLoginEnabled('profile-1');
    markLocalBiometricLoginEnabled('profile-2');
    markLocalBiometricLoginEnabled('profile-1');

    expect(hasLocalBiometricLoginProfile()).toBe(true);
    expect(getLocalBiometricLoginProfileIds()).toEqual(['profile-1', 'profile-2']);

    clearLocalBiometricLoginProfile('profile-1');
    expect(getLocalBiometricLoginProfileIds()).toEqual(['profile-2']);
  });
});
