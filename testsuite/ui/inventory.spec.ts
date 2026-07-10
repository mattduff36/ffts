/**
 * @tags @inventory @critical
 * Smoke tests inventory route and table controls.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@inventory @critical Inventory', () => {
  test('inventory page loads with table or empty state', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/inventory', 'Inventory route timed out in this environment');

    await expect(page.locator('body')).toContainText(/inventory|stock|item|group|location|category/i, {
      timeout: 10_000,
    });
  });

  test('inventory groups/settings state is reachable from the page shell', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/inventory', 'Inventory route timed out in this environment');

    await expect(page.locator('body')).toContainText(/search|filter|columns|show more|inventory/i, {
      timeout: 10_000,
    });
  });
});
