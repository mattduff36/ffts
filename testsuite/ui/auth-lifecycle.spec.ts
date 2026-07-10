/**
 * @tags @auth @lifecycle @critical
 * Auth lifecycle resilience scenarios focused on sync behavior.
 */
import { test, expect, type TestInfo } from '@playwright/test';
import { login } from '../helpers/auth';
import { waitForAppReady } from '../helpers/wait-for-app';
import { recordAuthLifecycleIssue, type AuthLifecycleIssueInput } from '../runner/auth-lifecycle-audit';

const AUTH_EVENT_STORAGE_KEY = 'avs_auth_event_v1';

test.use({ storageState: { cookies: [], origins: [] } });

async function logIssue(testInfo: TestInfo, issue: AuthLifecycleIssueInput): Promise<void> {
  recordAuthLifecycleIssue({
    ...issue,
    source: `${testInfo.file} :: ${testInfo.title}`,
  });

  await testInfo.attach(`issue-${Date.now()}`, {
    body: JSON.stringify(issue, null, 2),
    contentType: 'application/json',
  });
}

async function fetchSessionStatus(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/session', {
      credentials: 'include',
    });
    return response.status;
  });
}

test.describe('@auth @lifecycle Authentication Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
    await waitForAppReady(page);
  });

  test('session stays healthy after visibility/focus transitions', async ({ page }, testInfo) => {
    const initialStatus = await fetchSessionStatus(page);
    expect(initialStatus, 'Initial session request should be successful').toBe(200);

    const secondPage = await page.context().newPage();
    await secondPage.goto('/dashboard');
    await waitForAppReady(secondPage);
    await secondPage.bringToFront();
    await page.bringToFront();

    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await page.waitForTimeout(500);
    const afterStatus = await fetchSessionStatus(page);
    if (afterStatus !== 200) {
      await logIssue(testInfo, {
        scenario: 'focus/visibility revalidation',
        details: `Session check failed after focus transition with status ${afterStatus}.`,
        severity: 'high',
        route: '/dashboard',
      });
    }
  });

  test('sign-out in one tab propagates to another tab', async ({ page }, testInfo) => {
    const siblingTab = await page.context().newPage();
    await siblingTab.goto('/dashboard');
    await waitForAppReady(siblingTab);

    await page.evaluate(async (storageKey) => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          event: 'signed_out',
          at: Date.now(),
        })
      );
    }, AUTH_EVENT_STORAGE_KEY);

    const redirected = await siblingTab
      .waitForURL((url) => url.pathname.includes('/login'), { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (!redirected) {
      await logIssue(testInfo, {
        scenario: 'cross-tab sign-out synchronization',
        details: 'Second tab did not navigate to login within timeout after sign-out broadcast.',
        severity: 'high',
        route: '/dashboard',
      });
    }

    const sessionStatus = await fetchSessionStatus(siblingTab);
    expect([200, 401]).toContain(sessionStatus);
  });

  test('authenticated users do not stay on the login route', async ({ page }, testInfo) => {
    await page.goto('/login');
    const redirected = await page
      .waitForURL((url) => url.pathname.includes('/dashboard') || url.pathname.includes('/change-password'), {
        timeout: 8_000,
      })
      .then(() => true)
      .catch(() => false);

    if (!redirected) {
      await logIssue(testInfo, {
        scenario: 'authenticated login route redirect',
        details: 'An authenticated user remained on /login instead of being redirected back into the app.',
        severity: 'low',
        route: '/login',
      });
    }
  });

  test('session recovers after offline -> online transition', async ({ page, context }, testInfo) => {
    await context.setOffline(true);
    await page.waitForTimeout(750);
    await context.setOffline(false);
    await page.waitForTimeout(1_250);

    const sessionAfterReconnectStatus = await fetchSessionStatus(page);
    if (sessionAfterReconnectStatus !== 200) {
      await logIssue(testInfo, {
        scenario: 'network reconnect revalidation',
        details: `Session check failed after reconnect with status ${sessionAfterReconnectStatus}.`,
        severity: 'medium',
        route: '/dashboard',
      });
    }
  });

  test('retired lock switch entrypoint is absent', async ({ page }, testInfo) => {
    const lockButton = page.getByRole('button', { name: /lock\s*\/\s*switch/i }).first();
    if ((await lockButton.count()) > 0) {
      await logIssue(testInfo, {
        scenario: 'retired lock entrypoint visibility',
        details: 'Lock / Switch control is still visible after the feature was removed.',
        severity: 'high',
        route: '/dashboard',
      });
    }
  });
});
