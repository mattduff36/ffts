import { normalizeTrackedPath } from '@/lib/profile/quick-links';

export const USER_ANALYTICS_PRD_EPIC_ID = 'PRD-EPIC-USER-ANALYTICS-001';

export type UserUsageEventName =
  | 'session_started'
  | 'session_heartbeat'
  | 'session_ended'
  | 'page_view'
  | 'route_changed'
  | 'visibility_resume'
  | 'auth_login_success'
  | 'auth_login_failed'
  | 'auth_logout'
  | 'error_observed';

export type UserUsageEventCategory = 'session' | 'navigation' | 'auth' | 'error' | 'performance';
export type UserUsageEventSource = 'client' | 'server';
export type UsageDeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface UsageDeviceContext {
  userAgent: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  deviceType: UsageDeviceType;
  viewportWidth: number | null;
  viewportHeight: number | null;
  locale: string | null;
  timezone: string | null;
}

export interface UsageEventInput {
  eventName: UserUsageEventName;
  eventCategory?: UserUsageEventCategory;
  occurredAt?: string;
  path?: string | null;
  referrerPath?: string | null;
  durationMs?: number | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  errorLogId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const USER_USAGE_EVENT_CATEGORY_BY_NAME: Record<UserUsageEventName, UserUsageEventCategory> = {
  session_started: 'session',
  session_heartbeat: 'session',
  session_ended: 'session',
  page_view: 'navigation',
  route_changed: 'navigation',
  visibility_resume: 'session',
  auth_login_success: 'auth',
  auth_login_failed: 'auth',
  auth_logout: 'auth',
  error_observed: 'error',
};

const USER_USAGE_EVENT_NAMES = new Set<UserUsageEventName>(
  Object.keys(USER_USAGE_EVENT_CATEGORY_BY_NAME) as UserUsageEventName[]
);

const SENSITIVE_METADATA_KEY_PATTERN =
  /(password|passcode|pin|token|secret|cookie|authorization|credential|assertion|signature|clientdatajson|authenticatordata|email|phone|address)/i;

const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 40;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 500;
const MAX_METADATA_JSON_LENGTH = 8_000;

export function isUserUsageEventName(value: unknown): value is UserUsageEventName {
  return typeof value === 'string' && USER_USAGE_EVENT_NAMES.has(value as UserUsageEventName);
}

export function getUserUsageEventCategory(eventName: UserUsageEventName): UserUsageEventCategory {
  return USER_USAGE_EVENT_CATEGORY_BY_NAME[eventName];
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

export function normalizeUsagePath(rawPath: string | null | undefined): string | null {
  if (!rawPath || typeof rawPath !== 'string') return null;

  try {
    return normalizeTrackedPath(rawPath).slice(0, 300);
  } catch {
    return rawPath.trim().slice(0, 300) || null;
  }
}

export function getUsageModuleFromPath(path: string | null | undefined): string | null {
  const normalized = normalizeUsagePath(path);
  if (!normalized) return null;

  const pathname = normalized.split('?')[0] || '/';
  if (pathname === '/' || pathname === '/dashboard') return 'dashboard';

  const [first, second] = pathname.replace(/^\//, '').split('/');
  if (!first) return 'dashboard';
  if (first === 'admin' && second) return `admin/${second}`;
  if (first === 'absence' && second === 'manage') return 'absence/manage';
  return first;
}

export function detectUsageDeviceType(userAgent: string | null | undefined): UsageDeviceType {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return 'unknown';
  if (ua.includes('ipad') || ua.includes('tablet')) return 'tablet';
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) return 'mobile';
  return 'desktop';
}

export function parseBrowserName(userAgent: string | null | undefined): { name: string | null; version: string | null } {
  const ua = userAgent || '';
  const match =
    ua.match(/Edg\/([\d.]+)/) ||
    ua.match(/Chrome\/([\d.]+)/) ||
    ua.match(/Firefox\/([\d.]+)/) ||
    ua.match(/Version\/([\d.]+).*Safari/) ||
    ua.match(/Safari\/([\d.]+)/);

  if (!match) return { name: null, version: null };
  if (ua.includes('Edg/')) return { name: 'Edge', version: match[1] };
  if (ua.includes('Chrome/')) return { name: 'Chrome', version: match[1] };
  if (ua.includes('Firefox/')) return { name: 'Firefox', version: match[1] };
  if (ua.includes('Safari/')) return { name: 'Safari', version: match[1] };
  return { name: 'Unknown', version: match[1] };
}

export function parseOsName(userAgent: string | null | undefined): string | null {
  const ua = userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) || typeof value === 'boolean' ? value : null;
  }
  if (typeof value === 'string') return truncate(value, MAX_STRING_LENGTH);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= MAX_METADATA_DEPTH) return '[truncated]';
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeMetadataValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return null;
  if (depth >= MAX_METADATA_DEPTH) return '[truncated]';

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    const safeKey = truncate(key.replace(/[^\w.-]/g, '_'), 80);
    if (!safeKey) continue;
    output[safeKey] = SENSITIVE_METADATA_KEY_PATTERN.test(safeKey)
      ? '[redacted]'
      : sanitizeMetadataValue(entry, depth + 1);
  }

  return output;
}

export function sanitizeAnalyticsMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeMetadataValue(value, 0);
  const objectValue =
    sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};

  const serialized = JSON.stringify(objectValue);
  if (serialized.length <= MAX_METADATA_JSON_LENGTH) {
    return objectValue;
  }

  return {
    truncated: true,
    originalSize: serialized.length,
    preview: serialized.slice(0, MAX_METADATA_JSON_LENGTH - 100),
  };
}

export function getBrowserUsageDeviceContext(): UsageDeviceContext {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: null,
      browserName: null,
      browserVersion: null,
      osName: null,
      deviceType: 'unknown',
      viewportWidth: null,
      viewportHeight: null,
      locale: null,
      timezone: null,
    };
  }

  const userAgent = navigator.userAgent || null;
  const browser = parseBrowserName(userAgent);
  return {
    userAgent,
    browserName: browser.name,
    browserVersion: browser.version,
    osName: parseOsName(userAgent),
    deviceType: detectUsageDeviceType(userAgent),
    viewportWidth: Number.isFinite(window.innerWidth) ? window.innerWidth : null,
    viewportHeight: Number.isFinite(window.innerHeight) ? window.innerHeight : null,
    locale: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  };
}
