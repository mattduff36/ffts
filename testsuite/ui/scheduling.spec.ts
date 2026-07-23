/**
 * @tags @scheduling
 * Smoke tests scheduling management and employee surfaces.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function readControlContrast(locator: Locator) {
  return locator.evaluate((element) => {
    function parseColor(value: string) {
      if (!value.startsWith('rgb')) {
        const context = document.createElement('canvas').getContext('2d');
        if (context) {
          context.fillStyle = '#000000';
          context.fillStyle = value;
          value = context.fillStyle;
        }
      }
      if (value.startsWith('#')) {
        const hex = value.slice(1);
        const expanded = hex.length === 3
          ? hex.split('').map((channel) => channel + channel).join('')
          : hex;
        return {
          red: Number.parseInt(expanded.slice(0, 2), 16),
          green: Number.parseInt(expanded.slice(2, 4), 16),
          blue: Number.parseInt(expanded.slice(4, 6), 16),
          alpha: 1,
        };
      }
      const channels = value.match(/[\d.]+/g)?.map(Number) || [];
      return {
        red: channels[0] || 0,
        green: channels[1] || 0,
        blue: channels[2] || 0,
        alpha: channels[3] ?? 1,
      };
    }
    function composite(foreground: ReturnType<typeof parseColor>, background: ReturnType<typeof parseColor>) {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
      return {
        red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
        green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
        blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
        alpha,
      };
    }
    function luminance(color: ReturnType<typeof parseColor>) {
      const values = [color.red, color.green, color.blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    }
    const style = getComputedStyle(element);
    let background = parseColor(style.backgroundColor);
    let parent = element.parentElement;
    while (background.alpha < 1 && parent) {
      background = composite(background, parseColor(getComputedStyle(parent).backgroundColor));
      parent = parent.parentElement;
    }
    const foreground = parseColor(style.color);
    const lighter = Math.max(luminance(background), luminance(foreground));
    const darker = Math.min(luminance(background), luminance(foreground));
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
      ratio: (lighter + 0.05) / (darker + 0.05),
    };
  });
}

function schedulingFixture() {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const hospitalTag = {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Hospital',
    color: 'slate',
    description: null,
    is_active: true,
  };

  return {
    week: { start: formatDate(start), end: formatDate(end) },
    jobs: [{
      id: '11111111-1111-4111-8111-111111111111',
      job_reference: 'TEST-JOB-101',
      title: 'Scheduling interaction test',
      description: null,
      site_address: 'Test site',
      status: 'scheduled',
      source_type: 'manual',
      start_date: formatDate(start),
      end_date: formatDate(end),
      estimated_duration_minutes: 360,
      quote_id: null,
      quote_project_number_id: '77777777-7777-4777-8777-777777777777',
      customer_id: null,
      is_drop_on_ready: false,
      tags: [hospitalTag],
      created_by: null,
      updated_by: null,
      created_at: start.toISOString(),
      updated_at: start.toISOString(),
    }],
    tags: [hospitalTag],
    visits: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        job_id: '11111111-1111-4111-8111-111111111111',
        sequence_number: 1,
        title: 'Initial visit',
        starts_at: `${formatDate(start)}T08:00:00.000Z`,
        ends_at: `${formatDate(start)}T11:00:00.000Z`,
        status: 'planned',
        notes: null,
        created_by: null,
        updated_by: null,
        created_at: start.toISOString(),
        updated_at: start.toISOString(),
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        job_id: '11111111-1111-4111-8111-111111111111',
        sequence_number: 2,
        title: 'Follow-up visit',
        starts_at: `${formatDate(end)}T12:00:00.000Z`,
        ends_at: `${formatDate(end)}T15:00:00.000Z`,
        status: 'planned',
        notes: null,
        created_by: null,
        updated_by: null,
        created_at: start.toISOString(),
        updated_at: start.toISOString(),
      },
    ],
    assignments: [] as Array<Record<string, unknown>>,
    resources: {
      employees: [{
        id: '22222222-2222-4222-8222-222222222222',
        full_name: 'Test Scheduler',
        employee_id: 'E-TEST',
        team_id: null,
        team_name: null,
      }],
      plant: [],
    },
    employee_capacity: [{
      date: formatDate(start),
      available_employee_count: 1,
      total_available_minutes: 450,
      employees: [{
        profile_id: '22222222-2222-4222-8222-222222222222',
        full_name: 'Test Scheduler',
        available_minutes: 450,
      }],
    }],
    plant_unavailability: [],
  };
}

async function mockManagerBoard(
  page: Page,
  options: { assignmentConflict?: boolean; quoteJob?: boolean } = {}
) {
  const fixture = schedulingFixture();
  if (options.quoteJob) {
    Object.assign(fixture.jobs[0] as unknown as Record<string, unknown>, {
      source_type: 'quote',
      quote_id: '66666666-6666-4666-8666-666666666666',
      quote_project_number_id: null,
    });
  }
  const assignmentRequests: Array<Record<string, unknown>> = [];
  const removeJobRequests: string[] = [];
  const quoteScheduleRequests: Array<Record<string, unknown>> = [];
  const jobPatchRequests: Array<Record<string, unknown>> = [];
  const visitUpdateRequests: Array<Record<string, unknown>> = [];
  const projectScheduleRequests: Array<Record<string, unknown>> = [];
  const projectCandidates = [{
    id: '99999999-9999-4999-8999-999999999999',
    project_reference: 'TEST-PROJECT-101',
    manager_profile_id: '33333333-3333-4333-8333-333333333333',
    requester_initials: 'TS',
    title: 'Open Project work',
    description: null,
    status: 'open',
  }];
  const quoteCandidates = [{
    id: '66666666-6666-4666-8666-666666666666',
    quote_reference: 'TEST-QUOTE-101',
    base_quote_reference: 'TEST-QUOTE-101',
    title: 'Unscheduled test work',
    customer_name: 'Test Customer',
    status: 'draft',
    start_date: null as string | null,
    end_date: null as string | null,
    estimated_duration_days: 2,
    estimated_duration_minutes: 120,
  }];
  await page.route('**/api/scheduling/context', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: '33333333-3333-4333-8333-333333333333',
        access_level: 5,
        is_manager_or_admin: true,
        role_name: 'admin',
        role_class: 'admin',
        team_id: null,
        team_name: null,
      }),
    })
  );
  await page.route('**/api/scheduling/board?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    })
  );
  await page.route('**/api/scheduling/quotes**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ quotes: quoteCandidates }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    quoteScheduleRequests.push(body);
    quoteCandidates[0].start_date = String(body.start_date);
    quoteCandidates[0].end_date = String(body.end_date);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: fixture.jobs[0] }),
    });
  });
  await page.route('**/api/scheduling/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: projectCandidates }),
    })
  );
  await page.route('**/api/scheduling/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      projectScheduleRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ job: fixture.jobs[0] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobs: fixture.jobs,
        customers: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          company_name: 'Test Customer',
          status: 'active',
          sites: [],
        }],
        tags: [],
      }),
    });
  });
  await page.route('**/api/scheduling/visits/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    visitUpdateRequests.push(body);
    const visit = fixture.visits.find((item) =>
      route.request().url().endsWith(item.id)
    );
    if (visit) {
      visit.starts_at = String(body.starts_at || visit.starts_at);
      visit.ends_at = String(body.ends_at || visit.ends_at);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ visit }),
    });
  });
  await page.route('**/api/scheduling/assignments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    assignmentRequests.push(body);
    if (options.assignmentConflict && !body.override_conflicts) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'This assignment has scheduling conflicts.',
          conflicts_by_date: {
            [fixture.week.start]: [{
              code: 'employee_absent',
              severity: 'warning',
              message: 'Employee has an approved absence.',
            }],
          },
        }),
      });
      return;
    }
    const visit = fixture.visits.find((item) => item.id === body.visit_id);
    fixture.assignments.push({
      id: `assignment-${assignmentRequests.length}`,
      job_id: String(body.job_id),
      work_date: String(visit?.starts_at.slice(0, 10)),
      visit_id: String(body.visit_id),
      profile_id: String(body.resource_id),
      resource_type: 'employee',
      employee: fixture.resources.employees[0],
      notes: null,
      conflict_override: false,
      conflict_codes: [],
      conflict_override_by: null,
      conflict_override_at: null,
      assigned_by: '33333333-3333-4333-8333-333333333333',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      conflicts: [],
      visit: visit || null,
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ assignments: fixture.assignments }),
    });
  });
  await page.route('**/api/scheduling/jobs/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      jobPatchRequests.push(body);
      fixture.jobs[0] = { ...fixture.jobs[0], ...body };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job: fixture.jobs[0] }),
      });
      return;
    }
    if (route.request().method() !== 'DELETE') return route.fallback();
    const jobId = route.request().url().split('/').pop() || '';
    removeJobRequests.push(jobId);
    fixture.jobs = fixture.jobs.filter((job) => job.id !== jobId);
    fixture.visits = fixture.visits.filter((visit) => visit.job_id !== jobId);
    fixture.assignments = fixture.assignments.filter(
      (assignment) => assignment.job_id !== jobId
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        source_type: 'manual',
        project_number_id: '77777777-7777-4777-8777-777777777777',
      }),
    });
  });
  return {
    fixture,
    assignmentRequests,
    removeJobRequests,
    quoteScheduleRequests,
    jobPatchRequests,
    visitUpdateRequests,
    projectScheduleRequests,
  };
}

