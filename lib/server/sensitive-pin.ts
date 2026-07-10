import { createHash, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { verifyUserPassword } from '@/lib/server/password-auth';
import type { SensitiveAccessModuleName } from '@/types/roles';
import { notifyAdminsOfSensitivePinEvent } from '@/lib/server/sensitive-pin-notifications';
import { getPrimaryResendEmailConfig } from '@/lib/server/resend-email-config';

export type CurrentAuthenticatedProfile = NonNullable<Awaited<ReturnType<typeof getCurrentAuthenticatedProfile>>>;

const pbkdf2Async = promisify(pbkdf2);
const PIN_HASH_ITERATIONS = 210_000;
const PIN_KEY_LENGTH = 32;
const PIN_DIGEST = 'sha256';
const VERIFICATION_CODE_TTL_MINUTES = 15;
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;
export const SENSITIVE_PIN_UNLOCK_MINUTES = 20;

export type SensitivePinPurpose = 'setup' | 'change' | 'reset';

interface SensitivePinRow {
  profile_id: string;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_length: number | null;
  failed_attempts: number;
  locked_until: string | null;
  must_reset: boolean;
}

interface SensitivePinTokenRow {
  id: string;
  profile_id: string;
  pending_pin_hash: string;
  pending_pin_salt: string;
  pending_pin_length: number;
  attempts: number;
}

export interface SensitivePinStatus {
  configured: boolean;
  pin_length: 4 | 6 | null;
  must_reset: boolean;
  locked_until: string | null;
}

export interface SensitiveModulePinState {
  module_name: SensitiveAccessModuleName;
  required: boolean;
  unlocked: boolean;
  expires_at: string | null;
  pin_status: SensitivePinStatus;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function hashVerificationCode(code: string): string {
  return createHash('sha256').update(`sensitive-pin-verification:${code}`).digest('hex');
}

function getVerificationExpiry(): string {
  return new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000).toISOString();
}

function getUnlockExpiry(): string {
  return new Date(Date.now() + SENSITIVE_PIN_UNLOCK_MINUTES * 60 * 1000).toISOString();
}

function getLockExpiry(): string {
  return new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString();
}

function getStoredPinLength(row: SensitivePinRow | null | undefined): 4 | 6 | null {
  const length = row?.pin_length;
  return length === 4 || length === 6 ? length : null;
}

export function validateSensitivePin(pin: string): { valid: boolean; error?: string; length?: 4 | 6 } {
  if (!/^\d+$/.test(pin)) {
    return { valid: false, error: 'PIN must contain digits only' };
  }

  if (pin.length !== 4 && pin.length !== 6) {
    return { valid: false, error: 'PIN must be either 4 or 6 digits' };
  }

  return { valid: true, length: pin.length as 4 | 6 };
}

async function hashPin(pin: string, salt = toBase64Url(randomBytes(24))): Promise<{
  hash: string;
  salt: string;
}> {
  const key = await pbkdf2Async(pin, salt, PIN_HASH_ITERATIONS, PIN_KEY_LENGTH, PIN_DIGEST);
  return {
    hash: `${PIN_HASH_ITERATIONS}:${PIN_DIGEST}:${toBase64Url(key)}`,
    salt,
  };
}

async function comparePin(pin: string, row: SensitivePinRow): Promise<boolean> {
  if (!row.pin_hash || !row.pin_salt) return false;

  const [, , expectedHash] = row.pin_hash.split(':');
  if (!expectedHash) return false;

  const candidate = await hashPin(pin, row.pin_salt);
  const [, , candidateHash] = candidate.hash.split(':');
  const expected = Buffer.from(expectedHash);
  const actual = Buffer.from(candidateHash || '');

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function sendVerificationEmail(params: {
  to: string;
  name: string;
  purpose: SensitivePinPurpose;
  code: string;
}): Promise<void> {
  const { apiKey, fromEmail } = getPrimaryResendEmailConfig();
  if (!apiKey) {
    throw new Error('Email service is not configured');
  }

  const action = params.purpose === 'setup'
    ? 'set up'
    : params.purpose === 'change'
      ? 'change'
      : 'reset';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.to],
      subject: 'Sensitive access PIN verification',
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
            <h2>Sensitive access PIN verification</h2>
            <p>Hello ${params.name},</p>
            <p>Use this verification code to ${action} your sensitive access PIN:</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; padding: 16px; border: 2px solid #F1D64A; display: inline-block;">${params.code}</div>
            <p>This code expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.</p>
            <p style="color: #6b7280; font-size: 14px;">If you did not request this, contact an admin immediately.</p>
          </body>
        </html>
      `,
    }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message || 'Failed to send verification email');
  }
}

async function getSensitivePinRow(profileId: string): Promise<SensitivePinRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profile_sensitive_pins')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SensitivePinRow | null) || null;
}

export async function getCurrentSensitivePinStatus(): Promise<SensitivePinStatus> {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    throw new Error('Unauthorized');
  }

  const row = await getSensitivePinRow(current.profile.id);
  return {
    configured: Boolean(row?.pin_hash && row?.pin_salt && row?.pin_length),
    pin_length: getStoredPinLength(row),
    must_reset: row?.must_reset === true,
    locked_until: row?.locked_until || null,
  };
}

export async function requestSensitivePinVerification(params: {
  pin: string;
  purpose: SensitivePinPurpose;
}): Promise<{ email: string }> {
  if (params.purpose !== 'setup') {
    throw new Error('Sensitive PIN changes and resets must be started by an administrator');
  }

  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) throw new Error('Unauthorized');
  if (!current.profile.email) {
    throw new Error('Email verification is unavailable for this account');
  }

  const validation = validateSensitivePin(params.pin);
  if (!validation.valid || !validation.length) {
    throw new Error(validation.error || 'Invalid PIN');
  }

  const matchesMainPassword = await verifyUserPassword(
    current.profile.email,
    current.profile.id,
    params.pin
  );
  if (matchesMainPassword) {
    throw new Error('Sensitive PIN cannot be the same as your main password');
  }

  const pending = await hashPin(params.pin);
  const code = String(randomInt(100000, 1000000));
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  await admin
    .from('sensitive_pin_verification_tokens')
    .update({ consumed_at: nowIso })
    .eq('profile_id', current.profile.id)
    .eq('purpose', params.purpose)
    .is('consumed_at', null);

  const { error: tokenError } = await admin
    .from('sensitive_pin_verification_tokens')
    .insert({
      profile_id: current.profile.id,
      token_hash: hashVerificationCode(code),
      purpose: params.purpose,
      pending_pin_hash: pending.hash,
      pending_pin_salt: pending.salt,
      pending_pin_length: validation.length,
      expires_at: getVerificationExpiry(),
    });

  if (tokenError) throw new Error(tokenError.message);

  await admin.from('sensitive_pin_audit_events').insert({
    profile_id: current.profile.id,
    actor_profile_id: current.profile.id,
    event_type: `${params.purpose}_requested`,
  });

  await sendVerificationEmail({
    to: current.profile.email,
    name: current.profile.full_name || 'User',
    purpose: params.purpose,
    code,
  });

  return { email: current.profile.email };
}

export async function setupSensitivePinWithoutEmailVerification(params: {
  pin: string;
}): Promise<{ eventType: 'set' }> {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) throw new Error('Unauthorized');

  const existing = await getSensitivePinRow(current.profile.id);
  if (existing?.pin_hash && !existing.must_reset) {
    throw new Error('Ask an administrator to reset your sensitive PIN before setting a new one');
  }

  const validation = validateSensitivePin(params.pin);
  if (!validation.valid || !validation.length) {
    throw new Error(validation.error || 'Invalid PIN');
  }

  const matchesMainPassword = await verifyUserPassword(
    current.profile.email,
    current.profile.id,
    params.pin
  );
  if (matchesMainPassword) {
    throw new Error('Sensitive PIN cannot be the same as your main password');
  }

  const pending = await hashPin(params.pin);
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { error: upsertError } = await admin
    .from('profile_sensitive_pins')
    .upsert({
      profile_id: current.profile.id,
      pin_hash: pending.hash,
      pin_salt: pending.salt,
      pin_length: validation.length,
      failed_attempts: 0,
      locked_until: null,
      must_reset: false,
      last_changed_at: nowIso,
      updated_at: nowIso,
    }, { onConflict: 'profile_id' });

  if (upsertError) throw new Error(upsertError.message);

  await Promise.all([
    admin
      .from('sensitive_pin_verification_tokens')
      .update({ consumed_at: nowIso })
      .eq('profile_id', current.profile.id)
      .is('consumed_at', null),
    admin
      .from('sensitive_pin_unlocks')
      .delete()
      .eq('profile_id', current.profile.id),
    admin.from('sensitive_pin_audit_events').insert({
      profile_id: current.profile.id,
      actor_profile_id: current.profile.id,
      event_type: 'setup_confirmed',
    }),
  ]);

  await notifyAdminsOfSensitivePinEvent({
    actorProfileId: current.profile.id,
    targetProfileId: current.profile.id,
    targetName: current.profile.full_name || current.profile.email || 'A user',
    eventType: 'set',
  });

  return { eventType: 'set' };
}

export async function confirmSensitivePinVerification(params: {
  code: string;
  purpose: SensitivePinPurpose;
}): Promise<{ eventType: 'set' | 'changed' }> {
  if (params.purpose !== 'setup') {
    throw new Error('Sensitive PIN changes and resets must be started by an administrator');
  }

  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) throw new Error('Unauthorized');

  const code = params.code.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Verification code must be 6 digits');
  }

  const admin = createAdminClient();
  const { data: token, error: tokenError } = await admin
    .from('sensitive_pin_verification_tokens')
    .select('*')
    .eq('profile_id', current.profile.id)
    .eq('purpose', params.purpose)
    .eq('token_hash', hashVerificationCode(code))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError) throw new Error(tokenError.message);
  if (!token) throw new Error('Verification code is invalid or has expired');

  const typedToken = token as SensitivePinTokenRow;
  const existing = await getSensitivePinRow(current.profile.id);
  const eventType: 'set' | 'changed' = existing?.pin_hash && !existing.must_reset ? 'changed' : 'set';
  const nowIso = new Date().toISOString();

  const { error: upsertError } = await admin
    .from('profile_sensitive_pins')
    .upsert({
      profile_id: current.profile.id,
      pin_hash: typedToken.pending_pin_hash,
      pin_salt: typedToken.pending_pin_salt,
      pin_length: typedToken.pending_pin_length,
      failed_attempts: 0,
      locked_until: null,
      must_reset: false,
      last_changed_at: nowIso,
      updated_at: nowIso,
    }, { onConflict: 'profile_id' });

  if (upsertError) throw new Error(upsertError.message);

  await Promise.all([
    admin
      .from('sensitive_pin_verification_tokens')
      .update({ consumed_at: nowIso })
      .eq('id', typedToken.id),
    admin
      .from('sensitive_pin_unlocks')
      .delete()
      .eq('profile_id', current.profile.id),
    admin.from('sensitive_pin_audit_events').insert({
      profile_id: current.profile.id,
      actor_profile_id: current.profile.id,
      event_type: params.purpose === 'setup' ? 'setup_confirmed' : params.purpose === 'change' ? 'change_confirmed' : 'reset_confirmed',
    }),
  ]);

  await notifyAdminsOfSensitivePinEvent({
    actorProfileId: current.profile.id,
    targetProfileId: current.profile.id,
    targetName: current.profile.full_name || current.profile.email || 'A user',
    eventType,
  });

  return { eventType };
}

export async function adminResetSensitivePin(params: {
  actorProfileId: string;
  targetProfileId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: targetProfile, error: targetError } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('id', params.targetProfileId)
    .single();

  if (targetError || !targetProfile) {
    throw new Error('User not found');
  }

  const { error: upsertError } = await admin
    .from('profile_sensitive_pins')
    .upsert({
      profile_id: params.targetProfileId,
      pin_hash: null,
      pin_salt: null,
      pin_length: null,
      failed_attempts: 0,
      locked_until: null,
      must_reset: true,
      updated_at: nowIso,
    }, { onConflict: 'profile_id' });

  if (upsertError) throw new Error(upsertError.message);

  await Promise.all([
    admin.from('sensitive_pin_unlocks').delete().eq('profile_id', params.targetProfileId),
    admin.from('sensitive_pin_verification_tokens').update({ consumed_at: nowIso }).eq('profile_id', params.targetProfileId).is('consumed_at', null),
    admin.from('sensitive_pin_audit_events').insert({
      profile_id: params.targetProfileId,
      actor_profile_id: params.actorProfileId,
      event_type: 'admin_reset',
    }),
  ]);

  await notifyAdminsOfSensitivePinEvent({
    actorProfileId: params.actorProfileId,
    targetProfileId: params.targetProfileId,
    targetName: targetProfile.full_name || 'A user',
    eventType: 'admin_reset',
  });
}

export async function getSensitiveModulePinState(
  moduleName: SensitiveAccessModuleName,
  currentContext?: CurrentAuthenticatedProfile
): Promise<SensitiveModulePinState> {
  const current = currentContext ?? await getCurrentAuthenticatedProfile();
  if (!current) throw new Error('Unauthorized');

  const admin = createAdminClient();
  const { data: module, error: moduleError } = await admin
    .from('permission_modules')
    .select('module_name, requires_sensitive_pin')
    .eq('module_name', moduleName)
    .maybeSingle();

  if (moduleError) throw new Error(moduleError.message);

  const pinRow = await getSensitivePinRow(current.profile.id);
  const pinStatus = {
    configured: Boolean(pinRow?.pin_hash && pinRow?.pin_salt && pinRow?.pin_length),
    pin_length: getStoredPinLength(pinRow),
    must_reset: pinRow?.must_reset === true,
    locked_until: pinRow?.locked_until || null,
  };

  if (!module || module.requires_sensitive_pin !== true) {
    return {
      module_name: moduleName,
      required: false,
      unlocked: true,
      expires_at: null,
      pin_status: pinStatus,
    };
  }

  const sessionId = current.validation.session?.id;
  if (!sessionId) {
    return {
      module_name: moduleName,
      required: true,
      unlocked: false,
      expires_at: null,
      pin_status: pinStatus,
    };
  }

  const { data: unlock, error: unlockError } = await admin
    .from('sensitive_pin_unlocks')
    .select('expires_at')
    .eq('profile_id', current.profile.id)
    .eq('session_id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (unlockError) throw new Error(unlockError.message);

  return {
    module_name: moduleName,
    required: true,
    unlocked: Boolean(unlock),
    expires_at: (unlock as { expires_at?: string } | null)?.expires_at || null,
    pin_status: pinStatus,
  };
}

export async function unlockSensitiveModuleWithPin(params: {
  moduleName: SensitiveAccessModuleName;
  pin: string;
  currentContext?: CurrentAuthenticatedProfile;
}): Promise<SensitiveModulePinState> {
  const current = params.currentContext ?? await getCurrentAuthenticatedProfile();
  if (!current) throw new Error('Unauthorized');

  const validation = validateSensitivePin(params.pin);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid PIN');
  }

  if (!current.validation.session?.id) {
    throw new Error('Sensitive PIN unlock requires an active app session');
  }

  const admin = createAdminClient();
  const row = await getSensitivePinRow(current.profile.id);
  if (!row?.pin_hash || !row.pin_salt || row.must_reset) {
    throw new Error('Set up your sensitive access PIN from your profile before opening this module');
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw new Error('Sensitive PIN is temporarily locked. Try again later.');
  }

  const isValid = await comparePin(params.pin, row);
  if (!isValid) {
    const nextFailures = row.failed_attempts + 1;
    const lockedUntil = nextFailures >= MAX_PIN_FAILURES ? getLockExpiry() : null;
    await Promise.all([
      admin
        .from('profile_sensitive_pins')
        .update({
          failed_attempts: nextFailures,
          locked_until: lockedUntil,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', current.profile.id),
      admin.from('sensitive_pin_audit_events').insert({
        profile_id: current.profile.id,
        actor_profile_id: current.profile.id,
        event_type: lockedUntil ? 'pin_locked' : 'unlock_failed',
        module_name: params.moduleName,
      }),
    ]);

    throw new Error(lockedUntil ? 'Too many incorrect attempts. PIN is temporarily locked.' : 'Incorrect sensitive PIN');
  }

  const expiresAt = getUnlockExpiry();
  const { data: protectedModules, error: protectedModulesError } = await admin
    .from('permission_modules')
    .select('module_name')
    .eq('requires_sensitive_pin', true);

  if (protectedModulesError) {
    throw new Error(protectedModulesError.message);
  }

  const unlockRows = ((protectedModules || []) as Array<{ module_name: SensitiveAccessModuleName }>)
    .map((module) => ({
      profile_id: current.profile.id,
      session_id: current.validation.session!.id,
      module_name: module.module_name,
      unlocked_at: new Date().toISOString(),
      expires_at: expiresAt,
    }));

  await Promise.all([
    admin
      .from('profile_sensitive_pins')
      .update({
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('profile_id', current.profile.id),
    unlockRows.length > 0
      ? admin
        .from('sensitive_pin_unlocks')
        .upsert(unlockRows, { onConflict: 'session_id,module_name' })
      : Promise.resolve(),
    admin.from('sensitive_pin_audit_events').insert({
      profile_id: current.profile.id,
      actor_profile_id: current.profile.id,
      event_type: 'unlock_success',
      module_name: params.moduleName,
    }),
  ]);

  return getSensitiveModulePinState(params.moduleName, current);
}

export async function extendCurrentSensitiveModuleAccess(
  currentContext?: CurrentAuthenticatedProfile
): Promise<string> {
  const current = currentContext ?? await getCurrentAuthenticatedProfile();
  if (!current) throw new Error('Unauthorized');

  const sessionId = current.validation.session?.id;
  if (!sessionId) {
    throw new Error('Sensitive PIN unlock requires an active app session');
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const expiresAt = getUnlockExpiry();
  const { error: updateError } = await admin
    .from('sensitive_pin_unlocks')
    .update({ expires_at: expiresAt })
    .eq('profile_id', current.profile.id)
    .eq('session_id', sessionId)
    .gt('expires_at', nowIso);

  if (updateError) throw new Error(updateError.message);

  return expiresAt;
}

export async function renewSensitiveModuleAccess(
  moduleName: SensitiveAccessModuleName,
  currentContext?: CurrentAuthenticatedProfile
): Promise<SensitiveModulePinState> {
  const current = currentContext ?? await getCurrentAuthenticatedProfile();
  if (!current) throw new Error('Unauthorized');

  const sessionId = current.validation.session?.id;
  if (!sessionId) {
    throw new Error('Sensitive PIN unlock requires an active app session');
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: unlock, error: unlockError } = await admin
    .from('sensitive_pin_unlocks')
    .select('module_name')
    .eq('profile_id', current.profile.id)
    .eq('session_id', sessionId)
    .eq('module_name', moduleName)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (unlockError) throw new Error(unlockError.message);
  if (!unlock) {
    throw new Error('Sensitive access PIN required for protected modules.');
  }

  await extendCurrentSensitiveModuleAccess(current);

  return getSensitiveModulePinState(moduleName, current);
}
