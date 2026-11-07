import { expect, test } from '@playwright/test';
import { date, mockScheduling } from './fixture';

test('outside clicks dismiss panels while protecting dirty nested forms', async ({ page }) => {
  await mockScheduling(page, 200, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?view=week&date=${date}`);
  for (const name of ['Quotes', 'Customers']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByTestId('scheduling-nav-panel')).toBeVisible();
    await page.mouse.click(1400, 500);
    await expect(page.getByTestId('scheduling-nav-panel')).toHaveCount(0);
    await expect(page.getByRole('link', { name, exact: true })).toBeFocused();
  }
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await panel.getByRole('button', { name: /Fictional Customer/ }).click();
  await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
  const form = page.getByRole('dialog', { name: 'Edit Customer' });
  await form.getByLabel('Company Name', { exact: false }).fill('Unsaved customer');
  await page.mouse.click(1400, 500);
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Company Name', { exact: false })).toHaveValue('Unsaved customer');
  await expect(page.getByTestId('scheduling-nav-panel')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`view=week&date=${date}`));
});

test('customer panel saves in place and retains the scheduling board', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?view=week&date=${date}`);
  await expect(page.getByText('Weekly job board', { exact: true })).toBeVisible();
  await page.getByTestId('schedule-manager-board-root').evaluate(element => { element.setAttribute('data-review-instance', 'retained'); });
  await page.getByPlaceholder('Search jobs').first().fill('Oak');
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /Fictional Customer/ }).click();
  await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
  const form = page.getByRole('dialog', { name: 'Edit Customer' });
  await expect(form).toBeVisible();
  await form.getByLabel('Company Name', { exact: false }).fill('Fictional Updated Customer');
  await form.getByRole('button', { name: 'Update Customer', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fictional Updated Customer', exact: true })).toBeVisible();
  await expect.poll(() => api.panels.writes.filter(path => path.startsWith('PATCH /api/customers')).length).toBe(1);
  await expect.poll(() => api.reads.filter(path => path === '/api/scheduling/board').length).toBeGreaterThan(1);
  await page.screenshot({ path: 'testsuite/reports/scheduling-local/screenshots/nav-customers-desktop.png', fullPage: true });
  await panel.getByRole('button', { name: 'Close Customers panel' }).click();
  await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`view=week&date=${date}`));
  await expect(page.getByTestId('schedule-manager-board-root')).toHaveAttribute('data-review-instance', 'retained');
  await expect(page.getByPlaceholder('Search jobs').first()).toHaveValue('Oak');
  await expect(page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111111')).toContainText('Fictional Updated Customer');
  expect(api.unexpected).toEqual([]);
});

