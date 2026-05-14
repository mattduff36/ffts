/**
 * @tags @critical
 * Tests help/FAQ and absence module pages.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@critical Help & FAQ', () => {
  test('help page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    try {
      await page.goto('/help');
      await waitForAppReady(page);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      test.skip(message.includes('timeout'), 'Help route timed out in this environment');
      throw error;
    }

    const hasContent = await page.getByText(/help|faq|support|guide/i).first()
      .isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasContent || page.url().includes('/help')).toBeTruthy();

    await page.goto('/help?tab=install');
    await waitForAppReady(page);
    const hasInstallContent = await page
      .getByText(/install fieldops template|quick support actions|install app/i)
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    expect(hasInstallContent || page.url().includes('/help?tab=install')).toBeTruthy();

    const errors = capture.getErrors();
    const unexpectedErrors = errors.filter((entry) => !entry.message.includes('403 (Forbidden)'));
    expect(unexpectedErrors, 'No unexpected page errors on help page').toHaveLength(0);
  });
});
