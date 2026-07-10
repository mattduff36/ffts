/**
 * E2E: Plant Daily Checks Full Workflow
 *
 * Tests the complete plant daily check user journey:
 * - List page loads and shows content
 * - Navigation links work (no 404s)
 * - New daily check form loads
 * - No console errors or hydration errors
 * - Network failures captured
 *
 * Auth: employee storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('Plant Daily Checks — Page Loading', () => {
  test('plant-inspections list page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/plant-inspections') && response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/plant daily check|daily check|inspection/i);

    expect(failedRequests, 'No 500 errors on plant-inspections page').toHaveLength(0);
    const errors = capture.getErrors();
    expect(errors, 'No console errors on plant-inspections list').toHaveLength(0);
  });

  test('plant-inspections/new page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);

    await page.goto('/plant-inspections/new');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    const hasFormContent = /daily check|inspection|checklist|plant|save|submit/i.test(bodyText);
    expect(hasFormContent, 'New plant daily check form should load').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No console errors on plant-inspections/new').toHaveLength(0);
  });
});

test.describe('Plant Daily Checks — Navigation', () => {
  test('no 404 on /plant-inspections', async ({ page }) => {
    const response = await page.goto('/plant-inspections');
    expect(response?.status()).not.toBe(404);
  });

  test('no 404 on /plant-inspections/new', async ({ page }) => {
    const response = await page.goto('/plant-inspections/new');
    expect(response?.status()).not.toBe(404);
  });

  test('can open an existing plant daily check detail page when list has entries', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    const detailLink = page.locator('a[href^="/plant-inspections/"]:not([href$="/new"])').first();
    const hasDetailLink = (await detailLink.count()) > 0;
    test.skip(!hasDetailLink, 'No plant daily check records available for this environment');

    await detailLink.click();
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/plant-inspections\/.+/, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/inspection|defect|submit|draft/i);
  });
});

test.describe('Plant Daily Checks — Content Verification', () => {
  test('list page shows "Plant" in content', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/plant/i, { timeout: 10_000 });
  });

  test('list page uses daily check terminology', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);
    await expect(page.locator('h1')).toContainText(/Plant Daily Checks/i);
  });

  test('no "Vehicle Inspection" text in headings', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const vehicleHeadings = headings.filter(h => /vehicle\s+inspection/i.test(h));
    expect(vehicleHeadings, 'No headings should say "Vehicle Inspection"').toHaveLength(0);
  });

  test('new inspection page exposes workflow actions for human users', async ({ page }) => {
    await page.goto('/plant-inspections/new');
    await waitForAppReady(page);

    const actionButton = page.getByRole('button', { name: /save|submit|create|start|complete/i });
    const actionCount = await actionButton.count();

    if (actionCount === 0) {
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      const hasExpectedEmptyState = /(no\s+.*(plant|inspection|asset))|(select\s+.*(plant|asset))/.test(bodyText);
      expect(hasExpectedEmptyState).toBeTruthy();
      return;
    }

    expect(actionCount).toBeGreaterThan(0);
  });
});
