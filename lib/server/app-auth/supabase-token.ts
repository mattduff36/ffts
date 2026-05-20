import {
  createClient as createSupabaseClient,
  type Session,
} from '@supabase/supabase-js';
import {
  getSupabaseAuthIssuer,
  getSupabaseJwtSigningSecret,
  SUPABASE_DATA_TOKEN_ROLE,
  SUPABASE_DATA_TOKEN_TTL_SECONDS,
} from '@/lib/server/app-auth/constants';
import { signJwtHS256 } from '@/lib/server/app-auth/jwt';
import { templateConfig } from '@/lib/config/template-config';

export interface SupabaseDataTokenOptions {
  profileId: string;
  email: string | null;
  sessionId: string;
}

function normaliseEmail(email: string | null): string {
  return (email || '').trim().toLowerCase();
}

function isDemoEmail(email: string | null): boolean {
  const normalisedEmail = normaliseEmail(email);
  const demoDomain = templateConfig.demoEmailDomain.trim().toLowerCase();
  return Boolean(normalisedEmail && demoDomain && normalisedEmail.endsWith(`@${demoDomain}`));
}

function getDemoUserPassword(): string {
  return process.env.DEMO_USER_PASSWORD || 'DemoPass123!';
}

export function canIssueSupabaseDataToken(email: string | null): boolean {
  return Boolean(getSupabaseJwtSigningSecret()) || (templateConfig.isDemoMode && isDemoEmail(email));
}

async function issueDemoSupabaseAccessToken(
  email: string | null
): Promise<{ token: string; expiresAt: number } | null> {
  if (!templateConfig.isDemoMode || !isDemoEmail(email)) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normaliseEmail(email),
    password: getDemoUserPassword(),
  });
  const session = data.session as Session | null;
  if (error || !session?.access_token) {
    return null;
  }

  return {
    token: session.access_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + SUPABASE_DATA_TOKEN_TTL_SECONDS,
  };
}

export async function issueSupabaseDataToken(
  options: SupabaseDataTokenOptions
): Promise<{ token: string; expiresAt: number } | null> {
  const signingSecret = getSupabaseJwtSigningSecret();
  if (!signingSecret) {
    return issueDemoSupabaseAccessToken(options.email);
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
