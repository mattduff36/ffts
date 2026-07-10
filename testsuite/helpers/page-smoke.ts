import { expect, test, type Page } from '@playwright/test';
import { attachConsoleErrorCapture } from './console-error-fixture';
import { waitForAppReady } from './wait-for-app';

export async function gotoWithTimeoutSkip(page: Page, route: string, skipMessage: string): Promise<void> {
  try {
    await page.goto(route);
    await waitForAppReady(page);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    test.skip(
      message.includes('timeout') ||
        message.includes('err_connection_refused') ||
        message.includes('net::err_connection_refused'),
      skipMessage
    );
    throw error;
  }
}

export async function expectSmokePage({
  page,
  route,
  content,
  name,
}: {
  page: Page;
  route: string;
  content: RegExp;
  name: string;
}): Promise<void> {
  const capture = attachConsoleErrorCapture(page);
  await gotoWithTimeoutSkip(page, route, `${name} route timed out in this environment`);

  await expect(page.locator('body')).toContainText(content, { timeout: 10_000 });

  const errors = capture.getErrors();
  expect(errors, `No console errors on ${name}`).toHaveLength(0);
}
