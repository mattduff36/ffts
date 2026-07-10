import {
  createClient as createSupabaseClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { loadClientAuthSession, type ClientAuthSessionResponse } from '@/lib/app-auth/client-session'
import { handleAuthFailureStatus } from '@/lib/app-auth/recovery-bridge'
import { markDatabaseBackedSuccess, nudgeDatabaseHealthCheck } from '@/lib/database/client-health'
import { getViewAsRoleId, getViewAsTeamId } from '@/lib/utils/view-as-cookie'
import { withAuthOverrides } from '@/lib/supabase/with-auth-overrides'
import { createStatusError, getErrorStatus, isAuthErrorStatus } from '@/lib/utils/http-error'
import type { Database } from '@/types/database'

type BrowserSupabaseClient = SupabaseClient<Database>

let client: BrowserSupabaseClient | null = null
let cachedDataToken: { token: string; expiresAt: number } | null = null
let pendingDataTokenPromise: Promise<string | null> | null = null
let lastDataTokenFailureStatus: number | null = null

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: 'no-store',
    headers: {
      ...init?.headers,
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
    user: null,
    data_token_available: false,
  }
}

async function getDataToken(): Promise<string | null> {
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
      return null
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

  // During build/prerendering, environment variables may not be available
  // This is only used in client components, so we can safely skip during build
  if (typeof window === 'undefined') {
    throw new Error('createClient() can only be used in the browser')
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
        const token = await getDataToken()
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
        fetch: async (input, init) => {
          const viewAsRoleId = getViewAsRoleId()
          const viewAsTeamId = getViewAsTeamId()
          let response: Response

          if (viewAsRoleId || viewAsTeamId) {
            const headers = new Headers(init?.headers)
            if (viewAsRoleId) {
              headers.set('x-view-as-role-id', viewAsRoleId)
            }
            if (viewAsTeamId) {
              headers.set('x-view-as-team-id', viewAsTeamId)
            }
            response = await globalThis.fetch(input, { ...init, headers })
          } else {
            response = await globalThis.fetch(input, init)
          }

          if (isAuthErrorStatus(response.status)) {
            void handleAuthFailureStatus(response.status, { fallbackToRedirect: false })
          }

          if (response.ok) {
            markDatabaseBackedSuccess()
          } else if (response.status >= 500) {
            nudgeDatabaseHealthCheck()
          }

          return response
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
      if (!user) {
        return {
          data: {
            session: null,
          },
          error: null,
        }
      }

      const token = await getDataToken()
      if (!token) {
        return {
          data: {
            session: null,
          },
          error: null,
        }
      }

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

