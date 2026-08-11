import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockLoadBacklog,
  mockLoadTags,
  mockRpc,
  mockVisitSingle,
  mockJobSingle,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockLoadBacklog: vi.fn(),
  mockLoadTags: vi.fn(),
  mockRpc: vi.fn(),
  mockVisitSingle: vi.fn(),
  mockJobSingle: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));

vi.mock('@/lib/server/scheduling-visit-backlog', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/server/scheduling-visit-backlog')
  >('@/lib/server/scheduling-visit-backlog');
  return {
    ...actual,
    loadScheduleVisitBacklog: mockLoadBacklog,
  };
});

vi.mock('@/lib/server/scheduling-tags', () => ({
  loadTagsForScheduleJob: mockLoadTags,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === 'schedule_visits' ? mockVisitSingle : mockJobSingle,
        }),
      }),
    }),
  }),
}));

const visitId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const params = { params: Promise.resolve({ id: visitId }) };

function postRequest(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('scheduling visit backlog routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockLoadBacklog.mockResolvedValue([{
      visit_id: visitId,
      job_id: 'job-1',
      job_reference: '99108-SD',
      job_title: 'Thinning programme',
      source_type: 'sample',
      customer_name: 'Sample customer',
      sequence_number: 2,
      title: 'Second visit',
      notes: null,
      original_starts_at: '2026-08-12T07:00:00.000Z',
      original_ends_at: '2026-08-12T11:00:00.000Z',
      duration_milliseconds: 14_400_000,
      duration_minutes: 240,
      queued_at: '2026-08-11T00:00:00.000Z',
    }]);
    mockLoadTags.mockResolvedValue([]);
    mockVisitSingle.mockResolvedValue({
      data: {
        id: visitId,
        job_id: 'job-1',
        sequence_number: 2,
        starts_at: '2026-08-13T07:00:00.000Z',
        ends_at: '2026-08-13T11:00:00.000Z',
        status: 'planned',
      },
      error: null,
    });
    mockJobSingle.mockResolvedValue({
      data: {
        id: 'job-1',
        job_reference: '99108-SD',
        title: 'Thinning programme',
        source_type: 'sample',
        customer: { company_name: 'Sample customer' },
      },
      error: null,
    });
  });

  it('loads returned visits independently of the board week', async () => {
    const { GET } = await import('@/app/api/scheduling/visit-backlog/route');
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ visit_id: visitId, job_reference: '99108-SD' }],
    });
  });

  it('previews an authoritative assignment count and fingerprint', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        visit_id: visitId,
        job_id: 'job-1',
        job_reference: '99108-SD',
        sequence_number: 2,
        assignment_count: 3,
        fingerprint: 'preview-hash',
        already_queued: false,
      }],
      error: null,
    });
    const { GET } = await import('@/app/api/scheduling/visits/[id]/backlog/route');
    const response = await GET(
      new NextRequest(`http://localhost/api/scheduling/visits/${visitId}/backlog`),
      params
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      preview: { assignment_count: 3, fingerprint: 'preview-hash' },
    });
  });

  it('returns only the confirmed visit to Jobs', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        visit_id: visitId,
        job_id: 'job-1',
        assignment_count: 3,
        queued_at: '2026-08-11T00:00:00.000Z',
      }],
      error: null,
    });
    const { POST } = await import('@/app/api/scheduling/visits/[id]/backlog/route');
    const response = await POST(
      postRequest(
        `http://localhost/api/scheduling/visits/${visitId}/backlog`,
        { request_id: requestId, expected_fingerprint: 'preview-hash' }
      ),
      params
    );

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('enqueue_schedule_visit_v1', {
      p_request_id: requestId,
      p_visit_id: visitId,
      p_expected_fingerprint: 'preview-hash',
      p_actor_user_id: 'manager-1',
    });
  });

  it('rejects a stale confirmation without reporting success', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'STALE_VISIT_PREVIEW' },
    });
    const { POST } = await import('@/app/api/scheduling/visits/[id]/backlog/route');
    const response = await POST(
      postRequest(
        `http://localhost/api/scheduling/visits/${visitId}/backlog`,
        { request_id: requestId, expected_fingerprint: 'old-hash' }
      ),
      params
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'stale_visit_preview' });
  });

  it('reschedules the same queued visit identity', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        visit_id: visitId,
        job_id: 'job-1',
        starts_at: '2026-08-13T07:00:00.000Z',
        ends_at: '2026-08-13T11:00:00.000Z',
      }],
      error: null,
    });
    const { POST } = await import(
      '@/app/api/scheduling/visit-backlog/[id]/schedule/route'
    );
    const response = await POST(
      postRequest(
        `http://localhost/api/scheduling/visit-backlog/${visitId}/schedule`,
        {
          request_id: requestId,
          starts_at: '2026-08-13T07:00:00.000Z',
        }
      ),
      params
    );

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('schedule_queued_visit_v1', {
      p_request_id: requestId,
      p_visit_id: visitId,
      p_starts_at: '2026-08-13T07:00:00.000Z',
      p_actor_user_id: 'manager-1',
    });
    await expect(response.json()).resolves.toMatchObject({
      visit: { id: visitId },
      job: { id: 'job-1', customer_name: 'Sample customer' },
    });
  });

  it('rejects non-manager backlog access', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { GET } = await import('@/app/api/scheduling/visit-backlog/route');
    const response = await GET();

    expect(response.status).toBe(403);
    expect(mockLoadBacklog).not.toHaveBeenCalled();
  });
});
