import { headers } from 'next/headers';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  APP_SESSION_ABSOLUTE_HOURS,
  APP_SESSION_COOKIE_VERSION,
  APP_SESSION_IDLE_HOURS,
  APP_SESSION_REMEMBER_ABSOLUTE_DAYS,
  APP_SESSION_REMEMBER_IDLE_DAYS,
  APP_SESSION_ROTATE_AFTER_MINUTES,
  APP_SESSION_ROTATE_BEFORE_IDLE_EXPIRY_MINUTES,
} from '@/lib/server/app-auth/constants';
import {
  buildAppSessionCookieValue,
  getCurrentAppSessionCookiePayload,
} from '@/lib/server/app-auth/cookies';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { randomToken, sha256Hex } from '@/lib/server/app-auth/jwt';
import { upsertWebAuthnDevice, getWebAuthnDevice } from '@/lib/server/webauthn/devices';

export type AppAuthSessionSource =
  | 'password_login'
  | 'session_bootstrap'
  | 'biometric_login';

export interface AppAuthSessionRow {
  id: string;
  profile_id: string;
  device_id: string | null;
  session_secret_hash: string;
  session_source: AppAuthSessionSource;
  remember_me: boolean;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  replaced_by_session_id: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppSessionValidationResult {
  status: 'missing' | 'invalid' | 'active';
  session: AppAuthSessionRow | null;
  profileId: string | null;
  email: string | null;
  cookieValue: string | null;
  cookieExpiresAt: Date | null;
}

export interface IssueAppSessionOptions {
  profileId: string;
  source: AppAuthSessionSource;
  rememberMe?: boolean;
  rawDeviceId?: string | null;
  deviceLabel?: string | null;
  actorProfileId?: string | null;
  previousSessionId?: string | null;
  revokedReason?: string | null;
}

function getDurations(rememberMe: boolean) {
  const idleMs = rememberMe
    ? APP_SESSION_REMEMBER_IDLE_DAYS * 24 * 60 * 60 * 1000
    : APP_SESSION_IDLE_HOURS * 60 * 60 * 1000;
  const absoluteMs = rememberMe
    ? APP_SESSION_REMEMBER_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000
    : APP_SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
  return { idleMs, absoluteMs };
}

async function hashSessionSecret(secret: string): Promise<string> {
  return sha256Hex(`app-session:${secret}`);
}

async function hashIpAddress(ipAddress: string | null): Promise<string | null> {
  if (!ipAddress) {
    return null;
  }
  return sha256Hex(`app-ip:${ipAddress}`);
}

async function getCurrentRequestMetadata(): Promise<{ userAgent: string | null; ipHash: string | null }> {
  const headerStore = await headers();
  const forwardedFor = headerStore.get('x-forwarded-for');
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || headerStore.get('x-real-ip');
  return {
    userAgent: headerStore.get('user-agent'),
    ipHash: await hashIpAddress(ipAddress || null),
  };
}

const AUTH_USER_EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const authUserEmailCache = new Map<string, { email: string | null; expiresAt: number }>();

async function getAuthUserEmail(profileId: string): Promise<string | null> {
  const cachedEntry = authUserEmailCache.get(profileId);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.email;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(profileId);
  if (error || !data.user) {
    return null;
  }

  const email = data.user.email || null;
  authUserEmailCache.set(profileId, {
    email,
    expiresAt: Date.now() + AUTH_USER_EMAIL_CACHE_TTL_MS,
  });
  return email;
}

async function resolveDeviceId(
  profileId: string,
  rawDeviceId?: string | null,
  deviceLabel?: string | null
): Promise<string | null> {
  if (!rawDeviceId) {
    return null;
  }

  const device = await upsertWebAuthnDevice({
    profileId,
    rawDeviceId,
    deviceLabel: deviceLabel || null,
  });

  return device.id;
}

async function markDeviceAuthenticated(deviceId: string | null): Promise<void> {
  if (!deviceId) {
    return;
  }

  const admin = createAdminClient();
  await admin
    .from('webauthn_devices')
    .update({
      last_authenticated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', deviceId);
}

async function getSessionRow(sessionId: string): Promise<AppAuthSessionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_auth_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AppAuthSessionRow | null) || null;
}

function shouldRotateSession(row: AppAuthSessionRow, now: Date): boolean {
  const lastSeenAt = new Date(row.last_seen_at).getTime();
  const idleExpiresAt = new Date(row.idle_expires_at).getTime();

  return (
    now.getTime() - lastSeenAt >= APP_SESSION_ROTATE_AFTER_MINUTES * 60 * 1000 ||
    idleExpiresAt - now.getTime() <= APP_SESSION_ROTATE_BEFORE_IDLE_EXPIRY_MINUTES * 60 * 1000
  );
}

function getNextIdleExpiry(row: AppAuthSessionRow, now: Date): Date {
  const durations = getDurations(row.remember_me);
  const absoluteExpiry = new Date(row.absolute_expires_at);
  const candidate = new Date(now.getTime() + durations.idleMs);
  return candidate > absoluteExpiry ? absoluteExpiry : candidate;
}

async function updateSessionActivity(
  row: AppAuthSessionRow,
  options: { rotate: boolean; now: Date }
): Promise<{ row: AppAuthSessionRow; cookieValue: string | null; cookieExpiresAt: Date | null }> {
  const admin = createAdminClient();
  const nextIdleExpiry = getNextIdleExpiry(row, options.now);
  let nextSecret = row.session_secret_hash;
  let rawSecret: string | null = null;

  if (options.rotate) {
    rawSecret = randomToken();
    nextSecret = await hashSessionSecret(rawSecret);
  }

  const updatePayload: Partial<AppAuthSessionRow> = {
    last_seen_at: options.now.toISOString(),
    idle_expires_at: nextIdleExpiry.toISOString(),
  };

  if (options.rotate) {
    updatePayload.session_secret_hash = nextSecret;
  }

  const { data, error } = await admin
    .from('app_auth_sessions')
    .update(updatePayload)
    .eq('id', row.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to refresh app session');
  }

  const nextRow = data as AppAuthSessionRow;
  if (!rawSecret) {
    return {
      row: nextRow,
      cookieValue: null,
      cookieExpiresAt: null,
    };
  }

  return {
    row: nextRow,
    cookieValue: await buildAppSessionCookieValue({
      sid: nextRow.id,
      secret: rawSecret,
      expiresAt: nextIdleExpiry,
    }),
    cookieExpiresAt: nextIdleExpiry,
  };
}

export async function issueAppSession(
  options: IssueAppSessionOptions
): Promise<{ row: AppAuthSessionRow; cookieValue: string; cookieExpiresAt: Date }> {
  const admin = createAdminClient();
  const now = new Date();
  const rememberMe = options.rememberMe === true;
  const durations = getDurations(rememberMe);
  const secret = randomToken();
  const sessionSecretHash = await hashSessionSecret(secret);
  const cookieExpiresAt = new Date(now.getTime() + durations.idleMs);
  const absoluteExpiresAt = new Date(now.getTime() + durations.absoluteMs);
  const metadata = await getCurrentRequestMetadata();
  const deviceId = await resolveDeviceId(options.profileId, options.rawDeviceId, options.deviceLabel);

  const { data, error } = await admin
    .from('app_auth_sessions')
    .insert({
      profile_id: options.profileId,
      device_id: deviceId,
      session_secret_hash: sessionSecretHash,
      session_source: options.source,
      remember_me: rememberMe,
      last_seen_at: now.toISOString(),
      idle_expires_at: cookieExpiresAt.toISOString(),
      absolute_expires_at: absoluteExpiresAt.toISOString(),
      user_agent: metadata.userAgent,
      ip_hash: metadata.ipHash,
      replaced_by_session_id: null,
      revoked_reason: null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create app session');
  }

  if (deviceId) {
    await markDeviceAuthenticated(deviceId);
  }

  return {
    row: data as AppAuthSessionRow,
    cookieValue: await buildAppSessionCookieValue({
      sid: data.id,
      secret,
      expiresAt: cookieExpiresAt,
    }),
    cookieExpiresAt,
  };
}

export async function revokeAppSession(
  sessionId: string,
  reason: string,
  replacementSessionId?: string | null
): Promise<void> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const existing = await getSessionRow(sessionId);
  if (!existing || existing.revoked_at) {
    return;
  }

  const { error } = await admin
    .from('app_auth_sessions')
    .update({
      revoked_at: nowIso,
      revoked_reason: reason,
      replaced_by_session_id: replacementSessionId || null,
    })
    .eq('id', sessionId);

  if (error) {
    throw new Error(error.message);
  }

}

export async function validateAppSession(
  options: { includeEmail?: boolean } = {}
): Promise<AppSessionValidationResult> {
  const cookiePayload = await getCurrentAppSessionCookiePayload();
  if (!cookiePayload || cookiePayload.v !== APP_SESSION_COOKIE_VERSION) {
    return {
      status: 'missing',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    };
  }

  const row = await getSessionRow(cookiePayload.sid);
  if (!row) {
    return {
      status: 'invalid',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    };
  }

  const now = new Date();
  if (
    row.revoked_at ||
    new Date(row.absolute_expires_at) <= now ||
    new Date(row.idle_expires_at) <= now ||
    row.session_secret_hash !== (await hashSessionSecret(cookiePayload.secret))
  ) {
    return {
      status: 'invalid',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    };
  }

  let currentRow = row;
  const email = options.includeEmail ? await getAuthUserEmail(currentRow.profile_id) : null;
  let nextCookieValue: string | null = null;
  let nextCookieExpiresAt: Date | null = null;

  const needsRotation = shouldRotateSession(currentRow, now);
  const needsSeenUpdate = now.getTime() - new Date(currentRow.last_seen_at).getTime() >= 60 * 1000;

  if (needsRotation || needsSeenUpdate) {
    const refreshed = await updateSessionActivity(currentRow, {
      rotate: needsRotation,
      now,
    });
    currentRow = refreshed.row;

    nextCookieExpiresAt = refreshed.cookieExpiresAt ?? getNextIdleExpiry(currentRow, now);
    nextCookieValue =
      refreshed.cookieValue ||
      (await buildAppSessionCookieValue({
        sid: currentRow.id,
        secret: cookiePayload.secret,
        expiresAt: nextCookieExpiresAt,
      }));
  }

  return {
    status: 'active',
    session: currentRow,
    profileId: currentRow.profile_id,
    email,
    cookieValue: nextCookieValue,
    cookieExpiresAt: nextCookieExpiresAt,
  };
}

export async function getCurrentAuthenticatedProfile(
  options: { includeEmail?: boolean } = {}
) {
  const validation = await validateAppSession(options);
  if (
    validation.session &&
    validation.status !== 'missing' &&
    validation.status !== 'invalid'
  ) {
    const profile = await getAppAuthProfile(validation.session.profile_id, validation.email);
    return {
      validation,
      profile,
    };
  }

  return getCurrentAuthenticatedProfileFromSupabase(options);
}

export async function getCurrentAuthenticatedProfileFromSupabase(
  options: { includeEmail?: boolean } = {}
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const email = options.includeEmail ? user.email || null : null;
  const profile = await getAppAuthProfile(user.id, email);

  return {
    validation: {
      status: 'active' as const,
      session: null,
      profileId: user.id,
      email,
      cookieValue: null,
      cookieExpiresAt: null,
    },
    profile,
  };
}

export async function getDeviceIdForProfile(profileId: string, rawDeviceId: string): Promise<string | null> {
  const device = await getWebAuthnDevice(profileId, rawDeviceId);
  return device?.id || null;
}
