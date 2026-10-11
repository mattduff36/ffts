import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/training/profile-options/route';

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

const REAL_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HIDDEN_AUTH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('GET /api/training/profile-options', () => {
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

  it('rejects callers without admin training access', async () => {
    mockRequireTrainingAdminAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Admin Training access required',
    });

    const response = await GET(new NextRequest('http://localhost/api/training/profile-options'));

    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns only eligible id, name, and employee id', async () => {
    const rows = [
      { id: REAL_PROFILE_ID, full_name: 'Ada Lovelace', employee_id: 'EMP-1', is_placeholder: false, email: 'ada@example.com', phone_number: '07000000000' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Placeholder Pat', employee_id: 'PH-1', is_placeholder: true },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', full_name: 'Old Name (Deleted User)', employee_id: 'DEL-1', is_placeholder: false },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', full_name: 'Testsuite Admin', employee_id: 'TS-ADM', is_placeholder: false },
      { id: HIDDEN_AUTH_ID, full_name: 'Hidden Auth User', employee_id: 'HID-1', is_placeholder: false },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [{ id: HIDDEN_AUTH_ID, email: 'testsuite-admin@ffts.test' }] },
      error: null,
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
      auth: { admin: { listUsers } },
    });

    const response = await GET(new NextRequest('http://localhost/api/training/profile-options'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('is_placeholder', false);
    expect(select).toHaveBeenCalledWith('id, full_name, employee_id, is_placeholder');
    expect(payload.profiles).toEqual([
      { id: REAL_PROFILE_ID, full_name: 'Ada Lovelace', employee_id: 'EMP-1' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('ada@example.com');
    expect(JSON.stringify(payload)).not.toContain('phone_number');
  });
});
