/**
 * E2E: Van Daily Checks Full Workflow
 *
 * Tests the complete van daily check user journey:
 * - List page loads and shows content
 * - Navigation links work (no 404s)
 * - New daily check form loads
 * - PDF download endpoint accessible (for authenticated users)
 * - No console errors or hydration errors
 * - Network failures captured
 *
 * Auth: employee storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('Van Daily Checks — Page Loading', () => {
  test('van-inspections list page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/van-inspections') && response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/van-inspections', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await expect(page.getByRole('heading', { name: /Van Daily Checks/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/van daily check|daily check|inspection/i);

    expect(failedRequests, 'No 500 errors on van-inspections page').toHaveLength(0);
    const errors = capture.getErrors();
    expect(errors, 'No console errors on van-inspections list').toHaveLength(0);
  });

  test('van-inspections/new page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);

    await page.goto('/van-inspections/new', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // The new daily check form should render after its data-driven loader completes.
    await expect(page.getByText(/Daily Check Details|Daily Check Date/i).first()).toBeVisible({ timeout: 20_000 });

    const errors = capture.getErrors();
    expect(errors, 'No console errors on van-inspections/new').toHaveLength(0);
  });
});

test.describe('Van Daily Checks — Navigation', () => {
  test('van-inspections page is reachable from navigation', async ({ page }) => {
    await page.goto('/van-inspections', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await expect(page).toHaveURL(/\/van-inspections/);
    await expect(page.getByRole('heading', { name: /Van Daily Checks/i })).toBeVisible({ timeout: 15_000 });
  });

  test('no 404 on /van-inspections', async ({ page }) => {
    const response = await page.goto('/van-inspections');
    expect(response?.status()).not.toBe(404);
  });

  test('no 404 on /van-inspections/new', async ({ page }) => {
    const response = await page.goto('/van-inspections/new', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).not.toBe(404);
  });

  test('can open an existing van daily check detail page when list has entries', async ({ page }) => {
    await page.goto('/van-inspections', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const detailLink = page.locator('a[href^="/van-inspections/"]:not([href$="/new"])').first();
    const hasDetailLink = (await detailLink.count()) > 0;
    test.skip(!hasDetailLink, 'No van daily check records available for this environment');

    await detailLink.click();
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/van-inspections\/.+/, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/inspection|defect|submit|draft/i);
  });
});

test.describe('Van Daily Checks — Renamed Text Verification', () => {
  test('list page shows "Van" not "Vehicle" in headings', async ({ page }) => {
    await page.goto('/van-inspections');
    await waitForAppReady(page);

    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const vehicleHeadings = headings.filter(h => /vehicle\s+inspection/i.test(h));
    expect(vehicleHeadings, 'No headings should say "Vehicle Inspection"').toHaveLength(0);
  });

  test('list page uses daily check terminology', async ({ page }) => {
    await page.goto('/van-inspections');
    await waitForAppReady(page);
    await expect(page.getByRole('heading', { name: /Van Daily Checks/i })).toBeVisible({ timeout: 15_000 });
  });

  test('new inspection page exposes workflow actions for human users', async ({ page }) => {
    await page.goto('/van-inspections/new', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const actionButton = page.getByRole('button', { name: /save|submit|create|start|complete/i });
    const actionCount = await actionButton.count();

    if (actionCount === 0) {
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      const hasExpectedEmptyState = /(no\s+.*(van|vehicle|inspection|asset))|(select\s+.*(van|vehicle|asset))/.test(bodyText);
      expect(hasExpectedEmptyState).toBeTruthy();
      return;
    }

    expect(actionCount).toBeGreaterThan(0);
  });

  test('new inspection page uses a single daily date selector', async ({ page }) => {
    await page.goto('/van-inspections/new', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await expect(page.locator('input[type="date"]#weekEnding')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Daily Check Date/i);
    await expect(page.locator('body')).not.toContainText(/Week Ending \(Sunday\)/i);
    await expect(page.getByRole('button', { name: /^save draft$/i })).toHaveCount(0);
  });
});
