import { NextRequest, NextResponse } from 'next/server';
import { createWebAuthnAuditEvent } from '@/lib/server/webauthn/audit';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { revokeWebAuthnCredentialsForDevice } from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface RevokeDeviceBody {
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as RevokeDeviceBody;
  if (!body.deviceId) {
    return NextResponse.json({ error: 'A valid deviceId is required' }, { status: 400 });
  }

  const revokedCount = await revokeWebAuthnCredentialsForDevice({
    profileId: current.profile.id,
    rawDeviceId: body.deviceId,
  });

  if (revokedCount > 0) {
    await createWebAuthnAuditEvent({
      profileId: current.profile.id,
      actorProfileId: current.profile.id,
      eventType: 'biometric_credential_revoked',
      metadata: { revoked_count: revokedCount },
    });
  }

  return NextResponse.json({ success: true, revoked_count: revokedCount });
}
