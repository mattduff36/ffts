import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { applyValidationCookieIfNeeded, clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { issueAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import type { Database } from '@/types/database';

function getReturnTo(request: NextRequest): string {
  const candidate = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
  if (!candidate.startsWith('/')) {
    return '/dashboard';
  }
  return candidate;
}

export async function GET(request: NextRequest) {
  const existing = await validateAppSession();
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getReturnTo(request);
  redirectUrl.search = '';

  if (existing.session && existing.status !== 'invalid' && existing.status !== 'missing') {
    const response = NextResponse.redirect(redirectUrl, 307);
    applyValidationCookieIfNeeded(response, existing);
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl, 307);
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl, 307);
  }

  const nextSession = await issueAppSession({
    profileId: user.id,
    source: 'session_bootstrap',
    rememberMe: true,
    actorProfileId: user.id,
  });

  const response = NextResponse.redirect(redirectUrl, 307);
  clearAllAuthCookies(request, response);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });
  setAppSessionCookieInResponse(response, nextSession.cookieValue, nextSession.cookieExpiresAt);
  return response;
}
