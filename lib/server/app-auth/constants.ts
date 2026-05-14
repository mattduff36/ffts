export const APP_SESSION_COOKIE_LOGICAL_NAME = 'avs_app_session';
const shouldUseSecureHostCookie = process.env.NODE_ENV === 'production' && process.env.VERCEL === '1';
export const APP_SESSION_COOKIE_NAME =
  shouldUseSecureHostCookie
    ? `__Host-${APP_SESSION_COOKIE_LOGICAL_NAME}`
    : APP_SESSION_COOKIE_LOGICAL_NAME;

export const APP_SESSION_COOKIE_VERSION = 1;
export const APP_SESSION_IDLE_HOURS = 24;
export const APP_SESSION_ABSOLUTE_HOURS = 72;
export const APP_SESSION_REMEMBER_IDLE_DAYS = 30;
export const APP_SESSION_REMEMBER_ABSOLUTE_DAYS = 90;
export const APP_SESSION_ROTATE_AFTER_MINUTES = 60;
export const APP_SESSION_ROTATE_BEFORE_IDLE_EXPIRY_MINUTES = 6 * 60;
export const SUPABASE_DATA_TOKEN_TTL_SECONDS = 60 * 60;
export const APP_SESSION_TOKEN_ISSUER = 'avs-app-session';
export const SUPABASE_DATA_TOKEN_ROLE = 'authenticated';

export function getAppSessionSigningSecret(): string {
  const secret = process.env.APP_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('Missing APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY');
  }
  return secret;
}

export function getAppSessionHashSecret(): string {
  return process.env.APP_SESSION_HASH_SECRET || getAppSessionSigningSecret();
}

export function getSupabaseJwtSigningSecret(): string | null {
  return process.env.SUPABASE_JWT_SECRET || null;
}

export function getSupabaseAuthIssuer(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  return `${new URL(supabaseUrl).origin}/auth/v1`;
}
