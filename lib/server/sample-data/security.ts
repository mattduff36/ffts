import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ManagedFixtureKey,
  SampleDataAction,
  SampleDataFixtureStatus,
  SampleDataRegistryStatus,
} from './types';

const PREVIEW_TTL_MS = 5 * 60 * 1000;
const PREVIEW_VERSION = 1;

export function getConfirmationPhrase(
  fixtureKey: ManagedFixtureKey | 'all-managed',
  action: SampleDataAction
): string {
  if (action === 'create-base') return 'CREATE SCHEDULING BASE';
  if (action === 'create-queue') return 'CREATE SCHEDULING QUEUE EXTENSION';
  if (action === 'create-complete') {
    return 'CREATE COMPLETE SCHEDULING SAMPLE SET';
  }
  if (action === 'create') return 'CREATE FLEET INVENTORY SAMPLE';
  if (action === 'clear-all') return 'CLEAR ALL MANAGED SAMPLE DATA';
  return fixtureKey === 'scheduling-sample-v1'
    ? 'REMOVE SCHEDULING SAMPLE DATA'
    : 'REMOVE FLEET INVENTORY SAMPLE DATA';
}

interface PreviewPayload {
  version: number;
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  statusDigest: string;
  expiresAt: string;
}

function getSecret(): string {
  const secret = process.env.APP_SESSION_HASH_SECRET || process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error('Sample-data preview signing is not configured.');
  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', getSecret()).update(encodedPayload).digest('base64url');
}

export function getStatusDigest(
  status: SampleDataFixtureStatus | SampleDataRegistryStatus
): string {
  const digestable =
    'generatedAt' in status
      ? { ...status, generatedAt: null }
      : status;
  return createHmac('sha256', getSecret())
    .update(JSON.stringify(digestable))
    .digest('base64url');
}

export function createPreviewFingerprint(params: {
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  status: SampleDataFixtureStatus | SampleDataRegistryStatus;
  now?: Date;
}): { fingerprint: string; expiresAt: string } {
  const expiresAt = new Date(
    (params.now || new Date()).getTime() + PREVIEW_TTL_MS
  ).toISOString();
  const payload: PreviewPayload = {
    version: PREVIEW_VERSION,
    fixtureKey: params.fixtureKey,
    action: params.action,
    statusDigest: getStatusDigest(params.status),
    expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return {
    fingerprint: `${encodedPayload}.${sign(encodedPayload)}`,
    expiresAt,
  };
}

export function verifyPreviewFingerprint(params: {
  fingerprint: string;
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  status: SampleDataFixtureStatus | SampleDataRegistryStatus;
  now?: Date;
}): boolean {
  const [encodedPayload, providedSignature] = params.fingerprint.split('.');
  if (!encodedPayload || !providedSignature) return false;

  const expectedSignature = sign(encodedPayload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as PreviewPayload;
    return (
      payload.version === PREVIEW_VERSION
      && payload.fixtureKey === params.fixtureKey
      && payload.action === params.action
      && payload.statusDigest === getStatusDigest(params.status)
      && Date.parse(payload.expiresAt) > (params.now || new Date()).getTime()
    );
  } catch {
    return false;
  }
}

export function isValidConfirmation(
  fixtureKey: ManagedFixtureKey | 'all-managed',
  action: SampleDataAction,
  confirmation: string
): boolean {
  return confirmation === getConfirmationPhrase(fixtureKey, action);
}
