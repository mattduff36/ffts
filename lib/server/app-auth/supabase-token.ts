import {
  getSupabaseAuthIssuer,
  getSupabaseJwtSigningSecret,
  SUPABASE_DATA_TOKEN_ROLE,
  SUPABASE_DATA_TOKEN_TTL_SECONDS,
} from '@/lib/server/app-auth/constants';
import { signJwtHS256 } from '@/lib/server/app-auth/jwt';

export interface SupabaseDataTokenOptions {
  profileId: string;
  email: string | null;
  sessionId: string;
}

export function canIssueSupabaseDataToken(_email: string | null): boolean {
  return Boolean(getSupabaseJwtSigningSecret());
}

export async function issueSupabaseDataToken(
  options: SupabaseDataTokenOptions
): Promise<{ token: string; expiresAt: number } | null> {
  const signingSecret = getSupabaseJwtSigningSecret();
  if (!signingSecret) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SUPABASE_DATA_TOKEN_TTL_SECONDS;

  const token = await signJwtHS256(
    {
      aud: 'authenticated',
      exp: expiresAt,
      iat: now,
      iss: getSupabaseAuthIssuer(),
      sub: options.profileId,
      email: options.email,
      phone: '',
      role: SUPABASE_DATA_TOKEN_ROLE,
      aal: 'aal1',
      amr: [
        {
          method: 'app_session',
          timestamp: now,
        },
      ],
      session_id: options.sessionId,
      app_metadata: {
        provider: 'app_session',
        providers: ['app_session'],
      },
      user_metadata: {},
    },
    signingSecret
  );

  return {
    token,
    expiresAt,
  };
}
