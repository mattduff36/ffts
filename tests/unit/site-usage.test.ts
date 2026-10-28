import { describe, expect, it, vi } from 'vitest';
import {
  SITE_USAGE_IDLE_MS,
  SITE_USAGE_MAX_EVENTS,
  bindSiteUsageCapture,
  createSiteUsageController,
  normalizeSiteUsageBatch,
  sanitizeSiteUsageRoute,
  type SiteUsageCaptureView,
  type SiteUsageStorage,
} from '@/lib/analytics/site-usage';

const PROFILE_A = '11111111-1111-4111-8111-111111111111';
const PROFILE_B = '22222222-2222-4222-8222-222222222222';

function memoryStorage(): SiteUsageStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function createHarness(options?: {
  storage?: SiteUsageStorage;
  transport?: (body: string) => Promise<{ ok: boolean; status: number }>;
}) {
  let now = Date.now();
  const scheduled: Array<() => void> = [];
  const transport = options?.transport ?? vi.fn(async () => ({ ok: true, status: 200 }));
  const controller = createSiteUsageController({
    now: () => now,
    storage: options?.storage ?? memoryStorage(),
    transport,
    origin: 'http://localhost',
    schedule: (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    cancel: () => undefined,
  });
  return {
    controller,
    transport,
    scheduled,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('site usage sanitizing', () => {
  it('removes queries, fragments, and dynamic segments', () => {
    expect(sanitizeSiteUsageRoute(
      '/fleet/123e4567-e89b-12d3-a456-426614174000/jobs/42?token=SECRET#frag',
    )).toBe('/fleet/:id/jobs/:id');
    expect(sanitizeSiteUsageRoute('https://example.test/quotes/9?x=1')).toBe('/quotes/:id');
    expect(sanitizeSiteUsageRoute('/quotes/overview/10036-JC')).toBe('/quotes/overview/:id');
    expect(sanitizeSiteUsageRoute('/customers/Jane-Smith')).toBe('/customers/:id');
  });

  it('rejects ownership fields, freeform details, and oversized batches', () => {
    const now = Date.now();
    const event = {
      event_id: '33333333-3333-4333-8333-333333333333',
      event_type: 'navigation',
      occurred_at: new Date(now).toISOString(),
      route: '/fleet/15?secret=1',
      details: {},
    };
    const accepted = normalizeSiteUsageBatch({
      recording_id: '44444444-4444-4444-8444-444444444444',
      events: [event],
    }, now);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.events[0]?.route).toBe('/fleet/:id');

    expect(normalizeSiteUsageBatch({ ...event, user_id: PROFILE_A }, now).ok).toBe(false);
    expect(normalizeSiteUsageBatch({
      recording_id: '44444444-4444-4444-8444-444444444444',
      events: [{ ...event, details: { message: 'secret stack' } }],
    }, now).ok).toBe(false);
    expect(normalizeSiteUsageBatch({
      recording_id: '44444444-4444-4444-8444-444444444444',
      events: Array.from({ length: SITE_USAGE_MAX_EVENTS + 1 }, () => event),
    }, now).ok).toBe(false);
  });
});

describe('site usage recorder', () => {
  it('uploads active dwell during recording and stops producing events when off', async () => {
    const harness = createHarness();
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/scheduling');
    await harness.controller.setEnabled(true);
    harness.advance(5_000);
    harness.controller.tick();
    await harness.controller.flush();
    const batch = JSON.parse(String(vi.mocked(harness.transport).mock.calls.at(-1)?.[0]));
    expect(batch.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'dwell', route: '/scheduling', duration_ms: 5000 }),
    ]));
    await harness.controller.setEnabled(false);
    const calls = vi.mocked(harness.transport).mock.calls.length;
    harness.controller.noteClick('button', 'save-button');
    harness.controller.notePath('/quotes');
    harness.advance(5000);
    harness.controller.tick();
    await harness.controller.flush();
    expect(harness.transport).toHaveBeenCalledTimes(calls);
  });

  it('stays off and sends nothing until started', async () => {
    const harness = createHarness();
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard?secret=1');
    harness.controller.noteClick('button', 'save-button');
    harness.controller.noteFetch('http://localhost/api/fleet/4?token=1', 'GET', 200, 12);
    await harness.controller.flush();

    expect(harness.transport).not.toHaveBeenCalled();
    expect(harness.controller.getStatus()).toMatchObject({
      enabled: false,
      pendingCount: 0,
      upload: 'idle',
    });
  });

  it('starts a unique recording, scrubs navigation, and drains when switched off', async () => {
    const harness = createHarness();
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard');
    await harness.controller.setEnabled(true);
    const firstRecording = harness.controller.getStatus().recordingId;
    harness.controller.notePath('/fleet/99?token=SECRET#row');
    harness.advance(5_000);
    await harness.controller.setEnabled(false);

    expect(harness.controller.getStatus()).toMatchObject({
      enabled: false,
      pendingCount: 0,
      upload: 'idle',
    });
    const bodies = vi.mocked(harness.transport).mock.calls.map((call) => String(call[0]));
    expect(bodies.join('')).not.toContain('SECRET');
    const normalized = bodies.map((body) => normalizeSiteUsageBatch(JSON.parse(body)));
    expect(normalized.every((result) => result.ok)).toBe(true);
    await harness.controller.setEnabled(true);
    expect(harness.controller.getStatus().recordingId).not.toBe(firstRecording);
    harness.controller.noteClick('button', 'later');
    expect(harness.controller.getStatus().enabled).toBe(true);
  });

  it('counts visible dwell and excludes hidden and idle time', async () => {
    const harness = createHarness();
    let posted = '';
    const hanging = createHarness({
      transport: async (body) => {
        posted = body;
        return { ok: true, status: 200 };
      },
    });
    hanging.controller.setProfile(PROFILE_A);
    hanging.controller.notePath('/dashboard');
    await hanging.controller.setEnabled(true);
    hanging.advance(10_000);
    hanging.controller.noteVisibility(false);
    hanging.advance(50_000);
    hanging.controller.noteVisibility(true);
    hanging.controller.notePath('/help');
    await hanging.controller.flush();
    const hiddenDwell = normalizeSiteUsageBatch(JSON.parse(posted));
    expect(hiddenDwell.ok).toBe(true);
    if (hiddenDwell.ok) {
      expect(hiddenDwell.events.find((event) => event.event_type === 'dwell')?.duration_ms).toBe(10_000);
    }

    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard');
    await harness.controller.setEnabled(true);
    harness.advance(SITE_USAGE_IDLE_MS + 10_000);
    harness.controller.tick();
    harness.controller.notePath('/help');
    await harness.controller.flush();
    const idleBody = vi.mocked(harness.transport).mock.calls.at(-1)?.[0];
    const idleDwell = normalizeSiteUsageBatch(JSON.parse(String(idleBody)));
    expect(idleDwell.ok).toBe(true);
    if (idleDwell.ok) {
      expect(idleDwell.events.find((event) => event.event_type === 'dwell')?.duration_ms).toBe(SITE_USAGE_IDLE_MS);
    }
  });

  it('shows a failed upload and retries the same events', async () => {
    let fail = true;
    const bodies: string[] = [];
    const harness = createHarness({
      transport: async (body) => {
        bodies.push(body);
        return fail ? { ok: false, status: 503 } : { ok: true, status: 200 };
      },
    });
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard');
    await harness.controller.setEnabled(true);

    expect(harness.controller.getStatus().upload).toBe('failed');
    expect(harness.controller.getStatus().pendingCount).toBeGreaterThan(0);
    expect(harness.scheduled).toHaveLength(1);
    fail = false;
    harness.scheduled[0]?.();
    await harness.controller.flush();

    expect(harness.controller.getStatus()).toMatchObject({ pendingCount: 0, upload: 'idle' });
    expect(JSON.parse(bodies[1] ?? '{}').events).toEqual(JSON.parse(bodies[0] ?? '{}').events);
  });

  it('keeps accounts isolated and survives storage failures', async () => {
    const storage = memoryStorage();
    const harness = createHarness({
      storage,
      transport: async () => ({ ok: false, status: 503 }),
    });
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard');
    await harness.controller.setEnabled(true);
    const pendingA = harness.controller.getStatus().pendingCount;
    harness.controller.setProfile(PROFILE_B);

    expect(harness.controller.getStatus()).toMatchObject({ enabled: false, pendingCount: 0 });
    expect(JSON.parse(storage.values.get(`ffts_site_usage_v1:${PROFILE_A}`) ?? '{}').enabled).toBe(true);
    expect(storage.values.get(`ffts_site_usage_v1:${PROFILE_B}`)).toBeUndefined();
    harness.controller.setProfile(PROFILE_A);
    expect(harness.controller.getStatus().enabled).toBe(true);
    expect(harness.controller.getStatus().pendingCount).toBe(pendingA);

    const failing = memoryStorage();
    failing.setItem = () => {
      throw new Error('quota');
    };
    const resilient = createHarness({ storage: failing });
    resilient.controller.setProfile(PROFILE_A);
    await expect(resilient.controller.setEnabled(true)).resolves.toBeUndefined();
    expect(resilient.controller.getStatus().enabled).toBe(true);
  });

  it('records safe click and fetch metadata, then removes listeners', async () => {
    const harness = createHarness();
    harness.controller.setProfile(PROFILE_A);
    harness.controller.notePath('/dashboard');
    await harness.controller.setEnabled(true);
    const listeners = new Map<string, (event?: unknown) => void>();
    const documentListeners = new Map<string, () => void>();
    const originalFetch = vi.fn(async () => ({ status: 204 }));
    const view: SiteUsageCaptureView = {
      document: {
        visibilityState: 'visible',
        addEventListener: (type, listener) => documentListeners.set(type, listener),
        removeEventListener: (type, listener) => {
          if (documentListeners.get(type) === listener) documentListeners.delete(type);
        },
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
      setInterval: () => 1,
      clearInterval: () => undefined,
      location: { origin: 'http://localhost' },
      fetch: originalFetch,
    };
    const unbind = bindSiteUsageCapture(harness.controller, view);
    listeners.get('click')?.({
      target: {
        tagName: 'BUTTON',
        textContent: 'SECRET_TEXT',
        value: 'SECRET_VALUE',
        getAttribute: (name: string) => (name === 'data-testid' ? 'save-button' : null),
      },
    });
    listeners.get('error')?.({ message: 'SECRET_STACK', error: { stack: 'SECRET_STACK' } });
    await view.fetch('http://localhost/api/fleet/8?token=SECRET_QUERY', {
      method: 'POST',
      body: 'SECRET_BODY',
    });
    await view.fetch('http://localhost/api/me/site-usage', { method: 'POST', body: 'SECRET_BODY' });
    await view.fetch('https://example.test/outside');
    await view.fetch('http://localhost/api/auth/session');
    await harness.controller.flush();
    unbind();

    const posted = vi.mocked(harness.transport).mock.calls.map((call) => String(call[0])).join('');
    expect(posted).toContain('"tag":"button"');
    expect(posted).toContain('"test_id":"save-button"');
    expect(posted).toContain('"/api/fleet/:id"');
    expect(posted).toContain('"kind":"error"');
    expect(posted).not.toContain('SECRET_TEXT');
    expect(posted).not.toContain('SECRET_VALUE');
    expect(posted).not.toContain('SECRET_STACK');
    expect(posted).not.toContain('SECRET_QUERY');
    expect(posted).not.toContain('SECRET_BODY');
    expect(posted).not.toContain('example.test');
    expect(posted).not.toContain('/api/auth/session');
    expect(posted).not.toContain('/api/me/site-usage');
    expect(originalFetch).toHaveBeenCalledTimes(4);
    expect(view.fetch).toBe(originalFetch);
    expect(listeners.size).toBe(0);
    expect(documentListeners.size).toBe(0);
  });

  it('bounds the queue instead of growing forever', () => {
    const harness = createHarness();
    harness.controller.setProfile(PROFILE_A);
    void harness.controller.setEnabled(true);
    for (let index = 0; index < 90; index += 1) harness.controller.noteClick('div', 'row');
    const status = harness.controller.getStatus();
    expect(status.droppedCount).toBeGreaterThan(0);
    expect(status.pendingCount).toBeLessThanOrEqual(100);
  });
});
