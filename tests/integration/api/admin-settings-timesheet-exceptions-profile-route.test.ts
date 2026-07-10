import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE,
  PATCH,
} from '@/app/api/admin/settings/timesheet-exceptions/[profileId]/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/timesheet-type-exceptions');

describe('admin settings timesheet exceptions profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates an override with PATCH', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { upsertTimesheetTypeException, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: false,
      role_name: 'admin',
    } as never);
    vi.mocked(upsertTimesheetTypeException).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'plant' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(200);
    expect(upsertTimesheetTypeException).toHaveBeenCalledWith({
      profile_id: 'user-1',
      timesheet_type: 'plant',
      actor_id: 'admin-1',
    });
  });

  it('updates an override to user choice with PATCH', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { upsertTimesheetTypeException, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: false,
      role_name: 'admin',
    } as never);
    vi.mocked(upsertTimesheetTypeException).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'user_choice' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(200);
    expect(upsertTimesheetTypeException).toHaveBeenCalledWith({
      profile_id: 'user-1',
      timesheet_type: 'user_choice',
      actor_id: 'admin-1',
    });
  });

  it('rejects invalid PATCH timesheet_type values', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { upsertTimesheetTypeException } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: false,
      role_name: 'admin',
    } as never);

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'foobar' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(400);
    expect(upsertTimesheetTypeException).not.toHaveBeenCalled();
  });

  it('deletes an override row with DELETE', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { deleteTimesheetTypeExceptionRow, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: true,
      is_super_admin: false,
      role_name: 'admin',
    } as never);
    vi.mocked(deleteTimesheetTypeExceptionRow).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ profileId: 'user-1' }),
    });
    expect(response.status).toBe(200);
    expect(deleteTimesheetTypeExceptionRow).toHaveBeenCalledWith('user-1');
  });
});
