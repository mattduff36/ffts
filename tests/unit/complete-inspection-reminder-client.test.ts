import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeInspectionReminder } from '@/lib/client/complete-inspection-reminder';
import { getErrorStatus } from '@/lib/utils/http-error';

describe('completeInspectionReminder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a status error with string API messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }));

    await expect(
      completeInspectionReminder({
        assetType: 'van',
        assetId: 'van-1',
        assignedTo: '00000000-0000-0000-0000-000000000001',
      })
    ).rejects.toMatchObject({ message: 'Forbidden', status: 403 });
  });

  it('normalizes object-shaped API errors instead of throwing [object Object]', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Reminder action update failed' } }),
    }));

    await expect(
      completeInspectionReminder({
        assetType: 'van',
        assetId: 'van-1',
        assignedTo: '00000000-0000-0000-0000-000000000001',
      })
    ).rejects.toThrow('Reminder action update failed');
  });

  it('preserves response status for page-level error classification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    }));

    try {
      await completeInspectionReminder({
        assetType: 'plant',
        assetId: 'plant-1',
        assignedTo: '00000000-0000-0000-0000-000000000001',
      });
      throw new Error('Expected completeInspectionReminder to throw');
    } catch (error) {
      expect(getErrorStatus(error)).toBe(401);
    }
  });
});
