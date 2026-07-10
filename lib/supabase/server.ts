import {
  createClient as createSupabaseClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { VIEW_AS_ROLE_COOKIE_NAME, VIEW_AS_TEAM_COOKIE_NAME } from '@/lib/utils/view-as-cookie'
import { issueSupabaseDataToken } from '@/lib/server/app-auth/supabase-token'
import { validateAppSession } from '@/lib/server/app-auth/session'
import { withAuthOverrides } from '@/lib/supabase/with-auth-overrides'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()
  const viewAsRoleId = cookieStore.get(VIEW_AS_ROLE_COOKIE_NAME)?.value || ''
  const viewAsTeamId = cookieStore.get(VIEW_AS_TEAM_COOKIE_NAME)?.value || ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const appendViewAsHeaders = (init?: RequestInit) => {
    if (!viewAsRoleId && !viewAsTeamId) {
      return init
    }

    const headers = new Headers(init?.headers)
    if (viewAsRoleId) {
      headers.set('x-view-as-role-id', viewAsRoleId)
    }
    if (viewAsTeamId) {
      headers.set('x-view-as-team-id', viewAsTeamId)
    }
    return { ...init, headers }
  }

  const validation = await validateAppSession({ includeEmail: true })
  const session = validation.session
  const canUseAppSession = session && validation.status !== 'invalid' && validation.status !== 'missing'

  if (!canUseAppSession) {
    return createServerClient<Database>(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {
              // The `set` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing user sessions.
            }
          },
        },
        global: {
          fetch: (input, init) => fetch(input, appendViewAsHeaders(init)),
        },
      }
    )
  }

  const dataToken = await issueSupabaseDataToken({
    profileId: session.profile_id,
    email: validation.email,
    sessionId: session.id,
  })

  const baseClient: SupabaseClient<Database> = createSupabaseClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      accessToken: async () => dataToken?.token || '',
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, appendViewAsHeaders(init)),
      },
    }
  )

  const syntheticUser = {
    id: session.profile_id,
    app_metadata: {
      provider: 'app_session',
      providers: ['app_session'],
    },
    user_metadata: {},
    aud: 'authenticated',
    created_at: session.created_at,
    email: validation.email || undefined,
  } as User

  return withAuthOverrides(baseClient, {
    getUser: (async () => ({
      data: {
        user: syntheticUser,
      },
      error: null,
    })) as typeof baseClient.auth.getUser,
    getSession: (async () => {
      return {
        data: {
          session: {
            access_token: dataToken?.token || '',
            refresh_token: '',
            token_type: 'bearer',
            expires_in: dataToken ? Math.max(0, dataToken.expiresAt - Math.floor(Date.now() / 1000)) : 0,
            expires_at: dataToken?.expiresAt || Math.floor(Date.now() / 1000),
            user: syntheticUser,
          } as Session,
        },
        error: null,
      }
    }) as typeof baseClient.auth.getSession,
  })
}

