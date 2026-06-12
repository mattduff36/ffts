import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  APP_SESSION_COOKIE_LOGICAL_NAME,
  APP_SESSION_COOKIE_NAME,
  getAppSessionSigningSecret,
} from '@/lib/server/app-auth/constants'
import { verifyJwtHS256 } from '@/lib/server/app-auth/jwt'
import type { Database } from '@/types/database'

interface MiddlewareSessionPayload extends Record<string, unknown> {
  sid: string
  secret: string
  locked: boolean
  exp: number
  v: number
}

const CRON_ROUTE_PATHS = new Set([
  '/api/maintenance/sync-dvla-scheduled',
  '/api/quotes/start-alerts-scheduled',
  '/api/absence/bank-holidays/seed-scheduled',
])
const LEGACY_SUPABASE_COOKIE_PATTERN = /^sb-.*-auth-token(?:\.[0-9]+)?$/
const LEGACY_SUPABASE_CODE_VERIFIER_PATTERN = /^sb-.*-auth-token-code-verifier$/
const LEGACY_SESSION_ALLOWED_AUTH_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/logout',
])

function getAppSessionCookieValue(request: NextRequest): string | null {
  return (
    request.cookies.get(APP_SESSION_COOKIE_NAME)?.value ||
    request.cookies.get(APP_SESSION_COOKIE_LOGICAL_NAME)?.value ||
    null
  )
}

async function getMiddlewareSession(request: NextRequest): Promise<MiddlewareSessionPayload | null> {
  const cookieValue = getAppSessionCookieValue(request)
  if (!cookieValue) {
    return null
  }

  try {
    return await verifyJwtHS256<MiddlewareSessionPayload>(cookieValue, getAppSessionSigningSecret())
  } catch {
    return null
  }
}

function hasLegacySupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => LEGACY_SUPABASE_COOKIE_PATTERN.test(name))
}

function expireAppSessionCookies(response: NextResponse): void {
  const expiresAt = new Date(0)
  const cookieNames =
    APP_SESSION_COOKIE_NAME === APP_SESSION_COOKIE_LOGICAL_NAME
      ? [APP_SESSION_COOKIE_NAME]
      : [APP_SESSION_COOKIE_NAME, APP_SESSION_COOKIE_LOGICAL_NAME]

  cookieNames.forEach((cookieName) => {
    response.cookies.set(cookieName, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
      maxAge: 0,
      priority: 'high',
    })
  })
}

function clearLegacySupabaseCookies(request: NextRequest, response: NextResponse): void {
  request.cookies.getAll().forEach(({ name }) => {
    if (
      LEGACY_SUPABASE_COOKIE_PATTERN.test(name) ||
      LEGACY_SUPABASE_CODE_VERIFIER_PATTERN.test(name)
    ) {
      response.cookies.set(name, '', {
        path: '/',
        maxAge: 0,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      })
    }
  })
}

function clearAllAuthCookies(request: NextRequest, response: NextResponse): void {
  expireAppSessionCookies(response)
  clearLegacySupabaseCookies(request, response)
}

function isAuthorizedCronRequest(request: NextRequest): boolean {
  if (!CRON_ROUTE_PATHS.has(request.nextUrl.pathname)) {
    return false
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return false
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

function withMiddlewareCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie)
  })

  return target
}

function redirectWithMiddlewareCookies(
  source: NextResponse,
  url: URL,
  status?: number
): NextResponse {
  return withMiddlewareCookies(NextResponse.redirect(url, status), source)
}

function jsonWithMiddlewareCookies(
  source: NextResponse,
  body: { error: string; code?: string },
  init: { status: number }
): NextResponse {
  return withMiddlewareCookies(NextResponse.json(body, init), source)
}

