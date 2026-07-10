import { describe, expect, it, vi } from 'vitest';
import {
  generateFleetInspectionReminderActions,
  hasOpenFleetInspectionActionsWithStaleInspectionMetadata,
  loadLatestInspectionDates,
} from '@/lib/server/reminders/generate-fleet-inspection-actions';

interface QueryResult<T> {
  data: T[];
  error: null;
}

function createThenableQuery<T>(result: QueryResult<T>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    then: <TResult1 = QueryResult<T>, TResult2 = never>(
      onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };

  return query;
}

function createAdminMock(options: {
  actions: Array<Record<string, unknown>>;
  vanInspections?: Array<Record<string, unknown>>;
  plantInspections?: Array<Record<string, unknown>>;
  hgvInspections?: Array<Record<string, unknown>>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'reminder_actions') {
        return createThenableQuery({ data: options.actions, error: null });
      }

      if (table === 'van_inspections') {
        return createThenableQuery({ data: options.vanInspections || [], error: null });
      }

      if (table === 'plant_inspections') {
        return createThenableQuery({ data: options.plantInspections || [], error: null });
      }

      if (table === 'hgv_inspections') {
        return createThenableQuery({ data: options.hgvInspections || [], error: null });
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createGenerationAdminMock() {
  const actionUpdates: Record<string, unknown>[] = [];
  const actionUpdateIds: string[][] = [];
  const reminderUpdates: Record<string, unknown>[] = [];
  const reminderUpdateActionIds: string[][] = [];
  const settingsUpdates: Record<string, unknown>[] = [];

  const createQuery = <T>(result: QueryResult<T>) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: result.data[0] || null, error: null })),
      then: <TResult1 = QueryResult<T>, TResult2 = never>(
        onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(result).then(onfulfilled, onrejected),
    };

    return query;
  };

  return {
    actionUpdates,
    actionUpdateIds,
    reminderUpdates,
    reminderUpdateActionIds,
    settingsUpdates,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'reminder_workflow_settings') {
          return {
            select: vi.fn(() => createQuery({
              data: [{
                workflow_key: 'fleet_inspection_overdue',
                is_enabled: true,
                config: {
                  overdue_days_threshold: 28,
                  asset_types: { van: true, plant: true, hgv: true },
                },
                updated_by: null,
                last_generated_at: '2026-06-02T11:55:00.000Z',
                created_at: '2026-06-01T00:00:00.000Z',
                updated_at: '2026-06-01T00:00:00.000Z',
              }],
              error: null,
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              settingsUpdates.push(payload);
              return {
                eq: vi.fn(async () => ({ error: null })),
              };
            }),
          };
        }

        if (table === 'vans') {
          return createQuery({
            data: [{ id: 'van-1', reg_number: 'YP21 KXU', nickname: 'Kieran Lange' }],
            error: null,
          });
        }

        if (table === 'hgvs' || table === 'plant' || table === 'vehicle_maintenance') {
          return createQuery({ data: [], error: null });
        }

        if (table === 'van_inspections') {
          return createQuery({
            data: [{
              van_id: 'van-1',
              inspection_date: '2026-06-02',
              inspection_end_date: '2026-06-02',
              status: 'submitted',
            }],
            error: null,
          });
        }

        if (table === 'plant_inspections' || table === 'hgv_inspections') {
          return createQuery({ data: [], error: null });
        }

        if (table === 'reminder_actions') {
          return {
            select: vi.fn(() => createQuery({
              data: [{
                id: 'action-1',
                dedupe_key: 'fleet_inspection_overdue:van:van-1',
                metadata: {},
                reminders: [],
              }],
              error: null,
            })),
            insert: vi.fn(async () => ({ error: null })),
            update: vi.fn((payload: Record<string, unknown>) => {
              actionUpdates.push(payload);
              return {
                in: vi.fn(async (_column: string, ids: string[]) => {
                  actionUpdateIds.push(ids);
                  return { error: null };
                }),
              };
            }),
          };
        }

        if (table === 'reminders') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              reminderUpdates.push(payload);
              return {
                in: vi.fn((_column: string, ids: string[]) => {
                  reminderUpdateActionIds.push(ids);
                  return {
                    eq: vi.fn(() => ({
                      select: vi.fn(async () => ({ data: [], error: null })),
                    })),
                  };
                }),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('fleet inspection actions', () => {
  it('pages submitted inspections so latest dates are not capped at the first 1000 rows', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      van_id: `older-van-${index}`,
      inspection_date: '2026-01-01',
    }));
    const secondPage = [
      {
        van_id: 'target-van',
        inspection_date: '2026-06-02',
      },
    ];
    const pages = [firstPage, secondPage];
    const rangeCalls: Array<[number, number]> = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => {
        rangeCalls.push([from, to]);
        return {
          data: pages.shift() || [],
          error: null,
        };
      }),
    };
    const admin = {
      from: vi.fn(() => query),
    };

    const latestDates = await loadLatestInspectionDates(
      admin as never,
      'van_inspections',
      'van_id',
      ['target-van'],
    );

    expect(latestDates.get('target-van')).toBe('2026-06-02');
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('resolves an unassigned van action when a submitted daily check now exists', async () => {
    const admin = createGenerationAdminMock();

    await expect(
      generateFleetInspectionReminderActions({
        admin: admin.client as never,
        nowIso: '2026-06-02T12:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      inserted: 0,
      updated: 0,
      resolved: 1,
      openCount: 0,
    });

    expect(admin.actionUpdates[0]).toMatchObject({
      status: 'resolved',
      resolved_at: '2026-06-02T12:00:00.000Z',
      last_detected_at: '2026-06-02T12:00:00.000Z',
    });
    expect(admin.actionUpdateIds).toEqual([['action-1']]);
    expect(admin.reminderUpdates[0]).toMatchObject({
      status: 'cancelled',
      cancelled_at: '2026-06-02T12:00:00.000Z',
    });
    expect(admin.reminderUpdateActionIds).toEqual([['action-1']]);
  });

  it('treats an open van action as stale when a submitted daily check exists but metadata says never', async () => {
    const admin = createAdminMock({
      actions: [
        {
          asset_type: 'van',
          van_id: 'van-1',
          plant_id: null,
          hgv_id: null,
          metadata: {},
        },
      ],
      vanInspections: [
        {
          van_id: 'van-1',
          inspection_date: '2026-06-02',
          inspection_end_date: '2026-06-02',
          status: 'submitted',
        },
      ],
    });

    await expect(
      hasOpenFleetInspectionActionsWithStaleInspectionMetadata(admin as never, {
        thresholdDays: 28,
        today: new Date('2026-06-02T12:00:00.000Z'),
      }),
    ).resolves.toBe(true);
  });

  it('keeps a matching overdue latest submitted date fresh', async () => {
    const admin = createAdminMock({
      actions: [
        {
          asset_type: 'van',
          van_id: 'van-1',
          plant_id: null,
          hgv_id: null,
          metadata: {
            last_submitted_inspection_date: '2026-04-01',
          },
        },
      ],
      vanInspections: [
        {
          van_id: 'van-1',
          inspection_date: '2026-04-01',
          inspection_end_date: '2026-04-01',
          status: 'submitted',
        },
      ],
    });

    await expect(
      hasOpenFleetInspectionActionsWithStaleInspectionMetadata(admin as never, {
        thresholdDays: 28,
        today: new Date('2026-06-02T12:00:00.000Z'),
      }),
    ).resolves.toBe(false);
  });
});
