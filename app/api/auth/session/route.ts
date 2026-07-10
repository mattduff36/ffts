import { NextResponse } from 'next/server';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canIssueSupabaseDataToken } from '@/lib/server/app-auth/supabase-token';

export async function GET() {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        profile: null,
        data_token_available: canIssueSupabaseDataToken(null),
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    authenticated: true,
    user: {
      id: current.profile.id,
      email: current.profile.email,
    },
    profile: current.profile,
    can_edit_basic_fields: canEditOwnBasicProfileFields(current.profile),
    data_token_available: canIssueSupabaseDataToken(current.profile.email),
  });
  applyValidationCookieIfNeeded(response, current.validation);
  return response;
}
