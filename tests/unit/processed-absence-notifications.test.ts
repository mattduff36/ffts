import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProcessedAbsenceNotification,
  notifyProcessedAbsenceTimesheetAdjustment,
  resolveProcessedAbsenceNotificationRecipientIds,
} from '@/lib/server/processed-absence-notifications';

function asAdminClient(value: unknown) {
  return value as never;
}

const recipientProfiles = [
  {
    id: 'accounts-supervisor',
    team_id: 'accounts',
    super_admin: false,
    team: { id: 'accounts', name: 'Accounts' },
    role: { name: 'supervisor', hierarchy_rank: 3, is_super_admin: false, role_class: 'employee' },
  },
  {
    id: 'accounts-manager',
    team_id: 'accounts',
    super_admin: false,
    team: { id: 'accounts', name: 'Accounts' },
    role: { name: 'manager', hierarchy_rank: 4, is_super_admin: false, role_class: 'manager' },
  },
  {
    id: 'global-admin',
    team_id: 'transport',
    super_admin: false,
    team: { id: 'transport', name: 'Transport' },
    role: { name: 'admin', hierarchy_rank: 999, is_super_admin: false, role_class: 'admin' },
  },
  {
    id: 'actual-super-admin',
    team_id: null,
    super_admin: true,
    team: null,
    role: { name: 'manager', hierarchy_rank: 4, is_super_admin: false, role_class: 'manager' },
  },
  {
    id: 'accounts-employee',
    team_id: 'accounts',
    super_admin: false,
    team: { id: 'accounts', name: 'Accounts' },
    role: { name: 'employee', hierarchy_rank: 2, is_super_admin: false, role_class: 'employee' },
  },
  {
    id: 'civils-supervisor',
    team_id: 'civils',
    super_admin: false,
    team: { id: 'civils', name: 'Civils' },
    role: { name: 'supervisor', hierarchy_rank: 3, is_super_admin: false, role_class: 'employee' },
  },
];

describe('processed absence notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves Accounts supervisor+ recipients plus global admins', async () => {
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: recipientProfiles, error: null }),
      })),
    };

    const recipients = await resolveProcessedAbsenceNotificationRecipientIds(asAdminClient(admin));

    expect(recipients).toEqual([
      'accounts-supervisor',
      'accounts-manager',
      'global-admin',
      'actual-super-admin',
    ]);
  });

  it('creates current-schema notification messages and recipient rows', async () => {
    const messagesInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'message-id' }, error: null }),
      })),
    }));
    const recipientsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockResolvedValue({ data: recipientProfiles.slice(0, 2), error: null }),
          };
        }

        if (table === 'messages') {
          return { insert: messagesInsert };
        }

        if (table === 'message_recipients') {
          return { insert: recipientsInsert };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const notified = await createProcessedAbsenceNotification(asAdminClient(admin), {
      actorUserId: 'actor-id',
      subject: 'Processed absence updated',
      body: 'A processed absence changed.',
      createdVia: 'processed_absence_change',
    });

    expect(notified).toEqual(['accounts-supervisor', 'accounts-manager']);
    expect(messagesInsert).toHaveBeenCalledWith({
      type: 'NOTIFICATION',
      subject: 'Processed absence updated',
      body: 'A processed absence changed.',
      priority: 'HIGH',
      sender_id: 'actor-id',
      created_via: 'processed_absence_change',
      module_key: 'processed_absence',
    });
    expect(recipientsInsert).toHaveBeenCalledWith([
      { message_id: 'message-id', user_id: 'accounts-supervisor', status: 'PENDING' },
      { message_id: 'message-id', user_id: 'accounts-manager', status: 'PENDING' },
    ]);
  });

  it('notifies when a timesheet adjustment overlaps processed absence leave', async () => {
    const messagesInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'message-id' }, error: null }),
      })),
    }));
    const recipientsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const absencesBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      lte: vi.fn(),
      or: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'absence-1',
            profile_id: 'employee-id',
            date: '2026-04-22',
            end_date: null,
            status: 'processed',
            absence_reasons: { name: 'Annual Leave' },
          },
          {
            id: 'absence-2',
            profile_id: 'employee-id',
            date: '2026-04-01',
            end_date: null,
            status: 'processed',
            absence_reasons: { name: 'Sickness' },
          },
        ],
        error: null,
      }),
    };
    absencesBuilder.select.mockReturnValue(absencesBuilder);
    absencesBuilder.eq.mockReturnValue(absencesBuilder);
    absencesBuilder.lte.mockReturnValue(absencesBuilder);

    const actorProfileBuilder = {
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: { full_name: 'Accounts User' }, error: null }),
      })),
    };
    const profilesSelect = vi.fn((columns: string) => {
      if (columns === 'full_name') return actorProfileBuilder;
      return Promise.resolve({ data: recipientProfiles.slice(0, 1), error: null });
    });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'absences') return absencesBuilder;
        if (table === 'profiles') return { select: profilesSelect };
        if (table === 'messages') return { insert: messagesInsert };
        if (table === 'message_recipients') return { insert: recipientsInsert };
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const notified = await notifyProcessedAbsenceTimesheetAdjustment(asAdminClient(admin), {
      actorUserId: 'actor-id',
      employeeProfileId: 'employee-id',
      employeeName: 'Test Employee',
      weekEnding: '2026-04-26',
      adjustmentComments: 'Adjusted payroll hours',
    });

    expect(notified).toEqual(['accounts-supervisor']);
    expect(messagesInsert).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Processed absence affected by timesheet adjustment: Test Employee',
      created_via: 'processed_absence_timesheet_adjustment',
      module_key: 'processed_absence',
    }));
    expect(messagesInsert.mock.calls[0][0].body).toContain('Annual Leave: 22 Apr 2026');
    expect(messagesInsert.mock.calls[0][0].body).not.toContain('Sickness');
  });
});
