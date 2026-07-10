import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const DEVICE_ID_MIN_LENGTH = 16;
const DEVICE_ID_MAX_LENGTH = 200;

export interface WebAuthnDeviceRow {
  id: string;
  profile_id: string;
  device_id_hash: string;
  device_label: string | null;
  trusted_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeWebAuthnDeviceId(rawDeviceId: string): string {
  const trimmed = rawDeviceId.trim();
  if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) {
    throw new Error('Invalid device identifier');
  }
  return trimmed;
}

export function parseWebAuthnDeviceId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    return normalizeWebAuthnDeviceId(input);
  } catch {
    return null;
  }
}

export function hashWebAuthnDeviceId(rawDeviceId: string): string {
  const normalized = normalizeWebAuthnDeviceId(rawDeviceId);
  const pepper =
    process.env.WEBAUTHN_DEVICE_PEPPER ||
    process.env.APP_SESSION_HASH_SECRET;
  if (!pepper) {
    throw new Error('WebAuthn device hashing is not configured');
  }
  return createHash('sha256').update(`${pepper}:${normalized}`).digest('hex');
}

export async function getWebAuthnDevice(
  profileId: string,
  rawDeviceId: string
): Promise<WebAuthnDeviceRow | null> {
  const supabaseAdmin = createAdminClient();
  const deviceIdHash = hashWebAuthnDeviceId(rawDeviceId);
  const { data, error } = await supabaseAdmin
    .from('webauthn_devices')
    .select('*')
    .eq('profile_id', profileId)
    .eq('device_id_hash', deviceIdHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as WebAuthnDeviceRow | null;
}

export async function upsertWebAuthnDevice({
  profileId,
  rawDeviceId,
  deviceLabel,
}: {
  profileId: string;
  rawDeviceId: string;
  deviceLabel?: string | null;
}): Promise<WebAuthnDeviceRow> {
  const supabaseAdmin = createAdminClient();
  const nowIso = new Date().toISOString();
  const deviceIdHash = hashWebAuthnDeviceId(rawDeviceId);

  const { data, error } = await supabaseAdmin
    .from('webauthn_devices')
    .upsert(
      {
        profile_id: profileId,
        device_id_hash: deviceIdHash,
        device_label: deviceLabel || null,
        trusted_at: nowIso,
        last_seen_at: nowIso,
        revoked_at: null,
      },
      {
        onConflict: 'profile_id,device_id_hash',
      }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to register WebAuthn device');
  }

  return data as WebAuthnDeviceRow;
}
