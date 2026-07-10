import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  INVENTORY_PAT_CHECKLIST_ITEMS,
  INVENTORY_PAT_CHECKLIST_VERSION,
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
} from '@/lib/checklists/inventory-service-checklist';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from '@/app/api/inventory/[id]/checks/route';

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inventory/item-1/checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildChecklist(
  status: 'ok' | 'attention' | 'na' = 'ok',
  items = INVENTORY_SERVICE_CHECKLIST_ITEMS,
) {
  return items.map((item) => ({
    ...item,
    status,
    comment: status === 'attention' ? 'Failed check details' : null,
  }));
}

describe('inventory check route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
    });
  });

  it('rejects incomplete structured checklists before touching the database', async () => {
    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_items: buildChecklist().slice(0, -1),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checklist is incomplete' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects unsupported checklist versions before touching the database', async () => {
    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: 'unsupported-checklist-v1',
        checklist_items: buildChecklist(),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unsupported checklist version' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('requires comments for failed checklist items', async () => {
    const checklist = buildChecklist();
    checklist[0] = { ...checklist[0], status: 'attention', comment: null };

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_items: checklist,
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checklist item 1 requires a fail comment' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('requires comments for failed PAT checklist items', async () => {
    const checklist = buildChecklist('ok', INVENTORY_PAT_CHECKLIST_ITEMS);
    checklist[0] = { ...checklist[0], status: 'attention', comment: null };

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: INVENTORY_PAT_CHECKLIST_VERSION,
        checklist_items: checklist,
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checklist item 1 requires a fail comment' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('stores canonical checklist data and derives the overall status', async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const updatedRows: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        if (table === 'inventory_items') {
          return {
            select() {
              return {
                eq() {
                  return {
                    async single() {
                      return {
                        data: { id: 'item-1', check_interval_days: 30, last_checked_at: null, status: 'active' },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              updatedRows.push(payload);
              return {
                async eq() {
                  return { error: null };
                },
              };
            },
          };
        }

        if (table === 'inventory_check_history') {
          return {
            insert(payload: Record<string, unknown>) {
              insertedRows.push(payload);
              return {
                select() {
                  return {
                    async single() {
                      return { data: { id: 'check-1', ...payload }, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const checklist = buildChecklist();
    checklist[0] = { ...checklist[0], status: 'attention', comment: 'Replace spark plug' };

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: INVENTORY_SERVICE_CHECKLIST_VERSION,
        checklist_items: checklist,
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      item_id: 'item-1',
      checked_at: '2026-06-01',
      interval_days: 30,
      checklist_version: INVENTORY_SERVICE_CHECKLIST_VERSION,
      overall_status: 'fail',
      checked_by: 'user-1',
    });
    expect(insertedRows[0].checklist_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_number: 1,
          label: 'Spark Plug',
          status: 'attention',
          comment: 'Replace spark plug',
        }),
      ]),
    );
    expect(updatedRows).toEqual([{ last_checked_at: '2026-06-01', updated_by: 'user-1' }]);
  });

  it('stores PAT checklist data and counts it as the latest check', async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const updatedRows: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        if (table === 'inventory_items') {
          return {
            select() {
              return {
                eq() {
                  return {
                    async single() {
                      return {
                        data: { id: 'item-1', check_interval_days: 30, last_checked_at: '2026-05-01', status: 'active' },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              updatedRows.push(payload);
              return {
                async eq() {
                  return { error: null };
                },
              };
            },
          };
        }

        if (table === 'inventory_check_history') {
          return {
            insert(payload: Record<string, unknown>) {
              insertedRows.push(payload);
              return {
                select() {
                  return {
                    async single() {
                      return { data: { id: 'check-1', ...payload }, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const checklist = buildChecklist('ok', INVENTORY_PAT_CHECKLIST_ITEMS);

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: INVENTORY_PAT_CHECKLIST_VERSION,
        checklist_items: checklist,
        note: 'PAT complete',
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      item_id: 'item-1',
      checked_at: '2026-06-01',
      interval_days: 30,
      note: 'PAT complete',
      checklist_version: INVENTORY_PAT_CHECKLIST_VERSION,
      overall_status: 'pass',
      checked_by: 'user-1',
    });
    expect(insertedRows[0].checklist_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_number: 1,
          label: 'Cable',
          status: 'ok',
          comment: null,
        }),
      ]),
    );
    expect(updatedRows).toEqual([{ last_checked_at: '2026-06-01', updated_by: 'user-1' }]);
  });
});
