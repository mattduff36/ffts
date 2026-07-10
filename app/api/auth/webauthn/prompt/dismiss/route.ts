import { NextRequest, NextResponse } from 'next/server';
import { createWebAuthnAuditEvent } from '@/lib/server/webauthn/audit';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { dismissBiometricPrompt } from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface DismissBody {
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DismissBody;
  if (!body.deviceId) {
    return NextResponse.json({ error: 'A valid deviceId is required' }, { status: 400 });
  }

  await dismissBiometricPrompt({
    profileId: current.profile.id,
    rawDeviceId: body.deviceId,
  });

  await createWebAuthnAuditEvent({
    profileId: current.profile.id,
    actorProfileId: current.profile.id,
    eventType: 'biometric_prompt_dismissed',
  });

  return NextResponse.json({ success: true });
}
