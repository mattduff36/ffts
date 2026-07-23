import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockLoadTags,
  mockRemoveRpc,
  mockResolveSite,
  mockSensitiveAccess,
  mockSyncProjectLocation,
  mockCreateRpc,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockLoadTags: vi.fn(),
  mockRemoveRpc: vi.fn(),
  mockResolveSite: vi.fn(),
  mockSensitiveAccess: vi.fn(),
  mockSyncProjectLocation: vi.fn(),
  mockCreateRpc: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
  requireSchedulingAccess: vi.fn(),
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockSensitiveAccess,
}));

vi.mock('@/lib/server/customer-sites', () => ({
  resolveCustomerSiteSelection: mockResolveSite,
}));

vi.mock('@/lib/server/scheduling-tags', () => ({
  loadScheduleJobTags: vi.fn(),
  loadTagsForScheduleJob: mockLoadTags,
  syncScheduleJobTags: vi.fn(),
}));

vi.mock('@/lib/server/inventory-site-location-sync', () => ({
  syncProjectNumberSiteLocation: mockSyncProjectLocation,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'create_project_schedule_job') return mockCreateRpc(args);
      if (name === 'remove_schedule_job') return mockRemoveRpc(args);
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'quote_project_numbers') {
              return {
                data: {
                  id: 'project-1',
                  project_reference: '60001-MD',
                  title: 'Emergency works',
                  status: 'open',
                },
                error: null,
              };
            }
            if (table === 'schedule_jobs') {
              return {
                data: {
                  id: 'job-1',
                  job_reference: '60001-MD',
                  source_type: 'manual',
                  quote_project_number_id: 'project-1',
                },
                error: null,
              };
            }
            throw new Error(`Unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

const params = {
  params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
};

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validCreateBody() {
  return {
    manager_profile_id: '22222222-2222-4222-8222-222222222222',
    project_title: 'Emergency works',
    project_description: 'Make safe',
    project_notes: 'Created in Scheduling',
    customer_id: '33333333-3333-4333-8333-333333333333',
    customer_site_id: null,
    site_address: 'Example site',
    status: 'scheduled',
    start_date: '2026-07-27',
    end_date: '2026-07-29',
    estimated_duration_minutes: 480,
    is_drop_on_ready: true,
    tag_ids: ['44444444-4444-4444-8444-444444444444'],
  };
}

describe('Project-backed scheduling job routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockSensitiveAccess.mockResolvedValue(null);
    mockResolveSite.mockResolvedValue({
      customerSiteId: null,
      siteAddress: 'Example site',
      fieldErrors: {},
    });
    mockLoadTags.mockResolvedValue([]);
    mockCreateRpc.mockResolvedValue({
      data: [{
        project_number_id: 'project-1',
        schedule_job_id: 'job-1',
        project_reference: '60001-MD',
        was_project_created: true,
      }],
      error: null,
    });
    mockRemoveRpc.mockResolvedValue({
      data: [{
        removed_source_type: 'quote',
        removed_quote_id: 'quote-1',
        removed_project_number_id: null,
      }],
      error: null,
    });
    mockSyncProjectLocation.mockResolvedValue(undefined);
  });

  it('requires the Quotes sensitive-access boundary before creation', async () => {
    mockSensitiveAccess.mockResolvedValue(
      NextResponse.json({ error: 'Sensitive access PIN required.' }, { status: 428 })
    );
    const { POST } = await import('@/app/api/scheduling/jobs/route');
    const response = await POST(postRequest(validCreateBody()));

    expect(response.status).toBe(428);
    expect(mockCreateRpc).not.toHaveBeenCalled();
  });

  it('atomically creates a Project Number and its schedule projection', async () => {
    const { POST } = await import('@/app/api/scheduling/jobs/route');
    const response = await POST(postRequest(validCreateBody()));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockCreateRpc).toHaveBeenCalledWith(expect.objectContaining({
      p_project_number_id: null,
      p_manager_profile_id: '22222222-2222-4222-8222-222222222222',
      p_project_title: 'Emergency works',
      p_customer_id: '33333333-3333-4333-8333-333333333333',
      p_start_date: '2026-07-27',
      p_end_date: '2026-07-29',
      p_actor_user_id: 'manager-1',
    }));
    expect(mockSyncProjectLocation).toHaveBeenCalled();
    expect(payload.job.quote_project_number_id).toBe('project-1');
  });

  it('reuses an existing open Project without creating a second Project', async () => {
    mockCreateRpc.mockResolvedValue({
      data: [{
        project_number_id: 'project-existing',
        schedule_job_id: 'job-1',
        project_reference: '60002-MD',
        was_project_created: false,
      }],
      error: null,
    });
    const { POST } = await import('@/app/api/scheduling/jobs/route');
    const response = await POST(postRequest({
      ...validCreateBody(),
      project_number_id: '55555555-5555-4555-8555-555555555555',
      manager_profile_id: null,
      project_title: null,
    }));

    expect(response.status).toBe(201);
    expect(mockCreateRpc).toHaveBeenCalledWith(expect.objectContaining({
      p_project_number_id: '55555555-5555-4555-8555-555555555555',
      p_manager_profile_id: null,
    }));
    expect(mockSyncProjectLocation).not.toHaveBeenCalled();
  });

  it('uses the transactional removal function for Quote-backed jobs', async () => {
    const { DELETE } = await import('@/app/api/scheduling/jobs/[id]/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/scheduling/jobs/job-1', { method: 'DELETE' }),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockRemoveRpc).toHaveBeenCalledWith({
      p_job_id: '11111111-1111-4111-8111-111111111111',
      p_actor_user_id: 'manager-1',
    });
    expect(payload).toMatchObject({
      success: true,
      source_type: 'quote',
      quote_id: 'quote-1',
    });
  });

  it('returns Project provenance without deleting the Project source', async () => {
    mockRemoveRpc.mockResolvedValue({
      data: [{
        removed_source_type: 'manual',
        removed_quote_id: null,
        removed_project_number_id: 'project-1',
      }],
      error: null,
    });
    const { DELETE } = await import('@/app/api/scheduling/jobs/[id]/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/scheduling/jobs/job-1', { method: 'DELETE' }),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      source_type: 'manual',
      quote_id: null,
      project_number_id: 'project-1',
    });
  });
});
