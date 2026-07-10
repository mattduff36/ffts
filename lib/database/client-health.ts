'use client';

export type DatabaseHealthStatus = 'healthy' | 'suspect' | 'outage';
export type DatabaseHealthProbeReason = 'mount' | 'activity' | 'visibility' | 'route' | 'timer' | 'suspect' | 'nudge';

export interface DatabaseHealthState {
  status: DatabaseHealthStatus;
  outageActive: boolean;
  outageStartedAt: number | null;
  outageConfirmedAt: number | null;
  lastCheckedAt: number | null;
  lastHealthyAt: number | null;
  failureCount: number;
  emulatedOutageActive: boolean;
  emulatedOutageStartsAt: number | null;
  emulatedOutageExpiresAt: number | null;
}

interface OutageRecoveryWindow {
  outageStartedAt: number;
  outageConfirmedAt: number;
  recoveredAt: number;
  failureCount: number;
}

interface DatabaseHealthResponse {
  ok?: unknown;
  reason?: unknown;
}

const HEALTH_ENDPOINT = '/api/system/database-health';
const HEALTHY_PROOF_WINDOW_MS = 60_000;
const ACTIVITY_GATE_MS = 15 * 60_000;
const FAILURE_WINDOW_MS = 2 * 60_000;
const SUSPECT_POLL_MS = 15_000;
const TIMER_CHECK_MS = 60_000;
const CLEAR_HEALTHY_GAP_MS = 10_000;
const CLIENT_TIMEOUT_MS = 5_000;
const FAILURES_TO_SHOW = 3;
const HEALTHY_RESPONSES_TO_CLEAR = 2;
const EMULATION_STORAGE_KEY = 'avs.databaseHealth.emulatedOutageExpiresAt';
const EMULATION_SCHEDULE_STORAGE_KEY = 'avs.databaseHealth.emulatedOutageSchedule';

export const DATABASE_OUTAGE_EMULATION_MS = 5 * 60_000;

let state: DatabaseHealthState = {
  status: 'healthy',
  outageActive: false,
  outageStartedAt: null,
  outageConfirmedAt: null,
  lastCheckedAt: null,
  lastHealthyAt: null,
  failureCount: 0,
  emulatedOutageActive: false,
  emulatedOutageStartsAt: null,
  emulatedOutageExpiresAt: null,
};

let recentFailures: number[] = [];
let consecutiveHealthyResponses = 0;
let lastHealthyResponseAt: number | null = null;
let lastDbBackedSuccessAt = 0;
let lastActivityAt = Date.now();
let probeInFlight: Promise<void> | null = null;
let suspectTimer: ReturnType<typeof setTimeout> | null = null;
let slowTimer: ReturnType<typeof setInterval> | null = null;
let emulationTimer: ReturnType<typeof setTimeout> | null = null;
let emulationStartTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryInFlight: Promise<void> | null = null;
let clientId: string | null = null;
let hasHydratedEmulation = false;

const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function setState(nextState: Partial<DatabaseHealthState>): void {
  state = {
    ...state,
    ...nextState,
  };
  emitChange();
}

function now(): number {
  return Date.now();
}

function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function isRecentlyActive(currentTime = now()): boolean {
  return currentTime - lastActivityAt <= ACTIVITY_GATE_MS;
}

function hasRecentDbBackedSuccess(currentTime = now()): boolean {
  return currentTime - lastDbBackedSuccessAt <= HEALTHY_PROOF_WINDOW_MS;
}

function shouldProbe(currentTime = now()): boolean {
  return isVisible() && isRecentlyActive(currentTime) && isBrowserOnline();
}

function clearEmulationTimer(): void {
  if (emulationTimer) {
    clearTimeout(emulationTimer);
    emulationTimer = null;
  }
}

function clearEmulationStartTimer(): void {
  if (emulationStartTimer) {
    clearTimeout(emulationStartTimer);
    emulationStartTimer = null;
  }
}

function readStoredEmulationExpiresAt(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(EMULATION_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const expiresAt = Number(storedValue);
    if (!Number.isFinite(expiresAt)) {
      window.localStorage.removeItem(EMULATION_STORAGE_KEY);
      return null;
    }

    return expiresAt;
  } catch {
    return null;
  }
}

function writeStoredEmulationExpiresAt(expiresAt: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(EMULATION_STORAGE_KEY, String(expiresAt));
  } catch {
    // Storage failures should not stop the in-memory debug emulation.
  }
}

