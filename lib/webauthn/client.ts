'use client';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

const BIOMETRIC_LOGIN_PROFILES_STORAGE_KEY = 'biometric_login_profiles_v1';

function readEnabledProfileIds(): string[] {
  if (typeof window === 'undefined') return [];
  if (!window.localStorage) return [];

  const rawValue = window.localStorage.getItem(BIOMETRIC_LOGIN_PROFILES_STORAGE_KEY);
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function writeEnabledProfileIds(profileIds: string[]): void {
  if (typeof window === 'undefined') return;
  if (!window.localStorage) return;

  const uniqueProfileIds = Array.from(new Set(profileIds));
  if (uniqueProfileIds.length === 0) {
    window.localStorage.removeItem(BIOMETRIC_LOGIN_PROFILES_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(BIOMETRIC_LOGIN_PROFILES_STORAGE_KEY, JSON.stringify(uniqueProfileIds));
}

export function browserMaySupportWebAuthn(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.PublicKeyCredential !== 'undefined';
}

export async function canUsePlatformAuthenticator(): Promise<boolean> {
  if (!browserMaySupportWebAuthn()) return false;

  const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import(
    '@simplewebauthn/browser'
  );

  return browserSupportsWebAuthn() && platformAuthenticatorIsAvailable();
}

export async function startBiometricRegistration(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  return startRegistration({ optionsJSON });
}

export async function startBiometricAuthentication(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON
): Promise<AuthenticationResponseJSON> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  return startAuthentication({ optionsJSON });
}

export function hasLocalBiometricLoginProfile(): boolean {
  return readEnabledProfileIds().length > 0;
}

export function getLocalBiometricLoginProfileIds(): string[] {
  return readEnabledProfileIds();
}

export function markLocalBiometricLoginEnabled(profileId: string): void {
  writeEnabledProfileIds([profileId, ...readEnabledProfileIds().filter((value) => value !== profileId)]);
}

export function clearLocalBiometricLoginProfile(profileId: string): void {
  writeEnabledProfileIds(readEnabledProfileIds().filter((value) => value !== profileId));
}

export function clearAllLocalBiometricLoginProfiles(): void {
  writeEnabledProfileIds([]);
}
