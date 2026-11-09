import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { revokeAppSessionsForProfile } from '@/lib/server/app-auth/session';
import { CredentialLockError, getCredentialChangeProfile, withCredentialLock } from '@/lib/server/app-auth/credential-lock';
import { revokeWebAuthnCredentialsForProfile } from '@/lib/server/webauthn/credentials';
import { z } from 'zod';
import { generateSecurePassword } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { logServerError } from '@/lib/utils/server-error-logger';

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let stage = 'validation';
  let passwordChangeRequired = false;
  let sessionsRevoked = false;
  let biometricsRevoked = false;
  let credentialsChanged = false;
  let emailDeliveryAttempted = false;
  let emailSent = false;
  const partialState = () => ({ passwordChangeRequired, sessionsRevoked, biometricsRevoked, credentialsChanged, emailDeliveryAttempted, emailSent });

  try {
    const initialProfile = await getCredentialChangeProfile();
    if (!initialProfile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;
    const actor = await getEffectiveRole();
    if (!actor.user_id || actor.user_id !== initialProfile.profile.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const text = await request.text();
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
    }
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254).optional() }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter a valid destination email address' }, { status: 400 });
    }

    const userId = (await params).id;
    stage = 'credential_lock';
    return await withCredentialLock(userId, async (lock) => {
      stage = 'authorization';
      const freshProfile = await getCredentialChangeProfile();
      lock.assertHeld();
      if (!freshProfile || freshProfile.profile.id !== initialProfile.profile.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const accessResponse = await requireAdminUsersModuleAccess();
      lock.assertHeld();
      if (accessResponse) return accessResponse;
      const currentActor = await getEffectiveRole();
      lock.assertHeld();
      if (!currentActor.user_id || currentActor.user_id !== actor.user_id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const admin = getSupabaseAdmin();
      stage = 'target_profile';
      const { data: target, error: profileError } = await admin
        .from('profiles')
        .select('full_name, role_id, super_admin, role:roles!profiles_role_id_fkey(is_super_admin, role_class)')
        .eq('id', userId)
        .single();
      lock.assertHeld();
      if (profileError && profileError.code !== 'PGRST116') {
        throw new Error('Unable to load target profile');
      }
      if (!target) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const targetRole = Array.isArray(target.role) ? target.role[0] : target.role;
      if (!target.role_id || !targetRole || targetRole.is_super_admin !== false || target.super_admin === true ||
          !['admin', 'manager', 'employee'].includes(targetRole.role_class) ||
          !(await canEffectiveRoleAssignRole(target.role_id))) {
        return NextResponse.json({ error: 'Forbidden: you cannot reset password for this role' }, { status: 403 });
      }
      lock.assertHeld();

      stage = 'target_auth';
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
      lock.assertHeld();
      if (authError && authError.status !== 404) {
        throw new Error('Unable to load target Auth identity');
      }
      if (!authUser.user?.email) {
        return NextResponse.json({ error: 'User email not found' }, { status: 404 });
      }
      const email = parsed.data.email ?? authUser.user.email;

      // Enforce restrictions before issuing any new credentials. Failures remain safe to retry.
      stage = 'password_change_requirement';
      const { data: flagged, error: flagError } = await admin
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', userId)
        .select('id, must_change_password')
        .single();
      if (flagError || flagged?.id !== userId || flagged.must_change_password !== true) {
        throw new Error('Failed to persist password-change requirement');
      }
      passwordChangeRequired = true;
      lock.assertHeld();
      stage = 'session_revocation';
      await revokeAppSessionsForProfile(userId, 'admin_password_reset');
      sessionsRevoked = true;
      lock.assertHeld();
      stage = 'biometric_revocation';
      await revokeWebAuthnCredentialsForProfile(userId);
      biometricsRevoked = true;
      lock.assertHeld();

      stage = 'credentials';
      const temporaryPassword = generateSecurePassword();
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, {
        ...(parsed.data.email !== undefined ? { email, email_confirm: true } : {}),
        password: temporaryPassword,
      });
      if (updateError) {
        lock.assertHeld();
        const duplicate = updateError.code === 'email_exists' || updateError.code === 'email_conflict' ||
          /already.*(?:registered|exists|used)|email.*already/i.test(updateError.message);
        console.error('Account handover credential update rejected', { duplicate });
        return NextResponse.json({
          error: duplicate
            ? 'That email is already in use. Restrictions were applied, but credentials were not changed. Correct the email and retry Change email & reset password.'
            : 'Credentials were not changed. Password change is required and old access was revoked. Retry Change email & reset password.',
          code: duplicate ? 'EMAIL_ALREADY_IN_USE' : 'CREDENTIAL_UPDATE_FAILED',
          partialState: partialState(),
        }, { status: duplicate ? 409 : 500 });
      }
      if (!updated.user || updated.user.id !== userId || updated.user.email?.toLowerCase() !== email.toLowerCase()) {
        throw new Error('Unable to confirm credential update');
      }
      credentialsChanged = true;
      lock.assertHeld();

      // Sweep again after the credential change to catch concurrent login/enrolment.
      stage = 'final_biometric_revocation';
      biometricsRevoked = false;
      await revokeWebAuthnCredentialsForProfile(userId);
      biometricsRevoked = true;
      lock.assertHeld();
      stage = 'final_session_revocation';
      sessionsRevoked = false;
      await revokeAppSessionsForProfile(userId, 'admin_password_reset');
      sessionsRevoked = true;
      lock.assertHeld();

      stage = 'email';
      emailDeliveryAttempted = true;
      try {
        emailSent = (await sendPasswordEmail({
          to: email,
          userName: target.full_name || 'User',
          temporaryPassword,
          isReset: true,
        })).success;
      } catch {
        console.warn('Account handover email delivery failed');
      }
      lock.assertHeld();
      if (!emailSent) console.warn('Account handover completed without email delivery');

      return NextResponse.json({
        success: true,
        email,
        temporaryPassword,
        emailSent,
        warning: emailSent ? undefined : 'Credentials changed, but email delivery failed. Share this temporary password securely or retry to generate a fresh one.',
        selfReset: currentActor.user_id === userId,
      }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error) {
    if (error instanceof CredentialLockError && error.status === 409) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    // Do not log provider errors: they can contain credential request payloads.
    await logServerError({
      error: new Error(`Account handover failed at ${stage}`),
      request,
      componentName: '/api/admin/users/[id]/reset-password',
      additionalData: { stage, ...partialState() },
    });
    return NextResponse.json({
      error: `Account handover stopped at ${stage}. ${credentialsChanged ? 'Account credentials changed, but this request could not complete. ' : stage === 'credentials' ? 'The credential update could not be confirmed. ' : ''}${emailDeliveryAttempted ? `Email delivery was attempted${emailSent ? ' and reported successful' : ' but could not be confirmed'}. ` : 'No password email was sent. '}Restrictions already applied remain in place. Retry Change email & reset password; if resetting yourself, sign in again if possible or ask another administrator.`,
      code: error instanceof CredentialLockError ? error.code : 'ACCOUNT_HANDOVER_INCOMPLETE',
      partialState: { ...partialState(), credentialsMayHaveChanged: stage === 'credentials' },
    }, { status: error instanceof CredentialLockError ? error.status : 500 });
  }
}