function clearStoredEmulationExpiresAt(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(EMULATION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

interface StoredEmulationSchedule {
  startsAt: number;
  durationMs: number;
}

function readStoredEmulationSchedule(): StoredEmulationSchedule | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(EMULATION_SCHEDULE_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue) as Partial<StoredEmulationSchedule>;
    if (
      typeof parsed.startsAt !== 'number'
      || typeof parsed.durationMs !== 'number'
      || !Number.isFinite(parsed.startsAt)
      || !Number.isFinite(parsed.durationMs)
    ) {
      window.localStorage.removeItem(EMULATION_SCHEDULE_STORAGE_KEY);
      return null;
    }

    return {
      startsAt: parsed.startsAt,
      durationMs: parsed.durationMs,
    };
  } catch {
    window.localStorage.removeItem(EMULATION_SCHEDULE_STORAGE_KEY);
    return null;
  }
}

function writeStoredEmulationSchedule(schedule: StoredEmulationSchedule): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(EMULATION_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // Storage failures should not stop the in-memory debug emulation.
  }
}

function clearStoredEmulationSchedule(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(EMULATION_SCHEDULE_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function scheduleEmulationExpiry(expiresAt: number): void {
  clearEmulationTimer();
  const delayMs = Math.max(0, expiresAt - now());
  emulationTimer = setTimeout(() => {
    clearDatabaseOutageEmulation();
  }, delayMs);
}

function scheduleEmulationStart(startsAt: number, durationMs: number): void {
  clearEmulationStartTimer();
  const delayMs = Math.max(0, startsAt - now());
  emulationStartTimer = setTimeout(() => {
    clearStoredEmulationSchedule();
    setState({
      emulatedOutageStartsAt: null,
    });
    activateDatabaseOutageEmulation(durationMs);
  }, delayMs);
}

function applyDatabaseOutageEmulation(expiresAt: number, currentTime = now()): void {
  const outageStartedAt = state.emulatedOutageActive && state.outageStartedAt
    ? state.outageStartedAt
    : currentTime;

  recentFailures = Array.from({ length: FAILURES_TO_SHOW }, () => currentTime);
  consecutiveHealthyResponses = 0;
  lastHealthyResponseAt = null;
  setState({
    status: 'outage',
    outageActive: true,
    outageStartedAt,
    outageConfirmedAt: state.outageConfirmedAt || currentTime,
    lastCheckedAt: currentTime,
    failureCount: FAILURES_TO_SHOW,
    emulatedOutageActive: true,
    emulatedOutageStartsAt: null,
    emulatedOutageExpiresAt: expiresAt,
  });
  scheduleEmulationExpiry(expiresAt);
}

function hydrateStoredEmulation(): void {
  if (hasHydratedEmulation) {
    return;
  }

  hasHydratedEmulation = true;
  const schedule = readStoredEmulationSchedule();
  if (schedule) {
    const currentTime = now();
    const expiresAt = schedule.startsAt + schedule.durationMs;
    if (expiresAt <= currentTime) {
      clearStoredEmulationSchedule();
    } else if (schedule.startsAt <= currentTime) {
      clearStoredEmulationSchedule();
      writeStoredEmulationExpiresAt(expiresAt);
      applyDatabaseOutageEmulation(expiresAt, currentTime);
      return;
    } else {
      setState({
        emulatedOutageActive: false,
        emulatedOutageStartsAt: schedule.startsAt,
        emulatedOutageExpiresAt: expiresAt,
      });
      scheduleEmulationStart(schedule.startsAt, schedule.durationMs);
      return;
    }
  }

  const expiresAt = readStoredEmulationExpiresAt();
  if (!expiresAt) {
    return;
  }

  const currentTime = now();
  if (expiresAt <= currentTime) {
    clearStoredEmulationExpiresAt();
    return;
  }

  applyDatabaseOutageEmulation(expiresAt, currentTime);
}

function shouldKeepEmulatedOutage(currentTime = now()): boolean {
  if (!state.emulatedOutageActive || !state.emulatedOutageExpiresAt) {
    return false;
  }

  if (state.emulatedOutageExpiresAt <= currentTime) {
    clearDatabaseOutageEmulation();
    return false;
  }

  return true;
}

function buildRecoveryWindow(recoveredAt: number): OutageRecoveryWindow | null {
  if (!state.outageStartedAt || !state.outageConfirmedAt) {
    return null;
  }

  return {
    outageStartedAt: state.outageStartedAt,
    outageConfirmedAt: state.outageConfirmedAt,
    recoveredAt,
    failureCount: state.failureCount,
  };
}

function getClientId(): string {
  if (clientId) {
    return clientId;
  }

  const storageKey = 'avs.databaseHealth.clientId';
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      clientId = existing;
      return existing;
    }

    clientId = crypto.randomUUID();
    window.localStorage.setItem(storageKey, clientId);
    return clientId;
  } catch {
    clientId = `client-${Math.random().toString(36).slice(2)}`;
    return clientId;
  }
}

