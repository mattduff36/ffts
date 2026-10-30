import { z } from 'zod';

export const SITE_USAGE_EVENT_TYPES = [
  'recording_started',
  'recording_stopped',
  'navigation',
  'dwell',
  'click',
  'fetch',
  'runtime_error',
] as const;

export const SITE_USAGE_MAX_EVENTS = 20;
export const SITE_USAGE_MAX_BODY_BYTES = 24_576;
export const SITE_USAGE_IDLE_MS = 60_000;
export const SITE_USAGE_MAX_QUEUE = 80;

const MAX_QUEUE_HARD = 100;
const MAX_ROUTE_LENGTH = 180;
const MAX_STORED_PAYLOAD = 80_000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 86_400_000;
const STORAGE_PREFIX = 'ffts_site_usage_v1:';
// Temporary diagnostic default for Joe Cane only; a saved manual off choice wins.
const DEFAULT_RECORDING_PROFILE_ID = '9eaacb08-743b-462e-8853-f0441e5aa014';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'form', 'label', 'img', 'svg',
  'nav', 'header', 'main', 'section', 'li', 'tr', 'td', 'th', 'span', 'div',
]);
const FETCH_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
// Only known route words survive. Customer references and arbitrary slugs never do.
const ROUTE_WORDS = new Set(('api me dashboard scheduling my jobs visits assignments day-teams team-settings '
  + 'quotes projects customers sites overview new edit create manage history details settings '
  + 'inventory fleet vans hgvs plant maintenance workshop-tasks timesheets absence training '
  + 'reports approvals actions toolbox-talks suggestions admin users profile help debug '
  + 'van-inspections hgv-inspections plant-inspections auth login logout usage-events site-usage '
  + 'notifications messages search categories locations tags documents upload download export '
  + 'context board visit-backlog plant-unavailability copy team rams permissions session').split(' '));
const SAFE_TEST_IDS = new Set(['save-button', 'site-usage-monitor', 'schedule-team-settings-save',
  'schedule-team-add-extra', 'schedule-team-remove-extra']);

export type SiteUsageEventType = (typeof SITE_USAGE_EVENT_TYPES)[number];

export interface SiteUsageEventRecord {
  event_id: string;
  event_type: SiteUsageEventType;
  occurred_at: string;
  route: string | null;
  duration_ms: number | null;
  details: Record<string, string | number>;
}

export interface SiteUsageStatus {
  enabled: boolean;
  recordingId: string | null;
  upload: 'idle' | 'pending' | 'failed';
  pendingCount: number;
  droppedCount: number;
}

export type SiteUsageBatchResult =
  | { ok: true; recordingId: string; events: SiteUsageEventRecord[] }
  | { ok: false; error: string };

interface QueuedEvent {
  recordingId: string;
  eventId: string;
  eventType: SiteUsageEventType;
  occurredAt: string;
  route: string | null;
  durationMs: number | null;
  details: Record<string, string | number>;
}

interface StoredState {
  enabled: boolean;
  recordingId: string | null;
  queue: QueuedEvent[];
  droppedCount: number;
  route: string | null;
}

export interface SiteUsageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SiteUsageController {
  getStatus(): SiteUsageStatus;
  subscribe(listener: (status: SiteUsageStatus) => void): () => void;
  setProfile(profileId: string | null): void;
  setEnabled(enabled: boolean): Promise<void>;
  notePath(path: string): void;
  noteVisibility(visible: boolean): void;
  noteActivity(): void;
  noteClick(tagName: unknown, testId: unknown): void;
  noteFetch(url: string, method: string, status: number, durationMs: number): void;
  noteRuntimeError(kind: 'error' | 'unhandledrejection'): void;
  tick(): void;
  flush(): Promise<void>;
  setOrigin(origin: string): void;
}

export interface SiteUsageControllerOptions {
  now?: () => number;
  storage?: SiteUsageStorage | null;
  transport?: (body: string) => Promise<{ ok: boolean; status: number }>;
  origin?: string;
  createId?: () => string;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
}

