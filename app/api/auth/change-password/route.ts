import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { verifyUserPassword } from '@/lib/server/password-auth';
import { createAdminClient } from '@/lib/supabase/admin';

interface ChangePasswordBody {
  currentPassword?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
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
  if (!current.profile.email) {
    return NextResponse.json(
      { error: 'Current password verification is unavailable for this account' },
      { status: 400 }
    );
  }

  const isCurrentPasswordValid = await verifyUserPassword(
    current.profile.email,
    current.profile.id,
    currentPassword
  );
  if (!isCurrentPasswordValid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { error: authError } = await admin.auth.admin.updateUserById(current.profile.id, {
    password,
  });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', current.profile.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  applyValidationCookieIfNeeded(response, current.validation);
  return response;
}
