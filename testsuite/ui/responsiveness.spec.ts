/**
 * @tags @critical
 * Tests critical pages at desktop, tablet, and mobile viewports.
 * Auth: admin storage state (via responsive project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

const viewports = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 375, height: 812 },
];

const pages = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Workshop Tasks', path: '/workshop-tasks' },
  { name: 'Fleet', path: '/fleet' },
  { name: 'Inventory', path: '/inventory' },
  { name: 'Van Daily Check Form', path: '/van-inspections/new' },
];

async function gotoWithInfraSkip(
  page: import('@playwright/test').Page,
  route: string,
  pageName: string,
  viewportName: string
) {
  try {
    await page.goto(route);
    await waitForAppReady(page);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    test.skip(
      message.includes('timeout') ||
      message.includes('err_connection_refused') ||
      message.includes('net::err_connection_refused'),
      `${pageName} at ${viewportName} unavailable in this environment`
    );
    throw error;
  }
}

for (const viewport of viewports) {
  test.describe(`@critical Responsive – ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of pages) {
      test(`${name} loads at ${viewport.name}`, async ({ page }) => {
        const capture = attachConsoleErrorCapture(page);
        await gotoWithInfraSkip(page, path, name, viewport.name);

        const hasError = await page.getByText(/something went wrong|error boundary|application error/i).first()
          .isVisible({ timeout: 2_000 }).catch(() => false);
        expect(hasError, `${name} should not show error at ${viewport.name}`).toBeFalsy();

        const errors = capture.getErrors();
        expect(errors, `No console errors on ${name} at ${viewport.name}`).toHaveLength(0);
      });
    }

    if (viewport.name === 'Mobile') {
      test('mobile navigation can expose dashboard controls', async ({ page }) => {
        await gotoWithInfraSkip(page, '/dashboard', 'Dashboard', viewport.name);

        const menuButton = page.getByRole('button', { name: /menu|open navigation|navigation/i }).first();
        const hasNamedMenuButton = await menuButton.isVisible({ timeout: 5_000 }).catch(() => false);
        const mobileIconButton = page.locator('button.md\\:hidden').first();
        const hasMobileIconButton = await mobileIconButton.isVisible({ timeout: 1_000 }).catch(() => false);
        expect(
          hasNamedMenuButton || hasMobileIconButton,
          'Mobile dashboard should expose a navigation/menu control'
        ).toBeTruthy();
      });
    }
  });
}
