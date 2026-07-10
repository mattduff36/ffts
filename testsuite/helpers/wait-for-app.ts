/**
 * Waits for the app to finish transient route and permission loaders.
 */
import { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, timeout = 15_000): Promise<void> {
  // Wait for "Checking permissions..." to disappear
  const permCheck = page.getByText('Checking permissions...');
  await permCheck.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

  // Many dashboard routes render a shared full-page loader after auth has completed.
  // Wait for those transient shells to unmount so tests inspect the actual page state.
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="page-loader"]').length === 0,
      undefined,
      { timeout }
    )
    .catch(() => {});
}
