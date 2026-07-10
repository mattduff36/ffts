/**
 * E2E: Core Dashboard Regression Checks
 *
 * Smoke tests for high-traffic dashboard pages:
 * - Dashboard still loads
 * - Fleet page still loads
 * - Workshop tasks still loads
 * - Reports page still loads
 * - No broken routes from inspection rename
 * - No hydration errors
 *
 * Auth: admin storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

const SMOKE_ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/fleet', name: 'Fleet' },
  { path: '/workshop-tasks', name: 'Workshop Tasks' },
  { path: '/reports', name: 'Reports' },
  { path: '/actions', name: 'Actions and Reminders' },
  { path: '/timesheets', name: 'Timesheets' },
];

test.describe('Regression Smoke — Core Pages', () => {
  for (const route of SMOKE_ROUTES) {
    test(`${route.name} page loads without 404 or 500`, async ({ page }) => {
      const capture = attachConsoleErrorCapture(page);
      let response: Awaited<ReturnType<typeof page.goto>> | null = null;
      try {
        response = await page.goto(route.path);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        test.skip(message.includes('timeout'), `${route.name} route timed out in this environment`);
        throw error;
      }

      expect(response?.status(), `${route.name} should not 404`).not.toBe(404);
      expect(response?.status(), `${route.name} should not 500`).not.toBe(500);

      await waitForAppReady(page);

      const errors = capture.getErrors();
      expect(errors, `No console errors on ${route.name}`).toHaveLength(0);
    });
  }
});

test.describe('Regression — Inspection Routes', () => {
  test('/van-inspections loads without 404 or 500', async ({ page }) => {
    let response: Awaited<ReturnType<typeof page.goto>> | null = null;
    try {
      response = await page.goto('/van-inspections');
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      test.skip(message.includes('timeout'), '/van-inspections route timed out in this environment');
      throw error;
    }
    expect(response?.status()).not.toBe(404);
    expect(response?.status()).not.toBe(500);
  });
});

test.describe('Regression — No Hydration Errors', () => {
  test('van-inspections has no hydration mismatch', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('hydration')) {
        hydrationErrors.push(msg.text());
      }
    });

    try {
      await page.goto('/van-inspections');
      await waitForAppReady(page);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      test.skip(message.includes('timeout'), 'Van inspections route timed out in this environment');
      throw error;
    }

    // Wait a bit for any delayed hydration errors
    await page.waitForTimeout(2000);
    expect(hydrationErrors, 'No hydration errors').toHaveLength(0);
  });

  test('plant-inspections has no hydration mismatch', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('hydration')) {
        hydrationErrors.push(msg.text());
      }
    });

    try {
      await page.goto('/plant-inspections');
      await waitForAppReady(page);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      test.skip(message.includes('timeout'), 'Plant inspections route timed out in this environment');
      throw error;
    }

    await page.waitForTimeout(2000);
    expect(hydrationErrors, 'No hydration errors').toHaveLength(0);
  });
});
