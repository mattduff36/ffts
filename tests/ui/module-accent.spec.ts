import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'TestPass123!';

async function disableAnimations(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        scroll-behavior: auto !important;
      }
    `,
  });
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
}

async function getAccentVars(page: import('@playwright/test').Page) {
  return await page.evaluate(() => {
    const el = document.querySelector('[data-accent]');
    if (!el) return null;
    const cs = window.getComputedStyle(el as Element);
    return {
      accent: (el as HTMLElement).dataset.accent ?? null,
      primary: cs.getPropertyValue('--primary').trim(),
      primaryForeground: cs.getPropertyValue('--primary-foreground').trim(),
      ring: cs.getPropertyValue('--ring').trim(),
    };
  });
}

test.describe('Module accent theming', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await disableAnimations(page);
    await login(page);
  });

  test('Dashboard uses brand accent (yellow with dark foreground)', async ({ page }) => {
    await page.goto('/dashboard');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('brand');
    expect(vars!.primaryForeground).toBe('222 47% 11%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-dashboard.png');
  });

  test('Help uses brand accent (yellow with dark foreground)', async ({ page }) => {
    await page.goto('/help');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('brand');
    expect(vars!.primaryForeground).toBe('222 47% 11%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-help.png');
  });

  test('Timesheets uses timesheets accent', async ({ page }) => {
    await page.goto('/timesheets');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('timesheets');
    expect(vars!.primary).toBe('210 90% 50%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-timesheets.png');
  });

  test('Inspections uses inspections accent', async ({ page }) => {
    await page.goto('/van-inspections');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('inspections');
    expect(vars!.primary).toBe('30 95% 55%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-inspections.png');
  });

  test('RAMS uses rams accent', async ({ page }) => {
    await page.goto('/rams');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('rams');
    expect(vars!.primary).toBe('142 76% 36%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-rams.png');
  });

  test('Absence uses absence accent', async ({ page }) => {
    await page.goto('/absence');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('absence');
    expect(vars!.primary).toBe('260 60% 50%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-absence.png');
  });

  test('Maintenance page uses maintenance accent', async ({ page }) => {
    await page.goto('/maintenance');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('maintenance');
    expect(vars!.primary).toBe('0 84% 60%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-maintenance.png');
  });

  test('Workshop uses workshop accent', async ({ page }) => {
    await page.goto('/workshop-tasks');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('workshop');
    expect(vars!.primary).toBe('13 37% 48%');
    expect(vars!.primaryForeground).toBe('210 40% 98%');
    await expect(page.locator('nav')).toHaveScreenshot('nav-workshop.png');
  });

  test('Reports uses brand accent', async ({ page }) => {
    await page.goto('/reports');
    const vars = await getAccentVars(page);
    expect(vars).not.toBeNull();
    expect(vars!.accent).toBe('brand');
    await expect(page.locator('nav')).toHaveScreenshot('nav-reports.png');
  });
});

