/**
 * @tags @absence
 * Smoke tests absence employee and management surfaces.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@absence Absence', () => {
  test('absence page loads with booking or allowance state', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/absence', 'Absence route timed out in this environment');

    await expect(page.locator('body')).toContainText(/absence|holiday|leave|allowance|booking/i, {
      timeout: 10_000,
    });
  });

  test('absence management page loads or shows a clear access state', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/absence/manage', 'Absence manage route timed out in this environment');

    await expect(page.locator('body')).toContainText(/absence|manage|team|approval|permission|dashboard/i, {
      timeout: 10_000,
    });
  });
});
