import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/inspection-route-access', () => ({
  getInspectionRouteActorAccess: vi.fn(),
}));

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { POST as vanSyncPost } from '@/app/api/van-inspections/sync-defect-tasks/route';
import { POST as plantSyncPost } from '@/app/api/plant-inspections/sync-defect-tasks/route';
import { POST as hgvSyncPost } from '@/app/api/hgv-inspections/sync-defect-tasks/route';
import { GET as vanLockedDefectsGet } from '@/app/api/van-inspections/locked-defects/route';
import { GET as plantLockedDefectsGet } from '@/app/api/plant-inspections/locked-defects/route';
import { GET as hgvLockedDefectsGet } from '@/app/api/hgv-inspections/locked-defects/route';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

function mockAuthenticatedUser() {
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient);
}

describe('Inspection defect workflow alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: { userId: 'user-1', canManageOthers: true, canDeleteInspections: true },
      errorResponse: null,
    });
  });

  it('plant sync keeps oldest task and skips creating duplicate for same signature', async () => {
    mockAuthenticatedUser();
    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: { userId: 'user-1', canManageOthers: false, canDeleteInspections: false },
      errorResponse: null,
    });

    const actionUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
    const activeTasks = [
      {
        id: 'plant-task-oldest',
        status: 'pending',
        title: 'Plant P001: Windows & Wipers',
        description: 'Plant inspection defect found:\nItem 4 - Windows & Wipers (Mon)\nComment: cracked',
        inspection_id: 'inspection-old',
        inspection_item_id: 'item-old',
        plant_id: 'plant-1',
        created_at: '2026-03-01T08:00:00.000Z',
      },
      {
        id: 'plant-task-newer',
        status: 'logged',
        title: 'Plant P001: Windows & Wipers',
        description: 'Plant inspection defect found:\nItem 4 - Windows & Wipers (Wed)\nComment: still cracked',
        inspection_id: 'inspection-new',
        inspection_item_id: 'item-new',
        plant_id: 'plant-1',
        created_at: '2026-03-02T08:00:00.000Z',
      },
    ];

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'plant_inspections') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    user_id: 'user-1',
                    plant_id: 'plant-1',
                    is_hired_plant: false,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'plant') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { plant_id: 'P001' }, error: null }),
              }),
            }),
          };
        }

        if (table === 'workshop_task_categories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: 'repair-plant' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'hgv_inspections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'user-1', hgv_id: 'hgv-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'hgv_inspections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'user-1', hgv_id: 'hgv-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'actions') {
          return {
            select: () => {
              const filters: Record<string, unknown> = {};
              const completedTasksPayload = { data: [], error: null } as const;
              const query = createSupabaseQueryMock(
                () => (filters.inspection_id ? { data: [], error: null } : { data: activeTasks, error: null }),
                []
              );
              query.eq = vi.fn((column: string, value: unknown) => {
                  filters[column] = value;
                  return query;
                });
              query.in = vi.fn(async () => ({ data: activeTasks, error: null }));
              query.order = vi.fn(() => ({
                  limit: async () => completedTasksPayload,
                }));
              return query;
            },
            update: (payload: Record<string, unknown>) => ({
              eq: async (_column: string, value: string) => {
                actionUpdates.push({ id: value, payload });
                return { error: null };
              },
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await plantSyncPost(
      new NextRequest('http://localhost/api/plant-inspections/sync-defect-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionId: 'inspection-current',
          plantId: 'plant-1',
          createdBy: 'user-1',
          defects: [
            {
              item_number: 4,
              item_description: 'windows   & wipers',
              days: [3],
              comment: 'new report',
              primaryInspectionItemId: 'item-current',
            },
          ],
        }),
      })
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.dedupedClosed).toBe(1);
    expect(actionUpdates).toHaveLength(2);
    const closedUpdate = actionUpdates.find((entry) => entry.id === 'plant-task-newer');
    const keeperUpdate = actionUpdates.find((entry) => entry.id === 'plant-task-oldest');
    expect(closedUpdate?.payload.status).toBe('completed');
    expect(keeperUpdate?.payload).not.toHaveProperty('inspection_id');
    expect(keeperUpdate?.payload).not.toHaveProperty('inspection_item_id');
    expect(String(keeperUpdate?.payload.description || '')).toContain('(Mon, Wed)');
    expect(String(keeperUpdate?.payload.description || '')).toContain('Comment: cracked');
    expect(String(keeperUpdate?.payload.description || '')).not.toContain('Comment: new report');
  });

  it('hgv sync keeps oldest task and skips creating duplicate for same signature', async () => {
    mockAuthenticatedUser();

    const actionUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
    const activeTasks = [
      {
        id: 'hgv-task-oldest',
        status: 'pending',
        title: 'HX01 ABC - Brakes',
        description: 'HGV inspection defect found:\nItem 9 - Brakes (Mon)\nComment: low pressure',
        inspection_id: 'hgv-inspection-old',
        inspection_item_id: 'hgv-item-old',
        hgv_id: 'hgv-1',
        created_at: '2026-03-01T08:00:00.000Z',
      },
      {
        id: 'hgv-task-newer',
        status: 'in_progress',
        title: 'HX01 ABC - Brakes',
        description: 'HGV inspection defect found:\nItem 9 - Brakes (Wed)\nComment: still low pressure',
        inspection_id: 'hgv-inspection-new',
        inspection_item_id: 'hgv-item-new',
        hgv_id: 'hgv-1',
        created_at: '2026-03-02T08:00:00.000Z',
      },
    ];

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'hgvs') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { reg_number: 'HX01 ABC' }, error: null }),
              }),
            }),
          };
        }

        if (table === 'workshop_task_categories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: 'repair-hgv' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'hgv_inspections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'user-1', hgv_id: 'hgv-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'actions') {
          return {
            select: () => {
              const filters: Record<string, unknown> = {};
              const completedTasksPayload = { data: [], error: null } as const;
              const query = createSupabaseQueryMock(
                () => (filters.inspection_id ? { data: [], error: null } : { data: activeTasks, error: null }),
                []
              );
              query.eq = vi.fn((column: string, value: unknown) => {
                  filters[column] = value;
                  return query;
                });
              query.in = vi.fn(async () => ({ data: activeTasks, error: null }));
              query.order = vi.fn(() => ({
                  limit: async () => completedTasksPayload,
                }));
              return query;
            },
            update: (payload: Record<string, unknown>) => ({
              eq: async (_column: string, value: string) => {
                actionUpdates.push({ id: value, payload });
                return { error: null };
              },
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await hgvSyncPost(
      new NextRequest('http://localhost/api/hgv-inspections/sync-defect-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionId: 'hgv-inspection-current',
          hgvId: 'hgv-1',
          createdBy: 'user-1',
          defects: [
            {
              item_number: 9,
              item_description: 'BRAKES',
              dayOfWeek: 3,
              comment: 'fresh report',
              primaryInspectionItemId: 'hgv-item-current',
            },
          ],
        }),
      })
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.dedupedClosed).toBe(1);
    expect(actionUpdates).toHaveLength(2);
    const closedUpdate = actionUpdates.find((entry) => entry.id === 'hgv-task-newer');
    const keeperUpdate = actionUpdates.find((entry) => entry.id === 'hgv-task-oldest');
    expect(closedUpdate?.payload.status).toBe('completed');
    expect(keeperUpdate?.payload).not.toHaveProperty('inspection_id');
    expect(keeperUpdate?.payload).not.toHaveProperty('inspection_item_id');
    expect(String(keeperUpdate?.payload.description || '')).toContain('(Mon, Wed)');
    expect(String(keeperUpdate?.payload.description || '')).toContain('Comment: low pressure');
    expect(String(keeperUpdate?.payload.description || '')).not.toContain('Comment: fresh report');
  });

  it('hgv sync uses inserted database id for same-signature defects in one batch', async () => {
    mockAuthenticatedUser();

    const actionUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
    let insertCalls = 0;
    const insertedActionRow = {
      id: 'hgv-db-action-1',
      status: 'pending',
      title: 'HX01 ABC - Brakes',
      description: 'HGV inspection defect found:\nItem 9 - Brakes (Mon)\nComment: initial',
      inspection_id: 'hgv-inspection-current',
      inspection_item_id: 'hgv-item-a',
      hgv_id: 'hgv-1',
      created_at: '2026-03-03T08:00:00.000Z',
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'hgvs') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { reg_number: 'HX01 ABC' }, error: null }),
              }),
            }),
          };
        }

        if (table === 'workshop_task_categories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: 'repair-hgv' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'hgv_inspections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'user-1', hgv_id: 'hgv-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'actions') {
          return {
            select: () => {
              const filters: Record<string, unknown> = {};
              const completedTasksPayload = { data: [], error: null } as const;
              const query = createSupabaseQueryMock({ data: [], error: null }, []);
              query.eq = vi.fn((column: string, value: unknown) => {
                  filters[column] = value;
                  return query;
                });
              query.in = vi.fn(async () => ({ data: [], error: null }));
              query.order = vi.fn(() => ({
                  limit: async () => completedTasksPayload,
                }));
              return query;
            },
            update: (payload: Record<string, unknown>) => ({
              eq: async (_column: string, value: string) => {
                actionUpdates.push({ id: value, payload });
                return { error: null };
              },
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: insertCalls++ === 0 ? insertedActionRow : null,
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await hgvSyncPost(
      new NextRequest('http://localhost/api/hgv-inspections/sync-defect-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionId: 'hgv-inspection-current',
          hgvId: 'hgv-1',
          createdBy: 'user-1',
          defects: [
            {
              item_number: 9,
              item_description: 'Brakes',
              days: [1],
              comment: 'initial',
              primaryInspectionItemId: 'hgv-item-a',
            },
            {
              item_number: 9,
              item_description: 'Brakes',
              days: [3],
              comment: 'follow-up',
              primaryInspectionItemId: 'hgv-item-b',
            },
          ],
        }),
      })
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.updated).toBe(1);
    expect(body.skipped).toBe(0);
    expect(actionUpdates).toHaveLength(1);
    expect(actionUpdates[0]?.id).toBe('hgv-db-action-1');
    expect(actionUpdates[0]?.payload).not.toHaveProperty('inspection_id');
    expect(actionUpdates[0]?.payload).not.toHaveProperty('inspection_item_id');
    expect(String(actionUpdates[0]?.payload.description || '')).toContain('Comment: initial');
    expect(String(actionUpdates[0]?.payload.description || '')).not.toContain('Comment: follow-up');
  });

  it('van sync reuses active defect task without mutating original inspection links', async () => {
    mockAuthenticatedUser();

    const actionUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
    const activeTasks = [
      {
        id: 'van-task-original',
        status: 'pending',
        title: 'VN01 ABC - Tyres',
        description: 'Van inspection defect found:\nItem 2 - Tyres (Monday)\nComment: original tyre split',
        inspection_id: 'van-inspection-original',
        inspection_item_id: 'van-item-original',
        van_id: 'van-1',
        created_at: '2026-03-01T08:00:00.000Z',
      },
    ];

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'van_inspections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'user-1', van_id: 'van-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'vans') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { reg_number: 'VN01 ABC' }, error: null }),
              }),
            }),
          };
        }

        if (table === 'workshop_task_categories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: 'repair-van' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'workshop_task_subcategories') {
          return {
            select: () => ({
              eq: () => ({
                ilike: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: 'inspection-defects' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'actions') {
          return {
            select: () => {
              const filters: Record<string, unknown> = {};
              const completedTasksPayload = { data: [], error: null } as const;
              const query = createSupabaseQueryMock(
                () => (filters.inspection_id ? { data: [], error: null } : { data: activeTasks, error: null }),
                []
              );
              query.eq = vi.fn((column: string, value: unknown) => {
                filters[column] = value;
                return query;
              });
              query.in = vi.fn(async () => ({ data: activeTasks, error: null }));
              query.order = vi.fn(() => ({
                limit: async () => completedTasksPayload,
              }));
              return query;
            },
            update: (payload: Record<string, unknown>) => ({
              eq: async (_column: string, value: string) => {
                actionUpdates.push({ id: value, payload });
                return { error: null };
              },
            }),
            insert: () => ({ error: null }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await vanSyncPost(
      new NextRequest('http://localhost/api/van-inspections/sync-defect-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionId: 'van-inspection-current',
          vehicleId: 'van-1',
          createdBy: 'user-1',
          defects: [
            {
              item_number: 2,
              item_description: 'Tyres',
              days: [3],
              comment: 'current tyre split',
              primaryInspectionItemId: 'van-item-current',
            },
          ],
        }),
      })
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);
    expect(actionUpdates).toHaveLength(1);
    expect(actionUpdates[0]?.id).toBe('van-task-original');
    expect(actionUpdates[0]?.payload).not.toHaveProperty('inspection_id');
    expect(actionUpdates[0]?.payload).not.toHaveProperty('inspection_item_id');
    expect(String(actionUpdates[0]?.payload.description || '')).toContain('Comment: original tyre split');
    expect(String(actionUpdates[0]?.payload.description || '')).not.toContain('Comment: current tyre split');
  });

  it('plant locked-defects includes pending tasks as locked items', async () => {
    mockAuthenticatedUser();

    let statusFilter: string[] = [];
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'actions') {
          const query = {
            select: () => query,
            eq: () => query,
            in: (_column: string, values: string[]) => {
              statusFilter = values;
              return Promise.resolve({
                data: [
                  {
                    id: 'plant-task-pending',
                    status: 'pending',
                    logged_comment: 'Defect pending with workshop',
                    workshop_comments: 'Workshop status should not be copied',
                    description: 'Plant inspection defect found:\nItem 2 - Mirrors\nComment: cracked',
                    inspection_item_id: 'plant-item-2',
                    inspection_id: 'plant-inspection-1',
                  },
                ],
                error: null,
              });
            },
          };
          return query;
        }

        if (table === 'inspection_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'plant-item-2',
                  item_number: 2,
                  item_description: 'Mirrors',
                  comments: 'Original mirror crack',
                }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await plantLockedDefectsGet(
      new NextRequest('http://localhost/api/plant-inspections/locked-defects?plantId=plant-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(statusFilter).toContain('pending');
    expect(body.lockedItems).toHaveLength(1);
    expect(body.lockedItems[0]).toMatchObject({
      item_number: 2,
      status: 'pending',
      actionId: 'plant-task-pending',
      comment: 'Original mirror crack',
    });
  });

  it('van locked-defects returns original inspection item comment over workshop comments', async () => {
    mockAuthenticatedUser();

    let statusFilter: string[] = [];
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'actions') {
          const query = {
            select: () => query,
            eq: () => query,
            in: (_column: string, values: string[]) => {
              statusFilter = values;
              return Promise.resolve({
                data: [
                  {
                    id: 'van-task-pending',
                    status: 'pending',
                    logged_comment: 'Defect pending with workshop',
                    workshop_comments: 'Workshop status should not be copied',
                    description: 'Van inspection defect found:\nItem 5 - Lights (Monday)\nComment: original side light out',
                    inspection_item_id: 'van-item-5',
                    inspection_id: 'van-inspection-1',
                  },
                ],
                error: null,
              });
            },
          };
          return query;
        }

        if (table === 'inspection_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'van-item-5',
                  item_number: 5,
                  item_description: 'Lights',
                  comments: 'Original side light out',
                }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await vanLockedDefectsGet(
      new NextRequest('http://localhost/api/van-inspections/locked-defects?vehicleId=van-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(statusFilter).toContain('pending');
    expect(body.lockedItems).toHaveLength(1);
    expect(body.lockedItems[0]).toMatchObject({
      item_number: 5,
      status: 'pending',
      actionId: 'van-task-pending',
      comment: 'Original side light out',
    });
  });

  it('hgv locked-defects includes pending tasks as locked items', async () => {
    mockAuthenticatedUser();

    let statusFilter: string[] = [];
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'actions') {
          const query = {
            select: () => query,
            eq: () => query,
            in: (_column: string, values: string[]) => {
              statusFilter = values;
              return Promise.resolve({
                data: [
                  {
                    id: 'hgv-task-pending',
                    status: 'pending',
                    logged_comment: 'Defect pending with workshop',
                    workshop_comments: 'Workshop status should not be copied',
                    description: 'HGV inspection defect found:\nItem 11 - Tyres\nComment: split',
                    inspection_item_id: 'hgv-item-11',
                  },
                ],
                error: null,
              });
            },
          };
          return query;
        }

        if (table === 'inspection_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'hgv-item-11',
                  item_number: 11,
                  item_description: 'Tyres',
                  comments: 'Original tyre split',
                }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

    const response = await hgvLockedDefectsGet(
      new NextRequest('http://localhost/api/hgv-inspections/locked-defects?hgvId=hgv-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(statusFilter).toContain('pending');
    expect(body.lockedItems).toHaveLength(1);
    expect(body.lockedItems[0]).toMatchObject({
      item_number: 11,
      status: 'pending',
      actionId: 'hgv-task-pending',
      comment: 'Original tyre split',
    });
  });
});
