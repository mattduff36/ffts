import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  getActiveWebAuthnCredentialsForProfile,
  isBiometricPromptDismissed,
} from '@/lib/server/webauthn/credentials';
import { isWebAuthnConfigured } from '@/lib/server/webauthn/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isWebAuthnConfigured()) {
    return NextResponse.json({
      success: true,
      webauthn_configured: false,
      credentials_configured: false,
      credential_count: 0,
      prompt_dismissed: true,
    });
  }

  const rawDeviceId = request.nextUrl.searchParams.get('deviceId');
  const credentials = await getActiveWebAuthnCredentialsForProfile({
    profileId: current.profile.id,
    rawDeviceId,
  });
  const promptDismissed = await isBiometricPromptDismissed({
    profileId: current.profile.id,
    rawDeviceId,
  });

  return NextResponse.json({
    success: true,
    webauthn_configured: true,
    credentials_configured: credentials.length > 0,
    credential_count: credentials.length,
    prompt_dismissed: promptDismissed,
  });
}
