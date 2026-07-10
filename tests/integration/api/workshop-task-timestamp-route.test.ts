import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp/route';

const {
  mockCreateClient,
  mockCreateAdminSupabaseClient,
  mockUserHasPermission,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminSupabaseClient: vi.fn(),
  mockUserHasPermission: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateAdminSupabaseClient,
}));

vi.mock('@/lib/utils/permissions', () => ({
  userHasPermission: mockUserHasPermission,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    action_type: 'workshop_vehicle_task',
    title: 'Workshop Task - Test Asset',
    description: 'Routine workshop task',
    workshop_comments: 'Routine workshop task',
    created_at: '2026-04-13T09:00:00.000Z',
    created_by: 'user-created',
    logged_at: '2026-04-13T10:00:00.000Z',
    logged_by: 'user-started',
    logged_comment: 'Started work',
    actioned: false,
    actioned_at: null,
    actioned_by: null,
    actioned_comment: null,
    actioned_signature_data: null,
    actioned_signed_at: null,
    van_id: null,
    hgv_id: null,
    plant_id: null,
    workshop_task_categories: null,
    workshop_task_subcategories: null,
    status_history: [
      {
        id: 'event-started',
        type: 'status',
        status: 'logged',
        created_at: '2026-04-13T10:00:00.000Z',
        author_id: 'user-started',
        author_name: 'Starter',
        body: 'Started work',
      },
    ],
    ...overrides,
  };
}

function buildComment(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    body: 'Waiting for parts',
    created_at: '2026-04-13T11:00:00.000Z',
    updated_at: null,
    profiles: {
      id: 'user-comment',
      full_name: 'Commenter',
    },
    ...overrides,
  };
}

function createAdminClient({
  task,
  comments = [],
  maintenanceCategories = [],
  maintenanceRecord = null,
  profile = { full_name: 'Manager One' },
}: {
  task: Record<string, unknown>;
  comments?: Array<Record<string, unknown>>;
  maintenanceCategories?: Array<Record<string, unknown>>;
  maintenanceRecord?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
}) {
  const taskSingle = vi.fn().mockResolvedValue({ data: task, error: null });
  const taskEq = vi.fn(() => ({ single: taskSingle }));
  const taskSelect = vi.fn(() => ({ eq: taskEq }));

  const actionUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const actionUpdate = vi.fn(() => ({ eq: actionUpdateEq }));

  const commentsOrder = vi.fn().mockResolvedValue({ data: comments, error: null });
  const commentsEq = vi.fn(() => ({ order: commentsOrder }));
  const commentsSelect = vi.fn(() => ({ eq: commentsEq }));

  const commentUpdateEqTask = vi.fn().mockResolvedValue({ error: null });
  const commentUpdateEqId = vi.fn(() => ({ eq: commentUpdateEqTask }));
  const commentUpdate = vi.fn(() => ({ eq: commentUpdateEqId }));

  const attachmentUpdateEqStatus = vi.fn().mockResolvedValue({ error: null });
  const attachmentUpdateEqTask = vi.fn(() => ({ eq: attachmentUpdateEqStatus }));
  const attachmentUpdate = vi.fn(() => ({ eq: attachmentUpdateEqTask }));

  const categoriesEq = vi.fn().mockResolvedValue({ data: maintenanceCategories, error: null });
  const categoriesSelect = vi.fn(() => ({ eq: categoriesEq }));

  const maintenanceMaybeSingle = vi.fn().mockResolvedValue({ data: maintenanceRecord, error: null });
  const maintenanceEqByAsset = vi.fn(() => ({ maybeSingle: maintenanceMaybeSingle }));
  const maintenanceSelect = vi.fn(() => ({ eq: maintenanceEqByAsset }));
  const maintenanceUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const maintenanceUpdate = vi.fn(() => ({ eq: maintenanceUpdateEq }));
  const maintenanceInsert = vi.fn().mockResolvedValue({ error: null });

  const profileMaybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null });
  const profileEq = vi.fn(() => ({ maybeSingle: profileMaybeSingle }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  const maintenanceHistoryInsert = vi.fn().mockResolvedValue({ error: null });

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'actions') {
        return {
          select: taskSelect,
          update: actionUpdate,
        };
      }

      if (table === 'workshop_task_comments') {
        return {
          select: commentsSelect,
          update: commentUpdate,
        };
      }

      if (table === 'workshop_task_attachments') {
        return {
          update: attachmentUpdate,
        };
      }

      if (table === 'maintenance_categories') {
        return {
          select: categoriesSelect,
        };
      }

      if (table === 'vehicle_maintenance') {
        return {
          select: maintenanceSelect,
          update: maintenanceUpdate,
          insert: maintenanceInsert,
        };
      }

      if (table === 'profiles') {
        return {
          select: profileSelect,
        };
      }

      if (table === 'maintenance_history') {
        return {
          insert: maintenanceHistoryInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    actionUpdate,
    actionUpdateEq,
    commentUpdate,
    commentUpdateEqId,
    commentUpdateEqTask,
    attachmentUpdate,
    attachmentUpdateEqTask,
    attachmentUpdateEqStatus,
    maintenanceUpdate,
    maintenanceUpdateEq,
    maintenanceInsert,
    maintenanceHistoryInsert,
  };
}

async function callRoute({
  timelineItemId,
  itemType,
  timestamp,
}: {
  timelineItemId: string;
  itemType: 'created' | 'status_event' | 'comment';
  timestamp: string;
}) {
  return PATCH(
    new NextRequest(
      `http://localhost/api/workshop-tasks/tasks/${TASK_ID}/timeline/${encodeURIComponent(timelineItemId)}/timestamp`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType, timestamp }),
      }
    ),
    { params: Promise.resolve({ taskId: TASK_ID, timelineItemId }) }
  );
}

