import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

export async function GET() {
  const current = await getCurrentAuthenticatedProfile({ allowPendingPasswordChange: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (current.profile.must_change_password === true) {
    return NextResponse.json(
      { error: 'Choose a permanent password before using the app.', code: 'PASSWORD_CHANGE_REQUIRED' },
      { status: 403 }
    );
  }
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: 'No active access token' }, { status: 503 });
  }

  return NextResponse.json({
    token: session.access_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
