'use client';

// Keep the legacy storage key so existing biometric credentials remain tied to
// the same browser device identifier after removing Lock / Switch.
const WEBAUTHN_DEVICE_ID_STORAGE_KEY = 'account_switch_device_id_v1';
const DEVICE_ID_MIN_LENGTH = 16;
const DEVICE_ID_MAX_LENGTH = 200;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function buildFallbackDeviceId(): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `legacy-${Date.now()}-${randomPart}`;
}

function normalizeStoredDeviceId(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

export function getOrCreateWebAuthnDeviceId(): string {
  if (!isBrowser()) {
    return '';
  }

  const existingValue = normalizeStoredDeviceId(
    localStorage.getItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY)
  );
  if (existingValue) {
    if (localStorage.getItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY) !== existingValue) {
      localStorage.setItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY, existingValue);
    }
    return existingValue;
  }

  const nextDeviceId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : buildFallbackDeviceId();

  localStorage.setItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function getWebAuthnDeviceId(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const existingValue = normalizeStoredDeviceId(
    localStorage.getItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY)
  );
  if (!existingValue) {
    localStorage.removeItem(WEBAUTHN_DEVICE_ID_STORAGE_KEY);
    return null;
  }

  return existingValue;
}

export function getWebAuthnDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Unknown device';
  }

  const platform = navigator.platform || 'unknown-platform';
  return `Browser (${platform})`;
}
