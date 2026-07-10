import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  setAppSessionCookieInResponse,
} from '@/lib/server/app-auth/cookies';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { issueAppSession, validateAppSession, revokeAppSession } from '@/lib/server/app-auth/session';
import { isWebAuthnConfigured } from '@/lib/server/webauthn/config';
import { createClient } from '@/lib/supabase/server';
import { trackServerUsageEvent } from '@/lib/server/user-analytics';
import type { Database } from '@/types/database';

interface LoginRequestBody {
  email?: string;
  password?: string;
  rememberMe?: boolean;
  deviceId?: string;
  deviceLabel?: string;
}

async function verifyPasswordLogin(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string
): Promise<User | null> {
  async function attemptPassword(candidate: string): Promise<User | null> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: candidate,
    });

    if (error || !data.user) {
      return null;
    }

    return data.user;
  }

  const directMatch = await attemptPassword(password);
  if (directMatch) {
    return directMatch;
  }

  const trimmedPassword = password.trim();
  if (!trimmedPassword || trimmedPassword === password) {
    return null;
  }

  return attemptPassword(trimmedPassword);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const email = body.email?.trim() || '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        request,
        metadata: {
          method: 'password',
          reason: 'missing_credentials',
          status: 400,
        },
      });
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await verifyPasswordLogin(supabase, email, password);
    if (!user) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        request,
        metadata: {
          method: 'password',
          reason: 'invalid_credentials',
          status: 401,
        },
      });
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const existing = await validateAppSession();
    const shouldTrackWebAuthnDevice = isWebAuthnConfigured();
    const nextSession = await issueAppSession({
      profileId: user.id,
      source: 'password_login',
      rememberMe: body.rememberMe === true,
      rawDeviceId: shouldTrackWebAuthnDevice ? body.deviceId || null : null,
      deviceLabel: shouldTrackWebAuthnDevice ? body.deviceLabel || null : null,
      actorProfileId: user.id,
    });

    if (existing.session) {
      await revokeAppSession(existing.session.id, 'replaced_by_password_login', nextSession.row.id);
    }

    const profile = await getAppAuthProfile(user.id, user.email || null);
    await trackServerUsageEvent({
      eventName: 'auth_login_success',
      userId: user.id,
      appSessionId: nextSession.row.id,
      request,
      metadata: {
        method: 'password',
        rememberMe: body.rememberMe === true,
        hadExistingSession: Boolean(existing.session),
        deviceLabelProvided: Boolean(body.deviceLabel),
      },
    });
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || null,
      },
      profile: {
        id: profile.id,
        must_change_password: profile.must_change_password,
      },
    });

    clearAllAuthCookies(request, response);
    setAppSessionCookieInResponse(response, nextSession.cookieValue, nextSession.cookieExpiresAt);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 500 }
    );
  }
}
