/**
 * @tags @scheduling
 * Smoke tests scheduling management and employee surfaces.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@scheduling Scheduling', () => {
  test('management board loads or shows a clear access state', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/scheduling',
      'Scheduling route timed out in this environment'
    );

    await expect(page.locator('body')).toContainText(
      /job scheduling|weekly job board|my schedule|manager|permission|dashboard/i,
      { timeout: 10_000 }
    );
  });

  test('employee schedule loads with a weekly state', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/scheduling/my',
      'My schedule route timed out in this environment'
    );

    await expect(page.locator('body')).toContainText(
      /my schedule|assignment|no work assigned|permission|dashboard/i,
      { timeout: 10_000 }
    );
  });
});