async function getSupabaseUser(
  request: NextRequest,
  response: NextResponse
): Promise<{ id: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user ? { id: user.id } : null
}

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request })
  const session = await getMiddlewareSession(request)
  await getSupabaseUser(request, response)
  const hasLegacyCookie = hasLegacySupabaseSessionCookie(request)
  const publicPaths = ['/login', '/change-password', '/offline', '/questionnaire']
  const publicApiPaths = ['/api/questionnaire']
  const isPublicPath = publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  const isPublicApiRoute = publicApiPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isLockRoute = request.nextUrl.pathname.startsWith('/lock')
  const isAuthRoute = request.nextUrl.pathname.startsWith('/api/auth/')
  const isAccountSwitchRoute = request.nextUrl.pathname.startsWith('/api/account-switch/')
  const isVersionRoute = request.nextUrl.pathname === '/api/version'
  const allowLockedApi =
    isAuthRoute || isAccountSwitchRoute || isVersionRoute

  if (isAuthorizedCronRequest(request)) {
    return response
  }

  // The app-session cookie is now the only accepted browser auth state.
  // Legacy Supabase cookies are cleared opportunistically when a valid app session exists,
  // and otherwise force a clean login so mixed auth modes cannot linger.
  if (session && hasLegacyCookie) {
    clearLegacySupabaseCookies(request, response)
  }

  if (!session && hasLegacyCookie) {
    clearAllAuthCookies(request, response)

    if (
      isApiRoute &&
      !isPublicApiRoute &&
      !LEGACY_SESSION_ALLOWED_AUTH_ROUTES.has(request.nextUrl.pathname)
    ) {
      return jsonWithMiddlewareCookies(
        response,
        { error: 'Legacy session expired', code: 'LEGACY_SESSION_EXPIRED' },
        { status: 401 }
      )
    }

    if (isPublicPath || isPublicApiRoute || LEGACY_SESSION_ALLOWED_AUTH_ROUTES.has(request.nextUrl.pathname)) {
      return response
    }

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (request.nextUrl.pathname !== '/') {
      url.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    }
    return redirectWithMiddlewareCookies(response, url)
  }

  const isAuthenticated = Boolean(session)
  const isLocked = session?.locked === true

  if (request.nextUrl.pathname.startsWith('/rams')) {
    const url = request.nextUrl.clone()
    url.pathname = request.nextUrl.pathname.replace(/^\/rams/, '/projects')
    return redirectWithMiddlewareCookies(response, url, 301)
  }

  if (request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone()
    if (isAuthenticated) {
      url.pathname = isLocked ? '/lock' : '/dashboard'
      return redirectWithMiddlewareCookies(response, url, 307)
    }
    if (hasLegacyCookie) {
      url.pathname = '/api/auth/bootstrap'
      url.search = ''
      url.searchParams.set('returnTo', '/dashboard')
      return redirectWithMiddlewareCookies(response, url, 307)
    }
    url.pathname = '/login'
    return redirectWithMiddlewareCookies(response, url, 307)
  }

  if (
    isAuthenticated &&
    isLocked &&
    !isPublicPath &&
    !isLockRoute &&
    !isApiRoute &&
    request.nextUrl.pathname !== '/login'
  ) {
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`
    const url = request.nextUrl.clone()
    url.pathname = '/lock'
    url.search = ''
    url.searchParams.set('returnTo', returnTo)

    return redirectWithMiddlewareCookies(response, url, 307)
  }

  if (isAuthenticated && isLocked && isApiRoute && !isPublicApiRoute && !allowLockedApi) {
    return jsonWithMiddlewareCookies(
      response,
      { error: 'Session is locked', code: 'SESSION_LOCKED' },
      { status: 423 }
    )
  }

  if (!isPublicPath && !isPublicApiRoute && !isAuthenticated && !isAuthRoute) {
    if (isApiRoute) {
      return jsonWithMiddlewareCookies(
        response,
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return redirectWithMiddlewareCookies(response, url)
  }

  if (request.nextUrl.pathname === '/login' && isAuthenticated && !isLocked) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return redirectWithMiddlewareCookies(response, url)
  }

  return response
}

