import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/utils/permissions', () => ({
  getProfileWithRole: vi.fn(),
}));

vi.mock('@/lib/utils/email', () => ({
  sendTrainingBookingDeclinedEmail: vi.fn(),
}));

import { declineTrainingBookings } from '@/lib/server/training-bookings';

const originalCoordinatorProfileId = process.env.TRAINING_COORDINATOR_PROFILE_ID;
const originalCoordinatorName = process.env.TRAINING_COORDINATOR_NAME;
const originalCoordinatorEmail = process.env.TRAINING_COORDINATOR_EMAIL;

describe('training booking decline helper', () => {
  const state = {
    deletedAbsenceIds: [] as string[],
    createdMessage: null as Record<string, unknown> | null,
    createdRecipients: [] as Array<Record<string, unknown>>,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    state.deletedAbsenceIds = [];
    state.createdMessage = null;
    state.createdRecipients = [];
    process.env.TRAINING_COORDINATOR_PROFILE_ID = 'coordinator-profile';
    process.env.TRAINING_COORDINATOR_NAME = 'Training Coordinator';
    process.env.TRAINING_COORDINATOR_EMAIL = 'coordinator@example.test';

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getProfileWithRole } = await import('@/lib/utils/permissions');
    const { sendTrainingBookingDeclinedEmail } = await import('@/lib/utils/email');

    vi.mocked(getProfileWithRole).mockResolvedValue({
      id: 'employee-1',
      full_name: 'Alice Employee',
      email: null,
      phone_number: null,
      employee_id: 'E001',
      role_id: 'role-employee',
      must_change_password: false,
      is_super_admin: false,
      created_at: '2026-04-13T09:00:00.000Z',
      updated_at: '2026-04-13T09:00:00.000Z',
      role: {
        name: 'employee',
        display_name: 'Employee',
        role_class: 'employee',
        hierarchy_rank: 1,
        is_manager_admin: false,
        is_super_admin: false,
      },
    });
    vi.mocked(sendTrainingBookingDeclinedEmail).mockResolvedValue({ success: true });

    const adminClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async (profileId: string) => ({
            data: {
              user: profileId === 'manager-1'
                ? { email: 'manager@example.com' }
                : { email: 'coordinator@example.test' },
            },
            error: null,
          })),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'absences') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    id: 'absence-1',
                    date: '2026-04-15',
                    profile_id: 'employee-1',
                    absence_reasons: { name: 'Training' },
                    profile: {
                      id: 'employee-1',
                      full_name: 'Alice Employee',
                      team_id: 'team-1',
                      line_manager_id: 'manager-1',
                      secondary_manager_id: null,
                    },
                  },
                ],
                error: null,
              })),
            })),
            delete: vi.fn(() => ({
              in: vi.fn(async (_column: string, ids: string[]) => {
                state.deletedAbsenceIds = ids;
                return { error: null };
              }),
            })),
          };
        }

        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((_column: string, value: string) => ({
                maybeSingle: vi.fn(async () => ({
                  data: value === 'manager-1'
                    ? { id: 'manager-1', full_name: 'Molly Manager' }
                    : value === 'coordinator-profile'
                      ? { id: 'coordinator-profile', full_name: 'Training Coordinator' }
                    : null,
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'messages') {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              state.createdMessage = payload;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: 'message-1' },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }

        if (table === 'message_recipients') {
          return {
            insert: vi.fn(async (payload: Array<Record<string, unknown>>) => {
              state.createdRecipients = payload;
              return { error: null };
            }),
          };
        }

        if (table === 'timesheets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [],
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'org_teams') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { manager_1_profile_id: null, manager_2_profile_id: null },
                  error: null,
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);
  });

  afterEach(() => {
    restoreEnv('TRAINING_COORDINATOR_PROFILE_ID', originalCoordinatorProfileId);
    restoreEnv('TRAINING_COORDINATOR_NAME', originalCoordinatorName);
    restoreEnv('TRAINING_COORDINATOR_EMAIL', originalCoordinatorEmail);
  });

  it('deletes the booking and notifies the manager plus configured coordinator', async () => {
    const { sendTrainingBookingDeclinedEmail } = await import('@/lib/utils/email');

    const result = await declineTrainingBookings('employee-1', ['absence-1']);

    expect(result.deletedAbsenceIds).toEqual(['absence-1']);
    expect(result.employeeName).toBe('Alice Employee');
    expect(result.trainingDate).toContain('Wednesday');
    expect(state.deletedAbsenceIds).toEqual(['absence-1']);
    expect(state.createdMessage).toMatchObject({
      type: 'NOTIFICATION',
      created_via: 'timesheet_training_decline',
      module_key: 'training',
    });
    expect(state.createdRecipients).toEqual([
      { message_id: 'message-1', user_id: 'manager-1', status: 'PENDING' },
      { message_id: 'message-1', user_id: 'coordinator-profile', status: 'PENDING' },
    ]);
    expect(sendTrainingBookingDeclinedEmail).toHaveBeenCalledTimes(2);
    expect(sendTrainingBookingDeclinedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'manager@example.com', recipientName: 'Molly Manager' })
    );
    expect(sendTrainingBookingDeclinedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'coordinator@example.test',
        recipientName: 'Training Coordinator',
      })
    );
  });

  it('rejects non-training bookings', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');

    const adminClient = {
      auth: {
        admin: {
          getUserById: vi.fn(),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'absences') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    id: 'absence-1',
                    date: '2026-04-15',
                    profile_id: 'employee-1',
                    absence_reasons: { name: 'Annual Leave' },
                    profile: {
                      id: 'employee-1',
                      full_name: 'Alice Employee',
                      team_id: 'team-1',
                      line_manager_id: 'manager-1',
                      secondary_manager_id: null,
                    },
                  },
                ],
                error: null,
              })),
            })),
            delete: vi.fn(() => ({
              in: vi.fn(async () => ({ error: null })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);

    await expect(declineTrainingBookings('employee-1', ['absence-1'])).rejects.toThrow(
      'Only Training bookings can be declined from the timesheet'
    );
  });

  it('blocks removing training linked to processed timesheets', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');

    const adminClient = {
      auth: {
        admin: {
          getUserById: vi.fn(),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'absences') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    id: 'absence-1',
                    date: '2026-04-15',
                    end_date: null,
                    is_half_day: false,
                    profile_id: 'employee-1',
                    absence_reasons: { name: 'Training' },
                    profile: {
                      id: 'employee-1',
                      full_name: 'Alice Employee',
                      team_id: 'team-1',
                      line_manager_id: 'manager-1',
                      secondary_manager_id: null,
                    },
                  },
                ],
                error: null,
              })),
            })),
            delete: vi.fn(() => ({
              in: vi.fn(async () => ({ error: null })),
            })),
          };
        }

        if (table === 'timesheets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [
                    {
                      id: 'timesheet-1',
                      week_ending: '2026-04-19',
                      status: 'processed',
                      manager_comments: null,
                    },
                  ],
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'timesheet_entries') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [],
                error: null,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);

    await expect(declineTrainingBookings('employee-1', ['absence-1'])).rejects.toThrow(
      'Training bookings linked to processed or adjusted timesheets cannot be removed from the timesheet flow'
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
