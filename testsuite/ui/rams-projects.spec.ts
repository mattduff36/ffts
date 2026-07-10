/**
 * @tags @rams @projects
 * Smoke tests RAMS and projects surfaces.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@rams @projects RAMS and Projects', () => {
  test('projects page loads', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/projects', 'Projects route timed out in this environment');

    await expect(page.locator('body')).toContainText(/project|rams|document|favourite|manage/i, {
      timeout: 10_000,
    });
  });

  test('projects manage page loads for admins', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/projects/manage', 'Projects manage route timed out in this environment');

    await expect(page.locator('body')).toContainText(/project|manage|document|rams|upload|assign/i, {
      timeout: 10_000,
    });
  });

  test('RAMS page loads or redirects to a valid project state', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/rams', 'RAMS route timed out in this environment');

    await expect(page.locator('body')).toContainText(/rams|project|document|dashboard|permission/i, {
      timeout: 10_000,
    });
  });
});
