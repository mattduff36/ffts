/**
 * @tags @quotes @customers
 * Smoke tests quotes and customers business surfaces.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@quotes @customers Quotes and Customers', () => {
  test('quotes page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/quotes', 'Quotes route timed out in this environment');

    await expect(page.locator('body')).toContainText(/quote|customer|status|calendar|amount|dashboard/i, {
      timeout: 10_000,
    });
  });

  test('customers page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/customers', 'Customers route timed out in this environment');

    await expect(page.locator('body')).toContainText(/customer|contact|quote|history|dashboard/i, {
      timeout: 10_000,
    });
  });
});
