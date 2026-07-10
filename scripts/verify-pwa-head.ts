import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface StorageCookie {
  name: string;
  value: string;
}

interface StorageState {
  cookies?: StorageCookie[];
}

interface RouteCheck {
  path: string;
  label: string;
  authenticated?: boolean;
}

const baseUrl = process.env.PWA_HEAD_BASE_URL || process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';
const adminStorageStatePath = resolve(process.cwd(), 'testsuite/.state/storage-state-admin.json');

const publicRoutes: RouteCheck[] = [
  { path: '/', label: 'root redirect' },
  { path: '/login', label: 'login' },
  { path: '/pwa-debug', label: 'pwa debug' },
];

const authenticatedRoutes: RouteCheck[] = [
  { path: '/', label: 'authenticated root redirect', authenticated: true },
  { path: '/dashboard', label: 'dashboard', authenticated: true },
  { path: '/fleet', label: 'fleet', authenticated: true },
  { path: '/timesheets', label: 'timesheets', authenticated: true },
  { path: '/profile', label: 'profile', authenticated: true },
];

function readCookieHeader(): string | null {
  if (!existsSync(adminStorageStatePath)) {
    return null;
  }

  const storageState = JSON.parse(readFileSync(adminStorageStatePath, 'utf8')) as StorageState;
  const cookies = storageState.cookies || [];
  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function getInitialHead(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return match?.[1] ?? '';
}

function getNamedMeta(head: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = head.match(new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])([^>]*)>`, 'i'));
  if (!match) return null;

  const contentMatch = match[1].match(/\bcontent=["']([^"']*)["']/i);
  return contentMatch?.[1] ?? '';
}

function getManifestLinks(head: string): string[] {
  return [...head.matchAll(/<link\b(?=[^>]*\brel=["']manifest["'])([^>]*)>/gi)]
    .map((match) => {
      const hrefMatch = match[1].match(/\bhref=["']([^"']*)["']/i);
      return hrefMatch?.[1] ?? '';
    });
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchHtml(route: RouteCheck, cookieHeader: string | null): Promise<{ html: string; finalUrl: string; status: number }> {
  const response = await fetch(new URL(route.path, baseUrl), {
    redirect: 'follow',
    headers: {
      accept: 'text/html',
      ...(route.authenticated && cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });

  return {
    html: await response.text(),
    finalUrl: response.url,
    status: response.status,
  };
}

function verifyHead(route: RouteCheck, html: string, finalUrl: string, status: number): void {
  assert(status === 200, `${route.label}: expected HTTP 200 after redirects, got ${status} at ${finalUrl}`);
  if (route.authenticated) {
    assert(new URL(finalUrl).pathname !== '/login', `${route.label}: authenticated route resolved to /login; refresh testsuite admin storage state`);
  }

  const head = getInitialHead(html);
  assert(head, `${route.label}: initial <head> not found`);

  assert(getNamedMeta(head, 'apple-mobile-web-app-capable') === 'yes', `${route.label}: missing apple-mobile-web-app-capable=yes in initial head`);
  assert(getNamedMeta(head, 'mobile-web-app-capable') === 'yes', `${route.label}: missing mobile-web-app-capable=yes in initial head`);
  assert(Boolean(getNamedMeta(head, 'apple-mobile-web-app-title')), `${route.label}: missing apple-mobile-web-app-title in initial head`);
  assert(getNamedMeta(head, 'apple-mobile-web-app-status-bar-style') === 'black-translucent', `${route.label}: missing apple status bar meta in initial head`);

  const manifests = getManifestLinks(head);
  assert(manifests.length === 1, `${route.label}: expected exactly one manifest link in initial head, got ${manifests.length}`);
  assert(manifests[0] === '/manifest.json', `${route.label}: expected canonical /manifest.json, got ${manifests[0]}`);

  const allManifestLinks = [...html.matchAll(/<link\b(?=[^>]*\brel=["']manifest["'])([^>]*)>/gi)];
  assert(allManifestLinks.length === 1, `${route.label}: expected exactly one manifest link in full HTML, got ${allManifestLinks.length}`);
}

async function verifyManifest(): Promise<void> {
  const response = await fetch(new URL('/manifest.json', baseUrl));
  assert(response.status === 200, `manifest.json: expected HTTP 200, got ${response.status}`);
  const manifest = await response.json() as {
    start_url?: string;
    scope?: string;
    display?: string;
    display_override?: string[];
  };

  assert(manifest.start_url === '/', `manifest.json: expected start_url "/", got ${manifest.start_url}`);
  assert(manifest.scope === '/', `manifest.json: expected scope "/", got ${manifest.scope}`);
  assert(manifest.display === 'standalone', `manifest.json: expected display "standalone", got ${manifest.display}`);
  assert(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'), 'manifest.json: expected display_override to include "standalone"');

  const staleManifest = await fetch(new URL('/favicon/site.webmanifest', baseUrl), { redirect: 'manual' });
  assert(staleManifest.status !== 200, 'favicon/site.webmanifest: stale secondary manifest should not be served');
}

async function main() {
  const cookieHeader = readCookieHeader();
  const routes = cookieHeader ? [...publicRoutes, ...authenticatedRoutes] : publicRoutes;

  if (!cookieHeader) {
    console.warn('Admin storage state not found; authenticated PWA head routes were skipped.');
  }

  for (const route of routes) {
    const { html, finalUrl, status } = await fetchHtml(route, cookieHeader);
    verifyHead(route, html, finalUrl, status);
    console.log(`PWA head OK: ${route.label} -> ${new URL(finalUrl).pathname}`);
  }

  await verifyManifest();
  console.log('PWA manifest OK: /manifest.json is canonical and install-scoped to /');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
