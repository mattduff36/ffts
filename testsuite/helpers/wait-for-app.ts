/**
 * Waits for the TemplateApp to finish its client-side loading/auth check.
 * The app shows "Loading TemplateApp..." while bootstrapping.
 */
import { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, timeout = 15_000): Promise<void> {
  // Wait for the loading indicator to disappear
  const loadingText = page.getByText('Loading TemplateApp...');
  await loadingText.waitFor({ state: 'hidden', timeout }).catch(() => {
    // If it was never visible or already gone, that's fine
  });

  // Also wait for "Checking permissions..." to disappear
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
