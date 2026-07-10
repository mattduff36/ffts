/**
 * @tags @timesheets @critical
 * Smoke tests timesheet page navigation and listing.
 * Auth: manager storage state (via timesheets project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@timesheets @critical Timesheets Smoke', () => {
  test('timesheets page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/timesheets');
    await waitForAppReady(page);

    expect(page.url()).toContain('/timesheets');
    await expect(page.locator('body')).toContainText(/timesheet/i, { timeout: 10_000 });

    const errors = capture.getErrors();
    expect(errors, 'No page errors on timesheets').toHaveLength(0);
  });

  test('new timesheet form loads', async ({ page }) => {
    await page.goto('/timesheets/new');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/week ending|timesheet|new/i, { timeout: 10_000 });
  });
});