export interface SiteUsageCaptureView {
  document: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
  setInterval(handler: () => void, timeout: number): unknown;
  clearInterval(id: unknown): void;
  location: { origin: string };
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<{ status: number }>;
}

const eventSchema = z.strictObject({
  event_id: z.uuid(),
  event_type: z.enum(SITE_USAGE_EVENT_TYPES),
  occurred_at: z.iso.datetime(),
  route: z.string().max(2000).nullable().optional(),
  duration_ms: z.number().int().min(0).max(MAX_DURATION_MS).nullable().optional(),
  details: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

const batchSchema = z.strictObject({
  recording_id: z.uuid(),
  events: z.array(eventSchema).min(1).max(SITE_USAGE_MAX_EVENTS),
});

function isDynamicSegment(segment: string): boolean {
  if (UUID_RE.test(segment) || /^\d+$/.test(segment)) return true;
  if (segment.includes('@') || segment.length > 32) return true;
  return !/^[A-Za-z0-9_-]+$/.test(segment);
}

export function sanitizeSiteUsageRoute(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2000) return null;
  let path = input.trim();
  if (path.includes('://')) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const hashIndex = path.indexOf('#');
  if (hashIndex >= 0) path = path.slice(0, hashIndex);
  const queryIndex = path.indexOf('?');
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  if (!path.startsWith('/') || path.includes('\\') || path.includes('..')) return null;
  const safe = path
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      try {
        const decoded = decodeURIComponent(segment);
        return isDynamicSegment(decoded) || !ROUTE_WORDS.has(decoded) ? ':id' : decoded;
      } catch {
        return ':id';
      }
    })
    .join('/');
  if (!safe.startsWith('/') || safe.length > MAX_ROUTE_LENGTH) return null;
  return safe;
}

export function isExcludedSiteUsageRoute(route: string): boolean {
  return (
    route === '/api/me/site-usage'
    || route.startsWith('/api/me/site-usage/')
    || route.startsWith('/api/me/usage-events')
    || route.startsWith('/api/auth')
    || route === '/auth'
    || route.startsWith('/auth/')
  );
}

function normalizeTag(tagName: unknown): string | null {
  if (typeof tagName !== 'string' || tagName.length === 0 || tagName.length > 40) return null;
  const tag = tagName.toLowerCase();
  return CLICK_TAGS.has(tag) ? tag : 'other';
}

function normalizeTestId(testId: unknown): string | null {
  if (typeof testId !== 'string') return null;
  if (!SAFE_TEST_IDS.has(testId)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(testId)) return null;
  if (UUID_RE.test(testId) || /^\d+$/.test(testId)) return null;
  return testId;
}

function normalizeMethod(method: unknown): string | null {
  if (typeof method !== 'string') return null;
  const normalized = method.toUpperCase();
  return FETCH_METHODS.has(normalized) ? normalized : null;
}

function clampDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(MAX_DURATION_MS, Math.round(value));
}

function cleanDetails(
  eventType: SiteUsageEventType,
  details: Record<string, string | number> | undefined,
  durationMs: number | null,
  route: string | null,
): Record<string, string | number> | null {
  const source = details ?? {};
  const keys = Object.keys(source);
  if (
    eventType === 'recording_started'
    || eventType === 'recording_stopped'
    || eventType === 'navigation'
    || eventType === 'dwell'
  ) {
    if (keys.length > 0 || durationMs == null && eventType === 'dwell') return null;
    if (eventType !== 'dwell' && durationMs != null) return null;
    if ((eventType === 'navigation' || eventType === 'dwell') && !route) return null;
    return {};
  }
  if (eventType === 'click') {
    if (keys.some((key) => key !== 'tag' && key !== 'test_id') || durationMs != null) return null;
    const tag = normalizeTag(source.tag);
    if (!tag) return null;
    const cleaned: Record<string, string | number> = { tag };
    if ('test_id' in source) {
      const testId = normalizeTestId(source.test_id);
      if (!testId) return null;
      cleaned.test_id = testId;
    }
    return cleaned;
  }
  if (eventType === 'fetch') {
    if (keys.some((key) => key !== 'method' && key !== 'status') || !route || durationMs == null) return null;
    const method = normalizeMethod(source.method);
    const status = source.status;
    if (!method || typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 599) {
      return null;
    }
    return { method, status };
  }
  if (keys.some((key) => key !== 'kind' && key !== 'count')) return null;
  const kind = source.kind;
  const count = source.count;
  if ((kind !== 'error' && kind !== 'unhandledrejection') || typeof count !== 'number') return null;
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  return { kind, count };
}

