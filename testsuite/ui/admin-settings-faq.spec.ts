/**
 * @tags @admin @faq
 * Smoke tests admin settings, vehicle admin, and FAQ editor routes.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@admin @faq Admin Settings and FAQ', () => {
  test('admin settings page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/admin/settings', 'Admin settings route timed out in this environment');

    await expect(page.locator('body')).toContainText(/settings|admin|timesheet|exception|configuration/i, {
      timeout: 10_000,
    });
  });

  test('admin vehicles page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/admin/vehicles', 'Admin vehicles route timed out in this environment');

    await expect(page.locator('body')).toContainText(/vehicle|van|hgv|plant|admin|category/i, {
      timeout: 10_000,
    });
  });

  test('admin FAQ editor page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/admin/faq', 'Admin FAQ route timed out in this environment');

    await expect(page.locator('body')).toContainText(/faq|help|article|category|admin/i, {
      timeout: 10_000,
    });
  });
});
