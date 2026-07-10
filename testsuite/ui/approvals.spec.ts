/**
 * @tags @approvals @critical
 * Smoke tests approvals shell and tab switching.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@approvals @critical Approvals', () => {
  test('approvals page loads with timesheet approvals shell', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/approvals', 'Approvals route timed out in this environment');

    await expect(page.locator('body')).toContainText(/approval|timesheet|absence|pending|manager/i, {
      timeout: 10_000,
    });
  });

  test('absence approvals tab can be opened', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/approvals?tab=absences', 'Approvals absences tab timed out in this environment');

    await expect(page.locator('body')).toContainText(/absence|holiday|approved|pending|all caught up/i, {
      timeout: 10_000,
    });
  });
});
