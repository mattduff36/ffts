import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFixtureApi, date, employeeId, mockScheduling, userId } from './fixture';

const sizes = [[390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900]];
const screenshots = resolve('testsuite', 'reports', 'scheduling-local', 'screenshots');
const jobId = '11111111-1111-4111-8111-111111111111';
const visitId = '44444444-4444-4444-8444-444444444444';

test('daily Teams shares a line for back-to-back jobs and stacks overlapping jobs', async ({ page }) => {
  const { board } = await mockScheduling(page);
  const [firstJob] = board.jobs;
  const [firstVisit] = board.visits;
  const [firstAssignment] = board.assignments;

  const addJob = (id: string, start: string, end: string) => {
    const job = { ...firstJob, id: `job-${id}`, job_reference: `LOCAL-${id}` };
    const visit = {
      ...firstVisit,
      id,
      job_id: job.id,
      starts_at: `${date}T${start}:00.000Z`,
      ends_at: `${date}T${end}:00.000Z`,
    };
    board.jobs.push(job);
    board.visits.push(visit);
    board.assignments.push({
      ...firstAssignment, id: `assignment-${id}`, job_id: job.id, visit_id: id, visit,
    });
  };

  addJob('overlapping', '10:59', '12:30');
  addJob('back-to-back', '11:00', '14:00');
  await page.goto(`/?date=${date}`);
  await page.getByRole('tab', { name: 'Daily', exact: true }).click();
  await page.getByRole('tab', { name: 'Primary Teams', exact: true }).click();

  const team = page.getByTestId('schedule-board-row-team-1');
  const first = team.getByTestId(new RegExp(`^schedule-timeline-visit-.*${visitId}$`));
  const backToBack = team.getByTestId(/^schedule-timeline-visit-.*back-to-back$/);
  const overlapping = team.getByTestId(/^schedule-timeline-visit-.*overlapping$/);
  await expect(backToBack).toBeVisible();
  const firstBox = (await first.boundingBox())!;
  const nextBox = (await backToBack.boundingBox())!;
  const overlapBox = (await overlapping.boundingBox())!;
  expect(nextBox.y).toBeCloseTo(firstBox.y);
  expect(nextBox.x).toBeGreaterThanOrEqual(firstBox.x + firstBox.width);
  expect(overlapBox.y).toBeGreaterThanOrEqual(firstBox.y + firstBox.height);
});