function sanitizeParsedEvent(
  event: z.infer<typeof eventSchema>,
  now: number,
): SiteUsageEventRecord | null {
  const occurred = Date.parse(event.occurred_at);
  if (!Number.isFinite(occurred)) return null;
  if (occurred > now + MAX_FUTURE_SKEW_MS || now - occurred > MAX_EVENT_AGE_MS) return null;
  const route = event.route == null ? null : sanitizeSiteUsageRoute(event.route);
  if (event.route != null && !route) return null;
  const duration = event.duration_ms == null ? null : clampDuration(event.duration_ms);
  if (event.duration_ms != null && duration == null) return null;
  const details = cleanDetails(event.event_type, event.details, duration, route);
  if (!details) return null;
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: new Date(occurred).toISOString(),
    route,
    duration_ms: duration,
    details,
  };
}

export function normalizeSiteUsageBatch(payload: unknown, now = Date.now()): SiteUsageBatchResult {
  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid site usage payload' };
  const seen = new Set<string>();
  const events: SiteUsageEventRecord[] = [];
  for (const event of parsed.data.events) {
    if (seen.has(event.event_id)) return { ok: false, error: 'Invalid site usage payload' };
    seen.add(event.event_id);
    const clean = sanitizeParsedEvent(event, now);
    if (!clean) return { ok: false, error: 'Invalid site usage payload' };
    events.push(clean);
  }
  return { ok: true, recordingId: parsed.data.recording_id, events };
}

function randomUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as QueuedEvent;
  return UUID_RE.test(event.recordingId) && UUID_RE.test(event.eventId) && typeof event.eventType === 'string';
}

class SiteUsageSession implements SiteUsageController {
  private readonly now: () => number;
  private readonly storage: SiteUsageStorage | null;
  private readonly transport: (body: string) => Promise<{ ok: boolean; status: number }>;
  private readonly createId: () => string;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (id: unknown) => void;
  private readonly listeners = new Set<(status: SiteUsageStatus) => void>();
  private origin: string;
  private profileId: string | null = null;
  private enabled = false;
  private visible = true;
  private recordingId: string | null = null;
  private route: string | null = null;
  private queue: QueuedEvent[] = [];
  private upload: SiteUsageStatus['upload'] = 'idle';
  private droppedCount = 0;
  private lastActivityAt = 0;
  private dwellOpenStart: number | null = null;
  private dwellMs = 0;
  private generation = 0;
  private flushToken = 0;
  private flushing = false;
  private flushPromise: Promise<void> = Promise.resolve();
  private retryTimer: unknown = null;
  private retryCount = 0;
  private retryMs = 1000;

  constructor(options: SiteUsageControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.storage = options.storage ?? null;
    this.transport = options.transport ?? (async () => ({ ok: false, status: 0 }));
    this.origin = options.origin ?? '';
    this.createId = options.createId ?? randomUuid;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.lastActivityAt = this.now();
  }

  getStatus(): SiteUsageStatus {
    return {
      enabled: this.enabled,
      recordingId: this.recordingId,
      upload: this.queue.length > 0 && this.upload === 'idle' ? 'pending' : this.upload,
      pendingCount: this.queue.length,
      droppedCount: this.droppedCount,
    };
  }

