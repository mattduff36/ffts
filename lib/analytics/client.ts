'use client';

import {
  getBrowserUsageDeviceContext,
  getUserUsageEventCategory,
  sanitizeAnalyticsMetadata,
  type UsageEventInput,
} from '@/lib/analytics/events';

const USAGE_EVENTS_ENDPOINT = '/api/me/usage-events';
const SESSION_STORAGE_KEY = 'avs_usage_client_session_id';
const MAX_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5_000;

interface QueuedUsageEvent extends UsageEventInput {
  clientEventId: string;
  clientSessionId: string;
}

interface UsageEventBatchPayload {
  clientSessionId: string;
  device: ReturnType<typeof getBrowserUsageDeviceContext>;
  events: Array<QueuedUsageEvent & { eventCategory: NonNullable<UsageEventInput['eventCategory']> }>;
}

let flushTimer: number | null = null;
let listenersInstalled = false;
const queue: QueuedUsageEvent[] = [];

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function getUsageClientSessionId(): string {
  if (typeof window === 'undefined') {
    return createRandomId('server_session');
  }

  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const next = createRandomId('usage_session');
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
}

function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushUsageEvents();
  }, FLUSH_INTERVAL_MS);
}

function buildPayload(events: QueuedUsageEvent[]): UsageEventBatchPayload {
  return {
    clientSessionId: getUsageClientSessionId(),
    device: getBrowserUsageDeviceContext(),
    events: events.map((event) => ({
      ...event,
      eventCategory: event.eventCategory || getUserUsageEventCategory(event.eventName),
      metadata: sanitizeAnalyticsMetadata(event.metadata || {}),
    })),
  };
}

function sendPayload(payload: UsageEventBatchPayload, useBeacon: boolean): Promise<void> {
  const body = JSON.stringify(payload);

  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(USAGE_EVENTS_ENDPOINT, blob)) {
      return Promise.resolve();
    }
  }

  return fetch(USAGE_EVENTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: body.length < 60_000,
    body,
  }).then(() => undefined);
}

function installUsageAnalyticsListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void flushUsageEvents({ useBeacon: true });
    }
  });

  window.addEventListener('pagehide', () => {
    void flushUsageEvents({ useBeacon: true });
  });
}

export async function flushUsageEvents(options: { useBeacon?: boolean } = {}): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    await sendPayload(buildPayload(batch), options.useBeacon === true);
  } catch {
    // Usage analytics must never break normal app flows. Drop failed telemetry.
  }

  if (queue.length > 0) {
    scheduleFlush();
  }
}

export function trackUsageEvent(input: UsageEventInput): void {
  if (typeof window === 'undefined') return;
  installUsageAnalyticsListeners();

  queue.push({
    ...input,
    occurredAt: input.occurredAt || new Date().toISOString(),
    clientEventId: createRandomId('usage_event'),
    clientSessionId: getUsageClientSessionId(),
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    void flushUsageEvents();
    return;
  }

  scheduleFlush();
}

export function getUsageAnalyticsContext(): { clientSessionId: string } {
  return {
    clientSessionId: getUsageClientSessionId(),
  };
}
