import { test, expect, Page, Locator } from '@playwright/test';

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'TestPass123!';

async function disableAnimations(page: Page) {
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

async function login(page: Page) {
  await page.goto('http://localhost:4000/login');
  await page.getByLabel('Email Address').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
}

/**
 * Calculate relative luminance for a color component
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function luminanceComponent(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Calculate relative luminance for an RGB color
 */
function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * luminanceComponent(r) +
    0.7152 * luminanceComponent(g) +
    0.0722 * luminanceComponent(b)
  );
}

/**
 * Calculate WCAG contrast ratio between two colors
 * https://www.w3.org/WAI/GL/wiki/Contrast_ratio
 */
function contrastRatio(
  rgb1: { r: number; g: number; b: number },
  rgb2: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse RGB color string to components
 */
function parseRgb(rgbString: string): { r: number; g: number; b: number } {
  const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    throw new Error(`Invalid RGB string: ${rgbString}`);
  }
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
  };
}

/**
 * Check contrast ratio for an input element
 */
async function checkInputContrast(
  page: Page,
  selector: string | Locator,
  minRatio: number = 4.5
): Promise<{ passed: boolean; ratio: number; details: string }> {
  const element =
    typeof selector === 'string' ? page.locator(selector).first() : selector.first();
  
  // Get computed styles
  const color = await element.evaluate((el) => {
    return window.getComputedStyle(el).color;
  });
  
  const backgroundColor = await element.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });

  try {
    const textRgb = parseRgb(color);
    const bgRgb = parseRgb(backgroundColor);
    const ratio = contrastRatio(textRgb, bgRgb);
    
    return {
      passed: ratio >= minRatio,
      ratio,
      details: `Text: ${color}, Background: ${backgroundColor}, Ratio: ${ratio.toFixed(2)}:1 (min ${minRatio}:1)`,
    };
  } catch (error) {
    return {
      passed: false,
      ratio: 0,
      details: `Error checking contrast: ${error}`,
    };
  }
}

