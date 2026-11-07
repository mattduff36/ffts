import { expect, test } from '@playwright/test';
import { date, mockScheduling } from './fixture';

for (const mode of ['daily', 'daily-body', 'weekly']) {
  const view = mode === 'weekly' ? 'weekly' : 'daily';
  test(`existing Resources job drags onto an empty ${mode} calendar and survives reload`, async ({ page }) => {
    const api = await mockScheduling(page);
    const job = api.jobs[0];
    const template = api.board.visits[0];
    api.board.jobs = [];
    api.board.visits = [];
    api.board.assignments = [];
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/scheduling/visits', async route => {
      const input = route.request().postDataJSON();
      writes.push(input);
      expect(input.job_id).toBe(job.id);
      const visit = { ...template, ...input };
      api.board.jobs = [job];
      api.board.visits = [visit];
      await route.fulfill({ status: 201, json: { visit } });
    });
    await page.goto(`/?date=${date}&view=${view === 'daily' ? 'day' : 'week'}`);
    await page.getByRole('tab', { name: view === 'daily' ? 'Daily' : 'Weekly', exact: true }).click();
    const source = page.getByTestId(`schedule-resource-job-${job.id}`);
    await expect(source).toBeVisible();
    const target = view === 'daily'
      ? page.getByTestId('schedule-daily-timeline-header')
      : page.locator(`[data-testid^="schedule-date-drop-"][data-testid$="${date}"]`).filter({ visible: true }).first();
    const s = (await source.boundingBox())!;
    const t = (await target.boundingBox())!;
    const hour = view === 'daily' ? Number(await target.getAttribute('data-hour-width')) : 0;
    await page.mouse.move(s.x + 20, s.y + 20);
    await page.mouse.down();
    await page.mouse.move(s.x + 32, s.y + 24, { steps: 3 });
    await page.mouse.move(view === 'daily' ? t.x + 5 * hour : t.x + t.width / 2,
      mode === 'daily-body' ? t.y + t.height + 20 : t.y + t.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => writes.length).toBe(1);
    expect(String(writes[0].starts_at)).toContain(date);
    if (view === 'daily') expect(writes[0].starts_at).toBe(`${date}T10:00:00.000Z`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(source).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`schedule-resource-job-${job.id}`)).toBeVisible();
    await expect(page.locator(`[data-testid="schedule-visit-${template.id}"]:visible`).first()).toBeVisible();
    expect(api.board.visits).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });
}

test('clicking a Resources job still edits it and cancelling a drag writes nothing', async ({ page }) => {
  const api = await mockScheduling(page);
  await page.goto(`/?date=${date}`);
  const source = page.getByTestId(`schedule-resource-job-${api.jobs[0].id}`);
  await source.click();
  await expect(page.getByRole('dialog', { name: 'Edit scheduled job' })).toBeVisible();
  await page.keyboard.press('Escape');
  const s = (await source.boundingBox())!;
  await page.mouse.move(s.x + 20, s.y + 20);
  await page.mouse.down();
  await page.mouse.move(s.x + 80, s.y + 50, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('a rejected Resources drop keeps the job and offers the visit draft for correction', async ({ page }) => {
  const api = await mockScheduling(page);
  const before = structuredClone(api.board.visits);
  let writes = 0;
  await page.route('**/api/scheduling/visits', async route => {
    writes++;
    await route.fulfill({ status: 400, json: { error: 'The visit must fall within the Quote planning dates.' } });
  });
  await page.goto(`/?date=${date}`);
  await page.getByRole('tab', { name: 'Daily', exact: true }).click();
  const source = page.getByTestId(`schedule-resource-job-${api.jobs[1].id}`);
  const target = page.getByTestId('schedule-daily-timeline-header');
  const s = (await source.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(s.x + 20, s.y + 20);
  await page.mouse.down();
  await page.mouse.move(s.x + 32, s.y + 24, { steps: 3 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(api.board.visits).toEqual(before);
  expect(api.unexpected).toEqual([]);
});
