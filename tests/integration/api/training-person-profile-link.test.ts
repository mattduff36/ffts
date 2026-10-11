import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/training/people/[id]/route';

const { mockCreateAdminClient, mockRequireTrainingAdminAccess, mockLogServerError } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockRequireTrainingAdminAccess: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/training-auth', () => ({
  requireTrainingAdminAccess: mockRequireTrainingAdminAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

const PERSON_ID = 'person-1';
const CURRENT_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT_PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/training/people/${PERSON_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockAdmin(options: {
  currentProfileId?: string | null;
  personFound?: boolean;
  profile?: { id: string; full_name: string; employee_id: string | null; is_placeholder: boolean } | null;
  hiddenUsers?: Array<{ id: string; email: string }>;
}) {
  const updateSingle = vi.fn().mockResolvedValue({
    data: { id: PERSON_ID, profile_id: options.currentProfileId ?? null },
    error: null,
  });
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ single: updateSingle })),
    })),
  }));
  const personMaybeSingle = vi.fn().mockResolvedValue({
    data: options.personFound === false ? null : { profile_id: options.currentProfileId ?? null },
    error: null,
  });
  const profileMaybeSingle = vi.fn().mockResolvedValue({
    data: options.profile === undefined
      ? { id: NEXT_PROFILE_ID, full_name: 'Ada Lovelace', employee_id: 'EMP-1', is_placeholder: false }
      : options.profile,
    error: null,
  });
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: profileMaybeSingle })),
        })),
      };
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: personMaybeSingle })),
      })),
      update,
    };
  });
  mockCreateAdminClient.mockReturnValue({
    from,
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: options.hiddenUsers || [] },
          error: null,
        }),
      },
    },
  });
  return { update, profileMaybeSingle };
}

describe('PATCH /api/training/people/[id] profile link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireTrainingAdminAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-1',
      isAdminLevel: true,
    });
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('rejects non-admin callers', async () => {
    mockRequireTrainingAdminAccess.mockResolvedValue({
      allowed: false,
      status: 401,
      error: 'Unauthorized',
    });

    const response = await PATCH(patchRequest({ profile_id: NEXT_PROFILE_ID }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });

    expect(response.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid profile id before writing', async () => {
    const { update } = mockAdmin({ currentProfileId: null });

    const response = await PATCH(patchRequest({ profile_id: 'not-a-uuid' }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a profile that is missing, placeholder, or a hidden test account', async () => {
    const { update } = mockAdmin({
      currentProfileId: null,
      profile: null,
    });

    const missing = await PATCH(patchRequest({ profile_id: NEXT_PROFILE_ID }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(missing.status).toBe(400);
    expect(update).not.toHaveBeenCalled();

    mockAdmin({
      currentProfileId: null,
      profile: { id: NEXT_PROFILE_ID, full_name: 'Placeholder Pat', employee_id: 'PH-1', is_placeholder: true },
    });
    const placeholder = await PATCH(patchRequest({ profile_id: NEXT_PROFILE_ID }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(placeholder.status).toBe(400);

    mockAdmin({
      currentProfileId: null,
      profile: { id: NEXT_PROFILE_ID, full_name: 'Testsuite Admin', employee_id: 'TS-ADM', is_placeholder: false },
    });
    const hidden = await PATCH(patchRequest({ profile_id: NEXT_PROFILE_ID }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(hidden.status).toBe(400);
  });

  it('keeps an unchanged historical link and accepts a new eligible link or unlink', async () => {
    const historical = mockAdmin({
      currentProfileId: CURRENT_PROFILE_ID,
      profile: null,
    });
    const unchanged = await PATCH(patchRequest({ profile_id: CURRENT_PROFILE_ID, employee_name_raw: 'Imported Name' }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(unchanged.status).toBe(200);
    expect(historical.profileMaybeSingle).not.toHaveBeenCalled();
    expect(historical.update).toHaveBeenCalledWith(expect.objectContaining({
      profile_id: CURRENT_PROFILE_ID,
      employee_name_raw: 'Imported Name',
    }));

    const eligible = mockAdmin({ currentProfileId: null });
    const linked = await PATCH(patchRequest({ profile_id: NEXT_PROFILE_ID }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(linked.status).toBe(200);
    expect(eligible.update).toHaveBeenCalledWith(expect.objectContaining({ profile_id: NEXT_PROFILE_ID }));

    const cleared = mockAdmin({ currentProfileId: CURRENT_PROFILE_ID });
    const unlinked = await PATCH(patchRequest({ profile_id: '' }), {
      params: Promise.resolve({ id: PERSON_ID }),
    });
    expect(unlinked.status).toBe(200);
    expect(cleared.update).toHaveBeenCalledWith(expect.objectContaining({ profile_id: null }));
  });
});