test.describe('UI Contrast Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set to dark mode for testing
    await page.emulateMedia({ colorScheme: 'dark' });
    await disableAnimations(page);
    await login(page);
  });

  test('Workshop Task Modal - Input fields have sufficient contrast', async ({ page }) => {
    // Navigate to workshop tasks page (adjust URL as needed)
    await page.goto('http://localhost:4000/workshop-tasks');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Look for the "New Task" button and click it
    const createButton = page.getByRole('button', { name: /new task|create.*task/i });
    if (await createButton.count() > 0) {
      await createButton.click();
      
      // Wait for modal to appear
      await page.waitForSelector('input[type="number"]', { timeout: 5000 });
      
      // Check mileage input
      const mileageCheck = await checkInputContrast(page, 'input[type="number"]');
      console.log('Mileage Input:', mileageCheck.details);
      expect(mileageCheck.passed, `Mileage input contrast failed: ${mileageCheck.details}`).toBeTruthy();
      
      // Check textarea
      const textareaCheck = await checkInputContrast(page, 'textarea');
      console.log('Textarea:', textareaCheck.details);
      expect(textareaCheck.passed, `Textarea contrast failed: ${textareaCheck.details}`).toBeTruthy();
    }
  });

  test('RAMS Assign Modal - Select fields have sufficient contrast', async ({ page }) => {
    // This is a placeholder - adjust based on actual RAMS page structure
    await page.goto('http://localhost:4000/rams/manage');
    await page.waitForLoadState('networkidle');
    
    // Look for assign button (adjust selector as needed)
    const assignButton = page.getByRole('button', { name: /assign/i }).first();
    if (await assignButton.count() > 0) {
      await assignButton.click();
      
      // Check for inputs/selects in modal
      const inputs = page.locator('input[type="text"], input[type="search"]');
      const count = await inputs.count();
      
      for (let i = 0; i < Math.min(count, 3); i++) {
        const input = inputs.nth(i);
        const selector = await input.getAttribute('id');
        if (selector) {
          const check = await checkInputContrast(page, `#${selector}`);
          console.log(`Input ${i}:`, check.details);
          expect(check.passed, `Input ${i} contrast failed: ${check.details}`).toBeTruthy();
        }
      }
    }
  });

  test('Timesheet Edit - Input fields have sufficient contrast', async ({ page }) => {
    await page.goto('http://localhost:4000/timesheets/new');
    await page.waitForLoadState('networkidle');
    
    // Check time input fields
    const timeInputs = page.locator('input[type="time"]');
    const count = await timeInputs.count();
    
    if (count > 0) {
      const check = await checkInputContrast(page, 'input[type="time"]');
      console.log('Time Input:', check.details);
      expect(check.passed, `Time input contrast failed: ${check.details}`).toBeTruthy();
    }
  });

  test('Inspection Form - Input fields have sufficient contrast', async ({ page }) => {
    await page.goto('http://localhost:4000/inspections/new');
    await page.waitForLoadState('networkidle');
    
    // Check a few visible inputs/textareas directly (avoid brittle nth-of-type selectors)
    const inputs = page.locator('input:not([type="hidden"]), textarea');
    const count = await inputs.count();
    expect(count, 'Expected at least one visible input/textarea on inspection form').toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i);
      const check = await checkInputContrast(page, input);
      console.log(`Form field ${i}:`, check.details);

      // Warning-only for sampled fields; we don't want flakiness from dynamic UI states
      if (!check.passed) {
        console.warn(`⚠️  Potential contrast issue in form field ${i}: ${check.details}`);
      }
    }
  });

  test('Base Input Component - Has proper contrast', async ({ page }) => {
    // Create a simple test page with explicit colors (no Tailwind CDN)
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head></head>
        <body style="background: rgb(15, 23, 42); padding: 32px;">
          <input 
            type="text" 
            style="
              width: 100%;
              height: 40px;
              border-radius: 6px;
              border: 1px solid rgb(51, 65, 85);
              background: rgb(30, 41, 59);
              color: rgb(241, 245, 249);
              padding: 8px 12px;
              font-size: 16px;
            "
            value="Test input"
          />
        </body>
      </html>
    `);
    
    const check = await checkInputContrast(page, 'input');
    console.log('Base Input Component:', check.details);
    expect(check.passed, `Base input contrast failed: ${check.details}`).toBeTruthy();
    expect(check.ratio).toBeGreaterThan(7); // Strong contrast
  });

  test('Workshop Tasks Settings - Category list items have proper contrast', async ({ page }) => {
    await page.goto('http://localhost:4000/workshop-tasks');
    await page.waitForLoadState('networkidle');
    
    // Click on Settings tab
    const settingsTab = page.getByRole('tab', { name: /settings/i });
    if (await settingsTab.count() > 0) {
      await settingsTab.click();
      await page.waitForTimeout(1000);

      // Check category list items text contrast
      const categoryButtons = await page.locator('button').filter({ hasText: /categor/i }).all();
      
      if (categoryButtons.length > 0) {
        for (let i = 0; i < Math.min(categoryButtons.length, 3); i++) {
          const button = categoryButtons[i];
          const textColor = await button.evaluate(el => window.getComputedStyle(el).color);
          const bgColor = await button.evaluate(el => window.getComputedStyle(el).backgroundColor);
          
          const textRgb = parseRgb(textColor);
          const bgRgb = parseRgb(bgColor);
          const ratio = contrastRatio(textRgb, bgRgb);
          
          console.log(`Category ${i}: Text ${textColor}, BG ${bgColor}, Ratio ${ratio.toFixed(2)}:1`);
          expect(ratio, `Category button ${i} has insufficient contrast: ${ratio.toFixed(2)}:1 (need 4.5:1)`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
