import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { fromBase64Url } from '@/lib/server/app-auth/jwt';
import {
  getWebAuthnRequestConfig,
  isWebAuthnConfigured,
  WEBAUTHN_DISABLED_MESSAGE,
} from '@/lib/server/webauthn/config';
import {
  getActiveWebAuthnCredentialsForProfile,
  getWebAuthnUserId,
  saveWebAuthnChallenge,
  toWebAuthnBytes,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface RegistrationOptionsBody {
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

  const body = (await request.json().catch(() => ({}))) as RegistrationOptionsBody;
  const config = await getWebAuthnRequestConfig();
  const webauthnUserId = await getWebAuthnUserId(current.profile.id);
  const credentials = await getActiveWebAuthnCredentialsForProfile({
    profileId: current.profile.id,
    rawDeviceId: body.deviceId,
  });

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: toWebAuthnBytes(fromBase64Url(webauthnUserId)),
    userName: current.profile.email || current.profile.id,
    userDisplayName: current.profile.full_name || current.profile.email || 'Forest Farm user',
    attestationType: 'none',
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports || undefined,
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    preferredAuthenticatorType: 'localDevice',
  });

  await saveWebAuthnChallenge({
    profileId: current.profile.id,
    rawDeviceId: body.deviceId,
    challenge: options.challenge,
    challengeType: 'registration',
    webauthnUserId,
  });

  return NextResponse.json(options);
}
