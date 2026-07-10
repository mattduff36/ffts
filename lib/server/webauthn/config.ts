import { headers } from 'next/headers';
import { templateConfig } from '@/lib/config/template-config';

export interface WebAuthnRequestConfig {
  rpName: string;
  rpID: string;
  origin: string;
  expectedOrigins: string[];
}

export const WEBAUTHN_DISABLED_MESSAGE =
  'Biometric sign-in is not configured for this deployment';

export function isWebAuthnConfigured(): boolean {
  return Boolean(
    process.env.WEBAUTHN_ORIGIN?.trim() &&
      process.env.WEBAUTHN_RP_ID?.trim() &&
      process.env.WEBAUTHN_DEVICE_PEPPER?.trim()
  );
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

function getConfiguredOrigins(origin: string): string[] {
  const configured = process.env.WEBAUTHN_EXPECTED_ORIGINS || process.env.WEBAUTHN_ORIGIN;
  if (!configured) return [origin];

  return Array.from(new Set([
    origin,
    ...configured
    .split(',')
    .map((value) => value.trim())
      .filter(Boolean)
      .map(normalizeOrigin),
  ]));
}

function getOriginFromHeaders(
  originHeader: string | null,
  host: string | null,
  protocol: string | null
): string {
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN;
  if (originHeader) return normalizeOrigin(originHeader);

  if (configuredOrigin && !host) return normalizeOrigin(configuredOrigin);

  const safeHost = host || 'localhost:4000';
  const safeProtocol = protocol || (safeHost.startsWith('localhost') ? 'http' : 'https');
  return normalizeOrigin(`${safeProtocol}://${safeHost}`);
}

function isRpIdValidForHost(rpID: string, hostname: string): boolean {
  return hostname === rpID || hostname.endsWith(`.${rpID}`);
}

export async function getWebAuthnRequestConfig(): Promise<WebAuthnRequestConfig> {
  const headerStore = await headers();
  const originHeader = headerStore.get('origin');
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto');
  const origin = getOriginFromHeaders(originHeader, host, protocol);
  const originHostname = new URL(origin).hostname;
  const configuredRpID = process.env.WEBAUTHN_RP_ID;
  const rpID =
    configuredRpID && isRpIdValidForHost(configuredRpID, originHostname)
      ? configuredRpID
      : originHostname;

  return {
    rpName: process.env.WEBAUTHN_RP_NAME || templateConfig.branding.companyName,
    rpID,
    origin,
    expectedOrigins: getConfiguredOrigins(origin),
  };
}
