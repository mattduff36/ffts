import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockGenerateQuoteReferenceForManager,
  mockGetInitialsFromName,
  mockGetQuoteManagerOption,
  mockSyncProjectNumberSiteLocation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockGenerateQuoteReferenceForManager: vi.fn(),
  mockGetInitialsFromName: vi.fn(),
  mockGetQuoteManagerOption: vi.fn(),
  mockSyncProjectNumberSiteLocation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: vi.fn(),
  calculateQuoteTotals: vi.fn(),
  generateQuoteReferenceForManager: mockGenerateQuoteReferenceForManager,
  getInitialsFromName: mockGetInitialsFromName,
  getQuoteManagerOption: mockGetQuoteManagerOption,
}));

vi.mock('@/lib/server/inventory-site-location-sync', () => ({
  syncProjectNumberSiteLocation: mockSyncProjectNumberSiteLocation,
}));

describe('POST /api/quotes/project-numbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
    mockGetQuoteManagerOption.mockResolvedValue({
      profile_id: 'manager-1',
      initials: 'MD',
      signoff_name: 'Matt Duffill',
    });
    mockGetInitialsFromName.mockReturnValue('MD');
    mockGenerateQuoteReferenceForManager.mockResolvedValue({
      quoteReference: '60001-MD',
      initials: 'MD',
    });
    mockSyncProjectNumberSiteLocation.mockResolvedValue({
      action: 'created',
      location_id: 'site-location-1',
      external_reference: '60001-MD',
    });
  });

  it('reserves a quote-series reference for a provisional project number', async () => {
    const profileSingle = vi.fn().mockResolvedValue({
      data: { id: 'manager-1', full_name: 'Matt Duffill' },
      error: null,
    });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });
    const projectSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'project-1',
        project_reference: '60001-MD',
        manager_profile_id: 'manager-1',
        title: 'Emergency enabling works',
        status: 'open',
      },
      error: null,
    });
    const projectSelect = vi.fn().mockReturnValue({ single: projectSingle });
    const projectInsert = vi.fn().mockReturnValue({ select: projectSelect });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: profileEq,
            })),
          };
        }

        if (table === 'quote_project_numbers') {
          return {
            insert: projectInsert,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('@/app/api/quotes/project-numbers/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/project-numbers', {
      method: 'POST',
      body: JSON.stringify({
        manager_profile_id: 'manager-1',
        title: 'Emergency enabling works',
        description: 'Costs before customer is confirmed',
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockGenerateQuoteReferenceForManager).toHaveBeenCalledWith({
      managerProfileId: 'manager-1',
      fallbackInitials: 'MD',
    });
    expect(projectInsert).toHaveBeenCalledWith(expect.objectContaining({
      project_reference: '60001-MD',
      manager_profile_id: 'manager-1',
      requester_initials: 'MD',
      title: 'Emergency enabling works',
      created_by: 'user-1',
    }));
    expect(mockSyncProjectNumberSiteLocation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: 'project-1',
        project_reference: '60001-MD',
        title: 'Emergency enabling works',
        status: 'open',
      }),
      'user-1'
    );
    expect(payload.project.project_reference).toBe('60001-MD');
  });

  it('returns field errors when required project fields are missing', async () => {
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() });

    const { POST } = await import('@/app/api/quotes/project-numbers/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/project-numbers', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.field_errors).toEqual({
      manager_profile_id: 'Select a manager.',
      title: 'Enter a project title.',
    });
    expect(mockGenerateQuoteReferenceForManager).not.toHaveBeenCalled();
  });
});
