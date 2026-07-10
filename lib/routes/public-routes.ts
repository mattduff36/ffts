const PUBLIC_BROWSER_ROUTE_PREFIXES = [
  '/login',
  '/change-password',
  '/offline',
  '/pwa-debug',
  '/displayboard-workshop',
  '/displayboard-workshop-tv',
] as const;

const PUBLIC_API_ROUTE_PREFIXES = [
  '/api/display-board/',
] as const;

function getPathname(value: string): string {
  return value.split(/[?#]/, 1)[0] || '/';
}

export function pathMatchesRoutePrefix(path: string, prefix: string): boolean {
  const pathname = getPathname(path);

  if (prefix.endsWith('/')) {
    return pathname.startsWith(prefix);
  }

  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicBrowserPath(path: string): boolean {
  return PUBLIC_BROWSER_ROUTE_PREFIXES.some((prefix) => pathMatchesRoutePrefix(path, prefix));
}

export function isPublicRequestPath(path: string): boolean {
  return (
    isPublicBrowserPath(path) ||
    PUBLIC_API_ROUTE_PREFIXES.some((prefix) => pathMatchesRoutePrefix(path, prefix))
  );
}

export function isSafeInternalRedirectTarget(value: string | null): value is string {
  return Boolean(value && value.startsWith('/') && !value.startsWith('//'));
}
