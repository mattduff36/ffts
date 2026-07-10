import { describe, expect, it, vi } from 'vitest';
import { useWorkshopTaskLifecycleActions } from '@/app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskLifecycleActions';
import type { CompletionData } from '@/components/workshop-tasks/MarkTaskCompleteDialog';
import type { Action } from '@/app/(dashboard)/workshop-tasks/types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

function buildTask(overrides: Partial<Action> = {}): Action {
  return {
    id: 'task-1',
    action_type: 'workshop_vehicle_task',
    title: '6 weekly inspection',
    description: '6 weekly PMI',
    status: 'logged',
    priority: 'medium',
    created_at: '2026-05-10T09:00:00.000Z',
    created_by: 'manager-1',
    created_by_name: 'Manager One',
    logged_at: '2026-05-10T10:00:00.000Z',
    logged_by: 'manager-1',
    logged_by_name: 'Manager One',
    logged_comment: 'Started',
    actioned: false,
    actioned_at: null,
    actioned_by: null,
    actioned_by_name: null,
    actioned_comment: null,
    actioned_signature_data: null,
    actioned_signed_at: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_comment: null,
    status_history: [],
    van_id: null,
    hgv_id: 'hgv-1',
    plant_id: null,
    vehicle_id: null,
    workshop_comments: null,
    updated_at: '2026-05-10T10:00:00.000Z',
    workshop_task_categories: {
      id: 'category-1',
      name: 'Inspection',
      completion_updates: null,
    },
    workshop_task_subcategories: {
      id: 'subcategory-1',
      name: '6 weekly inspection (HGV)',
    },
    profiles: null,
    profiles_created: null,
    profiles_logged: null,
    profiles_actioned: null,
    profiles_cancelled: null,
    vehicles: null,
    vans: null,
    hgvs: null,
    plant: null,
    workshop_task_comments: [],
    workshop_task_attachments: [],
    ...overrides,
  } as Action;
}

describe('workshop task completion date confirmation', () => {
  it('uses the confirmed completed date for action, history, signature, and maintenance sync', async () => {
    const updatePayloads: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'actions') throw new Error(`Unexpected table: ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { status_history: [] }, error: null }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }),
    };
    const fetchTasks = vi.fn().mockResolvedValue(undefined);
    const setUpdatingStatus = vi.fn((updater: (previous: Set<string>) => Set<string>) => updater(new Set()));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const completedAt = '2026-05-11T14:26:00.000Z';
    const task = buildTask();
    const lifecycle = useWorkshopTaskLifecycleActions({
      supabase: supabase as never,
      userId: 'manager-1',
      profileName: 'Manager One',
      tasks: [task],
      fetchTasks,
      selectedTask: null,
      loggedComment: '',
      onHoldingTask: null,
      onHoldComment: '',
      resumingTask: null,
      resumeComment: '',
      completingTask: task,
      setUpdatingStatus,
      setShowStatusModal: vi.fn(),
      setSelectedTask: vi.fn(),
      setLoggedComment: vi.fn(),
      setShowOnHoldModal: vi.fn(),
      setShowResumeModal: vi.fn(),
      setShowCompleteModal: vi.fn(),
      setCompletingTask: vi.fn(),
    });

    const result = await lifecycle.confirmMarkComplete({
      intermediateComment: '',
      completedComment: 'Completed',
      completedAt,
      completedSignatureData: 'data:image/png;base64,signature',
      completedSignedAt: '2026-05-11T16:00:00.000Z',
    } satisfies CompletionData);

    expect(result).toBe(true);
    expect(updatePayloads[0]).toMatchObject({
      status: 'completed',
      actioned: true,
      actioned_at: completedAt,
      actioned_signed_at: completedAt,
    });
    expect(updatePayloads[0].status_history).toEqual([
      expect.objectContaining({
        status: 'completed',
        created_at: completedAt,
        meta: expect.objectContaining({
          signature_data: 'data:image/png;base64,signature',
          signed_at: completedAt,
        }),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/maintenance/by-vehicle/hgv-1',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(`"completed_at":"${completedAt}"`),
      })
    );

    vi.unstubAllGlobals();
  });

  it('uses confirmed created and in-progress dates when completion is backdated before them', async () => {
    const loggedEvent = {
      id: 'event-logged',
      type: 'status',
      status: 'logged',
      created_at: '2026-05-10T10:00:00.000Z',
      author_id: 'manager-1',
      author_name: 'Manager One',
      body: 'Started',
    };
    const updatePayloads: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'actions') throw new Error(`Unexpected table: ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { status_history: [loggedEvent] },
                error: null,
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const task = buildTask({
      created_at: '2026-05-10T09:00:00.000Z',
      logged_at: '2026-05-10T10:00:00.000Z',
    });
    const lifecycle = useWorkshopTaskLifecycleActions({
      supabase: supabase as never,
      userId: 'manager-1',
      profileName: 'Manager One',
      tasks: [task],
      fetchTasks: vi.fn().mockResolvedValue(undefined),
      selectedTask: null,
      loggedComment: '',
      onHoldingTask: null,
      onHoldComment: '',
      resumingTask: null,
      resumeComment: '',
      completingTask: task,
      setUpdatingStatus: vi.fn((updater: (previous: Set<string>) => Set<string>) => updater(new Set())),
      setShowStatusModal: vi.fn(),
      setSelectedTask: vi.fn(),
      setLoggedComment: vi.fn(),
      setShowOnHoldModal: vi.fn(),
      setShowResumeModal: vi.fn(),
      setShowCompleteModal: vi.fn(),
      setCompletingTask: vi.fn(),
    });

    const completedAt = '2026-05-09T14:26:00.000Z';
    const createdAt = '2026-05-09T14:24:00.000Z';
    const intermediateAt = '2026-05-09T14:25:00.000Z';
    const result = await lifecycle.confirmMarkComplete({
      intermediateComment: '',
      completedComment: 'Backdated completion',
      completedAt,
      createdAt,
      intermediateAt,
    } satisfies CompletionData);

    expect(result).toBe(true);
    expect(updatePayloads[0]).toMatchObject({
      created_at: createdAt,
      logged_at: intermediateAt,
      actioned_at: completedAt,
    });
    expect(updatePayloads[0].status_history).toEqual([
      expect.objectContaining({
        id: 'event-logged',
        created_at: intermediateAt,
      }),
      expect.objectContaining({
        status: 'completed',
        created_at: completedAt,
      }),
    ]);

    vi.unstubAllGlobals();
  });
});
