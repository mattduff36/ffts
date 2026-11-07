import type { Page } from '@playwright/test';
import type { ScheduleAssignment, ScheduleJob, SchedulingBoardPayload } from '@/types/scheduling';
import { buildScheduleDayTeams, SCHEDULE_DAY_TEAM_SLOT_INDEXES } from '@/lib/utils/scheduling-day-teams';
import { createPanelFixture } from './panel-fixture';

export const userId = '33333333-3333-4333-8333-333333333333';
export const employeeId = '22222222-2222-4222-8222-222222222222';
export const date = '2026-11-05';
const now = `${date}T08:00:00.000Z`;

export function fixture() {
  const employees = Array.from({ length: 16 }, (_, index) => ({
    id: index === 0 ? employeeId : `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    full_name: ['Sam Taylor', 'Alex Green', 'Robin Reed', 'Casey Wood'][index % 4] + (index > 3 ? ` ${index}` : ''),
    employee_id: `LOCAL-${index + 1}`, team_id: null, team_name: null, kind: 'employee' as const,
  }));
  const job: ScheduleJob = {
    id: '11111111-1111-4111-8111-111111111111', job_reference: 'LOCAL-60001',
    title: 'Oak crown reduction', description: null, site_address: 'Fictional test yard',
    status: 'in_progress', source_type: 'manual', start_date: '2026-11-02', end_date: '2026-11-08',
    estimated_duration_minutes: 180, required_staff_count: 3, quote_id: null,
    quote_project_number_id: '77777777-7777-4777-8777-777777777777',
    customer_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customer_site_id: null,
    customer_name: 'Fictional Customer', is_drop_on_ready: false, tags: [],
    created_by: userId, updated_by: userId, created_at: now, updated_at: now,
  };
  const visit = {
    id: '44444444-4444-4444-8444-444444444444', job_id: job.id, sequence_number: 1,
    title: 'Tree works', starts_at: `${date}T08:00:00.000Z`, ends_at: `${date}T11:00:00.000Z`,
    status: 'planned' as const, notes: null, created_by: userId, updated_by: userId, created_at: now, updated_at: now,
  };
  const assignment: ScheduleAssignment = {
    id: '55555555-5555-4555-8555-555555555555', job_id: job.id, visit_id: visit.id,
    work_date: date, resource_type: 'employee', profile_id: employeeId, employee: employees[0],
    notes: null, conflict_override: false, conflict_codes: [], conflict_override_by: null,
    conflict_override_at: null, assigned_by: userId, created_at: now, updated_at: now,
    conflicts: [], visit,
  };
  const teamSettings = { visible_slot_count: 16, leaders: [], updated_by: userId, updated_at: now };
  const members = SCHEDULE_DAY_TEAM_SLOT_INDEXES.map((slotIndex, index) => ({
    work_date: date, slot_index: slotIndex, profile_id: employees[index].id,
    employee: employees[index], added_by: userId, created_at: now,
  }));
  const board: SchedulingBoardPayload = {
    week: { start: '2026-11-02', end: '2026-11-08' },
    jobs: [job], visits: [visit], assignments: [
      assignment,
      { ...assignment, id: '55555555-5555-4555-8555-555555555556', work_date: '2026-11-06' },
      { ...assignment, id: '55555555-5555-4555-8555-555555555557', profile_id: employees[1].id, employee: employees[1] },
    ],
    resources: { employees, plant: [] }, tags: [], employee_capacity: [],
    plant_unavailability: [], team_settings: teamSettings,
    day_teams: buildScheduleDayTeams([date, '2026-11-06'], [...members, { ...members[0], work_date: '2026-11-06' }], teamSettings),
  };
  return { board, jobs: [
    job,
    { ...job, id: '11111111-1111-4111-8111-111111111112', job_reference: 'LOCAL-EXPIRED',
      title: 'Unfinished expired work', start_date: '2020-01-01', end_date: '2020-01-01', estimated_duration_minutes: 15 },
    { ...job, id: '11111111-1111-4111-8111-111111111113', job_reference: 'LOCAL-COMPLETE', status: 'completed' as const },
  ] };
}

export function createFixtureApi(removalStatus = 200, withPanels = false) {
  const data = fixture();
  const panels = createPanelFixture();
  const removals: URL[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  const unexpected: string[] = [];
  function respond(url: URL, method: string, body?: unknown): { status: number; json: unknown } {
    if (method === 'GET') reads.push(url.pathname);
    if (url.pathname.startsWith('/api/sensitive-access') || (withPanels && (url.pathname.startsWith('/api/customers') || url.pathname.startsWith('/api/quotes')))) {
      const response = panels.respond(url, method, body as Record<string, unknown> | undefined);
      if (response) return response;
    }
    if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
    if (method !== 'GET' && method !== 'PATCH' && method !== 'DELETE') {
      unexpected.push(`${method} ${url.pathname}`);
      return { status: 501, json: { error: 'Creating records is disabled in this local fixture preview.' } };
    }
    let payload: unknown;
    if (url.pathname.startsWith('/api/scheduling/jobs/') && method === 'PATCH') {
      const jobId = url.pathname.split('/').at(-1);
      const job = data.jobs.find((item) => item.id === jobId);
      if (!job || !body || typeof body !== 'object' || !('status' in body) || body.status !== 'completed') {
        return { status: 422, json: { error: 'Local fixture supports marking an existing job Completed only.' } };
      }
      job.status = 'completed';
      const boardJob = data.board.jobs.find((item) => item.id === jobId);
      if (boardJob) boardJob.status = 'completed';
      payload = { job };
    }
    else if (url.pathname === '/api/scheduling/context' && method === 'GET') payload = {
      user_id: userId, access_level: 4, is_manager_or_admin: true, role_name: 'manager', role_class: 'manager', team_id: null, team_name: null,
    };
    else if (url.pathname === '/api/scheduling/board' && method === 'GET') payload = {
      ...data.board, jobs: data.board.jobs.map(job => ({ ...job, customer_name: panels.customers.find(customer => customer.id === job.customer_id)?.company_name || job.customer_name })),
    };
    else if (url.pathname === '/api/scheduling/jobs' && method === 'GET') payload = {
      jobs: data.jobs.map(job => ({ ...job, customer_name: panels.customers.find(customer => customer.id === job.customer_id)?.company_name || job.customer_name })), tags: [],
      customers: withPanels ? panels.customers : [{ id: data.jobs[0].customer_id, company_name: 'Fictional Customer', status: 'active', sites: [] }],
    };
    else if (url.pathname === '/api/scheduling/quotes' && method === 'GET') payload = { quotes: withPanels ? panels.quotes.map(quote => ({
      id: quote.id, quote_reference: quote.quote_reference, base_quote_reference: quote.base_quote_reference,
      title: quote.subject_line, customer_name: panels.customers.find(customer => customer.id === quote.customer_id)?.company_name,
      site_name: panels.customers.flatMap(customer => customer.sites).find(site => site.id === quote.customer_site_id)?.site_name,
      status: quote.status, start_date: null, end_date: null, estimated_duration_days: 1, estimated_duration_minutes: 60,
    })) : [] };
    else if (url.pathname === '/api/scheduling/projects' && method === 'GET') payload = { projects: [] };
    else if (url.pathname === '/api/scheduling/visit-backlog' && method === 'GET') payload = { items: [] };
    else if (url.pathname === '/api/quotes/metadata' && method === 'GET') payload = {
      managerOptions: [{ profile_id: userId, initials: 'ST', is_active: true, profile: { full_name: 'Sample Manager' } }],
    };
    else if (url.pathname === '/api/scheduling/day-teams' && method === 'DELETE') {
      removals.push(url);
      if (removalStatus !== 200) {
        return { status: removalStatus, json: { error: 'Removal denied by fixture' } };
      }
      const profileId = url.searchParams.get('profile_id');
      const workDate = url.searchParams.get('work_date');
      data.board.day_teams.forEach((day) => {
        if (day.date === workDate) day.slots.forEach((slot) => { slot.members = slot.members.filter((member) => member.profile_id !== profileId); });
      });
      data.board.assignments = data.board.assignments.filter((item) =>
        !(item.resource_type === 'employee' && item.profile_id === profileId && item.work_date === workDate)
      );
      payload = { success: true };
    } else {
      unexpected.push(`${method} ${url.pathname}`);
      return { status: 501, json: { error: 'Unconfigured local fixture route' } };
    }
    return { status: 200, json: payload };
  }
  return { ...data, panels, removals, writes, reads, unexpected, respond };
}

export async function mockScheduling(page: Page, removalStatus = 200, withPanels = false) {
  const api = createFixtureApi(removalStatus, withPanels);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4017') {
      api.unexpected.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    return route.fulfill(api.respond(url, request.method(), request.postDataJSON()));
  });
  return api;
}

export function installReviewFixtures() {
  const api = createFixtureApi(200, new URLSearchParams(location.search).has('panels'));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href), init);
    const url = new URL(request.url);
    if (url.origin !== location.origin) throw new Error('External requests are disabled in the scheduling fixture preview.');
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    const body = request.method === 'PATCH' || request.method === 'POST' ? await request.json() : undefined;
    const response = api.respond(url, request.method, body);
    return Response.json(response.json, { status: response.status });
  };
}
