/* @vitest-environment happy-dom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value,
    configurable: true,
  });
}

describe('database health server handling', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/server/database-health');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('classifies direct database connectivity failures without counting auth or generic probe failures', async () => {
    const {
      classifyDatabaseHealthError,
      probeDatabaseHealth,
    } = await import('@/lib/server/database-health');

    expect(classifyDatabaseHealthError(Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' })))
      .toBe('database_unreachable');
    expect(classifyDatabaseHealthError(Object.assign(new Error('bad password'), { code: '28P01' })))
      .toBe('database_auth_failed');
    expect(classifyDatabaseHealthError(new Error('syntax error')))
      .toBe('database_probe_failed');

    const client = {
      connect: vi.fn(async () => {
        throw Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' });
      }),
      query: vi.fn(),
      end: vi.fn(async () => undefined),
    };

    await expect(
      probeDatabaseHealth({
        connectionString: 'postgres://user:pass@localhost:5432/postgres',
        createClient: () => client,
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: 'database_unreachable',
      errorCode: 'ETIMEDOUT',
    });
    expect(client.end).toHaveBeenCalled();
  });

  it('returns the countable 503 payload only for confirmed database-unreachable probes', async () => {
    vi.doMock('@/lib/server/database-health', () => ({
      probeDatabaseHealth: vi.fn(async () => ({
        ok: false,
        reason: 'database_unreachable',
        checkedAt: '2026-06-01T10:00:00.000Z',
        latencyMs: 42,
      })),
      recordDatabaseRecoveryEvent: vi.fn(),
    }));

    const { GET } = await import('@/app/api/system/database-health/route');
    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: 'database_unreachable',
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('database health client monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
    mockPathname = '/dashboard';
    setVisibilityState('visible');
    setOnline(true);
  });

  afterEach(async () => {
    const { resetDatabaseHealthForTests } = await import('@/lib/database/client-health');
    await act(async () => {
      resetDatabaseHealthForTests();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('pauses hidden tabs and ignores client-side network failures', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const {
      getDatabaseHealthState,
      runDatabaseHealthProbe,
    } = await import('@/lib/database/client-health');

    setVisibilityState('hidden');
    await runDatabaseHealthProbe('timer');
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibilityState('visible');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await runDatabaseHealthProbe('nudge');

    expect(getDatabaseHealthState()).toMatchObject({
      outageActive: false,
      failureCount: 0,
    });
  });

  it('requires three confirmed DB failures to show and two spaced healthy responses to clear', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { ok: false, reason: 'database_unreachable' }))
      .mockResolvedValueOnce(jsonResponse(503, { ok: false, reason: 'database_unreachable' }))
      .mockResolvedValueOnce(jsonResponse(503, { ok: false, reason: 'database_unreachable' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, recovery: 'logged' }));
    vi.stubGlobal('fetch', fetchMock);

    const {
      getDatabaseHealthState,
      markDatabaseBackedSuccess,
      runDatabaseHealthProbe,
    } = await import('@/lib/database/client-health');

    markDatabaseBackedSuccess();
    await runDatabaseHealthProbe('timer');
    expect(fetchMock).not.toHaveBeenCalled();

    await runDatabaseHealthProbe('nudge');
    await runDatabaseHealthProbe('nudge');
    await runDatabaseHealthProbe('nudge');

    expect(getDatabaseHealthState()).toMatchObject({
      status: 'outage',
      outageActive: true,
      failureCount: 3,
    });

    await runDatabaseHealthProbe('nudge');
    expect(getDatabaseHealthState().outageActive).toBe(true);

    vi.advanceTimersByTime(10_000);
    await runDatabaseHealthProbe('nudge');

    expect(getDatabaseHealthState()).toMatchObject({
      status: 'healthy',
      outageActive: false,
      failureCount: 0,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/system/database-health',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('supports a debug-only outage emulation that auto-clears after five minutes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const {
      activateDatabaseOutageEmulation,
      DATABASE_OUTAGE_EMULATION_MS,
      getDatabaseHealthState,
      markDatabaseBackedSuccess,
      runDatabaseHealthProbe,
    } = await import('@/lib/database/client-health');

    activateDatabaseOutageEmulation();
    expect(getDatabaseHealthState()).toMatchObject({
      status: 'outage',
      outageActive: true,
      emulatedOutageActive: true,
      failureCount: 3,
    });

    markDatabaseBackedSuccess();
    await runDatabaseHealthProbe('nudge');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDatabaseHealthState().outageActive).toBe(true);

    vi.advanceTimersByTime(DATABASE_OUTAGE_EMULATION_MS - 1);
    expect(getDatabaseHealthState().emulatedOutageActive).toBe(true);

    vi.advanceTimersByTime(1);
    expect(getDatabaseHealthState()).toMatchObject({
      status: 'healthy',
      outageActive: false,
      emulatedOutageActive: false,
      failureCount: 0,
    });
  });

  it('can delay debug outage emulation before starting the five minute timer', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const {
      DATABASE_OUTAGE_EMULATION_MS,
      getDatabaseHealthState,
      scheduleDatabaseOutageEmulation,
    } = await import('@/lib/database/client-health');

    scheduleDatabaseOutageEmulation(30_000);
    expect(getDatabaseHealthState()).toMatchObject({
      status: 'healthy',
      outageActive: false,
      emulatedOutageActive: false,
      failureCount: 0,
    });
    expect(getDatabaseHealthState().emulatedOutageStartsAt).toBe(new Date('2026-06-01T10:00:30.000Z').getTime());

    vi.advanceTimersByTime(29_999);
    expect(getDatabaseHealthState().emulatedOutageActive).toBe(false);

    vi.advanceTimersByTime(1);
    expect(getDatabaseHealthState()).toMatchObject({
      status: 'outage',
      outageActive: true,
      emulatedOutageActive: true,
      failureCount: 3,
    });
    expect(getDatabaseHealthState().emulatedOutageStartsAt).toBeNull();

    vi.advanceTimersByTime(DATABASE_OUTAGE_EMULATION_MS);
    expect(getDatabaseHealthState()).toMatchObject({
      status: 'healthy',
      outageActive: false,
      emulatedOutageActive: false,
      failureCount: 0,
    });
  });
});

describe('DatabaseOutageBlocker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
    mockPathname = '/dashboard';
    setVisibilityState('visible');
    setOnline(true);
  });

  afterEach(async () => {
    const { resetDatabaseHealthForTests } = await import('@/lib/database/client-health');
    await act(async () => {
      resetDatabaseHealthForTests();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('renders a non-dismissible alert overlay that blocks pointer and keyboard interaction', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(async () => jsonResponse(503, { ok: false, reason: 'database_unreachable' }));
    vi.stubGlobal('fetch', fetchMock);

    const { runDatabaseHealthProbe } = await import('@/lib/database/client-health');
    const { DatabaseOutageBlocker } = await import('@/components/system/DatabaseOutageBlocker');
    setVisibilityState('hidden');
    await act(async () => {
      render(
        createElement(
          Fragment,
          null,
          createElement('button', { type: 'button' }, 'Underlying action'),
          createElement(DatabaseOutageBlocker)
        )
      );
    });
    setVisibilityState('visible');

    await act(async () => {
      await runDatabaseHealthProbe('nudge');
      await runDatabaseHealthProbe('nudge');
      await runDatabaseHealthProbe('nudge');
    });

    expect(screen.getByRole('alert').textContent).toContain('Database connection issue');
    expect(screen.queryByRole('button', { name: /dismiss|close/i })).toBeNull();
    expect(fireEvent.pointerDown(screen.getByTestId('database-outage-blocker'))).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
  });

  it('lets debug emulation be manually ended from the warning overlay', async () => {
    mockPathname = '/debug';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));

    const { activateDatabaseOutageEmulation, getDatabaseHealthState } = await import('@/lib/database/client-health');
    const { DatabaseOutageBlocker } = await import('@/components/system/DatabaseOutageBlocker');
    setVisibilityState('hidden');
    await act(async () => {
      render(createElement(DatabaseOutageBlocker));
    });
    setVisibilityState('visible');

    act(() => {
      activateDatabaseOutageEmulation();
    });

    expect(screen.getByRole('alert').textContent).toContain('Database connection issue');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /end emulation/i }));
    });

    expect(getDatabaseHealthState()).toMatchObject({
      outageActive: false,
      emulatedOutageActive: false,
    });
    expect(screen.queryByTestId('database-outage-blocker')).toBeNull();
  });
});

describe('database health recovery dedupe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('merges overlapping reports into one service event and one recovery error log', async () => {
    vi.doUnmock('@/lib/server/database-health');
    const { recordDatabaseRecoveryEvent } = await import('@/lib/server/database-health');
    let event: {
      id: string;
      outage_started_at: string;
      outage_last_seen_at: string;
      recovered_at: string | null;
      recovery_error_log_id: string | null;
    } | null = null;
    let errorLogInsertCount = 0;

    const client = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT id, outage_started_at')) {
          return { rows: event ? [event] : [] };
        }

        if (sql.includes('INSERT INTO public.service_health_events')) {
          event = {
            id: 'incident-1',
            outage_started_at: values?.[1] as string,
            outage_last_seen_at: values?.[2] as string,
            recovered_at: values?.[3] as string,
            recovery_error_log_id: null,
          };
          return { rows: [event] };
        }

        if (sql.includes('UPDATE public.service_health_events') && sql.includes('status =')) {
          return { rows: event ? [event] : [] };
        }

        if (sql.includes('INSERT INTO public.error_logs')) {
          errorLogInsertCount += 1;
          return { rows: [{ id: 'error-log-1' }] };
        }

        if (sql.includes('SET recovery_error_log_id')) {
          if (event) {
            event = {
              ...event,
              recovery_error_log_id: values?.[1] as string,
            };
          }
          return { rows: [] };
        }

        return { rows: [] };
      }),
    };

    const first = await recordDatabaseRecoveryEvent(
      {
        outageStartedAt: '2026-06-01T10:00:00.000Z',
        outageConfirmedAt: '2026-06-01T10:00:30.000Z',
        recoveredAt: '2026-06-01T10:02:00.000Z',
        failureCount: 3,
      },
      {
        connectionString: 'postgres://user:pass@localhost:5432/postgres',
        createClient: () => client,
      }
    );
    const second = await recordDatabaseRecoveryEvent(
      {
        outageStartedAt: '2026-06-01T10:01:00.000Z',
        outageConfirmedAt: '2026-06-01T10:01:30.000Z',
        recoveredAt: '2026-06-01T10:02:30.000Z',
        failureCount: 4,
      },
      {
        connectionString: 'postgres://user:pass@localhost:5432/postgres',
        createClient: () => client,
      }
    );

    expect(first).toMatchObject({ incidentId: 'incident-1', errorLogId: 'error-log-1', deduped: false });
    expect(second).toMatchObject({ incidentId: 'incident-1', errorLogId: 'error-log-1', deduped: true });
    expect(errorLogInsertCount).toBe(1);
  });
});
