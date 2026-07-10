import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { DELETE, PATCH } from '@/app/api/inventory/[id]/route';

function buildRequest(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/inventory/item-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('inventory item retirement route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
    });
  });

  it('requires an approved retirement reason when retiring an item', async () => {
    const response = await DELETE(
      buildRequest('DELETE', { retire_reason: 'Missing' }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Valid retirement reason is required' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('soft-retires an item with metadata', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        expect(table).toBe('inventory_items');
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return {
              async eq(column: string, value: string) {
                expect(column).toBe('id');
                expect(value).toBe('item-1');
                return { error: null };
              },
            };
          },
        };
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await DELETE(
      buildRequest('DELETE', { retire_reason: 'Lost' }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'retired',
      retire_reason: 'Lost',
      retired_by: 'user-1',
      updated_by: 'user-1',
    });
    expect(typeof updates[0].retired_at).toBe('string');
  });

  it('clears retirement metadata when restoring an item', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        expect(table).toBe('inventory_items');
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return {
              eq() {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: { id: 'item-1', status: 'active' },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(
      buildRequest('PATCH', { status: 'active' }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updates[0]).toMatchObject({
      status: 'active',
      retired_at: null,
      retire_reason: null,
      retired_by: null,
      updated_by: 'user-1',
    });
  });
});