  subscribe(listener: (status: SiteUsageStatus) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getStatus());
    } catch {
      // Status display must not break the app.
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  setOrigin(origin: string): void {
    this.origin = origin;
  }

  setProfile(profileId: string | null): void {
    const safe = profileId && UUID_RE.test(profileId) ? profileId : null;
    if (safe === this.profileId) return;
    this.rememberOpenDwell();
    this.persist();
    this.generation += 1;
    this.flushToken += 1;
    this.flushing = false;
    this.cancelRetry();
    this.profileId = safe;
    this.queue = [];
    this.enabled = false;
    this.recordingId = null;
    this.route = null;
    this.dwellMs = 0;
    this.dwellOpenStart = null;
    this.droppedCount = 0;
    this.upload = 'idle';
    this.retryCount = 0;
    this.retryMs = 1000;
    const restored = this.hydrate();
    if (!restored && this.profileId === DEFAULT_RECORDING_PROFILE_ID) {
      void this.setEnabled(true);
      return;
    }
    if (this.enabled) this.openDwell(this.now());
    this.emit();
    if (this.profileId && this.queue.length > 0) void this.flush();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    try {
      if (!this.profileId) return;
      if (enabled === this.enabled) {
        if (!enabled) await this.flush();
        return;
      }
      if (!enabled) {
        this.enabled = false;
        const duration = this.takeDwell();
        if (duration > 0 && this.route) {
          this.enqueue('dwell', { route: this.route, durationMs: duration, force: true });
        }
        this.enqueue('recording_stopped', { force: true });
        this.persist();
        this.emit();
        await this.flush();
        return;
      }
      this.recordingId = this.nextId();
      this.enabled = true;
      this.lastActivityAt = this.now();
      this.enqueue('recording_started', { route: this.route });
      this.openDwell(this.now());
      this.persist();
      this.emit();
      await this.flush();
    } catch {
      this.upload = 'failed';
      this.emit();
    }
  }

  notePath(path: string): void {
    try {
      const next = sanitizeSiteUsageRoute(path);
      if (!next || next === this.route) {
        if (this.enabled) this.openDwell(this.now());
        return;
      }
      const previous = this.route;
      if (this.enabled && previous) {
        const duration = this.takeDwell();
        if (duration > 0) this.enqueue('dwell', { route: previous, durationMs: duration, force: true });
      } else {
        this.dwellMs = 0;
        this.dwellOpenStart = null;
      }
      this.route = next;
      if (!this.enabled) return;
      this.enqueue('navigation', { route: next });
      this.openDwell(this.now());
      this.persist();
      this.emit();
    } catch {
      // Navigation capture must not break routing.
    }
  }

  noteVisibility(visible: boolean): void {
    try {
      if (visible === this.visible) return;
      if (!visible) {
        this.accrue(this.now());
        this.visible = false;
        this.dwellOpenStart = null;
        return;
      }
      this.visible = true;
      this.openDwell(this.now());
    } catch {
      // Visibility capture is best-effort.
    }
  }

  noteActivity(): void {
    try {
      this.accrue(this.now());
      this.lastActivityAt = this.now();
      this.openDwell(this.now());
    } catch {
      // Activity tracking is best-effort.
    }
  }

  noteClick(tagName: unknown, testId: unknown): void {
    try {
      if (!this.enabled) return;
      const tag = normalizeTag(tagName);
      if (!tag) return;
      const details: Record<string, string | number> = { tag };
      const safeTestId = normalizeTestId(testId);
      if (safeTestId) details.test_id = safeTestId;
      this.enqueue('click', { route: this.route, details });
      this.persist();
      this.emit();
    } catch {
      // Click capture must not break the page.
    }
  }

  noteFetch(url: string, method: string, status: number, durationMs: number): void {
    try {
      if (!this.enabled) return;
      const parsed = new URL(url, this.origin || undefined);
      if (this.origin && parsed.origin !== this.origin) return;
      const route = sanitizeSiteUsageRoute(parsed.pathname);
      if (!route || isExcludedSiteUsageRoute(route)) return;
      const safeMethod = normalizeMethod(method);
      const duration = clampDuration(durationMs);
      if (!safeMethod || duration == null || !Number.isInteger(status) || status < 0 || status > 599) return;
      this.enqueue('fetch', {
        route,
        durationMs: duration,
        details: { method: safeMethod, status },
      });
      this.persist();
      this.emit();
    } catch {
      // Fetch observation must not affect the request.
    }
  }

  noteRuntimeError(kind: 'error' | 'unhandledrejection'): void {
    try {
      if (!this.enabled || !this.recordingId) return;
      const last = this.queue[this.queue.length - 1];
      if (
        last
        && last.eventType === 'runtime_error'
        && last.recordingId === this.recordingId
        && last.details.kind === kind
        && typeof last.details.count === 'number'
        && last.details.count < 20
      ) {
        last.details = { kind, count: last.details.count + 1 };
        this.persist();
        this.emit();
        return;
      }
      this.enqueue('runtime_error', { route: this.route, details: { kind, count: 1 } });
      this.persist();
      this.emit();
    } catch {
      // Error counting must not throw over the original error.
    }
  }

  tick(): void {
    try {
      this.rememberOpenDwell();
      this.openDwell(this.now());
      this.persist();
      this.emit();
    } catch {
      // Dwell ticking is best-effort.
    }
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushPromise;
    if (!this.profileId || this.queue.length === 0) return Promise.resolve();
    const token = ++this.flushToken;
    const generation = this.generation;
    const profileId = this.profileId;
    this.flushing = true;
    this.flushPromise = this.drain(token, generation, profileId).finally(() => {
      if (this.flushToken === token) this.flushing = false;
    });
    return this.flushPromise;
  }

  private async drain(token: number, generation: number, profileId: string): Promise<void> {
    while (this.queue.length > 0 && this.flushToken === token && this.generation === generation && this.profileId === profileId) {
      const recordingId = this.queue[0]?.recordingId;
      if (!recordingId) return;
      const batch: QueuedEvent[] = [];
      for (const event of this.queue) {
        if (event.recordingId !== recordingId || batch.length >= SITE_USAGE_MAX_EVENTS) break;
        batch.push(event);
      }
      this.upload = 'pending';
      this.emit();
      let result: { ok: boolean; status: number };
      try {
        result = await this.transport(JSON.stringify({
          recording_id: recordingId,
          events: batch.map((event) => ({
            event_id: event.eventId,
            event_type: event.eventType,
            occurred_at: event.occurredAt,
            route: event.route,
            duration_ms: event.durationMs,
            details: event.details,
          })),
        }));
      } catch {
        result = { ok: false, status: 0 };
      }
      if (this.flushToken !== token || this.generation !== generation || this.profileId !== profileId) return;
      if (!result.ok) {
        this.upload = 'failed';
        this.persist();
        this.emit();
        if (result.status !== 400 && result.status !== 413) this.scheduleRetry();
        return;
      }
      const sent = new Set(batch.map((event) => event.eventId));
      this.queue = this.queue.filter((event) => !sent.has(event.eventId));
      this.upload = this.queue.length > 0 ? 'pending' : 'idle';
      this.retryCount = 0;
      this.retryMs = 1000;
      this.cancelRetry();
      this.persist();
      this.emit();
    }
  }

  private enqueue(
    eventType: SiteUsageEventType,
    input: {
      route?: string | null;
      durationMs?: number | null;
      details?: Record<string, string | number>;
      force?: boolean;
    },
  ): void {
    if ((!this.enabled && !input.force) || !this.recordingId || !this.profileId) return;
    const limit = input.force ? MAX_QUEUE_HARD : SITE_USAGE_MAX_QUEUE;
    if (this.queue.length >= limit) {
      this.droppedCount += 1;
      this.emit();
      return;
    }
    this.queue.push({
      recordingId: this.recordingId,
      eventId: this.nextId(),
      eventType,
      occurredAt: new Date(this.now()).toISOString(),
      route: input.route ?? null,
      durationMs: input.durationMs ?? null,
      details: input.details ?? {},
    });
    if (this.upload !== 'failed') this.upload = 'pending';
  }

  private rememberOpenDwell(): void {
    if (!this.enabled || !this.route) return;
    const duration = this.takeDwell();
    if (duration > 0) this.enqueue('dwell', { route: this.route, durationMs: duration, force: true });
  }

  private takeDwell(): number {
    this.accrue(this.now());
    const duration = this.dwellMs;
    this.dwellMs = 0;
    this.dwellOpenStart = null;
    return duration;
  }

  private accrue(now: number): void {
    if (this.dwellOpenStart == null) return;
    const end = Math.min(now, this.lastActivityAt + SITE_USAGE_IDLE_MS);
    if (end > this.dwellOpenStart) this.dwellMs += end - this.dwellOpenStart;
    this.dwellOpenStart = this.visible && now < this.lastActivityAt + SITE_USAGE_IDLE_MS ? now : null;
  }

  private openDwell(now: number): void {
    if (!this.enabled || !this.visible || !this.route) return;
    if (now >= this.lastActivityAt + SITE_USAGE_IDLE_MS) return;
    if (this.dwellOpenStart == null) this.dwellOpenStart = now;
  }

  private nextId(): string {
    try {
      const id = this.createId();
      if (UUID_RE.test(id)) return id;
    } catch {
      // Fall through to a local UUID.
    }
    return randomUuid();
  }

  private storageKey(): string {
    return `${STORAGE_PREFIX}${this.profileId}`;
  }

  private persist(): void {
    if (!this.storage || !this.profileId) return;
    try {
      const state: StoredState = {
        enabled: this.enabled,
        recordingId: this.recordingId,
        queue: this.queue.slice(0, MAX_QUEUE_HARD),
        droppedCount: this.droppedCount,
        route: this.route,
      };
      let payload = JSON.stringify(state);
      while (payload.length > MAX_STORED_PAYLOAD && state.queue.length > 1) {
        state.queue.shift();
        this.droppedCount += 1;
        state.droppedCount = this.droppedCount;
        payload = JSON.stringify(state);
      }
      this.queue = state.queue;
      this.storage.setItem(this.storageKey(), payload);
    } catch {
      // Storage quota or privacy mode must not break the session.
    }
  }

  private hydrate(): boolean {
    if (!this.storage || !this.profileId) return false;
    try {
      const raw = this.storage.getItem(this.storageKey());
      if (!raw || raw.length > 100_000) return false;
      const stored = JSON.parse(raw) as StoredState;
      if (!stored || !Array.isArray(stored.queue)) return false;
      this.recordingId = stored.recordingId && UUID_RE.test(stored.recordingId) ? stored.recordingId : null;
      this.enabled = stored.enabled === true && this.recordingId != null;
      this.route = typeof stored.route === 'string' ? sanitizeSiteUsageRoute(stored.route) : null;
      this.droppedCount = Number.isInteger(stored.droppedCount) && stored.droppedCount > 0
        ? Math.min(stored.droppedCount, 1_000_000)
        : 0;
      this.queue = stored.queue.filter(isQueuedEvent).slice(0, MAX_QUEUE_HARD);
      this.upload = this.queue.length > 0 ? 'pending' : 'idle';
      return true;
    } catch {
      this.enabled = false;
      this.queue = [];
      return false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer != null || this.retryCount >= 8) return;
    this.retryCount += 1;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer == null) return;
    try {
      this.cancel(this.retryTimer);
    } catch {
      // Ignore timer cleanup failures.
    }
    this.retryTimer = null;
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // A status listener must not break capture.
      }
    }
  }
}

