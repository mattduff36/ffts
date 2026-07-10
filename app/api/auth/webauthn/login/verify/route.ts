import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { createWebAuthnAuditEvent } from '@/lib/server/webauthn/audit';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { issueAppSession, revokeAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import {
  getWebAuthnRequestConfig,
  isWebAuthnConfigured,
  WEBAUTHN_DISABLED_MESSAGE,
} from '@/lib/server/webauthn/config';
import { trackServerUsageEvent } from '@/lib/server/user-analytics';
import {
  consumeWebAuthnChallenge,
  getCredentialPublicKey,
  getWebAuthnCredentialByCredentialId,
  updateWebAuthnCredentialCounter,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface VerifyLoginBody {
  response?: AuthenticationResponseJSON;
  challenge?: string;
  rememberMe?: boolean;
  deviceId?: string;
  deviceLabel?: string;
  profileId?: string;
}

export async function POST(request: NextRequest) {
  if (!isWebAuthnConfigured()) {
    return NextResponse.json({ error: WEBAUTHN_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    const body = (await request.json()) as VerifyLoginBody;
    if (!body.response || !body.challenge) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        request,
        metadata: {
          method: 'biometric',
          reason: 'missing_biometric_response',
          status: 400,
        },
      });
      return NextResponse.json({ error: 'Biometric response is required' }, { status: 400 });
    }

    const credential = await getWebAuthnCredentialByCredentialId(body.response.id);
    if (!credential) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        request,
        metadata: {
          method: 'biometric',
          reason: 'credential_not_recognised',
          status: 401,
        },
      });
      return NextResponse.json({ error: 'Biometric credential was not recognised' }, { status: 401 });
    }

    if (body.profileId && credential.profile_id !== body.profileId) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        userId: credential.profile_id,
        request,
        metadata: {
          method: 'biometric',
          reason: 'profile_mismatch',
          status: 401,
        },
      });
      return NextResponse.json({ error: 'Biometric credential was not recognised' }, { status: 401 });
    }

    const challenge = await consumeWebAuthnChallenge({
      challenge: body.challenge,
      challengeType: 'authentication',
      profileId: body.profileId || null,
    });
    if (challenge.device_id && credential.device_id !== challenge.device_id) {
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        userId: credential.profile_id,
        request,
        metadata: {
          method: 'biometric',
          reason: 'device_mismatch',
          status: 401,
        },
      });
      return NextResponse.json({ error: 'Biometric credential was not recognised for this device' }, { status: 401 });
    }
    const config = await getWebAuthnRequestConfig();
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: getCredentialPublicKey(credential),
        counter: credential.counter,
        transports: credential.transports || undefined,
      },
    });

    if (!verification.verified) {
      await createWebAuthnAuditEvent({
        profileId: credential.profile_id,
        actorProfileId: credential.profile_id,
        eventType: 'biometric_login_failed',
      });
      await trackServerUsageEvent({
        eventName: 'auth_login_failed',
        userId: credential.profile_id,
        request,
        metadata: {
          method: 'biometric',
          reason: 'verification_failed',
          status: 401,
        },
      });
      return NextResponse.json({ error: 'Biometric login failed' }, { status: 401 });
    }

    await updateWebAuthnCredentialCounter({
      credentialId: credential.credential_id,
      counter: verification.authenticationInfo.newCounter,
    });

    const existing = await validateAppSession();
    const nextSession = await issueAppSession({
      profileId: credential.profile_id,
      source: 'biometric_login',
      rememberMe: body.rememberMe === true,
      rawDeviceId: body.deviceId || null,
      deviceLabel: body.deviceLabel || null,
      actorProfileId: credential.profile_id,
    });

    if (existing.session) {
      await revokeAppSession(existing.session.id, 'replaced_by_biometric_login', nextSession.row.id);
    }

    const profile = await getAppAuthProfile(credential.profile_id, null);
    await trackServerUsageEvent({
      eventName: 'auth_login_success',
      userId: credential.profile_id,
      appSessionId: nextSession.row.id,
      request,
      metadata: {
        method: 'biometric',
        rememberMe: body.rememberMe === true,
        hadExistingSession: Boolean(existing.session),
        deviceLabelProvided: Boolean(body.deviceLabel),
      },
    });
    await createWebAuthnAuditEvent({
      profileId: credential.profile_id,
      actorProfileId: credential.profile_id,
      eventType: 'biometric_login_success',
      metadata: {
        app_session_id: nextSession.row.id,
        credential_id: credential.credential_id,
      },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: credential.profile_id,
        email: profile.email || null,
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
      { error: error instanceof Error ? error.message : 'Biometric login failed' },
      { status: 500 }
    );
  }
}
