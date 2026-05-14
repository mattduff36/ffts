import {
  createClient as createSupabaseClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { loadClientAuthSession, type ClientAuthSessionResponse } from '@/lib/app-auth/client-session'
import { getViewAsRoleId, getViewAsTeamId } from '@/lib/utils/view-as-cookie'
import { withAuthOverrides } from '@/lib/supabase/with-auth-overrides'
import { createStatusError, getErrorStatus } from '@/lib/utils/http-error'
import type { Database } from '@/types/database'

type BrowserSupabaseClient = SupabaseClient<Database>

let client: BrowserSupabaseClient | null = null
let cachedDataToken: { token: string; expiresAt: number } | null = null
let pendingDataTokenPromise: Promise<string> | null = null
let lastDataTokenFailureStatus: number | null = null

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      'Cache-Control': 'no-cache',
    },
  })

  const rawPayload = await response.text()
  const payload = rawPayload ? JSON.parse(rawPayload) as T & { error?: string } : null

  if (!response.ok) {
    throw createStatusError(payload?.error || `HTTP ${response.status}`, response.status)
  }

  return payload as T
}

function buildSyntheticUser(sessionResponse: ClientAuthSessionResponse): User | null {
  if (!sessionResponse.user?.id) {
    return null
  }

  const nowIso = new Date().toISOString()
  return {
    id: sessionResponse.user.id,
    app_metadata: {
      provider: 'app_session',
      providers: ['app_session'],
    },
    user_metadata: {},
    aud: 'authenticated',
    created_at: nowIso,
    email: sessionResponse.user.email || undefined,
  } as User
}

async function getCurrentAuthSessionResponse(): Promise<ClientAuthSessionResponse> {
  const result = await loadClientAuthSession()
  return result.payload || {
    authenticated: false,
    locked: false,
    user: null,
    data_token_available: false,
  }
}

async function getDataToken(dataTokenAvailable = true): Promise<string> {
  if (!dataTokenAvailable) {
    cachedDataToken = null
    lastDataTokenFailureStatus = null
    return ''
  }

  if (cachedDataToken && cachedDataToken.expiresAt * 1000 > Date.now() + 30_000) {
    return cachedDataToken.token
  }

  if (pendingDataTokenPromise) {
    return pendingDataTokenPromise
  }

  pendingDataTokenPromise = (async () => {
    try {
      const response = await fetchJson<{ token: string; expires_at: number }>('/api/auth/data-token')
      cachedDataToken = {
        token: response.token,
        expiresAt: response.expires_at,
      }
      lastDataTokenFailureStatus = null
      return response.token
    } catch (error) {
      cachedDataToken = null
      lastDataTokenFailureStatus = getErrorStatus(error)
      return ''
    } finally {
      pendingDataTokenPromise = null
    }
  })()

  return pendingDataTokenPromise
}

export function invalidateCachedDataToken(): void {
  cachedDataToken = null
  lastDataTokenFailureStatus = null
}

export function getLastDataTokenFailureStatus(): number | null {
  return lastDataTokenFailureStatus
}

export function createClient(): BrowserSupabaseClient {
  if (client) {
    return client
  }

  if (typeof window === 'undefined') {
    // Client components still render once on the server in production. Return an inert
    // client so hooks can initialise; React Query work runs after hydration in the browser.
    return createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not set')
  }

  const baseClient = createSupabaseClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      accessToken: async () => {
        const sessionResponse = await getCurrentAuthSessionResponse()
        if (!sessionResponse.authenticated || sessionResponse.locked) {
          return ''
        }

        const token = await getDataToken(sessionResponse.data_token_available !== false)
        if (token) {
          baseClient.realtime.setAuth(token)
        }
        return token
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => {
          const viewAsRoleId = getViewAsRoleId()
          const viewAsTeamId = getViewAsTeamId()
          if (viewAsRoleId || viewAsTeamId) {
            const headers = new Headers(init?.headers)
            if (viewAsRoleId) {
              headers.set('x-view-as-role-id', viewAsRoleId)
            }
            if (viewAsTeamId) {
              headers.set('x-view-as-team-id', viewAsTeamId)
            }
            return globalThis.fetch(input, { ...init, headers })
          }

          return globalThis.fetch(input, init)
        },
      },
    }
  )

  client = withAuthOverrides(baseClient, {
    getUser: (async () => {
      const sessionResponse = await getCurrentAuthSessionResponse()
      return {
        data: {
          user: buildSyntheticUser(sessionResponse),
        },
        error: null,
      }
    }) as typeof baseClient.auth.getUser,
    getSession: (async () => {
      const sessionResponse = await getCurrentAuthSessionResponse()
      const user = buildSyntheticUser(sessionResponse)
      if (!user || sessionResponse.locked) {
        return {
          data: {
            session: null,
          },
          error: null,
        }
      }

      const token = await getDataToken(sessionResponse.data_token_available !== false)
      const expiresAt = cachedDataToken?.expiresAt ?? Math.floor(Date.now() / 1000)
      return {
        data: {
          session: {
            access_token: token,
            refresh_token: '',
            token_type: 'bearer',
            expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
            expires_at: expiresAt,
            user,
          } as Session,
        },
        error: null,
      }
    }) as typeof baseClient.auth.getSession,
    signOut: (async () => {
      invalidateCachedDataToken()
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }).catch(() => undefined)
      return {
        error: null,
      }
    }) as typeof baseClient.auth.signOut,
  }) as BrowserSupabaseClient

  return client as BrowserSupabaseClient
}

