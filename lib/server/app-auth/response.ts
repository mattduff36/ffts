import { NextRequest, NextResponse } from 'next/server';
import {
  expireAppSessionCookieInResponse,
  setAppSessionCookieInResponse,
} from '@/lib/server/app-auth/cookies';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const LEGACY_SUPABASE_COOKIE_PATTERN = /^sb-.*-auth-token(?:\.[0-9]+)?$/;
const LEGACY_SUPABASE_CODE_VERIFIER_PATTERN = /^sb-.*-auth-token-code-verifier$/;

function getRequestCookies(
  request: NextRequest | Request
): Array<{ name: string; value: string }> {
  if ('cookies' in request && request.cookies && typeof request.cookies.getAll === 'function') {
    return request.cookies.getAll();
  }

  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return [];
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return { name: part, value: '' };
      }

      return {
        name: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1).trim(),
      };
    });
}

export function clearLegacySupabaseCookies(request: NextRequest | Request, response: NextResponse): void {
  getRequestCookies(request).forEach((cookie) => {
    if (
      LEGACY_SUPABASE_COOKIE_PATTERN.test(cookie.name) ||
      LEGACY_SUPABASE_CODE_VERIFIER_PATTERN.test(cookie.name)
    ) {
      response.cookies.set(cookie.name, '', {
        path: '/',
        maxAge: 0,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
  });
}

export function applyValidationCookieIfNeeded(
  response: NextResponse,
  validation: AppSessionValidationResult
): void {
  if (validation.cookieValue && validation.cookieExpiresAt) {
    setAppSessionCookieInResponse(response, validation.cookieValue, validation.cookieExpiresAt);
  }
}

export function clearAllAuthCookies(request: NextRequest | Request, response: NextResponse): void {
  expireAppSessionCookieInResponse(response);
  clearLegacySupabaseCookies(request, response);
}
