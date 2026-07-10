import { describe, expect, it } from 'vitest';

describe('client auth policy helpers', () => {
  it('defers unauthenticated handling for silent background refresh reasons', async () => {
    const { shouldDeferUnauthenticatedHandling } = await import('@/lib/app-auth/client-auth-policy');

    expect(shouldDeferUnauthenticatedHandling('focus', { silent: true })).toBe(true);
    expect(shouldDeferUnauthenticatedHandling('recover', { silent: true })).toBe(true);
    expect(shouldDeferUnauthenticatedHandling('broadcast', { silent: true })).toBe(false);
    expect(shouldDeferUnauthenticatedHandling('focus', { silent: false })).toBe(false);
  });

  it('redirects auth failures to login', async () => {
    const { getAuthFailureRedirectPath } = await import('@/lib/app-auth/client-auth-policy');

    expect(getAuthFailureRedirectPath(401)).toBe('/login');
    expect(getAuthFailureRedirectPath(423)).toBe('/login');
  });
});
