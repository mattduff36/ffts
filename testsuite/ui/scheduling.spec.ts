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
      created_by: null,
      updated_by: null,
      created_at: start.toISOString(),
      updated_at: start.toISOString(),
    }],
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
    assignments: [],
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
    plant_unavailability: [],
  };
}

async function mockManagerBoard(page: Page) {
  const fixture = schedulingFixture();
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
  return fixture;
}

test.describe('@scheduling Scheduling', () => {
  test('management board loads or shows a clear access state', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/scheduling',
      'Scheduling route timed out in this environment'
    );

    await expect(page.locator('body')).toContainText(
      /job scheduling|weekly job board|my schedule|manager|permission|dashboard/i,
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

  test('wide board drags a whole resource card to a timed visit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await mockManagerBoard(page);
    await page.goto('/scheduling');

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
    await expect(source).toHaveAttribute('aria-label', /or drag to an available job day/i);
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

    await expect(page.getByRole('dialog', { name: 'Assign resource' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Test Scheduler');
  });

  test('mobile board assigns by selection and tap without drag', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockManagerBoard(page);
    await page.goto('/scheduling');

    await page
      .getByTestId('schedule-resource-employee-22222222-2222-4222-8222-222222222222')
      .click();
    await page.getByRole('button', {
      name: 'Assign resource to visit 1 for TEST-JOB-101',
    }).click();

    await expect(page.getByRole('dialog', { name: 'Assign resource' })).toBeVisible();
    await expect(page.locator('button button')).toHaveCount(0);
  });
});
