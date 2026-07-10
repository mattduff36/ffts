/**
 * @tags @auth @critical
 * Tests login/logout flows. Runs in auth-tests project with NO storage state.
 * NON-DESTRUCTIVE: uses only testsuite test accounts.
 */
import { test, expect } from '@playwright/test';
import { getTestUser } from '../helpers/auth';

test.describe('@auth @critical Authentication', () => {
  test('admin can log in and reaches dashboard', async ({ page }) => {
    const user = getTestUser('admin');
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.getByLabel('Email Address').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });

    expect(page.url()).not.toContain('/login');
  });

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.getByLabel('Email Address').fill('nonexistent@test.com');
    await page.getByLabel('Password').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByText(/invalid|incorrect|failed|error|unable|credentials/i).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).toContain('/login');
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    // This test has no storage state so the user is not logged in
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });
});
