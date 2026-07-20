import { Page, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const STATE_DIR = path.resolve(__dirname, '../.state');
const PRODUCTION_SETUP_COMMAND = 'npm run testsuite:setup:production';

interface TestUser {
  email: string;
  password: string;
  role: string;
  userId?: string;
}

function loadTestUsers(): Record<string, TestUser> {
  const stateFile = path.join(STATE_DIR, 'test-users.json');
  if (!fs.existsSync(stateFile)) {
    throw new Error(
      'Test users not provisioned. Run: npm run testsuite:setup\n' +
      `For the configured production project run: ${PRODUCTION_SETUP_COMMAND}\n` +
      `Expected ignored state file: ${stateFile}`
    );
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
}

export function getTestUser(role: 'admin' | 'manager' | 'employee'): TestUser {
  const users = loadTestUsers();
  const user = users[role];
  if (!user) {
    throw new Error(
      `No test user found for role "${role}". Re-run ${PRODUCTION_SETUP_COMMAND}; credentials are never committed.`
    );
  }
  return user;
}

export async function login(page: Page, role: 'admin' | 'manager' | 'employee'): Promise<void> {
  const user = getTestUser(role);
  await page.goto('/login');

  // Wait for login form to be ready
  await page.getByLabel('Email Address').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByLabel('Email Address').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for navigation away from login page
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });

  // Handle "must change password" interstitial
  if (page.url().includes('/change-password')) {
    // Fill in the change password form using id-based locators
    const newPwField = page.locator('#new-password');
    const confirmPwField = page.locator('#confirm-password');

    await newPwField.waitFor({ state: 'visible', timeout: 5_000 });
    await newPwField.fill(user.password);
    await confirmPwField.fill(user.password);

    const submitBtn = page.getByRole('button', { name: /change password/i });
    await submitBtn.click();

    // After successful change, check if we go to success screen + redirect
    try {
      await page.waitForURL('**/dashboard', { timeout: 15_000 });
    } catch {
      // May show success message first, then redirect
      const continueBtn = page.getByRole('button', { name: /continue|go to dashboard/i }).first();
      const hasContinue = await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (hasContinue) {
        await continueBtn.click();
      }
      await page.waitForURL('**/dashboard', { timeout: 10_000 });
    }
  }

  // At this point we should be on the dashboard
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

export async function logout(page: Page): Promise<void> {
  // Click the user menu / sign out button
  const signOutBtn = page.getByRole('button', { name: /sign out|log out/i });
  if (await signOutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await signOutBtn.click();
    await page.waitForURL('**/login', { timeout: 10_000 });
  } else {
    // Fallback: navigate directly to login
    await page.goto('/login');
  }
}

export function storageStatePath(role: 'admin' | 'manager' | 'employee'): string {
  return path.join(STATE_DIR, `storage-state-${role}.json`);
}

export async function saveStorageState(
  context: BrowserContext,
  role: 'admin' | 'manager' | 'employee'
): Promise<void> {
  const filePath = storageStatePath(role);
  await context.storageState({ path: filePath });
}
