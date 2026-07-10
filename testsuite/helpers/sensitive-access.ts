import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { getTestUser } from './auth';

config({ path: resolve(process.cwd(), '.env.local') });

type TestRole = 'admin' | 'manager' | 'employee';

interface AppSessionCookiePayload {
  sid?: string;
}

interface EnsureSensitiveModuleAccessOptions {
  moduleName?: string;
  role?: TestRole;
}

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function getAppSessionIdFromCookieValue(cookieValue: string): string | null {
  const [, payload] = cookieValue.split('.');
  if (!payload) return null;
  return decodeBase64UrlJson<AppSessionCookiePayload>(payload)?.sid || null;
}

export async function ensureSensitiveModuleAccess(
  page: Page,
  options: EnsureSensitiveModuleAccessOptions = {}
): Promise<void> {
  const moduleName = options.moduleName ?? 'debug';
  const role = options.role ?? 'admin';
  const profileId = getTestUser(role).userId;
  expect(profileId, `${role} profile id should be available before opening /${moduleName}`).toBeTruthy();

  const appSessionCookie = (await page.context().cookies())
    .find((cookie) => cookie.name === 'avs_app_session' || cookie.name === '__Host-avs_app_session');
  const sessionId = appSessionCookie ? getAppSessionIdFromCookieValue(appSessionCookie.value) : null;
  expect(sessionId, 'App session id should be available before opening a sensitive module').toBeTruthy();

  const supabase = getServiceClient();
  const { data: protectedModule, error: moduleError } = await supabase
    .from('permission_modules')
    .select('module_name, requires_sensitive_pin')
    .eq('module_name', moduleName)
    .maybeSingle();

  if (moduleError) {
    throw new Error(`Failed to load sensitive module metadata: ${moduleError.message}`);
  }

  if (protectedModule?.requires_sensitive_pin !== true) {
    return;
  }

  const { error } = await supabase
    .from('sensitive_pin_unlocks')
    .upsert({
      profile_id: profileId!,
      session_id: sessionId!,
      module_name: moduleName,
      unlocked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    }, { onConflict: 'session_id,module_name' });

  if (error) {
    throw new Error(`Failed to grant test sensitive access: ${error.message}`);
  }
}
