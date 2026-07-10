import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/training/records/[id]/route';

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

describe('PATCH /api/training/records/[id]', () => {
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

  it('rejects invalid record statuses before updating the database', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/training/records/record-1', {
        method: 'PATCH',
        body: JSON.stringify({ record_status: 'deleted' }),
      }),
      { params: Promise.resolve({ id: 'record-1' }) }
    );

    expect(response.status).toBe(400);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('normalizes editable dates and stores the admin updater id', async () => {
    const updatedRecord = {
      id: 'record-1',
      expiry_date: '2030-11-30',
      expiry_raw: '30.11.2030',
    };
    const single = vi.fn().mockResolvedValue({ data: updatedRecord, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    mockCreateAdminClient.mockReturnValue({ from });

    const response = await PATCH(
      new NextRequest('http://localhost/api/training/records/record-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expiry_date: '30.11.2030',
          record_status: 'active',
        }),
      }),
      { params: Promise.resolve({ id: 'record-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.record).toEqual(updatedRecord);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      expiry_date: '2030-11-30',
      expiry_raw: '30.11.2030',
      record_status: 'active',
      updated_by: 'admin-1',
    }));
    expect(eq).toHaveBeenCalledWith('id', 'record-1');
  });
});
