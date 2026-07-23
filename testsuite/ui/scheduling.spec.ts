/**
 * @tags @scheduling
 * Smoke tests scheduling management and employee surfaces.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function schedulingFixture() {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

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
      quote_project_number_id: null,
      customer_id: null,
      is_drop_on_ready: false,
      tags: [],
      created_by: null,
      updated_by: null,
      created_at: start.toISOString(),
      updated_at: start.toISOString(),
    }],
    tags: [],
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

async function mockManagerBoard(page: Page) {
  const fixture = schedulingFixture();
  const assignmentRequests: Array<Record<string, unknown>> = [];
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
  await page.route('**/api/scheduling/assignments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    assignmentRequests.push(body);
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
  return { fixture, assignmentRequests };
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

  test('wide board directly assigns a dragged resource to a timed visit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture, assignmentRequests } = await mockManagerBoard(page);
    await page.goto('/scheduling');

    const source = page.getByTestId(
      'schedule-resource-employee-22222222-2222-4222-8222-222222222222'
    );
    const dragHandle = source.getByRole('button', { name: 'Drag Test Scheduler to a visit' });
    const target = page
      .getByTestId(
        'schedule-cell-11111111-1111-4111-8111-111111111111-'
          + fixture.week.start
      )
      .getByTestId('schedule-visit-44444444-4444-4444-8444-444444444444');
    await expect(source).toBeVisible();
    await expect(dragHandle).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await dragHandle.boundingBox();
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

  test('daily board presents a horizontally scrollable 5am to 8pm timeline', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockManagerBoard(page);
    await page.goto('/scheduling');

    await page.getByRole('tab', { name: 'Daily' }).click();

    const timeline = page.getByLabel('Daily schedule timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toHaveClass(/scrollbar-hidden/);
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
    await page.getByRole('button', { name: 'Select Test Scheduler' }).click();

    await expect.poll(() => assignmentRequests).toHaveLength(1);
    await expect(page.getByRole('dialog', { name: 'Assign resource' })).toHaveCount(0);
    await expect(page.locator('button button')).toHaveCount(0);
  });

  test.describe('touchscreen laptop context', () => {
    test.use({
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });

    test('keeps tap assignment available without starting a drag', async ({ page }) => {
      const { assignmentRequests } = await mockManagerBoard(page);
      await page.goto('/scheduling');

      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      const resourceCard = page.getByTestId(
        'schedule-resource-employee-22222222-2222-4222-8222-222222222222'
      );
      const dragHandle = resourceCard.getByRole('button', {
        name: 'Drag Test Scheduler to a visit',
      });
      const selectButton = resourceCard.getByRole('button', {
        name: 'Select Test Scheduler',
      });
      expect(await dragHandle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
      expect(await selectButton.evaluate((element) => getComputedStyle(element).touchAction)).not.toBe('none');
      await page
        .getByRole('button', { name: 'Select visit 1 for TEST-JOB-101' })
        .tap();
      await selectButton.tap();

      await expect.poll(() => assignmentRequests).toHaveLength(1);
      await expect(page.getByRole('dialog', { name: 'Assign resource' })).toHaveCount(0);
    });
  });
});
