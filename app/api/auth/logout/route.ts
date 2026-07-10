import { NextRequest, NextResponse } from 'next/server';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { revokeAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import { createClient } from '@/lib/supabase/server';
import { trackServerUsageEvent } from '@/lib/server/user-analytics';

export async function POST(request: NextRequest) {
  let response: NextResponse = NextResponse.json({ success: true });

  try {
    const validation = await validateAppSession();
    if (validation.session) {
      await trackServerUsageEvent({
        eventName: 'auth_logout',
        userId: validation.profileId,
        appSessionId: validation.session.id,
        request,
        metadata: {
          source: 'app_session',
        },
      });
      await revokeAppSession(validation.session.id, 'logout');
    } else {
      const supabase = await createClient();
      await trackServerUsageEvent({
        eventName: 'auth_logout',
        request,
        metadata: {
          source: 'supabase_session',
        },
      });
      await supabase.auth.signOut();
    }
  } catch (error) {
    response = NextResponse.json(
      { error: error instanceof Error ? error.message : 'Logout failed' },
      { status: 500 }
    );
  } finally {
    clearAllAuthCookies(request, response);
  }

  return response;
}