test.describe('Jobs timeline coordinates', () => {
  for (const mode of ['fit', 'scroll']) {
    test(`Jobs daily ${mode} uses the full-width timeline for moving and resizing visits`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 900 });
      const data = await mockScheduling(page);
      const changes: Array<{ starts_at: string; ends_at: string }> = [];
      await page.route(`**/api/scheduling/visits/${visitId}`, async (route) => {
        expect(route.request().method()).toBe('PATCH');
        const input: { starts_at: string; ends_at: string } = route.request().postDataJSON();
        changes.push(input);
        data.board.visits[0] = { ...data.board.visits[0], starts_at: input.starts_at, ends_at: input.ends_at };
        await route.fulfill({ json: { visit: data.board.visits[0] } });
      });
      await page.addInitScript((userId) => {
        localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, 'daily');
      }, userId);
      await page.goto(`/?date=${date}`);
      const timeline = page.getByTestId('schedule-daily-timeline');
      const displayMode = page.getByRole('button', { name: mode === 'fit' ? 'Shrink to fit width' : 'Scroll', exact: true });
      await expect(displayMode).toBeEnabled();
      await displayMode.click();
      await expect(timeline).toHaveAttribute('data-timeline-mode', mode);
      const header = timeline.getByTestId('schedule-daily-timeline-header');
      const card = timeline.getByTestId(`schedule-timeline-visit-${visitId}`);
      const hourWidth = Number(await header.getAttribute('data-hour-width'));
      await expect(card).toBeVisible();
      expect(Math.abs((await card.boundingBox())!.x - (await header.boundingBox())!.x - 3 * hourWidth - 4)).toBeLessThanOrEqual(1);
      if (mode === 'scroll') {
        await timeline.evaluate((element) => { element.scrollLeft = 96; });
      }

      const move = (await card.getByRole('button', { name: 'Select visit 1 for LOCAL-60001' }).boundingBox())!;
      await page.mouse.move(move.x + move.width / 2, move.y + move.height / 2);
      await page.mouse.down();
      await page.mouse.move(move.x + move.width / 2 + hourWidth, move.y + move.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => changes.length).toBe(1);
      expect(changes[0]).toMatchObject({
        starts_at: '2026-11-05T09:00:00.000Z', ends_at: '2026-11-05T12:00:00.000Z',
      });

      const resize = (await card.getByRole('button', { name: 'Adjust end of visit 1 for LOCAL-60001' }).boundingBox())!;
      await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
      await page.mouse.down();
      await page.mouse.move(resize.x + resize.width / 2 + hourWidth / 2, resize.y + resize.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => changes.length).toBe(2);
      expect(changes[1]).toMatchObject({
        starts_at: '2026-11-05T09:00:00.000Z', ends_at: '2026-11-05T12:30:00.000Z',
      });
      expect(data.unexpected).toEqual([]);
    });
  }

  test('Jobs daily quote drop maps the scrolled timeline origin without a label-column offset', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const data = await mockScheduling(page);
    const quote = {
      id: '99999999-9999-4999-8999-999999999998',
      quote_reference: 'LOCAL-QUOTE-DROP', base_quote_reference: 'LOCAL-QUOTE-DROP',
      title: 'Fictional drop-coordinate work', customer_name: 'Fictional customer',
      status: 'won', start_date: null, end_date: null,
      estimated_duration_days: 1, estimated_duration_minutes: 60,
    };
    let scheduled = false;
    const placements: Array<{ initial_visit: { starts_at: string; ends_at: string } }> = [];
    await page.route('**/api/scheduling/quotes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { quotes: scheduled ? [] : [quote] } });
        return;
      }
      expect(route.request().method()).toBe('POST');
      const input: { initial_visit: { starts_at: string; ends_at: string } } = route.request().postDataJSON();
      data.writes.push('POST /api/scheduling/quotes');
      placements.push(input);
      const job = {
        ...data.board.jobs[0], id: quote.id, job_reference: quote.base_quote_reference,
        title: quote.title, source_type: 'quote' as const, quote_id: quote.id,
        quote_project_number_id: null, start_date: date, end_date: date,
      };
      const visit = { ...data.board.visits[0], id: quote.id, job_id: job.id, ...input.initial_visit };
      data.board.jobs.push(job);
      data.board.visits.push(visit);
      scheduled = true;
      await route.fulfill({ json: { job, visit } });
    });
    await page.addInitScript((userId) => {
      localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, 'daily');
    }, userId);
    await page.goto(`/?date=${date}`);
    const header = page.getByTestId('schedule-daily-timeline-header');
    const quoteCard = page.getByTestId(`schedule-quote-${quote.id}`);
    await expect(quoteCard).toBeVisible();
    await quoteCard.scrollIntoViewIfNeeded();
    await page.getByTestId('schedule-daily-timeline').evaluate((element) => { element.scrollLeft = 180; });
    const hourWidth = Number(await header.getAttribute('data-hour-width'));
    const target = (await header.boundingBox())!;
    const source = (await quoteCard.boundingBox())!;
    await page.mouse.move(source.x + 16, source.y + 16);
    await page.mouse.down();
    await page.mouse.move(source.x + 24, source.y + 24, { steps: 2 });
    await page.mouse.move(target.x + 5.5 * hourWidth, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => data.writes.length).toBe(1);
    expect(placements[0]).toMatchObject({
      initial_visit: { starts_at: '2026-11-05T10:30:00.000Z', ends_at: '2026-11-05T11:30:00.000Z' },
    });
    await expect(page.getByTestId('schedule-daily-timeline').getByTestId(`schedule-visit-${quote.id}`)).toBeVisible();
    expect(data.unexpected).toEqual([]);
  });
});

