import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFixtureApi, date, employeeId, mockScheduling, userId } from './fixture';

const sizes = [[390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900]];
const screenshots = resolve('testsuite', 'reports', 'scheduling-local', 'screenshots');

for (const [width, height] of sizes) {
  for (const layout of ['standard', 'columns']) {
    test(`${layout} ${width}x${height}: populated board and reachable modal`, async ({ page }) => {
      await mkdir(screenshots, { recursive: true });
      await page.setViewportSize({ width, height });
      const data = await mockScheduling(page);
      await page.addInitScript(({ userId, layout }) => {
        localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, 'daily');
        localStorage.setItem(`ffts:scheduling-layout:v1:${userId}`, layout);
      }, { userId, layout });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/?date=${date}`);
      await expect(page.getByTestId('schedule-manager-layout')).toHaveAttribute('data-layout', layout);
      await expect(page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111112')).toBeVisible();
      await expect(page.getByText('LOCAL-COMPLETE', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Remove Sam Taylor from/ }).first()).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: resolve(screenshots, `${layout}-${width}x${height}-board.png`), fullPage: true });
      const calendar = page.getByTestId('schedule-board-panel');
      await calendar.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(screenshots, `${layout}-${width}x${height}-calendar.png`) });
      if (layout === 'columns' && width >= 1100) {
        const teams = await page.getByTestId('schedule-teams-panel').boundingBox();
        const board = await calendar.boundingBox();
        expect(board!.width).toBeGreaterThan(teams!.width * 1.5);
        expect(board!.height).toBeGreaterThan(height * 0.45);
      }
      await page.getByTestId('schedule-quick-add-button').click();
      const dialog = page.getByRole('dialog', { name: 'Quick add job' });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Quick add', exact: true })).toBeInViewport();
      await dialog.getByTestId('schedule-quick-add-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(dialog.getByLabel('Notes', { exact: true })).toBeInViewport();
      await page.screenshot({ path: resolve(screenshots, `${layout}-${width}x${height}-modal.png`) });
      expect(data.removals).toHaveLength(0);
      expect(data.writes).toEqual([]);
      expect(data.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('layout choice persists independently of daily view and primary axis', async ({ page }) => {
  await mockScheduling(page);
  await page.goto(`/?date=${date}`);
  await page.getByRole('button', { name: 'Resources, Teams and Calendar columns', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('schedule-manager-layout')).toHaveAttribute('data-layout', 'columns');
  await expect(page.getByRole('tab', { name: 'Weekly', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tab', { name: 'Primary Jobs', exact: true })).toHaveAttribute('data-state', 'active');
});

test('an expired unfinished job is read-only until explicitly completed, then leaves Resources', async ({ page }) => {
  const data = await mockScheduling(page);
  const assignments = structuredClone(data.board.assignments);
  const visits = structuredClone(data.board.visits);
  await page.goto(`/?date=${date}`);
  const job = page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111112');
  await expect(job).toBeVisible();
  expect(data.writes).toEqual([]);
  await job.click();
  const dialog = page.getByRole('dialog', { name: 'Edit scheduled job' });
  await dialog.getByLabel('Status', { exact: true }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Save job', exact: true }).click();
  expect(await (await saved).json()).toMatchObject({ job: { status: 'completed' } });
  await expect(dialog).toHaveCount(0);
  await expect(job).toHaveCount(0);
  expect(data.writes).toEqual(['PATCH /api/scheduling/jobs/11111111-1111-4111-8111-111111111112']);
  expect(data.board.assignments).toEqual(assignments);
  expect(data.board.visits).toEqual(visits);
  expect(data.unexpected).toEqual([]);
});

test('standalone fixture preview serves fictional data without Playwright API routes', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.goto(`/?fixtures=1&date=${date}`);
  await expect(page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111112')).toBeVisible();
  expect(apiRequests).toEqual([]);
  const unsupported = await page.evaluate(async () => {
    const response = await fetch('/api/scheduling/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    return { status: response.status, body: await response.json() };
  });
  expect(unsupported.status).toBe(501);
  expect(unsupported.body.error).toMatch(/disabled/);
  expect(apiRequests).toEqual([]);
});

test('fixture rejects unsupported writes rather than returning read payloads', () => {
  const api = createFixtureApi();
  const jobs = structuredClone(api.jobs);
  const board = structuredClone(api.board);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    expect(api.respond(new URL('http://127.0.0.1:4017/api/scheduling/jobs'), method, {}).status).toBe(501);
  }
  expect(api.jobs).toEqual(jobs);
  expect(api.board).toEqual(board);
});

test('member removal waits for overlapping job edits before deleting assignments', async ({ page }) => {
  const data = await mockScheduling(page);
  await page.addInitScript((id) => {
    localStorage.setItem(`ffts:scheduling-layout:v1:${id}`, 'columns');
    localStorage.setItem(`ffts:scheduling-board-view:v1:${id}`, 'daily');
  }, userId);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requestStarted = false;
  await page.route('**/api/scheduling/jobs/11111111-1111-4111-8111-111111111111', async (route) => {
    requestStarted = true;
    await gate;
    await route.fulfill({ json: { job: data.jobs[0] } });
  });
  try {
    await page.goto(`/?date=${date}`);
    await page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111111').click();
    await page.getByRole('dialog', { name: 'Edit scheduled job' }).getByRole('button', { name: 'Save job', exact: true }).click();
    await expect.poll(() => requestStarted).toBe(true);
    await page.getByRole('button', { name: /Remove Sam Taylor from/ }).first().click();
    await page.getByRole('button', { name: 'Remove member and assignments', exact: true }).click();
    await expect(page.getByText('This employee or team has a pending scheduling change. Wait for it to finish, then review removal again.', { exact: true })).toBeVisible();
    expect(data.removals).toEqual([]);
    expect(data.board.assignments).toHaveLength(3);
  } finally {
    release();
  }
});

for (const status of [200, 403, 409, 500]) {
  test(`member removal: cancel, then ${status}; isolate employee and date`, async ({ page }) => {
    const data = await mockScheduling(page, status);
    const otherDayMembership = structuredClone(data.board.day_teams.find((day) => day.date === '2026-11-06'));
    await page.addInitScript((id) => {
      localStorage.setItem(`ffts:scheduling-layout:v1:${id}`, 'columns');
      localStorage.setItem(`ffts:scheduling-board-view:v1:${id}`, 'daily');
    }, userId);
    await page.goto(`/?date=${date}`);
    const cross = page.getByRole('button', { name: /Remove Sam Taylor from/ }).first();
    await cross.click();
    await expect(page.getByRole('alertdialog')).toContainText('LOCAL-60001');
    await page.getByRole('button', { name: 'Keep member', exact: true }).click();
    expect(data.removals).toHaveLength(0);
    await expect(cross).toBeVisible();
    await cross.click();
    await page.getByRole('button', { name: 'Remove member and assignments', exact: true }).click();
    await expect.poll(() => data.removals.length).toBe(1);
    expect(data.removals[0].searchParams.get('work_date')).toBe(date);
    expect(data.removals[0].searchParams.get('profile_id')).toBe(employeeId);
    expect(JSON.parse(data.removals[0].searchParams.get('assignment_ids')!)).toEqual(['55555555-5555-4555-8555-555555555555']);
    if (status === 200) {
      await expect(cross).toHaveCount(0);
      expect(data.board.assignments.map((item) => item.id)).toEqual([
        '55555555-5555-4555-8555-555555555556', '55555555-5555-4555-8555-555555555557',
      ]);
      expect(data.board.day_teams.find((day) => day.date === '2026-11-06')).toEqual(otherDayMembership);
    } else {
      await expect(page.getByText('Removal denied by fixture', { exact: true }).first()).toBeVisible();
      expect(data.board.assignments).toHaveLength(3);
      if (status < 500) await expect(cross).toBeVisible();
    }
    expect(data.unexpected).toEqual([]);
  });
}
