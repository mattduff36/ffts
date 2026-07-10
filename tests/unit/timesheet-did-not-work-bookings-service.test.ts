import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitTimesheetDidNotWorkBookings } from '@/lib/server/timesheet-did-not-work-bookings';

vi.mock('@/lib/utils/absence-timesheet-impact', () => ({
  applyApprovedAbsenceTimesheetEffects: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/server/processed-absence-notifications', () => ({
  resolveProcessedAbsenceNotificationRecipientIds: vi.fn().mockResolvedValue(['accounts-supervisor']),
}));

function createSelectMaybeSingleBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return builder;
}

function createExistingAbsencesBuilder(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return builder;
}

function createMessageDuplicateBuilder(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return builder;
}

describe('timesheet Did Not Work booking service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats an existing matching training booking as idempotent', async () => {
    const absencesInsert = vi.fn();
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'timesheets') {
          return createSelectMaybeSingleBuilder({
            id: 'timesheet-1',
            user_id: 'employee-1',
            week_ending: '2026-05-03',
          });
        }
        if (table === 'profiles') {
          return createSelectMaybeSingleBuilder({
            id: 'employee-1',
            full_name: 'Alice Employee',
            employee_id: 'E001',
            team_id: 'civils',
            line_manager_id: 'manager-1',
            secondary_manager_id: null,
            team: null,
          });
        }
        if (table === 'absence_reasons') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'training-reason', name: 'Training', is_paid: true }],
              error: null,
            }),
          };
        }
        if (table === 'absences') {
          return {
            select: createExistingAbsencesBuilder([
              {
                id: 'existing-training',
                reason_id: 'training-reason',
                date: '2026-04-28',
                end_date: null,
                is_half_day: true,
                half_day_session: 'PM',
              },
            ]).select,
            insert: absencesInsert,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await commitTimesheetDidNotWorkBookings(admin as never, {
      actorUserId: 'employee-1',
      timesheetId: 'timesheet-1',
      canManageOtherUsers: false,
      bookings: [
        {
          dayOfWeek: 2,
          date: '2026-04-28',
          kind: 'training',
          trainingSession: 'PM',
        },
      ],
    });

    expect(result).toEqual({
      insertedAbsenceIds: [],
      existingAbsenceIds: ['existing-training'],
      notifiedProfileIds: [],
    });
    expect(absencesInsert).not.toHaveBeenCalled();
  });

  it('creates sickness, applies timesheet effects, and notifies managers plus Accounts', async () => {
    const { applyApprovedAbsenceTimesheetEffects } = await import('@/lib/utils/absence-timesheet-impact');
    const messagesInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'message-1' }, error: null }),
      })),
    }));
    const recipientsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const absencesInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'sickness-absence' }, error: null }),
      })),
    }));

    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'timesheets') {
          return createSelectMaybeSingleBuilder({
            id: 'timesheet-1',
            user_id: 'employee-1',
            week_ending: '2026-05-03',
          });
        }
        if (table === 'profiles') {
          return createSelectMaybeSingleBuilder({
            id: 'employee-1',
            full_name: 'Alice Employee',
            employee_id: 'E001',
            team_id: 'civils',
            line_manager_id: 'manager-1',
            secondary_manager_id: null,
            team: { manager_1_profile_id: 'manager-2', manager_2_profile_id: null },
          });
        }
        if (table === 'absence_reasons') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'sickness-reason', name: 'Sickness', is_paid: true }],
              error: null,
            }),
          };
        }
        if (table === 'absences') {
          return {
            select: createExistingAbsencesBuilder([]).select,
            insert: absencesInsert,
          };
        }
        if (table === 'messages') {
          return {
            select: createMessageDuplicateBuilder([]).select,
            insert: messagesInsert,
          };
        }
        if (table === 'message_recipients') {
          return { insert: recipientsInsert };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await commitTimesheetDidNotWorkBookings(admin as never, {
      actorUserId: 'employee-1',
      timesheetId: 'timesheet-1',
      canManageOtherUsers: false,
      bookings: [{ dayOfWeek: 2, date: '2026-04-28', kind: 'sickness' }],
    });

    expect(result.insertedAbsenceIds).toEqual(['sickness-absence']);
    expect(result.notifiedProfileIds).toEqual(['manager-1', 'manager-2', 'accounts-supervisor']);
    expect(applyApprovedAbsenceTimesheetEffects).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        absenceId: 'sickness-absence',
        profileId: 'employee-1',
        reasonName: 'Sickness',
      })
    );
    expect(messagesInsert).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Sickness booked from Did Not Work: Alice Employee',
      created_via: 'timesheet_did_not_work_booking',
      module_key: 'absence',
    }));
    expect(recipientsInsert).toHaveBeenCalledWith([
      { message_id: 'message-1', user_id: 'manager-1', status: 'PENDING' },
      { message_id: 'message-1', user_id: 'manager-2', status: 'PENDING' },
      { message_id: 'message-1', user_id: 'accounts-supervisor', status: 'PENDING' },
    ]);
  });
});
