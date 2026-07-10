import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/inspection-route-access', () => ({
  getInspectionRouteActorAccess: vi.fn(),
}));

import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { POST as vanSyncPost } from '@/app/api/van-inspections/sync-defect-tasks/route';
import { POST as hgvSyncPost } from '@/app/api/hgv-inspections/sync-defect-tasks/route';
import { POST as plantSyncPost } from '@/app/api/plant-inspections/sync-defect-tasks/route';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

type AssetKind = 'van' | 'hgv' | 'plant';

interface RouteCase {
  name: string;
  assetKind: AssetKind;
  route: (request: NextRequest) => Promise<Response>;
  url: string;
  requestBody: Record<string, unknown>;
}

interface MockClientOptions {
  assetKind: AssetKind;
  activeTasks?: unknown[];
  existingTasks?: unknown[];
  completedTasks?: Array<{ description: string; actioned_at: string; updated_at?: string | null }>;
  insertCalls: unknown[];
}

function buildRecentCompletionTimestamp(): string {
  return new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
}

const ROUTE_CASES: RouteCase[] = [
  {
    name: 'van',
    assetKind: 'van',
    route: vanSyncPost,
    url: 'http://localhost/api/van-inspections/sync-defect-tasks',
    requestBody: {
      inspectionId: 'van-inspection-1',
      vehicleId: 'van-1',
      createdBy: 'user-1',
      defects: [
        {
          item_number: 3,
          item_description: 'Tyres',
          days: [2, 3],
          comment: 'tyres ordered and arrived',
          primaryInspectionItemId: 'van-item-1',
        },
      ],
    },
  },
  {
    name: 'hgv',
    assetKind: 'hgv',
    route: hgvSyncPost,
    url: 'http://localhost/api/hgv-inspections/sync-defect-tasks',
    requestBody: {
      inspectionId: 'hgv-inspection-1',
      hgvId: 'hgv-1',
      createdBy: 'user-1',
      defects: [
        {
          item_number: 3,
          item_description: 'Tyres',
          days: [7],
          comment: 'fresh report',
          primaryInspectionItemId: 'hgv-item-1',
        },
      ],
    },
  },
  {
    name: 'plant',
    assetKind: 'plant',
    route: plantSyncPost,
    url: 'http://localhost/api/plant-inspections/sync-defect-tasks',
    requestBody: {
      inspectionId: 'plant-inspection-1',
      plantId: 'plant-1',
      createdBy: 'user-1',
      defects: [
        {
          item_number: 3,
          item_description: 'Tyres',
          days: [7],
          comment: 'fresh report',
          primaryInspectionItemId: 'plant-item-1',
        },
      ],
    },
  },
];

function buildActionsTable({
  activeTasks = [],
  existingTasks = [],
  completedTasks = [],
  insertCalls,
}: Omit<MockClientOptions, 'assetKind'>) {
  return {
    select: () => {
      const filters: Record<string, unknown> = {};
      const query = createSupabaseQueryMock(
        () => (filters.inspection_id ? { data: existingTasks, error: null } : { data: [], error: null }),
        []
      );
      query.eq = vi.fn((column: string, value: unknown) => {
          filters[column] = value;
          return query;
        });
      query.in = vi.fn(async () => ({ data: activeTasks, error: null }));
      query.order = vi.fn(() => ({
          limit: async () => ({ data: completedTasks, error: null }),
        }));
      return query;
    },
    update: () => ({
      eq: async () => ({ error: null }),
    }),
    insert: (payload: unknown) => {
      insertCalls.push(payload);
      const insertQuery = createSupabaseQueryMock({ error: null }, []);
      insertQuery.select = vi.fn(() => ({
          single: async () => ({ data: null, error: null }),
        }));
      return insertQuery;
    },
  };
}

function createMockAdminClient(options: MockClientOptions) {
  const actionsTable = buildActionsTable(options);

  return {
    from: vi.fn((table: string) => {
      if (table === 'actions') {
        return actionsTable;
      }

      if (options.assetKind === 'van') {
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
                single: async () => ({ data: { reg_number: 'ME73 YBO' }, error: null }),
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
                    single: async () => ({ data: { id: 'inspection-defects-van' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
      }

      if (options.assetKind === 'hgv') {
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
      }

      if (options.assetKind === 'plant') {
        if (table === 'plant_inspections') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { user_id: 'user-1', plant_id: 'plant-1', is_hired_plant: false },
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
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('inspection defect recent completion guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: { userId: 'user-1', canManageOthers: true, canDeleteInspections: true },
      errorResponse: null,
    });
  });

  it.each(ROUTE_CASES)(
    'skips creating a new $name defect task when the same defect was completed recently',
    async ({ assetKind, route, url, requestBody }) => {
      const insertCalls: unknown[] = [];
      const recentCompletionTimestamp = buildRecentCompletionTimestamp();
      const adminClient = createMockAdminClient({
        assetKind,
        completedTasks: [
          {
            description:
              assetKind === 'van'
                ? 'Van inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report'
                : assetKind === 'hgv'
                  ? 'HGV inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report'
                  : 'Plant inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report',
            actioned_at: recentCompletionTimestamp,
          },
        ],
        insertCalls,
      });

      vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

      const response = await route(
        new NextRequest(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
      );

      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.created).toBe(0);
      expect(body.skipped).toBe(1);
      expect(insertCalls).toHaveLength(0);
    }
  );

  it.each(ROUTE_CASES)(
    'allows $name repeat defects when reconfirmed with a non-normalized signature payload',
    async ({ assetKind, route, url, requestBody }) => {
      const insertCalls: unknown[] = [];
      const recentCompletionTimestamp = buildRecentCompletionTimestamp();
      const adminClient = createMockAdminClient({
        assetKind,
        completedTasks: [
          {
            description:
              assetKind === 'van'
                ? 'Van inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report'
                : assetKind === 'hgv'
                  ? 'HGV inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report'
                  : 'Plant inspection defect found:\nItem 3 - Tyres (Sunday)\nComment: previous report',
            actioned_at: recentCompletionTimestamp,
          },
        ],
        insertCalls,
      });

      vi.mocked(createSupabaseJsClient).mockReturnValue(adminClient as never);

      const response = await route(
        new NextRequest(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...requestBody,
            confirmedRepeatDefectSignatures: [' 3 -   TYRES '],
          }),
        })
      );

      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.created).toBe(1);
      expect(body.skipped).toBe(0);
      expect(insertCalls).toHaveLength(1);
    }
  );
});
