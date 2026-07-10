import { cookies } from 'next/headers';
import { APP_SESSION_COOKIE_LOGICAL_NAME, APP_SESSION_COOKIE_NAME, getAppSessionSigningSecret } from '@/lib/server/app-auth/constants';
import { signJwtHS256, verifyJwtHS256 } from '@/lib/server/app-auth/jwt';

export interface AppSessionCookiePayload extends Record<string, unknown> {
  sid: string;
  secret: string;
  exp: number;
  v: number;
}

export interface AppSessionCookieOptions {
  sid: string;
  secret: string;
  expiresAt: Date;
}

type CookieResponse = {
  cookies: {
    set: (name: string, value: string, options?: Record<string, unknown>) => void;
  };
}

function getCookieNameCandidates(): string[] {
  if (APP_SESSION_COOKIE_NAME === APP_SESSION_COOKIE_LOGICAL_NAME) {
    return [APP_SESSION_COOKIE_NAME];
  }

  return [APP_SESSION_COOKIE_NAME, APP_SESSION_COOKIE_LOGICAL_NAME];
}

export function getAppSessionCookieAttributes(expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    priority: 'high' as const,
  };
}

export async function buildAppSessionCookieValue(
  options: AppSessionCookieOptions
): Promise<string> {
  return signJwtHS256(
    {
      sid: options.sid,
      secret: options.secret,
      exp: Math.floor(options.expiresAt.getTime() / 1000),
      v: 1,
    },
    getAppSessionSigningSecret()
  );
}

export async function parseAppSessionCookieValue(
  token: string
): Promise<AppSessionCookiePayload | null> {
  return verifyJwtHS256<AppSessionCookiePayload>(token, getAppSessionSigningSecret());
}

export async function getCurrentAppSessionCookieValue(): Promise<string | null> {
  const cookieStore = await cookies();
  for (const cookieName of getCookieNameCandidates()) {
    const value = cookieStore.get(cookieName)?.value;
    if (value) {
      return value;
    }
  }
  return null;
}

export async function getCurrentAppSessionCookiePayload(): Promise<AppSessionCookiePayload | null> {
  const value = await getCurrentAppSessionCookieValue();
  if (!value) {
    return null;
  }
  return parseAppSessionCookieValue(value);
}

export function expireAppSessionCookieInResponse(response: CookieResponse): void {
  for (const cookieName of getCookieNameCandidates()) {
    response.cookies.set(cookieName, '', {
      ...getAppSessionCookieAttributes(new Date(0)),
      maxAge: 0,
    });
  }
}

export function setAppSessionCookieInResponse(
  response: CookieResponse,
  value: string,
  expiresAt: Date
): void {
  response.cookies.set(APP_SESSION_COOKIE_NAME, value, getAppSessionCookieAttributes(expiresAt));
}
