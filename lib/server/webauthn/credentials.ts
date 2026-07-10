import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
} from '@simplewebauthn/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { randomToken, fromBase64Url, toBase64Url } from '@/lib/server/app-auth/jwt';
import {
  getWebAuthnDevice,
  parseWebAuthnDeviceId,
  upsertWebAuthnDevice,
} from '@/lib/server/webauthn/devices';

export type WebAuthnChallengeType =
  | 'registration'
  | 'authentication';

export interface WebAuthnCredentialRow {
  id: string;
  profile_id: string;
  device_id: string | null;
  credential_id: string;
  public_key: string;
  webauthn_user_id: string;
  counter: number;
  transports: AuthenticatorTransportFuture[] | null;
  device_type: CredentialDeviceType;
  backed_up: boolean;
  authenticator_attachment: 'platform';
  name: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebAuthnChallengeRow {
  id: string;
  profile_id: string | null;
  device_id: string | null;
  challenge: string;
  challenge_type: WebAuthnChallengeType;
  webauthn_user_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

interface SaveChallengeInput {
  profileId?: string | null;
  rawDeviceId?: string | null;
  challenge: string;
  challengeType: WebAuthnChallengeType;
  webauthnUserId?: string | null;
}

interface SaveCredentialInput {
  profileId: string;
  rawDeviceId?: string | null;
  credentialId: string;
  publicKey: Uint8Array;
  webauthnUserId: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[] | null;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  name?: string | null;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function getChallengeExpiry(): string {
  return new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
}

async function resolveDeviceId(
  profileId: string,
  rawDeviceId?: string | null
): Promise<string | null> {
  const parsedDeviceId = parseWebAuthnDeviceId(rawDeviceId);
  if (!parsedDeviceId) return null;

  const device = await upsertWebAuthnDevice({
    profileId,
    rawDeviceId: parsedDeviceId,
    deviceLabel: null,
  });

  return device.id;
}

export function toWebAuthnBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(input);
}

export function getCredentialPublicKey(row: WebAuthnCredentialRow): Uint8Array<ArrayBuffer> {
  return toWebAuthnBytes(fromBase64Url(row.public_key));
}

export async function getWebAuthnUserId(profileId: string): Promise<string> {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_credentials')
    .select('webauthn_user_id')
    .eq('profile_id', profileId)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const existing = data as { webauthn_user_id?: string | null } | null;
  return existing?.webauthn_user_id || randomToken(32);
}

export async function getActiveWebAuthnCredentialsForProfile({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId?: string | null;
}): Promise<WebAuthnCredentialRow[]> {
  const supabaseAdmin = createAdminClient();
  const parsedDeviceId = parseWebAuthnDeviceId(rawDeviceId);
  const device = parsedDeviceId ? await getWebAuthnDevice(profileId, parsedDeviceId) : null;

  let query = supabaseAdmin
    .from('webauthn_credentials')
    .select('*')
    .eq('profile_id', profileId)
    .is('revoked_at', null);

  if (parsedDeviceId) {
    if (!device) return [];
    query = query.eq('device_id', device.id);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as WebAuthnCredentialRow[];
}

export async function hasActiveWebAuthnCredentialForDevice({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId?: string | null;
}): Promise<boolean> {
  const credentials = await getActiveWebAuthnCredentialsForProfile({ profileId, rawDeviceId });
  return credentials.length > 0;
}

export async function getWebAuthnCredentialByCredentialId(
  credentialId: string
): Promise<WebAuthnCredentialRow | null> {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credentialId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as WebAuthnCredentialRow | null) || null;
}

export async function saveWebAuthnChallenge(input: SaveChallengeInput): Promise<WebAuthnChallengeRow> {
  const deviceId = input.profileId
    ? await resolveDeviceId(input.profileId, input.rawDeviceId)
    : null;
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_challenges')
    .insert({
      profile_id: input.profileId || null,
      device_id: deviceId,
      challenge: input.challenge,
      challenge_type: input.challengeType,
      webauthn_user_id: input.webauthnUserId || null,
      expires_at: getChallengeExpiry(),
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to save biometric challenge');
  return data as WebAuthnChallengeRow;
}

export async function consumeWebAuthnChallenge({
  challenge,
  challengeType,
  profileId,
}: {
  challenge: string;
  challengeType: WebAuthnChallengeType;
  profileId?: string | null;
}): Promise<WebAuthnChallengeRow> {
  const supabaseAdmin = createAdminClient();
  let query = supabaseAdmin
    .from('webauthn_challenges')
    .select('*')
    .eq('challenge', challenge)
    .eq('challenge_type', challengeType)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString());

  if (profileId) query = query.eq('profile_id', profileId);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const challengeRow = data as WebAuthnChallengeRow | null;
  if (!challengeRow) throw new Error('Biometric challenge has expired. Please try again.');

  const { error: updateError } = await supabaseAdmin
    .from('webauthn_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challengeRow.id)
    .is('consumed_at', null);

  if (updateError) throw new Error(updateError.message);
  return challengeRow;
}

export async function saveWebAuthnCredential(input: SaveCredentialInput): Promise<WebAuthnCredentialRow> {
  const deviceId = await resolveDeviceId(input.profileId, input.rawDeviceId);
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_credentials')
    .insert({
      profile_id: input.profileId,
      device_id: deviceId,
      credential_id: input.credentialId,
      public_key: toBase64Url(input.publicKey),
      webauthn_user_id: input.webauthnUserId,
      counter: input.counter,
      transports: input.transports || null,
      device_type: input.deviceType,
      backed_up: input.backedUp,
      authenticator_attachment: 'platform',
      name: input.name || null,
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to save biometric credential');
  return data as WebAuthnCredentialRow;
}

export async function updateWebAuthnCredentialCounter({
  credentialId,
  counter,
}: {
  credentialId: string;
  counter: number;
}): Promise<void> {
  const supabaseAdmin = createAdminClient();
  const { error } = await supabaseAdmin
    .from('webauthn_credentials')
    .update({
      counter,
      last_used_at: new Date().toISOString(),
    })
    .eq('credential_id', credentialId);

  if (error) throw new Error(error.message);
}

export async function revokeWebAuthnCredentialsForDevice({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId: string;
}): Promise<number> {
  const parsedDeviceId = parseWebAuthnDeviceId(rawDeviceId);
  if (!parsedDeviceId) return 0;

  const device = await getWebAuthnDevice(profileId, parsedDeviceId);
  if (!device) return 0;

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('device_id', device.id)
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(error.message);
  return (data || []).length;
}

export async function isBiometricPromptDismissed({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId?: string | null;
}): Promise<boolean> {
  const parsedDeviceId = parseWebAuthnDeviceId(rawDeviceId);
  if (!parsedDeviceId) return false;

  const device = await getWebAuthnDevice(profileId, parsedDeviceId);
  if (!device) return false;

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('webauthn_prompt_preferences')
    .select('dismissed_at')
    .eq('profile_id', profileId)
    .eq('device_id', device.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { dismissed_at?: string | null } | null)?.dismissed_at);
}

export async function dismissBiometricPrompt({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId: string;
}): Promise<void> {
  const deviceId = await resolveDeviceId(profileId, rawDeviceId);
  if (!deviceId) throw new Error('A valid device identifier is required');

  const supabaseAdmin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('webauthn_prompt_preferences')
    .upsert(
      {
        profile_id: profileId,
        device_id: deviceId,
        dismissed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'profile_id,device_id' }
    );

  if (error) throw new Error(error.message);
}
