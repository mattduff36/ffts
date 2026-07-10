import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import {
  getWebAuthnRequestConfig,
  isWebAuthnConfigured,
  WEBAUTHN_DISABLED_MESSAGE,
} from '@/lib/server/webauthn/config';
import {
  getActiveWebAuthnCredentialsForProfile,
  saveWebAuthnChallenge,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface LoginOptionsBody {
  profileId?: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  if (!isWebAuthnConfigured()) {
    return NextResponse.json({ error: WEBAUTHN_DISABLED_MESSAGE }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as LoginOptionsBody;
  const profileId = body.profileId?.trim() || null;
  const deviceId = body.deviceId?.trim() || null;
  const config = await getWebAuthnRequestConfig();
  const credentials = profileId && deviceId
    ? await getActiveWebAuthnCredentialsForProfile({
      profileId,
      rawDeviceId: deviceId,
    })
    : [];

  if (profileId && credentials.length === 0) {
    return NextResponse.json(
      { error: 'Biometric login is not enabled for this device' },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports || undefined,
    })),
    userVerification: 'required',
  });

  await saveWebAuthnChallenge({
    profileId,
    rawDeviceId: deviceId,
    challenge: options.challenge,
    challengeType: 'authentication',
  });

  return NextResponse.json(options);
}