test('customer and site creation/editing reconcile while save failures keep the form draft', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}`);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await panel.getByRole('button', { name: 'Add Customer', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Customer', exact: true });
  await form.getByLabel('Company Name', { exact: false }).fill('Fictional New Customer');
  await form.getByLabel('Contact Name', { exact: true }).fill('Fictional New Contact');
  await form.getByLabel('Email', { exact: true }).fill('new@ffts.test');
  api.panels.setFailSaves(true);
  await form.getByRole('button', { name: 'Add Customer', exact: true }).click();
  await expect(page.getByText('Fictional save failure', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Company Name', { exact: false })).toHaveValue('Fictional New Customer');
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  api.panels.setFailSaves(false);
  await form.getByRole('button', { name: 'Add Customer', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fictional New Customer', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Add site', exact: true }).click();
  const site = page.getByRole('dialog', { name: 'Add site', exact: true });
  await site.getByLabel('Site Name', { exact: false }).fill('Fictional New Yard');
  await site.getByLabel('Address Line 1', { exact: false }).fill('2 Fictional Lane');
  await site.getByRole('button', { name: 'Add site', exact: true }).click();
  await expect(site).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: /Fictional New Yard/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Customer' });
  await edit.getByLabel('Site Name', { exact: false }).fill('Fictional Edited Yard');
  await edit.getByRole('button', { name: 'Update Customer' }).click();
  await expect(edit).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: /Fictional Edited Yard/ })).toBeVisible();
  await expect.poll(() => api.reads.filter(path => path === '/api/scheduling/jobs').length).toBeGreaterThan(1);
  expect(api.panels.writes.filter(path => path.endsWith('/sites'))).toHaveLength(1);
  expect(api.unexpected).toEqual([]);
});

test('quote editing, creation and common workflow saves update scheduling resources without navigation', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}`);
  await page.getByRole('link', { name: 'Quotes', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Quotes', exact: true });
  await panel.getByRole('button', { name: 'Quick actions for LOCAL-Q-1' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: /Edit Quote/ });
  const title = edit.getByPlaceholder('e.g. Supply of Fence Panels & Accessories');
  await expect(title).toHaveValue('Fictional quote works');
  await title.fill('Fictional edited quote');
  await page.keyboard.press('Escape');
  await expect(edit).toBeVisible();
  await expect(title).toHaveValue('Fictional edited quote');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(panel.getByText('Fictional edited quote', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Quick actions for LOCAL-Q-1' }).click();
  await page.getByRole('menuitem', { name: 'Mark as Sent', exact: true }).click();
  await expect(panel.getByRole('button', { name: /LOCAL-Q-1 Confirmed/ })).toBeVisible();
  await panel.getByRole('button', { name: 'New Quote', exact: true }).click();
  const create = page.getByRole('dialog', { name: /New Quote/ });
  await create.getByRole('button', { name: 'Select customer', exact: true }).click();
  await create.getByRole('button', { name: /Fictional Customer contact@ffts.test/ }).click();
  await expect(create.getByRole('combobox').filter({ hasText: 'Sample Manager (ST)' })).toBeVisible();
  await create.getByPlaceholder('e.g. Supply of Fence Panels & Accessories').fill('Fictional created quote');
  await create.getByPlaceholder('Brief customer-facing summary').fill('Fictional created summary');
  await create.getByPlaceholder('Describe the included scope of works').fill('Fictional created scope');
  await create.getByLabel('Site address', { exact: true }).fill('1 Fictional Lane');
  await create.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(panel.getByText('Fictional created quote', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close Quotes panel' }).click();
  await expect(page.getByTestId('schedule-resources-panel').getByText('Fictional edited quote', { exact: true })).toBeVisible();
  await expect(page.getByTestId('schedule-resources-panel').getByText('Fictional created quote', { exact: true })).toBeVisible();
  expect(api.panels.writes.filter(path => path.startsWith('PATCH /api/quotes'))).toHaveLength(2);
  expect(api.panels.writes.filter(path => path === 'POST /api/quotes')).toHaveLength(1);
  expect(api.unexpected).toEqual([]);
});

test('saved result survives a failed panel refresh', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}`);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await panel.getByRole('button', { name: /Fictional Customer/ }).click();
  await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
  const form = page.getByRole('dialog', { name: 'Edit Customer' });
  await form.getByLabel('Company Name', { exact: false }).fill('Fictional Saved Despite Refresh');
  api.panels.setFailReads(true);
  await form.getByRole('button', { name: 'Update Customer' }).click();
  await expect(form).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fictional Saved Despite Refresh' })).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Changes saved. Refresh failed');
  api.panels.setFailReads(false);
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByRole('alert')).not.toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('module denial and independent sensitive locks do not reveal panel data', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}&deny=customers`);
  await expect(page.getByText('Weekly job board', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand menu', exact: true }).click();
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  let panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await expect(panel.getByRole('alert')).toHaveText('You do not have access to customers.');
  expect(api.panels.reads.some(path => path.includes('/api/customers'))).toBe(false);
  await panel.getByRole('button', { name: 'Close Customers panel' }).click();
  api.panels.locked.add('quotes');
  await page.getByRole('link', { name: 'Quotes', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Quotes', exact: true });
  await expect(panel.getByText(/sensitive access PIN to unlock Quotes/)).toBeVisible();
  expect(api.panels.reads).not.toContain('GET /api/quotes');
  await expect(panel.getByText('Fictional quote works', { exact: true })).toHaveCount(0);
});

test('sensitive expiry unmounts exposed data and nested quote dialogs', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  api.panels.expiries.set('quotes', new Date(Date.now() + 5000).toISOString());
  await page.goto(`/?date=${date}`);
  await page.getByRole('link', { name: 'Quotes', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Quotes', exact: true, includeHidden: true });
  await panel.getByRole('button', { name: /LOCAL-Q-1 Draft/ }).click();
  await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2);
  await expect(panel.getByText(/sensitive access PIN to unlock Quotes/)).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(1);
  await expect(panel.getByText('Fictional quote works', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close Quotes panel' }).click();
  api.panels.expiries.set('customers', new Date(Date.now() - 1000).toISOString());
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const customers = page.getByRole('dialog', { name: 'Customers', exact: true });
  await expect(customers.getByText(/sensitive access PIN to unlock Customers/)).toBeVisible();
  await expect(customers.getByText('Fictional Customer', { exact: true })).toHaveCount(0);
});

test('a rejected sensitive write unmounts protected customer contents and draft', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}`);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true, includeHidden: true });
  await panel.getByRole('button', { name: 'Add Customer', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Customer', exact: true });
  await form.getByLabel('Company Name', { exact: false }).fill('Fictional locked draft');
  api.panels.locked.add('customers');
  await form.getByRole('button', { name: 'Add Customer', exact: true }).click();
  await expect(panel.getByText(/sensitive access PIN to unlock Customers/)).toBeVisible();
  await expect(page.getByLabel('Company Name', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('Fictional Customer', { exact: true })).toHaveCount(0);
  expect(api.panels.writes.filter(path => path === 'POST /api/customers')).toHaveLength(1);
  expect(api.unexpected).toEqual([]);
});

test('panel reconciliation refreshes job options without resetting an unsaved scheduling draft', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?date=${date}`);
  await page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111111').click();
  const form = page.getByRole('dialog', { name: 'Edit scheduled job' });
  const minutes = form.getByLabel('Estimated minutes', { exact: true });
  await minutes.fill('777');
  const reads = api.reads.filter(path => path === '/api/scheduling/jobs').length;
  await page.evaluate(() => window.dispatchEvent(new Event('ffts:scheduling-panel-saved')));
  await expect.poll(() => api.reads.filter(path => path === '/api/scheduling/jobs').length).toBeGreaterThan(reads);
  await expect(minutes).toHaveValue('777');
  await expect(form).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('normal sidebar navigation outside scheduling is not intercepted', async ({ page }) => {
  await mockScheduling(page, 200, true);
  await page.goto(`/dashboard?date=${date}`);
  await page.getByRole('link', { name: 'Quotes', exact: true }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByTestId('scheduling-nav-panel')).toHaveCount(0);
});

test('panel saves defer protected scheduling reads until a pending job edit settles', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  await page.route('**/api/scheduling/jobs/11111111-1111-4111-8111-111111111111', async route => {
    pending = true;
    const input = route.request().postDataJSON();
    await gate;
    Object.assign(api.jobs[0], input);
    Object.assign(api.board.jobs[0], input);
    await route.fulfill({ json: { job: api.jobs[0] } });
  });
  try {
    await page.goto(`/?date=${date}`);
    await page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111111').click();
    const jobForm = page.getByRole('dialog', { name: 'Edit scheduled job' });
    await jobForm.getByLabel('Estimated minutes', { exact: true }).fill('240');
    await jobForm.getByRole('button', { name: 'Save job', exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    await expect(jobForm).not.toBeVisible();
    const boardReads = api.reads.filter(path => path === '/api/scheduling/board').length;
    const quoteReads = api.reads.filter(path => path === '/api/scheduling/quotes').length;
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
    await panel.getByRole('button', { name: /Fictional Customer/ }).click();
    await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
    const customerForm = page.getByRole('dialog', { name: 'Edit Customer' });
    await customerForm.getByLabel('Company Name', { exact: false }).fill('Fictional Concurrent Customer');
    await customerForm.getByRole('button', { name: 'Update Customer' }).click();
    await expect(customerForm).not.toBeVisible();
    await expect.poll(() => api.reads.filter(path => path === '/api/scheduling/quotes').length).toBeGreaterThan(quoteReads);
    expect(api.reads.filter(path => path === '/api/scheduling/board')).toHaveLength(boardReads);
    release();
    await expect.poll(() => api.reads.filter(path => path === '/api/scheduling/board').length).toBeGreaterThan(boardReads);
    await panel.getByRole('button', { name: 'Close Customers panel' }).click();
    const job = page.getByTestId('schedule-resource-job-11111111-1111-4111-8111-111111111111');
    await expect(job).toContainText('4 hours');
    await expect(job).toContainText('Fictional Concurrent Customer');
    expect(api.unexpected).toEqual([]);
  } finally { release(); }
});

test('a failed context reconciliation preserves the board but an explicit access denial does not', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  let contextStatus = 200;
  await page.route('**/api/scheduling/context', async route => {
    await route.fulfill(contextStatus === 200
      ? api.respond(new URL(route.request().url()), 'GET')
      : { status: contextStatus, json: { error: 'Fictional access refresh failure' } });
  });
  await page.goto(`/?date=${date}`);
  const board = page.getByTestId('schedule-manager-board-root');
  await expect(board).toBeVisible();
  await board.evaluate(element => element.setAttribute('data-review-instance', 'retained'));
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await panel.getByRole('button', { name: /Fictional Customer/ }).click();
  await panel.getByRole('button', { name: 'Edit customer & sites' }).click();
  const form = page.getByRole('dialog', { name: 'Edit Customer' });
  await form.getByLabel('Company Name', { exact: false }).fill('Fictional Context Save');
  contextStatus = 503;
  await form.getByRole('button', { name: 'Update Customer' }).click();
  await expect(form).not.toBeVisible();
  await panel.getByRole('button', { name: 'Close Customers panel' }).click();
  await expect(page.getByRole('alert')).toContainText('Your current schedule is retained.');
  await expect(board).toHaveAttribute('data-review-instance', 'retained');
  contextStatus = 403;
  await page.getByRole('button', { name: 'Retry access check' }).click();
  await expect(board).toHaveCount(0);
  await expect(page.getByText('Scheduling access could not be checked', { exact: true })).toBeVisible();
});

test('quote panel loads real details and adapts to small screens', async ({ page }) => {
  const api = await mockScheduling(page, 200, true);
  await page.goto(`/?view=week&date=${date}`);
  await page.getByRole('link', { name: 'Quotes', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Quotes', exact: true });
  await expect(panel.getByText('Fictional quote works', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /LOCAL-Q-1/ }).first().click();
  await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2);
  await expect(page.getByRole('dialog').last()).toContainText('Fictional quote works');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeInViewport();
  const portrait = await panel.boundingBox();
  expect(portrait?.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'testsuite/reports/scheduling-local/screenshots/nav-quotes-portrait.png', fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = await panel.boundingBox();
  expect(landscape!.x + landscape!.width).toBeLessThanOrEqual(844);
  expect(landscape!.y + landscape!.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'testsuite/reports/scheduling-local/screenshots/nav-quotes-landscape.png', fullPage: true });
  expect(api.unexpected).toEqual([]);
});
