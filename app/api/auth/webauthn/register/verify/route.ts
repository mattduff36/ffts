import { NextRequest, NextResponse } from 'next/server';
import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { createWebAuthnAuditEvent } from '@/lib/server/webauthn/audit';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  getWebAuthnRequestConfig,
  isWebAuthnConfigured,
  WEBAUTHN_DISABLED_MESSAGE,
} from '@/lib/server/webauthn/config';
import {
  consumeWebAuthnChallenge,
  saveWebAuthnCredential,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface VerifyRegistrationBody {
  response?: RegistrationResponseJSON;
  challenge?: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  if (!isWebAuthnConfigured()) {
    return NextResponse.json({ error: WEBAUTHN_DISABLED_MESSAGE }, { status: 503 });
  }

  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as VerifyRegistrationBody;
    if (!body.response || !body.challenge) {
      return NextResponse.json({ error: 'Registration response is required' }, { status: 400 });
    }

    if (
      body.response.authenticatorAttachment &&
      body.response.authenticatorAttachment !== 'platform'
    ) {
      return NextResponse.json(
        { error: 'Only this device biometric authenticator is supported' },
        { status: 400 }
      );
    }

    const challenge = await consumeWebAuthnChallenge({
      challenge: body.challenge,
      challengeType: 'registration',
      profileId: current.profile.id,
    });
    const config = await getWebAuthnRequestConfig();
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      await createWebAuthnAuditEvent({
        profileId: current.profile.id,
        actorProfileId: current.profile.id,
        eventType: 'biometric_registration_failed',
      });
      return NextResponse.json({ error: 'Biometric registration failed' }, { status: 400 });
    }

    const { credential, credentialBackedUp, credentialDeviceType } =
      verification.registrationInfo;
    await saveWebAuthnCredential({
      profileId: current.profile.id,
      rawDeviceId: body.deviceId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      webauthnUserId: challenge.webauthn_user_id || credential.id,
      counter: credential.counter,
      transports: credential.transports || body.response.response.transports || null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: 'Device biometrics',
    });

    await createWebAuthnAuditEvent({
      profileId: current.profile.id,
      actorProfileId: current.profile.id,
      eventType: 'biometric_registration_success',
      metadata: {
        credential_id: credential.id,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
      },
    });

    return NextResponse.json({ success: true, verified: true });
  } catch (error) {
    await createWebAuthnAuditEvent({
      profileId: current.profile.id,
      actorProfileId: current.profile.id,
      eventType: 'biometric_registration_failed',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown registration error',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Biometric registration failed' },
      { status: 400 }
    );
  }
}