describe('PATCH /api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    });
    mockUserHasPermission.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('updates the created timestamp for the task row', async () => {
    const admin = createAdminClient({
      task: buildTask(),
      comments: [],
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const nextTimestamp = '2026-04-13T08:30:00.000Z';
    const response = await callRoute({
      timelineItemId: 'created',
      itemType: 'created',
      timestamp: nextTimestamp,
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(admin.actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        created_at: nextTimestamp,
      })
    );
  });

  it('updates completed timestamps, completed attachments, and automatic maintenance due dates', async () => {
    const admin = createAdminClient({
      task: buildTask({
        title: 'C517773 (NOOTEBOOM)',
        description: '6 WEEKLY PMI',
        hgv_id: 'hgv-nooteboom',
        workshop_task_subcategories: {
          name: '6 weekly inspection (HGV)',
        },
        created_at: '2026-05-10T09:00:00.000Z',
        logged_at: '2026-05-11T06:00:00.000Z',
        actioned: true,
        actioned_at: '2026-05-13T14:26:00.000Z',
        actioned_by: 'user-completed',
        actioned_comment: 'Completed work',
        status_history: [
          {
            id: 'event-started',
            type: 'status',
            status: 'logged',
            created_at: '2026-05-11T06:00:00.000Z',
            author_id: 'user-started',
            author_name: 'Starter',
            body: 'Started work',
          },
          {
            id: 'event-completed',
            type: 'status',
            status: 'completed',
            created_at: '2026-05-13T14:26:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'Completed work',
            meta: {
              signature_data: 'data:image/png;base64,signature',
              signed_at: '2026-05-13T14:26:00.000Z',
            },
          },
        ],
      }),
      comments: [],
      maintenanceCategories: [
        {
          id: 'cat-6-week',
          name: '6 Weekly Inspection Due',
          type: 'date',
          period_unit: 'weeks',
          period_value: 6,
          applies_to: ['hgv'],
          is_active: true,
        },
      ],
      maintenanceRecord: {
        id: 'maintenance-1',
        current_mileage: 101,
        current_hours: null,
        six_weekly_inspection_due_date: '2026-06-24',
      },
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const nextTimestamp = '2026-05-11T14:26:00.000Z';
    const response = await callRoute({
      timelineItemId: 'completed',
      itemType: 'status_event',
      timestamp: nextTimestamp,
    });

    expect(response.status).toBe(200);
    expect(admin.actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        actioned: true,
        actioned_at: nextTimestamp,
        actioned_signed_at: nextTimestamp,
        status_history: expect.arrayContaining([
          expect.objectContaining({
            id: 'event-completed',
            created_at: nextTimestamp,
            meta: expect.objectContaining({
              signature_data: 'data:image/png;base64,signature',
              signed_at: nextTimestamp,
              timestamp_adjusted: true,
            }),
          }),
        ]),
      })
    );
    expect(admin.attachmentUpdate).toHaveBeenCalledWith({ completed_at: nextTimestamp });
    expect(admin.attachmentUpdateEqTask).toHaveBeenCalledWith('task_id', TASK_ID);
    expect(admin.attachmentUpdateEqStatus).toHaveBeenCalledWith('status', 'completed');
    expect(admin.maintenanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        six_weekly_inspection_due_date: '2026-06-22',
        last_updated_by: 'manager-1',
      })
    );
    expect(admin.maintenanceUpdateEq).toHaveBeenCalledWith('id', 'maintenance-1');
    expect(admin.maintenanceHistoryInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        hgv_id: 'hgv-nooteboom',
        field_name: 'six_weekly_inspection_due_date',
        old_value: '2026-06-24',
        new_value: '2026-06-22',
        maintenance_category_id: 'cat-6-week',
      }),
    ]);
  });

  it('does not create duplicate maintenance history when the recalculated due date is unchanged', async () => {
    const admin = createAdminClient({
      task: buildTask({
        title: 'C517773 (NOOTEBOOM)',
        description: '6 WEEKLY PMI',
        hgv_id: 'hgv-nooteboom',
        workshop_task_subcategories: {
          name: '6 weekly inspection (HGV)',
        },
        actioned: true,
        actioned_at: '2026-05-13T14:26:00.000Z',
        actioned_by: 'user-completed',
        actioned_comment: 'Completed work',
        status_history: [
          {
            id: 'event-started',
            type: 'status',
            status: 'logged',
            created_at: '2026-05-11T06:00:00.000Z',
            author_id: 'user-started',
            author_name: 'Starter',
            body: 'Started work',
          },
          {
            id: 'event-completed',
            type: 'status',
            status: 'completed',
            created_at: '2026-05-13T14:26:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'Completed work',
          },
        ],
      }),
      comments: [],
      maintenanceCategories: [
        {
          id: 'cat-6-week',
          name: '6 Weekly Inspection Due',
          type: 'date',
          period_unit: 'weeks',
          period_value: 6,
          applies_to: ['hgv'],
          is_active: true,
        },
      ],
      maintenanceRecord: {
        id: 'maintenance-1',
        current_mileage: 101,
        current_hours: null,
        six_weekly_inspection_due_date: '2026-06-22',
      },
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const response = await callRoute({
      timelineItemId: 'completed',
      itemType: 'status_event',
      timestamp: '2026-05-11T14:26:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(admin.maintenanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        six_weekly_inspection_due_date: '2026-06-22',
      })
    );
    expect(admin.maintenanceHistoryInsert).not.toHaveBeenCalled();
  });

  it('chains maintenance history old and new values across sequential re-adjustments', async () => {
    const admin = createAdminClient({
      task: buildTask({
        title: 'C517773 (NOOTEBOOM)',
        description: '6 WEEKLY PMI',
        hgv_id: 'hgv-nooteboom',
        workshop_task_subcategories: {
          name: '6 weekly inspection (HGV)',
        },
        actioned: true,
        actioned_at: '2026-05-11T14:26:00.000Z',
        actioned_by: 'user-completed',
        actioned_comment: 'Completed work',
        status_history: [
          {
            id: 'event-started',
            type: 'status',
            status: 'logged',
            created_at: '2026-05-11T06:00:00.000Z',
            author_id: 'user-started',
            author_name: 'Starter',
            body: 'Started work',
          },
          {
            id: 'event-completed',
            type: 'status',
            status: 'completed',
            created_at: '2026-05-11T14:26:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'Completed work',
            meta: {
              timestamp_adjusted: true,
            },
          },
        ],
      }),
      comments: [],
      maintenanceCategories: [
        {
          id: 'cat-6-week',
          name: '6 Weekly Inspection Due',
          type: 'date',
          period_unit: 'weeks',
          period_value: 6,
          applies_to: ['hgv'],
          is_active: true,
        },
      ],
      maintenanceRecord: {
        id: 'maintenance-1',
        current_mileage: 101,
        current_hours: null,
        six_weekly_inspection_due_date: '2026-06-22',
      },
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const response = await callRoute({
      timelineItemId: 'completed',
      itemType: 'status_event',
      timestamp: '2026-05-12T14:26:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(admin.maintenanceHistoryInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        hgv_id: 'hgv-nooteboom',
        field_name: 'six_weekly_inspection_due_date',
        old_value: '2026-06-22',
        new_value: '2026-06-23',
      }),
    ]);
  });

  it('does not recalculate maintenance when adjusting a non-latest completed event', async () => {
    const admin = createAdminClient({
      task: buildTask({
        title: 'C517773 (NOOTEBOOM)',
        description: '6 WEEKLY PMI',
        hgv_id: 'hgv-nooteboom',
        workshop_task_subcategories: {
          name: '6 weekly inspection (HGV)',
        },
        actioned: true,
        actioned_at: '2026-05-13T14:26:00.000Z',
        actioned_by: 'user-completed',
        actioned_comment: 'Latest completed work',
        status_history: [
          {
            id: 'event-started',
            type: 'status',
            status: 'logged',
            created_at: '2026-05-10T06:00:00.000Z',
            author_id: 'user-started',
            author_name: 'Starter',
            body: 'Started work',
          },
          {
            id: 'event-completed-early',
            type: 'status',
            status: 'completed',
            created_at: '2026-05-11T14:26:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'First completion',
          },
          {
            id: 'event-completed-latest',
            type: 'status',
            status: 'completed',
            created_at: '2026-05-13T14:26:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'Latest completion',
          },
        ],
      }),
      comments: [],
      maintenanceCategories: [
        {
          id: 'cat-6-week',
          name: '6 Weekly Inspection Due',
          type: 'date',
          period_unit: 'weeks',
          period_value: 6,
          applies_to: ['hgv'],
          is_active: true,
        },
      ],
      maintenanceRecord: {
        id: 'maintenance-1',
        current_mileage: 101,
        current_hours: null,
        six_weekly_inspection_due_date: '2026-06-24',
      },
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const response = await callRoute({
      timelineItemId: 'event-completed-early',
      itemType: 'status_event',
      timestamp: '2026-05-12T14:26:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(admin.attachmentUpdate).not.toHaveBeenCalled();
    expect(admin.maintenanceUpdate).not.toHaveBeenCalled();
    expect(admin.maintenanceHistoryInsert).not.toHaveBeenCalled();
  });

  it('updates comment timestamps on workshop_task_comments', async () => {
    const admin = createAdminClient({
      task: buildTask(),
      comments: [buildComment()],
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const nextTimestamp = '2026-04-13T10:30:00.000Z';
    const response = await callRoute({
      timelineItemId: COMMENT_ID,
      itemType: 'comment',
      timestamp: nextTimestamp,
    });

    expect(response.status).toBe(200);
    expect(admin.commentUpdate).toHaveBeenCalledWith({ created_at: nextTimestamp });
    expect(admin.commentUpdateEqId).toHaveBeenCalledWith('id', COMMENT_ID);
    expect(admin.commentUpdateEqTask).toHaveBeenCalledWith('task_id', TASK_ID);
  });

  it('rejects started timestamps that would move before task creation', async () => {
    const admin = createAdminClient({
      task: buildTask({
        status_history: null,
      }),
      comments: [],
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const response = await callRoute({
      timelineItemId: 'started',
      itemType: 'status_event',
      timestamp: '2026-04-13T08:45:00.000Z',
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Timestamp cannot be before the previous timeline event.');
    expect(admin.actionUpdate).not.toHaveBeenCalled();
  });

  it('rejects completed timestamps that would move before the started event', async () => {
    const admin = createAdminClient({
      task: buildTask({
        actioned: true,
        actioned_at: '2026-04-13T12:00:00.000Z',
        actioned_by: 'user-completed',
        actioned_comment: 'Completed work',
        status_history: [
          {
            id: 'event-started',
            type: 'status',
            status: 'logged',
            created_at: '2026-04-13T10:00:00.000Z',
            author_id: 'user-started',
            author_name: 'Starter',
            body: 'Started work',
          },
          {
            id: 'event-completed',
            type: 'status',
            status: 'completed',
            created_at: '2026-04-13T12:00:00.000Z',
            author_id: 'user-completed',
            author_name: 'Completer',
            body: 'Completed work',
          },
        ],
      }),
      comments: [],
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const response = await callRoute({
      timelineItemId: 'completed',
      itemType: 'status_event',
      timestamp: '2026-04-13T09:30:00.000Z',
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Timestamp cannot be before the previous timeline event.');
    expect(admin.actionUpdate).not.toHaveBeenCalled();
  });

  it('normalizes fallback status history when editing a legacy started timestamp', async () => {
    const admin = createAdminClient({
      task: buildTask({
        status_history: null,
      }),
      comments: [],
    });
    mockCreateAdminSupabaseClient.mockReturnValue(admin.client);

    const nextTimestamp = '2026-04-13T10:30:00.000Z';
    const response = await callRoute({
      timelineItemId: 'started',
      itemType: 'status_event',
      timestamp: nextTimestamp,
    });

    expect(response.status).toBe(200);
    expect(admin.actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        logged_at: nextTimestamp,
        status_history: expect.arrayContaining([
          expect.objectContaining({
            id: `status:logged:${TASK_ID}`,
            status: 'logged',
            created_at: nextTimestamp,
          }),
        ]),
      })
    );
  });
});