function postRecoveryWindow(recoveryWindow: OutageRecoveryWindow): void {
  if (recoveryInFlight) {
    return;
  }

  recoveryInFlight = fetch(HEALTH_ENDPOINT, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({
      outage_started_at: new Date(recoveryWindow.outageStartedAt).toISOString(),
      outage_confirmed_at: new Date(recoveryWindow.outageConfirmedAt).toISOString(),
      recovered_at: new Date(recoveryWindow.recoveredAt).toISOString(),
      failure_count: recoveryWindow.failureCount,
      client_id: getClientId(),
    }),
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      recoveryInFlight = null;
    });
}

function clearSuspectTimer(): void {
  if (suspectTimer) {
    clearTimeout(suspectTimer);
    suspectTimer = null;
  }
}

function scheduleSuspectProbe(): void {
  clearSuspectTimer();
  if (state.status === 'healthy') {
    return;
  }

  suspectTimer = setTimeout(() => {
    void runDatabaseHealthProbe('suspect');
  }, SUSPECT_POLL_MS);
}

function resetFailures(): void {
  recentFailures = [];
  consecutiveHealthyResponses = 0;
  lastHealthyResponseAt = null;
}

function recordHealthyResponse(currentTime = now()): void {
  if (shouldKeepEmulatedOutage(currentTime)) {
    return;
  }

  lastDbBackedSuccessAt = currentTime;

  const recoveryWindow = state.outageActive ? buildRecoveryWindow(currentTime) : null;
  const shouldCountForClear =
    lastHealthyResponseAt === null || currentTime - lastHealthyResponseAt >= CLEAR_HEALTHY_GAP_MS;

  if (shouldCountForClear) {
    consecutiveHealthyResponses += 1;
    lastHealthyResponseAt = currentTime;
  }

  if (state.outageActive && consecutiveHealthyResponses < HEALTHY_RESPONSES_TO_CLEAR) {
    setState({
      lastCheckedAt: currentTime,
      lastHealthyAt: currentTime,
    });
    scheduleSuspectProbe();
    return;
  }

  resetFailures();
  clearSuspectTimer();
  setState({
    status: 'healthy',
    outageActive: false,
    outageStartedAt: null,
    outageConfirmedAt: null,
    lastCheckedAt: currentTime,
    lastHealthyAt: currentTime,
    failureCount: 0,
  });

  if (recoveryWindow) {
    postRecoveryWindow(recoveryWindow);
  }
}

function recordConfirmedFailure(currentTime = now()): void {
  consecutiveHealthyResponses = 0;
  lastHealthyResponseAt = null;
  recentFailures = [...recentFailures.filter((failureAt) => currentTime - failureAt <= FAILURE_WINDOW_MS), currentTime];

  const outageStartedAt = state.outageStartedAt || recentFailures[0] || currentTime;
  const outageActive = recentFailures.length >= FAILURES_TO_SHOW;
  setState({
    status: outageActive ? 'outage' : 'suspect',
    outageActive,
    outageStartedAt,
    outageConfirmedAt: outageActive ? state.outageConfirmedAt || currentTime : null,
    lastCheckedAt: currentTime,
    failureCount: recentFailures.length,
  });
  scheduleSuspectProbe();
}

async function readHealthResponse(response: Response): Promise<DatabaseHealthResponse | null> {
  try {
    return (await response.json()) as DatabaseHealthResponse;
  } catch {
    return null;
  }
}

