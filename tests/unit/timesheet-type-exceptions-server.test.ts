import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertTimesheetTypeException } from '@/lib/server/timesheet-type-exceptions';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

describe('upsertTimesheetTypeException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not send created_by in upsert payload', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    await upsertTimesheetTypeException({
      profile_id: 'profile-1',
      timesheet_type: 'plant',
      actor_id: 'admin-1',
    });

    expect(from).toHaveBeenCalledWith('timesheet_type_exceptions');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'profile-1',
        timesheet_type: 'plant',
        updated_by: 'admin-1',
      }),
      { onConflict: 'profile_id' }
    );
    const [payload] = upsert.mock.calls[0];
    expect(payload).not.toHaveProperty('created_by');
  });

  it('supports user_choice in upsert payloads', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    await upsertTimesheetTypeException({
      profile_id: 'profile-1',
      timesheet_type: 'user_choice',
      actor_id: 'admin-1',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'profile-1',
        timesheet_type: 'user_choice',
        updated_by: 'admin-1',
      }),
      { onConflict: 'profile_id' }
    );
  });
});
