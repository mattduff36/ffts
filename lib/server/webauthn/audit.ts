import { createAdminClient } from '@/lib/supabase/admin';

export type WebAuthnAuditEventType =
  | 'biometric_registration_success'
  | 'biometric_registration_failed'
  | 'biometric_login_success'
  | 'biometric_login_failed'
  | 'biometric_prompt_dismissed'
  | 'biometric_credential_revoked';

export async function createWebAuthnAuditEvent({
  profileId,
  actorProfileId,
  eventType,
  metadata,
}: {
  profileId: string;
  actorProfileId: string | null;
  eventType: WebAuthnAuditEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabaseAdmin = createAdminClient();
  const { error } = await supabaseAdmin.from('webauthn_audit_events').insert({
    profile_id: profileId,
    actor_profile_id: actorProfileId,
    event_type: eventType,
    metadata: metadata || {},
  });

  if (error) {
    // Audit trail should not block user flows.
    console.warn('Failed to write WebAuthn audit event:', error.message);
  }
}
