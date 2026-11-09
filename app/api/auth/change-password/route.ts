import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { CredentialLockError, getCredentialChangeProfile, withCredentialLock } from '@/lib/server/app-auth/credential-lock';
import { verifyUserPassword } from '@/lib/server/password-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePasswordStrength } from '@/lib/utils/password';
import { logServerError } from '@/lib/utils/server-error-logger';

interface ChangePasswordBody {
  currentPassword?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  let passwordUpdateAttempted = false;
  let passwordChanged = false;
  try {
    return await changePassword();
  } catch (error) {
    if (error instanceof CredentialLockError && error.status === 409) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: new Error('Password change could not be completed'),
      request,
      componentName: '/api/auth/change-password',
      additionalData: { passwordUpdateAttempted, passwordChanged },
    });
    return NextResponse.json({
      error: passwordChanged
        ? 'Your password changed, but access could not be restored. Retry using your new password as the current password, or contact an administrator.'
        : passwordUpdateAttempted
          ? 'The password update could not be confirmed. Try signing in with the new password; if it works, use it as the current password to complete the change. Otherwise retry with your previous password.'
          : 'Password change is unavailable. Your credentials were not changed; please retry.',
      passwordChanged,
      passwordMayHaveChanged: passwordUpdateAttempted,
      ...(error instanceof CredentialLockError ? { code: error.code } : {}),
    }, { status: error instanceof CredentialLockError ? error.status : 500 });
  }

  async function changePassword() {
    const current = await getCredentialChangeProfile({ includeEmail: true, allowPendingPasswordChange: true });
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as ChangePasswordBody | null;
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!currentPassword.trim()) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
    }
    if (!password.trim()) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.errors.join('. ') }, { status: 400 });
    }
    if (password === currentPassword) {
      return NextResponse.json({ error: 'Choose a different password from your current password' }, { status: 400 });
    }
    return withCredentialLock(current.profile.id, async (lock) => {
      // The initial lookup only identifies the lock key; it cannot authorize a write.
      const fresh = await getCredentialChangeProfile({ includeEmail: true, allowPendingPasswordChange: true });
      lock.assertHeld();
      if (!fresh || fresh.profile.id !== current.profile.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!fresh.profile.email) {
        return NextResponse.json(
          { error: 'Current password verification is unavailable for this account' },
          { status: 400 }
        );
      }
      const isCurrentPasswordValid = await verifyUserPassword(
        fresh.profile.email,
        fresh.profile.id,
        currentPassword
      );
      lock.assertHeld();
      if (!isCurrentPasswordValid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
      }

      const admin = createAdminClient();
      passwordUpdateAttempted = true;
      const { data: updated, error: authError } = await admin.auth.admin.updateUserById(fresh.profile.id, {
        password,
      });
      if (authError) {
        lock.assertHeld();
        return NextResponse.json({ error: 'Failed to change password. Please retry.' }, { status: 400 });
      }
      if (updated.user?.id !== fresh.profile.id) {
        throw new Error('Unable to confirm password update');
      }
      passwordChanged = true;
      lock.assertHeld();

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', fresh.profile.id)
        .select('id, must_change_password')
        .single();
      lock.assertHeld();

      if (profileError || profile?.id !== fresh.profile.id || profile.must_change_password !== false) {
        throw new Error('Unable to confirm password-change requirement cleared');
      }

      const response = NextResponse.json({ success: true });
      applyValidationCookieIfNeeded(response, fresh.validation);
      return response;
    });
  }
}