test.describe('@scheduling Scheduling', () => {
  test('management board loads or shows a clear access state', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/scheduling',
      'Scheduling route timed out in this environment'
    );

    await expect(page.locator('body')).toContainText(
      /job scheduling|weekly job board|my schedule|manager|permission|dashboard|setup is incomplete/i,
      { timeout: 10_000 }
    );
  });

  test('Scheduling controls expose computed contrast across states', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { assignmentRequests } = await mockManagerBoard(page, {
      assignmentConflict: true,
    });
    await page.goto('/scheduling');

    const offerButton = page.getByRole('button', { name: 'Offer if crew free' });
    const offerOff = await readControlContrast(offerButton);
    expect(offerOff.ratio).toBeGreaterThanOrEqual(4.5);
    await offerButton.click();
    await expect(offerButton).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    const activeOffer = await readControlContrast(offerButton);
    expect(activeOffer.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(activeOffer.ratio).toBeGreaterThanOrEqual(4.5);
    await offerButton.click();

    const tagButton = page.getByRole('button', { name: 'Hospital' });
    await tagButton.click();
    await expect(tagButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tagButton.locator('.lucide-check')).toBeVisible();
    await page.waitForTimeout(200);
    expect((await readControlContrast(tagButton)).ratio).toBeGreaterThanOrEqual(4.5);
    await tagButton.click();

    const outlineButton = page.getByRole('button', { name: 'Plant availability' });
    expect((await readControlContrast(outlineButton)).ratio).toBeGreaterThanOrEqual(4.5);
    await outlineButton.hover();
    await page.waitForTimeout(200);
    expect((await readControlContrast(outlineButton)).ratio).toBeGreaterThanOrEqual(4.5);
    await outlineButton.focus();
    expect((await readControlContrast(outlineButton)).boxShadow).not.toBe('none');

    const dangerButton = page.getByRole('button', { name: 'Remove TEST-JOB-101' }).first();
    expect((await readControlContrast(dangerButton)).ratio).toBeGreaterThanOrEqual(4.5);
    await dangerButton.hover();
    await page.waitForTimeout(200);
    expect((await readControlContrast(dangerButton)).ratio).toBeGreaterThanOrEqual(4.5);

    await page.getByRole('tab', { name: 'Employees' }).click();
    await page.getByRole('button', { name: 'Select visit 1 for TEST-JOB-101' }).first().click();
    await page.getByTestId(
      'schedule-resource-employee-22222222-2222-4222-8222-222222222222'
    ).click();
    await expect.poll(() => assignmentRequests).toHaveLength(1);
    const overrideButton = page.getByRole('button', { name: 'Assign anyway' });
    await expect(overrideButton).toBeVisible();
    expect((await readControlContrast(overrideButton)).ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('board actions persist crew-offer toggles', async ({ page }) => {
    const { jobPatchRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    const actions = page.getByTestId(
      'schedule-job-actions-desktop-11111111-1111-4111-8111-111111111111'
    );
    const crewOffer = actions.getByRole('button', {
      name: 'Offer if crew finishes early',
    });
    await crewOffer.click();
    await expect(crewOffer).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => jobPatchRequests).toEqual([
      { is_drop_on_ready: true },
    ]);
  });

  test('Projects queue places an open Project through customer selection', async ({ page }) => {
    const { fixture, projectScheduleRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: 'Projects (1)' }).click();
    await page.getByTestId(
      'schedule-quote-99999999-9999-4999-8999-999999999999'
    ).click();
    await page.getByRole('button', {
      name: `Schedule TEST-PROJECT-101 from ${fixture.week.start}`,
    }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Schedule Project' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Test Customer' }).click();
    await dialog.getByRole('button', { name: 'Schedule Project' }).click();
    await expect.poll(() => projectScheduleRequests).toHaveLength(1);
    expect(projectScheduleRequests[0]).toMatchObject({
      project_number_id: '99999999-9999-4999-8999-999999999999',
      start_date: fixture.week.start,
      end_date: fixture.week.start,
    });
  });

  test('employee schedule loads with a weekly state', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/scheduling/my',
      'My schedule route timed out in this environment'
    );

    await expect(page.locator('body')).toContainText(
      /my schedule|assignment|no work assigned|permission|dashboard/i,
      { timeout: 10_000 }
    );
  });

  test('wide board schedules a queued job by dragging it onto a date', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture, quoteScheduleRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    const source = page.getByTestId(
      'schedule-quote-66666666-6666-4666-8666-666666666666'
    );
    const target = page.getByTestId(
      `schedule-date-drop-desktop-${fixture.week.start}`
    );
    await expect(source).toBeVisible({ timeout: 10_000 });
    await expect(source).toHaveAttribute(
      'aria-label',
      'TEST-QUOTE-101: select job or drag to a calendar date'
    );
    await expect(target).toBeVisible();
    await source.click();
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    await source.click();
    await expect(source).not.toHaveClass('bg-[#34d399]');
    await expect(page.getByText('Selected: TEST-QUOTE-101')).toHaveCount(0);

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 20 }
    );
    await page.mouse.up();

    await expect.poll(() => quoteScheduleRequests).toEqual([{
      quote_id: '66666666-6666-4666-8666-666666666666',
      start_date: fixture.week.start,
      end_date: formatDate(
        new Date(new Date(`${fixture.week.start}T12:00:00.000Z`).getTime() + 86_400_000)
      ),
    }]);
  });

  test('Daily queued-job drops create one snapped atomic initial visit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { quoteScheduleRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: 'Daily' }).click();

    const source = page.getByTestId(
      'schedule-quote-66666666-6666-4666-8666-666666666666'
    );
    const header = page.getByTestId('schedule-daily-timeline-header');
    const sourceBox = await source.boundingBox();
    const headerBox = await header.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    await page.mouse.move(sourceBox!.x + 20, sourceBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(headerBox!.x + 2 * 96, headerBox!.y + 90, { steps: 25 });
    await expect(source).not.toHaveClass('bg-[#34d399]');
    await expect(page.getByText('Selected: TEST-QUOTE-101')).toHaveCount(0);
    await page.mouse.up();

    await expect.poll(() => quoteScheduleRequests).toHaveLength(1);
    const request = quoteScheduleRequests[0] as {
      initial_visit?: { starts_at: string; ends_at: string };
    };
    expect(request.initial_visit).toBeDefined();
    const formatLondonTime = (value: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value));
    expect(formatLondonTime(request.initial_visit!.starts_at)).toBe('07:00');
    expect(formatLondonTime(request.initial_visit!.ends_at)).toBe('09:00');
  });

  test('wide board directly assigns a dragged resource to a timed visit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture, assignmentRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: 'Employees' }).click();

    const source = page.getByTestId(
      'schedule-resource-employee-22222222-2222-4222-8222-222222222222'
    );
    const target = page
      .getByTestId(
        'schedule-cell-11111111-1111-4111-8111-111111111111-'
          + fixture.week.start
      )
      .getByTestId('schedule-visit-44444444-4444-4444-8444-444444444444');
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2
    );
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 30 }
    );
    await page.waitForTimeout(500);
    await page.mouse.up();

    await expect.poll(() => assignmentRequests).toHaveLength(1);
    await expect(page.getByRole('dialog', { name: 'Assign resource' })).toHaveCount(0);
    await expect(source).toHaveCount(0);
  });

  test('daily board falls back to a scrollable 5am to 8pm timeline', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { visitUpdateRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    await page.getByRole('tab', { name: 'Daily' }).click();

    const timeline = page.getByLabel('Daily schedule timeline');
    await expect(timeline).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shrink to fit width' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Scroll' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(timeline).not.toHaveClass(/scrollbar-hidden/);
    await expect(page.getByTestId('schedule-timeline-hour-5')).toContainText('05:00');
    await expect(page.getByTestId('schedule-timeline-hour-20')).toContainText('20:00');
    await expect
      .poll(() =>
        timeline.evaluate((element) => element.scrollWidth > element.clientWidth)
      )
      .toBe(true);

    const londonWeekday = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
    }).format(new Date());
    const daysSinceMonday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      .indexOf(londonWeekday);
    for (let index = 0; index < daysSinceMonday; index += 1) {
      await page.getByRole('button', { name: 'Previous day' }).click();
    }

    const timelineVisit = timeline.getByTestId(
      'schedule-visit-44444444-4444-4444-8444-444444444444'
    );
    await expect(timelineVisit).toBeVisible();
    await expect(timelineVisit).toHaveCSS('background-color', 'rgb(51, 65, 85)');
    const singleVisitGeometry = await page.evaluate(() => {
      const timelineCell = document.querySelector<HTMLElement>(
        '[data-testid^="schedule-cell-11111111-1111-4111-8111-111111111111-"]'
      );
      const jobCell = document.querySelector<HTMLElement>(
        '[data-testid="schedule-daily-job-cell-11111111-1111-4111-8111-111111111111"]'
      );
      const visitPlacement = document.querySelector<HTMLElement>(
        '[data-testid="schedule-timeline-visit-44444444-4444-4444-8444-444444444444"]'
      );
      if (!timelineCell || !jobCell || !visitPlacement) return null;
      const timelineRect = timelineCell.getBoundingClientRect();
      const jobRect = jobCell.getBoundingClientRect();
      const visitRect = visitPlacement.getBoundingClientRect();
      return {
        sharedHeightDifference: Math.abs(timelineRect.height - jobRect.height),
        topInset: visitRect.top - timelineRect.top,
        bottomInset: timelineRect.bottom - visitRect.bottom,
      };
    });
    expect(singleVisitGeometry).not.toBeNull();
    expect(singleVisitGeometry!.sharedHeightDifference).toBeLessThanOrEqual(1);
    expect(singleVisitGeometry!.topInset).toBeCloseTo(8, 0);
    expect(singleVisitGeometry!.bottomInset).toBeCloseTo(8, 0);

    await timeline.evaluate((element) => {
      element.scrollLeft = 500;
    });
    await expect.poll(() => timeline.evaluate((element) => element.scrollLeft))
      .toBe(500);

    const jobCellTestId =
      'schedule-daily-job-cell-11111111-1111-4111-8111-111111111111';
    const visitTestId = 'schedule-visit-44444444-4444-4444-8444-444444444444';
    const stacking = await page.evaluate(({ jobCellTestId, visitTestId }) => {
      const jobCell = document.querySelector<HTMLElement>(
        `[data-testid="${jobCellTestId}"]`
      );
      const visit = document.querySelector<HTMLElement>(
        `[data-testid="${visitTestId}"]`
      );
      if (!jobCell || !visit) return null;
      const jobRect = jobCell.getBoundingClientRect();
      const visitRect = visit.getBoundingClientRect();
      const point = {
        x: Math.max(jobRect.left + 8, Math.min(jobRect.right - 8, visitRect.left + 8)),
        y: Math.max(jobRect.top + 8, Math.min(jobRect.bottom - 8, visitRect.top + 8)),
      };
      const hitTarget = document.elementFromPoint(point.x, point.y);
      return {
        hasHorizontalOverlap:
          visitRect.left < jobRect.right && visitRect.right > jobRect.left,
        hitStickyJobCell: hitTarget?.closest(
          `[data-testid="${jobCellTestId}"]`
        ) === jobCell,
      };
    }, { jobCellTestId, visitTestId });
    expect(stacking).toEqual({
      hasHorizontalOverlap: true,
      hitStickyJobCell: true,
    });

    const stickyJobCell = timeline.getByTestId(jobCellTestId);
    await stickyJobCell.getByRole('button', { name: 'Edit TEST-JOB-101' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit scheduled job' });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole('button', { name: 'Cancel' }).click();

    const resizeEnd = page.getByRole('button', {
      name: 'Adjust end of visit 1 for TEST-JOB-101',
    });
    await resizeEnd.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => visitUpdateRequests).toHaveLength(1);
    expect(visitUpdateRequests[0]).toMatchObject({
      starts_at: expect.stringContaining('T08:00:00.000Z'),
      ends_at: expect.stringContaining('T11:30:00.000Z'),
    });
  });

  test('ultra-wide Fit follows ResizeObserver width while Scroll stays fixed', async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await mockManagerBoard(page);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: 'Daily' }).click();

    const timeline = page.getByLabel('Daily schedule timeline');
    await expect(timeline).toHaveAttribute('data-timeline-mode', 'fit');

    const readMetrics = () => timeline.evaluate((element) => {
      const content = element.querySelector<HTMLElement>(
        '[data-testid="schedule-daily-timeline-content"]'
      );
      const header = element.querySelector<HTMLElement>(
        '[data-testid="schedule-daily-timeline-header"]'
      );
      const endMarker = element.querySelector<HTMLElement>(
        '[data-testid="schedule-timeline-hour-20"]'
      );
      const headerRect = header?.getBoundingClientRect();
      const endMarkerRect = endMarker?.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        contentWidth: content?.getBoundingClientRect().width || 0,
        hourWidth: Number(header?.dataset.hourWidth || 0),
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        endMarkerInside:
          Boolean(headerRect && endMarkerRect)
          && endMarkerRect!.right <= headerRect!.right + 0.5
          && endMarkerRect!.left >= headerRect!.left - 0.5,
      };
    });
    const initialMetrics = await readMetrics();
    expect(Math.abs(initialMetrics.contentWidth - initialMetrics.clientWidth))
      .toBeLessThanOrEqual(14);
    expect(initialMetrics.scrollWidth).toBeLessThanOrEqual(initialMetrics.clientWidth + 1);
    expect(initialMetrics.scrollLeft).toBe(0);
    expect(initialMetrics.endMarkerInside).toBe(true);

    await page.setViewportSize({ width: 2800, height: 900 });
    await expect.poll(async () => {
      const metrics = await readMetrics();
      return (
        Math.abs(metrics.contentWidth - metrics.clientWidth) <= 14
        && metrics.hourWidth > initialMetrics.hourWidth
      );
    }).toBe(true);

    const fittedMetrics = await readMetrics();
    expect(fittedMetrics.hourWidth).toBeGreaterThan(96);
    expect(fittedMetrics.scrollWidth).toBeLessThanOrEqual(fittedMetrics.clientWidth + 1);
    expect(fittedMetrics.scrollLeft).toBe(0);
    expect(fittedMetrics.endMarkerInside).toBe(true);

    await page.getByRole('button', { name: 'Scroll' }).click();
    await expect(timeline).toHaveAttribute('data-timeline-mode', 'scroll');
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect.poll(async () => {
      const metrics = await readMetrics();
      return metrics.scrollWidth > metrics.clientWidth;
    }).toBe(true);
    const scrolledMetrics = await readMetrics();
    expect(scrolledMetrics.contentWidth).toBe(1680);
    expect(scrolledMetrics.hourWidth).toBe(96);
    expect(scrolledMetrics.scrollWidth).toBeGreaterThan(scrolledMetrics.clientWidth);
  });

  test('weekly capacity opens its breakdown and a date drills into daily view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture } = await mockManagerBoard(page);
    await page.goto('/scheduling');
    const dateLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${fixture.week.start}T12:00:00.000Z`));

    await page.getByRole('button', {
      name: `1 person with 7h 30m available on ${dateLabel}`,
    }).click();
    await expect(page.getByText('1 person · 7h 30m available')).toBeVisible();
    await expect(page.getByText('Test Scheduler').last()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', {
      name: `Open daily schedule for ${dateLabel}`,
    }).click();
    await expect(page.getByText('Daily job board')).toBeVisible();
    await expect(page.getByLabel('Daily schedule timeline')).toBeVisible();
  });

  test('mobile board assigns by selection and tap without drag', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { assignmentRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    await page.getByRole('button', {
      name: 'Select visit 1 for TEST-JOB-101',
    }).click();
    await page.getByRole('button', {
      name: 'Test Scheduler: select resource or drag to a timed visit',
    }).click();

    await expect.poll(() => assignmentRequests).toHaveLength(1);
    await expect(page.getByRole('dialog', { name: 'Assign resource' })).toHaveCount(0);
    await expect(page.locator('button button')).toHaveCount(0);
  });

  test('mobile board confirms and removes a Project schedule', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { removeJobRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    await page.getByRole('button', { name: 'Remove TEST-JOB-101' }).click();
    const confirmation = page.getByRole('alertdialog', {
      name: 'Remove Project job from the schedule?',
    });
    await expect(confirmation).toContainText('Project Number and its costs remain open');
    await confirmation.getByRole('button', { name: 'Remove job' }).click();

    await expect.poll(() => removeJobRequests).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  test.describe('touchscreen laptop context', () => {
    test.use({
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });

    test('keeps tap assignment available without starting a drag', async ({ page }) => {
      const { assignmentRequests } = await mockManagerBoard(page);
      await page.goto('/scheduling');
      await page.getByRole('tab', { name: 'Employees' }).click();

      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      const resourceCard = page.getByTestId(
        'schedule-resource-employee-22222222-2222-4222-8222-222222222222'
      );
      await expect(resourceCard).toHaveRole('button');
      expect(await resourceCard.evaluate((element) => getComputedStyle(element).touchAction))
        .not.toBe('none');
      await page
        .getByRole('button', { name: 'Select visit 1 for TEST-JOB-101' })
        .tap();
      await resourceCard.tap();

      await expect.poll(() => assignmentRequests).toHaveLength(1);
      await expect(page.getByRole('dialog', { name: 'Assign resource' })).toHaveCount(0);
    });
  });
});