async function fetchHealthEndpoint(): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    return await fetch(HEALTH_ENDPOINT, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDatabaseHealthProbe(reason: DatabaseHealthProbeReason = 'nudge'): Promise<void> {
  const currentTime = now();
  hydrateStoredEmulation();
  if (shouldKeepEmulatedOutage(currentTime)) {
    setState({
      lastCheckedAt: currentTime,
      failureCount: FAILURES_TO_SHOW,
    });
    return;
  }

  if (!shouldProbe(currentTime)) {
    return;
  }

  if (
    reason === 'timer' &&
    state.status === 'healthy' &&
    hasRecentDbBackedSuccess(currentTime)
  ) {
    return;
  }

  if (probeInFlight) {
    return probeInFlight;
  }

  probeInFlight = (async () => {
    try {
      const response = await fetchHealthEndpoint();
      const payload = await readHealthResponse(response);

      if (response.ok && payload?.ok === true) {
        recordHealthyResponse(now());
        return;
      }

      if (response.status === 503 && payload?.reason === 'database_unreachable') {
        recordConfirmedFailure(now());
      }
    } catch {
      // Browser/network failures are intentionally ignored; only server-confirmed DB failures count.
    } finally {
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}

export function markDatabaseBackedSuccess(): void {
  if (shouldKeepEmulatedOutage()) {
    return;
  }

  recordHealthyResponse();
}

export function nudgeDatabaseHealthCheck(): void {
  if (!shouldProbe() || probeInFlight) {
    return;
  }

  void runDatabaseHealthProbe('nudge');
}

export function reportDatabaseHealthActivity(): void {
  const previousActivityAt = lastActivityAt;
  const currentTime = now();
  lastActivityAt = currentTime;
  if (currentTime - previousActivityAt > HEALTHY_PROOF_WINDOW_MS) {
    void runDatabaseHealthProbe('activity');
  }
}

export function getDatabaseHealthState(): DatabaseHealthState {
  return state;
}

export function subscribeToDatabaseHealth(listener: () => void): () => void {
  hydrateStoredEmulation();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startDatabaseHealthMonitor(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  hydrateStoredEmulation();

  const handleActivity = () => reportDatabaseHealthActivity();
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      lastActivityAt = now();
      void runDatabaseHealthProbe('visibility');
    }
  };
  const handleFocus = () => {
    lastActivityAt = now();
    void runDatabaseHealthProbe('visibility');
  };

  window.addEventListener('pointerdown', handleActivity, { passive: true });
  window.addEventListener('keydown', handleActivity);
  window.addEventListener('touchstart', handleActivity, { passive: true });
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', handleVisibility);

  void runDatabaseHealthProbe('mount');
  slowTimer = setInterval(() => {
    void runDatabaseHealthProbe('timer');
  }, TIMER_CHECK_MS);

  return () => {
    window.removeEventListener('pointerdown', handleActivity);
    window.removeEventListener('keydown', handleActivity);
    window.removeEventListener('touchstart', handleActivity);
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('visibilitychange', handleVisibility);
    clearSuspectTimer();
    if (slowTimer) {
      clearInterval(slowTimer);
      slowTimer = null;
    }
  };
}

export function activateDatabaseOutageEmulation(durationMs = DATABASE_OUTAGE_EMULATION_MS): void {
  const currentTime = now();
  const expiresAt = currentTime + durationMs;
  clearEmulationStartTimer();
  clearStoredEmulationSchedule();
  writeStoredEmulationExpiresAt(expiresAt);
  applyDatabaseOutageEmulation(expiresAt, currentTime);
}

export function scheduleDatabaseOutageEmulation(
  delayMs: number,
  durationMs = DATABASE_OUTAGE_EMULATION_MS,
): void {
  const currentTime = now();
  const normalizedDelayMs = Math.max(0, delayMs);
  if (normalizedDelayMs === 0) {
    activateDatabaseOutageEmulation(durationMs);
    return;
  }

  const startsAt = currentTime + normalizedDelayMs;
  const expiresAt = startsAt + durationMs;
  clearEmulationTimer();
  clearEmulationStartTimer();
  clearStoredEmulationExpiresAt();
  writeStoredEmulationSchedule({ startsAt, durationMs });
  resetFailures();
  clearSuspectTimer();
  setState({
    status: 'healthy',
    outageActive: false,
    outageStartedAt: null,
    outageConfirmedAt: null,
    lastCheckedAt: currentTime,
    failureCount: 0,
    emulatedOutageActive: false,
    emulatedOutageStartsAt: startsAt,
    emulatedOutageExpiresAt: expiresAt,
  });
  scheduleEmulationStart(startsAt, durationMs);
}

export function clearDatabaseOutageEmulation(): void {
  const wasEmulated = state.emulatedOutageActive || Boolean(state.emulatedOutageStartsAt);
  clearEmulationStartTimer();
  clearEmulationTimer();
  clearStoredEmulationSchedule();
  clearStoredEmulationExpiresAt();

  if (!wasEmulated) {
    return;
  }

  resetFailures();
  clearSuspectTimer();
  setState({
    status: 'healthy',
    outageActive: false,
    outageStartedAt: null,
    outageConfirmedAt: null,
    lastCheckedAt: now(),
    lastHealthyAt: now(),
    failureCount: 0,
    emulatedOutageActive: false,
    emulatedOutageStartsAt: null,
    emulatedOutageExpiresAt: null,
  });
}

export function resetDatabaseHealthForTests(): void {
  clearEmulationStartTimer();
  clearEmulationTimer();
  clearStoredEmulationSchedule();
  clearStoredEmulationExpiresAt();
  state = {
    status: 'healthy',
    outageActive: false,
    outageStartedAt: null,
    outageConfirmedAt: null,
    lastCheckedAt: null,
    lastHealthyAt: null,
    failureCount: 0,
    emulatedOutageActive: false,
    emulatedOutageStartsAt: null,
    emulatedOutageExpiresAt: null,
  };
  recentFailures = [];
  consecutiveHealthyResponses = 0;
  lastHealthyResponseAt = null;
  lastDbBackedSuccessAt = 0;
  lastActivityAt = Date.now();
  probeInFlight = null;
  clearSuspectTimer();
  if (slowTimer) {
    clearInterval(slowTimer);
    slowTimer = null;
  }
  recoveryInFlight = null;
  clientId = null;
  hasHydratedEmulation = false;
  emitChange();
}