for (const [width, height] of [[1280, 720], [768, 1024], [390, 844]]) {
  for (const view of ['daily', 'weekly']) {
    test(`Jobs card actions without label column: ${view} ${width}x${height}`, async ({ page }) => {
      await mkdir(screenshots, { recursive: true });
      await page.setViewportSize({ width, height });
      const data = await mockScheduling(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(({ userId, view }) => {
        localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, view);
      }, { userId, view });
      await page.goto(`/?date=${date}`);
      const row = page.getByTestId(`schedule-board-row-job-${jobId}${width < 768 ? '-mobile' : ''}`);
      const visit = row.getByTestId(`schedule-visit-${visitId}`);
      await expect(visit).toBeVisible();
      await expect(visit.getByText('LOCAL-60001', { exact: true })).toBeVisible();
      await expect(visit.getByText('Oak crown reduction', { exact: true })).toBeVisible();
      await expect(visit.getByTestId(`schedule-job-staffing-${jobId}`)).toHaveText('2/3');
      await expect(page.getByTestId('schedule-daily-job-header')).toHaveCount(0);
      await expect(page.getByTestId(`schedule-daily-job-cell-${jobId}`)).toHaveCount(0);
      if (width >= 768) {
        expect(await row.evaluate((element) => element.children.length)).toBe(view === 'daily' ? 1 : 7);
        if (view === 'daily') {
          const timeline = page.getByTestId('schedule-daily-timeline');
          await timeline.evaluate((element) => { element.scrollLeft = 0; });
          const metrics = await timeline.evaluate((element) => {
            const header = element.querySelector<HTMLElement>('[data-testid="schedule-daily-timeline-header"]')!;
            const content = element.querySelector<HTMLElement>('[data-testid="schedule-daily-timeline-content"]')!;
            return {
              left: header.getBoundingClientRect().left - element.getBoundingClientRect().left,
              header: header.offsetWidth, content: content.offsetWidth,
              viewport: element.clientWidth, hour: Number(header.dataset.hourWidth),
              mode: element.getAttribute('data-timeline-mode'),
            };
          });
          expect(metrics.left).toBeCloseTo(1, 0);
          expect(metrics.content).toBe(metrics.header);
          expect(metrics.header).toBe(metrics.hour * 15);
          if (metrics.mode === 'fit') {
            expect(metrics.viewport - metrics.content).toBeGreaterThanOrEqual(0);
            expect(metrics.viewport - metrics.content).toBeLessThan(15);
          }
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await visit.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(screenshots, `jobs-no-column-${view}-${width}x${height}.png`) });
      const actions = visit.getByRole('button', { name: 'Actions for LOCAL-60001 visit 1', exact: true });
      await actions.click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Open Project in new tab' })).toHaveAttribute('href', '/quotes?tab=projects');
      await expect(menu.getByRole('menuitem', { name: 'Open Project in new tab' })).toHaveAttribute('target', '_blank');
      await expect(menu.getByRole('menuitem', { name: 'Return visit to Jobs', exact: true })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Edit visit 1', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Edit visit', exact: true })).toBeVisible();
      await page.getByRole('dialog', { name: 'Edit visit', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
      await actions.click();
      await page.getByRole('menuitem', { name: 'Add Additional Visit', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Add visit', exact: true }).getByLabel('Starts', { exact: true })).toHaveValue(`${date}T08:00`);
      await page.getByRole('dialog', { name: 'Add visit', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
      await actions.click();
      await page.getByRole('menuitem', { name: 'Edit scheduled job', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Edit scheduled job', exact: true })).toBeVisible();
      await page.getByRole('dialog', { name: 'Edit scheduled job', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
      await actions.click();
      await page.getByRole('menuitem', { name: 'Remove from schedule', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText('LOCAL-60001');
      await page.getByRole('button', { name: 'Keep job', exact: true }).click();
      expect(data.writes).toEqual([]);
      expect(data.unexpected).toEqual([]);
      expect(data.board.visits[0].starts_at).toBe(`${date}T08:00:00.000Z`);
      expect(errors).toEqual([]);
    });
  }
}

test('short daily card keeps overflow actions clear of resize and pan gestures', async ({ page }) => {
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  const data = await mockScheduling(page);
  data.board.visits[0].ends_at = `${date}T08:30:00.000Z`;
  await page.addInitScript((id) => {
    localStorage.setItem(`ffts:scheduling-board-view:v1:${id}`, 'daily');
  }, userId);
  await page.goto(`/?date=${date}`);
  await page.getByRole('button', { name: 'Scroll', exact: true }).click();
  const card = page.getByTestId(`schedule-timeline-visit-${visitId}`);
  const actions = card.getByRole('button', { name: 'Actions for LOCAL-60001 visit 1', exact: true });
  await actions.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  const actionBox = (await actions.boundingBox())!;
  expect(box.width).toBe(48);
  expect(actionBox.x).toBeGreaterThanOrEqual(box.x + 8);
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(box.x + box.width - 8);
  await page.screenshot({ path: resolve(screenshots, 'jobs-no-column-short-card-1280x720.png') });
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Remove from schedule', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'jobs-no-column-short-card-actions-1280x720.png') });
  await page.keyboard.press('Escape');
  const center = { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 4, center.y + 2, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('menu')).toBeVisible();
  expect((await card.boundingBox())!.x).toBeCloseTo(box.x);
  expect(data.writes).toEqual([]);
  expect(data.unexpected).toEqual([]);
});

for (const [view, width] of [['daily', 1440], ['weekly', 1440], ['daily', 390], ['weekly', 390]] as const) {
  test(`Jobs without a visible visit stay off the calendar: ${view} ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    const data = await mockScheduling(page);
    // A visit elsewhere in the same week must not populate the selected day.
    if (view === 'daily') {
      data.board.visits[0].starts_at = '2026-11-04T08:00:00.000Z';
      data.board.visits[0].ends_at = '2026-11-04T11:00:00.000Z';
    } else data.board.visits = [];
    data.board.assignments = [];
    await page.addInitScript(({ userId, view }) => {
      localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, view);
    }, { userId, view });
    await page.goto(`/?date=${date}`);
    await expect(page.getByTestId(`schedule-resource-job-${jobId}`)).toBeVisible();
    await expect(page.getByTestId(`schedule-board-row-job-${jobId}${width < 768 ? '-mobile' : ''}`)).toHaveCount(0);
    await expect(page.getByText('No visits in view', { exact: true })).toHaveCount(0);
    expect(data.writes).toEqual([]);
  });
}

for (const view of ['daily', 'weekly']) {
  test(`Jobs visit staffing retains untimed assignments: ${view}`, async ({ page }) => {
    const data = await mockScheduling(page);
    const employee = data.board.resources.employees[2];
    data.board.assignments.push({
      ...data.board.assignments[0], id: employee.id, resource_type: 'employee',
      profile_id: employee.id, employee, visit_id: null, visit: null,
    });
    await page.addInitScript(({ userId, view }) => {
      localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, view);
    }, { userId, view });
    await page.goto(`/?date=${date}`);
    const card = page.getByTestId(`schedule-board-row-job-${jobId}`).getByTestId(`schedule-visit-${visitId}`);
    await expect(card.getByTestId(`schedule-job-staffing-${jobId}`)).toHaveText('3/3');
    await card.getByRole('button', { name: 'Actions for LOCAL-60001 visit 1', exact: true }).click();
    await expect(page.getByRole('menu')).toContainText('LOCAL-60001 · 3/3');
    expect(data.writes).toEqual([]);
    expect(data.unexpected).toEqual([]);
  });
}

for (const source of ['quote', 'sample'] as const) {
  test(`Jobs card actions retain ${source} source restrictions`, async ({ page }) => {
    const data = await mockScheduling(page);
    data.board.jobs[0].source_type = source;
    data.board.jobs[0].quote_id = source === 'quote' ? '88888888-8888-4888-8888-888888888888' : null;
    await page.goto(`/?date=${date}`);
    const row = page.getByTestId(`schedule-board-row-job-${jobId}`);
    await row.getByRole('button', { name: 'Actions for LOCAL-60001 visit 1', exact: true }).click();
    if (source === 'quote') {
      await expect(page.getByRole('menuitem', { name: 'Edit scheduled job', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Open Quote in new tab', exact: true })).toHaveAttribute('href', '/quotes/overview/LOCAL-60001');
      await page.getByRole('menuitem', { name: 'Reschedule', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    } else {
      await expect(page.getByRole('menuitem', { name: 'Remove from schedule', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Reschedule', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Edit scheduled job', exact: true })).toBeVisible();
    }
    expect(data.writes).toEqual([]);
    expect(data.unexpected).toEqual([]);
  });
}

for (const primary of ['team', 'plant']) {
  test(`Jobs column removal leaves ${primary} axes and Resources intact`, async ({ page }) => {
    const data = await mockScheduling(page);
    data.board.resources.plant.push({
      id: '99999999-9999-4999-8999-999999999999', plant_id: 'LOCAL-PLANT',
      nickname: 'Fictional chipper', make: 'Test', model: 'Fixture', status: 'active',
    });
    const employeeAssignment = data.board.assignments[0];
    if (employeeAssignment.resource_type !== 'employee') throw new Error('Expected the fixture employee assignment');
    const { profile_id: _profileId, employee: _employee, ...assignment } = employeeAssignment;
    const plant = data.board.resources.plant[0];
    data.board.assignments.push({
      ...assignment, id: plant.id, resource_type: 'plant', plant_id: plant.id, plant,
    });
    await page.addInitScript(({ userId, primary }) => {
      localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, 'daily');
      localStorage.setItem(`ffts:scheduling-board-primary:v1:${userId}`, primary);
    }, { userId, primary });
    await page.goto(`/?date=${date}`);
    const timeline = page.getByTestId('schedule-daily-timeline');
    const header = timeline.getByTestId('schedule-daily-job-header');
    await expect(header).toHaveText(new RegExp(primary === 'team' ? 'Team' : 'Plant'));
    expect((await header.boundingBox())!.width).toBe(240);
    const rail = primary === 'team'
      ? timeline.getByTestId('schedule-daily-row-cell-team-1')
      : timeline.getByTestId('schedule-daily-row-cell-plant-99999999-9999-4999-8999-999999999999');
    await expect(rail).toBeVisible();
    await expect(timeline.getByRole('button', { name: /^Actions for LOCAL/ })).toHaveCount(0);
    await expect(page.getByTestId(`schedule-resource-job-${jobId}`)).toBeVisible();
    await mkdir(screenshots, { recursive: true });
    await page.getByTestId('schedule-board-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(screenshots, `jobs-no-column-unaffected-${primary}.png`) });
    await page.getByRole('tab', { name: 'Weekly', exact: true }).click();
    expect(await rail.count()).toBe(0);
    const row = page.getByTestId(primary === 'team'
      ? 'schedule-board-row-team-1'
      : 'schedule-board-row-plant-99999999-9999-4999-8999-999999999999');
    expect(await row.evaluate((element) => element.children.length)).toBe(8);
    expect(data.writes).toEqual([]);
    expect(data.unexpected).toEqual([]);
  });
}

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

test('Resources and its tab rows keep the same width when switching layouts', async ({ page }) => {
  await mockScheduling(page);
  await page.goto(`/?date=${date}`);
  const grid = page.getByTestId('schedule-manager-layout');
  const resources = page.getByTestId('schedule-resources-panel');
  const mainTabs = resources.getByTestId('schedule-resource-tabs');
  const filters = resources.getByRole('tablist').filter({ has: page.getByRole('tab', { name: /^Projects \(/ }) });

  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const resourceWidths = [];
    for (const [layout, label] of [
      ['standard', 'Standard layout'],
      ['columns', 'Resources, Teams and Calendar columns'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(grid).toHaveAttribute('data-layout', layout);
      resourceWidths.push((await resources.boundingBox())!.width);

      const mainRow = (await mainTabs.boundingBox())!;
      const filterRow = (await filters.boundingBox())!;
      const firstFilter = (await filters.getByRole('tab').first().boundingBox())!;
      const lastFilter = (await filters.getByRole('tab').last().boundingBox())!;
      expect(filterRow.x).toBeCloseTo(mainRow.x);
      expect(filterRow.width).toBeCloseTo(mainRow.width);
      expect(lastFilter.x + lastFilter.width - firstFilter.x).toBeGreaterThan(filterRow.width - 12);
    }
    expect(resourceWidths[0]).toBeCloseTo(resourceWidths[1]);
  }
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

test('off-week completion stays projected when Resources repeatedly returns stale jobs', async ({ page }) => {
  const data = await mockScheduling(page);
  const stalePayload = structuredClone(data.respond(new URL('http://127.0.0.1:4017/api/scheduling/jobs'), 'GET').json);
  let staleReadsAfterSave = 0;
  await page.route('**/api/scheduling/jobs', async (route) => {
    if (data.writes.length > 0) staleReadsAfterSave += 1;
    await route.fulfill({ json: stalePayload });
  });
  await page.goto(`/?date=${date}`);
  const job = page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111112');
  await expect(job).toBeVisible();
  await job.click();
  const dialog = page.getByRole('dialog', { name: 'Edit scheduled job' });
  await dialog.getByLabel('Status', { exact: true }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => staleReadsAfterSave).toBeGreaterThanOrEqual(2);
  await expect(job).toHaveCount(0);
  expect(data.writes).toEqual(['PATCH /api/scheduling/jobs/11111111-1111-4111-8111-111111111112']);
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


test('wide job cards group details in two compact left-aligned columns', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const data = await mockScheduling(page);
  data.board.visits[0].ends_at = '2026-11-05T16:00:00.000Z';
  await page.addInitScript((userId) => {
    localStorage.setItem(`ffts:scheduling-board-view:v1:${userId}`, 'daily');
    localStorage.setItem(`ffts:scheduling-layout:v1:${userId}`, 'columns');
  }, userId);
  await page.goto(`/?date=${date}`);
  const card = page.getByTestId(`schedule-timeline-visit-${visitId}`);
  await expect(card).toBeVisible();
  const columns = card.locator('.schedule-job-card-details > span');
  const left = (await columns.nth(0).boundingBox())!;
  const right = (await columns.nth(1).boundingBox())!;
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(right.x - (left.x + left.width)).toBeGreaterThan(8);
  expect(right.x - (left.x + left.width)).toBeLessThan(24);
  expect(left.width).toBeLessThan((await card.boundingBox())!.width * 0.5);
  expect((await card.boundingBox())!.height).toBeLessThan(160);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, 'jobs-compact-details-1600x900.png') });
  expect(data.writes).toEqual([]);
});
