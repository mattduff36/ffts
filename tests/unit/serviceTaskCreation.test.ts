import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResponse = {
  terminal: 'limit' | 'single';
  table: string;
  data: unknown;
  error?: unknown;
};

type MockState = {
  queue: QueuedResponse[];
  fromCalls: string[];
  insertCalls: Array<{ table: string; payload: Record<string, unknown> }>;
};

const { mockState, mockCreateClient } = vi.hoisted(() => {
  const state: MockState = {
    queue: [],
    fromCalls: [],
    insertCalls: [],
  };

  const createClient = vi.fn(() => ({
    from: vi.fn((table: string) => {
      state.fromCalls.push(table);
      return createQueryBuilder(table);
    }),
  }));

  return { mockState: state, mockCreateClient: createClient };
});

function nextResponse(terminal: 'limit' | 'single', table: string) {
  const next = mockState.queue.shift();
  if (!next) {
    throw new Error(`Missing queued response for ${terminal}:${table}`);
  }
  if (next.terminal !== terminal || next.table !== table) {
    throw new Error(
      `Unexpected query sequence. Expected ${next.terminal}:${next.table}, received ${terminal}:${table}`
    );
  }
  return { data: next.data, error: next.error ?? null };
}

interface QueryChain {
  select: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

function createQueryBuilder(table: string): QueryChain {
  const chain = {
    select: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(async () => nextResponse('limit', table)),
    single: vi.fn(async () => nextResponse('single', table)),
    insert: vi.fn((payload: Record<string, unknown>) => {
      mockState.insertCalls.push({ table, payload });
      return chain;
    }),
  } as QueryChain;
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

import {
  ensureServiceTasksForAlerts,
  getTaskContent,
  resetCategoryCache,
  type AlertSeverity,
  type AlertType,
} from '@/lib/utils/serviceTaskCreation';

describe('Service Task Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCategoryCache();
    mockState.queue = [];
    mockState.fromCalls = [];
    mockState.insertCalls = [];
  });

  it('returns deterministic task content by alert type', () => {
    const tax = getTaskContent('Tax', 'AB12 CDE', 'Overdue by 4 days');
    const loler = getTaskContent('LOLER', 'PLANT-07', 'Due in 2 days');

    expect(tax.title).toBe('Tax Due - AB12 CDE');
    expect(tax.comments).toContain('Vehicle tax requires renewal');
    expect(loler.title).toBe('LOLER THOROUGH EXAMINATION Due - PLANT-07');
    expect(loler.comments).toContain('Lifting Operations and Lifting Equipment Regulations');
  });

  it('returns empty list when vehicle has no alerts', async () => {
    const result = await ensureServiceTasksForAlerts(
      { id: 'van-1', vehicle: { id: 'van-1', reg_number: 'AB12 CDE' }, alerts: [] },
      'user-1'
    );

    expect(result).toEqual([]);
    expect(mockState.fromCalls).toHaveLength(0);
  });

  it('creates one task per alert, mapping severity to priority', async () => {
    mockState.queue.push(
      { terminal: 'limit', table: 'workshop_task_categories', data: [{ id: 'cat-maint' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [{ id: 'sub-service' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [] },
      { terminal: 'limit', table: 'actions', data: [] },
      { terminal: 'single', table: 'actions', data: { id: 'task-1' } },
      { terminal: 'limit', table: 'actions', data: [] },
      { terminal: 'single', table: 'actions', data: { id: 'task-2' } }
    );

    const alerts: Array<{ type: AlertType; detail: string; severity: AlertSeverity }> = [
      { type: 'Tax', detail: 'Overdue by 3 days', severity: 'overdue' },
      { type: 'MOT', detail: 'Due in 9 days', severity: 'due_soon' },
    ];

    const createdIds = await ensureServiceTasksForAlerts(
      { id: 'van-1', vehicle: { id: 'van-1', reg_number: 'AB12 CDE' }, alerts },
      'manager-1'
    );

    expect(createdIds).toEqual(['task-1', 'task-2']);
    expect(mockState.insertCalls).toHaveLength(2);
    expect(mockState.insertCalls[0].payload.priority).toBe('high');
    expect(mockState.insertCalls[1].payload.priority).toBe('medium');
    expect(mockState.insertCalls[0].payload.title).toBe('Tax Due - AB12 CDE');
    expect(mockState.insertCalls[1].payload.title).toBe('MOT Due - AB12 CDE');
  });

  it('skips insertion when an active matching task already exists', async () => {
    mockState.queue.push(
      { terminal: 'limit', table: 'workshop_task_categories', data: [{ id: 'cat-maint' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [{ id: 'sub-service' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [] },
      { terminal: 'limit', table: 'actions', data: [{ id: 'existing-1', status: 'pending' }] }
    );

    const result = await ensureServiceTasksForAlerts(
      {
        id: 'van-1',
        vehicle: { id: 'van-1', reg_number: 'AB12 CDE' },
        alerts: [{ type: 'Service', detail: 'Due at 50000', severity: 'due_soon' }],
      },
      'manager-1'
    );

    expect(result).toEqual([]);
    expect(mockState.insertCalls).toHaveLength(0);
  });

  it('falls back to uncategorized subcategory when maintenance category is unavailable', async () => {
    mockState.queue.push(
      { terminal: 'limit', table: 'workshop_task_categories', data: [] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [{ id: 'sub-uncat' }] },
      { terminal: 'limit', table: 'actions', data: [] },
      { terminal: 'single', table: 'actions', data: { id: 'task-3' } }
    );

    const result = await ensureServiceTasksForAlerts(
      {
        id: 'van-2',
        vehicle: { id: 'van-2', reg_number: 'XY99 ZZZ' },
        alerts: [{ type: 'First Aid Kit', detail: 'Expired', severity: 'overdue' }],
      },
      'manager-1'
    );

    expect(result).toEqual(['task-3']);
    expect(mockState.insertCalls[0].payload.workshop_subcategory_id).toBe('sub-uncat');
  });

  it('caches category lookups across repeated invocations', async () => {
    mockState.queue.push(
      { terminal: 'limit', table: 'workshop_task_categories', data: [{ id: 'cat-maint' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [{ id: 'sub-service' }] },
      { terminal: 'limit', table: 'workshop_task_subcategories', data: [] },
      { terminal: 'limit', table: 'actions', data: [] },
      { terminal: 'single', table: 'actions', data: { id: 'task-a' } },
      { terminal: 'limit', table: 'actions', data: [] },
      { terminal: 'single', table: 'actions', data: { id: 'task-b' } }
    );

    const vehicle = {
      id: 'van-1',
      vehicle: { id: 'van-1', reg_number: 'AB12 CDE' },
      alerts: [{ type: 'Tax' as AlertType, detail: 'Overdue', severity: 'overdue' as AlertSeverity }],
    };

    await ensureServiceTasksForAlerts(vehicle, 'user-1');
    await ensureServiceTasksForAlerts(vehicle, 'user-1');

    const categoryLookups = mockState.fromCalls.filter((table) => table === 'workshop_task_categories');
    expect(categoryLookups).toHaveLength(1);
  });
});
