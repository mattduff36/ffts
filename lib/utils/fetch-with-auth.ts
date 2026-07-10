'use client';

import { handleAuthFailureStatus } from '@/lib/app-auth/recovery-bridge';
import { isAuthErrorStatus } from '@/lib/utils/http-error';

export interface AuthAwareRequestInit extends RequestInit {
  skipAuthRecovery?: boolean;
}

export type AuthAwareFetch = (
  input: string | URL | Request,
  init?: AuthAwareRequestInit
) => Promise<Response>;

type BrowserFetch = typeof window.fetch & {
  __avsAuthAwareOriginalFetch__?: typeof window.fetch;
  __avsAuthAwarePatched__?: boolean;
};

function getRequestUrl(input: string | URL | Request): URL | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (input instanceof Request) {
    return new URL(input.url, window.location.origin);
  }

  return new URL(String(input), window.location.origin);
}

function shouldHandleAuthRecovery(input: string | URL | Request): boolean {
  const requestUrl = getRequestUrl(input);
  if (!requestUrl) {
    return false;
  }

  if (requestUrl.origin !== window.location.origin) {
    return false;
  }

  if (!requestUrl.pathname.startsWith('/api/')) {
    return false;
  }

  if (requestUrl.pathname.startsWith('/api/auth/')) {
    return false;
  }

  return true;
}

export function createAuthAwareFetch(baseFetch: typeof fetch): AuthAwareFetch {
  return (async (input: string | URL | Request, init?: AuthAwareRequestInit) => {
    const { skipAuthRecovery = false, ...requestInit } = init ?? {};
    const response = await baseFetch(input, requestInit);

    if (!skipAuthRecovery && shouldHandleAuthRecovery(input) && isAuthErrorStatus(response.status)) {
      void handleAuthFailureStatus(response.status);
    }

    return response;
  }) as AuthAwareFetch;
}

export function installGlobalAuthAwareFetch(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const currentFetch = window.fetch as BrowserFetch;
  if (currentFetch.__avsAuthAwarePatched__) {
    return () => {};
  }

  const originalFetch = currentFetch.bind(window);
  const wrappedFetch = createAuthAwareFetch(originalFetch) as BrowserFetch;

  wrappedFetch.__avsAuthAwareOriginalFetch__ = originalFetch;
  wrappedFetch.__avsAuthAwarePatched__ = true;
  window.fetch = wrappedFetch;

  return () => {
    const activeFetch = window.fetch as BrowserFetch;
    if (
      activeFetch.__avsAuthAwarePatched__ &&
      activeFetch.__avsAuthAwareOriginalFetch__ === originalFetch
    ) {
      window.fetch = originalFetch;
    }
  };
}

export async function fetchWithAuth(
  input: string | URL | Request,
  init?: AuthAwareRequestInit
): Promise<Response> {
  const activeFetch =
    typeof window !== 'undefined'
      ? ((window.fetch as BrowserFetch).__avsAuthAwareOriginalFetch__ ?? window.fetch.bind(window))
      : fetch;

  return createAuthAwareFetch(activeFetch)(input, init);
}
