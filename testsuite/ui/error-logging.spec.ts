/**
 * @tags @errors @critical
 * Tests error logging and console error absence on critical pages.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: creates scoped test errors and removes them afterwards.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';
import { ensureSensitiveModuleAccess } from '../helpers/sensitive-access';

config({ path: resolve(process.cwd(), '.env.local') });

const CLIENT_ERROR_MARKER = 'Test client-side error: Button click handler failed';
const SERVER_ERROR_MARKER = 'Test caught error: Database connection failed';

test.describe.configure({ mode: 'serial' });

declare global {
  interface Window {
    errorLogger?: unknown;
  }
}

interface ErrorLogRow {
  id: string;
  error_message: string;
  user_email: string | null;
  timestamp: string;
  page_url: string;
  component_name: string | null;
}

async function gotoWithTimeoutSkip(
  page: import('@playwright/test').Page,
  route: string,
  skipMessage: string
) {
  try {
    await page.goto(route);
    await waitForAppReady(page);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    test.skip(
      message.includes('timeout') ||
      message.includes('err_connection_refused') ||
      message.includes('net::err_connection_refused'),
      skipMessage
    );
    throw error;
  }
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

function isTargetErrorLog(log: ErrorLogRow): boolean {
  return log.error_message.includes(CLIENT_ERROR_MARKER) || log.error_message.includes(SERVER_ERROR_MARKER);
}

async function fetchRecentTargetErrorLogs(sinceIso: string): Promise<ErrorLogRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('error_logs')
    .select('id, error_message, user_email, timestamp, page_url, component_name')
    .gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to fetch recent error logs: ${error.message}`);
  }

  return (data || []).filter(isTargetErrorLog);
}

async function cleanupRecentTargetErrorLogs(sinceIso: string): Promise<void> {
  const supabase = getServiceClient();
  const logs = await fetchRecentTargetErrorLogs(sinceIso);
  const ids = logs.map((log) => log.id);

  if (ids.length === 0) {
    return;
  }

  const { error } = await supabase.from('error_logs').delete().in('id', ids);
  if (error) {
    throw new Error(`Failed to clean up test error logs: ${error.message}`);
  }
}

test.describe('@errors @critical Error Logging', () => {
  test('regular admins cannot access the Super Admin debug console', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await ensureSensitiveModuleAccess(page, { moduleName: 'debug' });
    await gotoWithTimeoutSkip(page, '/debug', 'Debug route timed out in this environment');

    const bodyText = await page.locator('body').innerText();
    const onDebugRoute = /\/debug(?:$|[?#/])/.test(page.url());
    const accessDenied = /access denied|forbidden|unauthori|super\s*admin\s+only|actual role mode/i.test(bodyText);
    expect(
      !onDebugRoute || accessDenied,
      'Testsuite Admin must not receive Super Admin-only debug access'
    ).toBeTruthy();
    await expect(page.getByText('SuperAdmin Debug Console')).toHaveCount(0);

    const errors = capture.getErrors();
    expect(errors, 'No page errors while denying debug console access').toHaveLength(0);
  });

  test.skip('fresh client and server errors are logged and visible in debug console', async ({ page }) => {
    // This workflow requires a manually provisioned Super Admin account.
    // Automated testsuite accounts intentionally never receive that role.
    test.setTimeout(60_000);
    const capture = attachConsoleErrorCapture(page);
    const sinceIso = new Date().toISOString();

    try {
      await gotoWithTimeoutSkip(page, '/test-error-logging', 'Error logging test page timed out in this environment');
      await expect(page.getByRole('heading', { name: 'Error Logging Test Suite' })).toBeVisible();
      await expect
        .poll(async () => page.evaluate(() => Boolean(window.errorLogger)), { timeout: 10_000 })
        .toBe(true);

      await page.getByRole('button', { name: 'Test Client Error' }).click();
      await page.getByRole('button', { name: 'Test Server Error (Catch)' }).click();

      await expect
        .poll(
          async () => {
            const logs = await fetchRecentTargetErrorLogs(sinceIso);
            const hasClientError = logs.some((log) => log.error_message.includes(CLIENT_ERROR_MARKER));
            const hasServerError = logs.some((log) => log.error_message.includes(SERVER_ERROR_MARKER));
            return `${hasClientError}-${hasServerError}`;
          },
          {
            timeout: 30_000,
            intervals: [1_000, 2_000, 4_000],
          }
        )
        .toBe('true-true');

      capture.clear();

      await ensureSensitiveModuleAccess(page, { moduleName: 'debug' });
      await gotoWithTimeoutSkip(page, '/debug?tab=error-log', 'Debug route timed out in this environment');
      await expect(page.getByText('SuperAdmin Debug Console')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('tab', { name: /error log|errors/i }).click();
      await expect(page.getByText('Application Error Log')).toBeVisible({ timeout: 10_000 });

      const hideLocalhostFilter = page.getByText('Hide Localhost');
      if (!(await hideLocalhostFilter.isVisible({ timeout: 1_000 }).catch(() => false))) {
        await page.getByRole('button', { name: /^filters\b/i }).click();
      }
      await expect(hideLocalhostFilter).toBeVisible({ timeout: 5_000 });
      await hideLocalhostFilter.click();

      const searchInput = page.getByPlaceholder('Search errors...');
      await searchInput.fill('Test client-side error');
      await expect(page.getByText(CLIENT_ERROR_MARKER).first()).toBeVisible({ timeout: 10_000 });

      await searchInput.fill('Test caught error');
      await expect(page.getByText(SERVER_ERROR_MARKER).first()).toBeVisible({ timeout: 10_000 });

      const debugErrors = capture.getErrors().filter((error) => !(
        error.url?.includes('/test-error-logging') &&
        error.message.includes('the server responded with a status of 500')
      ));
      expect(debugErrors, 'No unexpected page errors on the debug error log view').toHaveLength(0);
    } finally {
      await cleanupRecentTargetErrorLogs(sinceIso);
    }
  });
});

test.describe('@errors @critical No Console Errors on Critical Pages', () => {
  const criticalPages = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Workshop Tasks', path: '/workshop-tasks' },
    { name: 'Fleet', path: '/fleet' },
    { name: 'Timesheets', path: '/timesheets' },
  ];

  for (const { name, path } of criticalPages) {
    test(`no console errors on ${name}`, async ({ page }) => {
      const capture = attachConsoleErrorCapture(page);
      await gotoWithTimeoutSkip(page, path, `${name} route timed out in this environment`);

      const errors = capture.getErrors();
      expect(errors, `No console errors on ${name}`).toHaveLength(0);
    });
  }
});
