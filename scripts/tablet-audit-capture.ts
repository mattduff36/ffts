import { chromium, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

type Role = 'admin' | 'manager' | 'employee';

interface RouteEntry {
  key: string;
  path: string;
}

interface CaptureResult {
  role: Role;
  route: string;
  url: string;
  screenshot: string;
  horizontalOverflow: boolean;
  notes: string[];
}

const baseUrl = process.env.TABLET_AUDIT_BASE_URL || 'http://localhost:4000';
const mode = (process.argv[2] === 'after' ? 'after' : 'before') as 'before' | 'after';
const stateDir = path.resolve(process.cwd(), 'testsuite/.state');
const outputDir = path.resolve(process.cwd(), `docs/audits/tablet-audit/${mode}`);
const reportFile = path.resolve(process.cwd(), `docs/audits/tablet-audit/${mode}-report.json`);

const roleRoutes: Record<Role, RouteEntry[]> = {
  employee: [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'timesheets', path: '/timesheets' },
    { key: 'timesheets-new', path: '/timesheets/new' },
    { key: 'van-inspections', path: '/van-inspections' },
    { key: 'van-inspections-new', path: '/van-inspections/new' },
    { key: 'plant-inspections', path: '/plant-inspections' },
    { key: 'plant-inspections-new', path: '/plant-inspections/new' },
    { key: 'hgv-inspections', path: '/hgv-inspections' },
    { key: 'hgv-inspections-new', path: '/hgv-inspections/new' },
    { key: 'notifications', path: '/notifications' },
    { key: 'help', path: '/help' },
  ],
  manager: [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'workshop-tasks', path: '/workshop-tasks' },
    { key: 'maintenance', path: '/maintenance' },
    { key: 'fleet', path: '/fleet' },
    { key: 'approvals', path: '/approvals' },
    { key: 'actions', path: '/actions' },
    { key: 'toolbox-talks', path: '/toolbox-talks' },
    { key: 'projects', path: '/projects' },
    { key: 'absence', path: '/absence' },
    { key: 'absence-manage', path: '/absence/manage' },
  ],
  admin: [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'workshop-tasks', path: '/workshop-tasks' },
    { key: 'fleet', path: '/fleet' },
    { key: 'maintenance', path: '/maintenance' },
    { key: 'projects-settings', path: '/projects/settings' },
  ],
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function enableTabletMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const authKey = Object.keys(window.localStorage).find((key) => key.includes('auth-token'));
    if (!authKey) return;
    const raw = window.localStorage.getItem(authKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const userId =
      parsed?.user?.id ||
      parsed?.currentSession?.user?.id ||
      parsed?.session?.user?.id ||
      parsed?.data?.session?.user?.id;
    if (userId) {
      window.localStorage.setItem(`tablet_mode:${userId}`, 'on');
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function collectPageSignals(page: Page): Promise<{ horizontalOverflow: boolean }> {
  return page.evaluate(() => {
    const horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    return { horizontalOverflow };
  });
}

async function waitForStableRender(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const loadingOverlay = page.getByText('Loading TemplateApp...');
  await loadingOverlay.first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function captureRole(role: Role): Promise<CaptureResult[]> {
  const storageState = path.resolve(stateDir, `storage-state-${role}.json`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 794, height: 1250 },
    storageState,
  });
  const page = await context.newPage();
  const results: CaptureResult[] = [];

  for (const route of roleRoutes[role]) {
    const url = `${baseUrl}${route.path}`;
    const notes: string[] = [];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await enableTabletMode(page);
      await waitForStableRender(page);

      const screenshotPath = path.join(outputDir, `tablet-${mode}-${role}-${route.key}-base.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const signals = await collectPageSignals(page);

      results.push({
        role,
        route: route.path,
        url: page.url(),
        screenshot: screenshotPath,
        horizontalOverflow: signals.horizontalOverflow,
        notes,
      });

      // Capture a few key state screenshots for workshop tasks.
      if (route.path === '/workshop-tasks') {
        const newTaskButton = page.getByRole('button', { name: /new task/i }).first();
        if (await newTaskButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await newTaskButton.click();
          await waitForStableRender(page);
          await page.screenshot({
            path: path.join(outputDir, `tablet-${mode}-${role}-workshop-create-task-dialog.png`),
            fullPage: true,
          });
          await page.keyboard.press('Escape');
        }

        const taskCard = page.locator('[class*="cursor-pointer"]').filter({
          hasText: /pending|in progress|on hold|complete|task/i,
        }).first();
        if (await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
          await taskCard.click();
          await waitForStableRender(page);
          await page.screenshot({
            path: path.join(outputDir, `tablet-${mode}-${role}-workshop-task-modal.png`),
            fullPage: true,
          });
          await page.keyboard.press('Escape');
        }
      }
    } catch (error) {
      results.push({
        role,
        route: route.path,
        url,
        screenshot: '',
        horizontalOverflow: false,
        notes: [`capture_failed: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  await context.close();
  await browser.close();
  return results;
}

async function main(): Promise<void> {
  ensureDir(outputDir);
  ensureDir(path.dirname(reportFile));
  const allResults: CaptureResult[] = [];
  for (const role of ['employee', 'manager', 'admin'] as const) {
    const roleResults = await captureRole(role);
    allResults.push(...roleResults);
  }
  fs.writeFileSync(reportFile, JSON.stringify(allResults, null, 2));
  console.log(`Saved ${allResults.length} route captures to ${outputDir}`);
  console.log(`Saved report: ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