export function createSiteUsageController(options: SiteUsageControllerOptions = {}): SiteUsageController {
  return new SiteUsageSession(options);
}

function readFetchTarget(input: unknown, init?: { method?: string }): { url: string; method: string } | null {
  if (typeof input === 'string') return { url: input, method: init?.method || 'GET' };
  if (typeof URL !== 'undefined' && input instanceof URL) return { url: input.href, method: init?.method || 'GET' };
  if (!input || typeof input !== 'object' || !('url' in input)) return null;
  const request = input as { url?: unknown; method?: unknown };
  if (typeof request.url !== 'string') return null;
  const method = typeof init?.method === 'string'
    ? init.method
    : typeof request.method === 'string'
      ? request.method
      : 'GET';
  return { url: request.url, method };
}

export function bindSiteUsageCapture(
  controller: SiteUsageController,
  view?: SiteUsageCaptureView,
): () => void {
  const target = view ?? (window as unknown as SiteUsageCaptureView);
  if (target.location?.origin) controller.setOrigin(target.location.origin);
  const onClick = (event?: unknown) => {
    try {
      const targetNode = (event as { target?: { tagName?: unknown; getAttribute?: (name: string) => unknown } } | undefined)?.target;
      const testId = targetNode && typeof targetNode.getAttribute === 'function'
        ? targetNode.getAttribute('data-testid')
        : null;
      controller.noteClick(targetNode?.tagName, testId);
    } catch {
      // Ignore capture failures.
    }
  };
  const onVisibility = () => {
    controller.noteVisibility(target.document.visibilityState !== 'hidden');
    controller.tick();
    void controller.flush();
  };
  const onActivity = () => controller.noteActivity();
  const onError = () => controller.noteRuntimeError('error');
  const onRejection = () => controller.noteRuntimeError('unhandledrejection');
  const originalFetch = target.fetch;
  const wrappedFetch: SiteUsageCaptureView['fetch'] = async (input, init) => {
    const started = Date.now();
    const recordingId = controller.getStatus().recordingId;
    const stillRecording = () => controller.getStatus().enabled
      && controller.getStatus().recordingId === recordingId;
    try {
      const response = await originalFetch(input, init);
      try {
        const described = readFetchTarget(input, init);
        if (described && stillRecording()) controller.noteFetch(described.url, described.method, response.status, Date.now() - started);
      } catch {
        // Observation never changes the response.
      }
      return response;
    } catch (error) {
      try {
        const described = readFetchTarget(input, init);
        if (described && stillRecording()) controller.noteFetch(described.url, described.method, 0, Date.now() - started);
      } catch {
        // Observation never swallows the network error.
      }
      throw error;
    }
  };
  target.document.addEventListener('visibilitychange', onVisibility);
  target.addEventListener('click', onClick);
  target.addEventListener('keydown', onActivity);
  target.addEventListener('pointerdown', onActivity);
  target.addEventListener('scroll', onActivity);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  target.fetch = wrappedFetch;
  const onPageHide = () => {
    controller.noteVisibility(false);
    controller.tick();
    void controller.flush();
  };
  target.addEventListener('pagehide', onPageHide);
  onVisibility();
  const timer = target.setInterval(() => { controller.tick(); void controller.flush(); }, 5_000);
  return () => {
    target.document.removeEventListener('visibilitychange', onVisibility);
    target.removeEventListener('click', onClick);
    target.removeEventListener('keydown', onActivity);
    target.removeEventListener('pointerdown', onActivity);
    target.removeEventListener('scroll', onActivity);
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    target.removeEventListener('pagehide', onPageHide);
    if (target.fetch === wrappedFetch) target.fetch = originalFetch;
    target.clearInterval(timer);
  };
}

let browserController: SiteUsageController | null = null;

function safeSessionStorage(): SiteUsageStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

async function postSiteUsageBatch(body: string): Promise<{ ok: boolean; status: number }> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);
  try {
  const response = await fetch('/api/me/site-usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body,
    signal: abort.signal,
  });
  const receipt = await response.json().catch(() => null);
  return { ok: response.ok && receipt?.success === true, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export function getBrowserSiteUsageController(): SiteUsageController {
  if (typeof window === 'undefined') {
    throw new Error('Site usage monitor is only available in the browser');
  }
  if (!browserController) {
    browserController = createSiteUsageController({
      storage: safeSessionStorage(),
      transport: postSiteUsageBatch,
      origin: window.location.origin,
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (id) => window.clearTimeout(id as ReturnType<typeof window.setTimeout>),
    });
  }
  return browserController;
}
