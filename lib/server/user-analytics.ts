import { createAdminClient } from '@/lib/supabase/admin';
import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import {
  detectUsageDeviceType,
  getUsageModuleFromPath,
  getUserUsageEventCategory,
  isUserUsageEventName,
  normalizeUsagePath,
  parseBrowserName,
  parseOsName,
  sanitizeAnalyticsMetadata,
  type UsageDeviceContext,
  type UserUsageEventCategory,
  type UserUsageEventName,
  type UserUsageEventSource,
} from '@/lib/analytics/events';

const MAX_BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 300;
const MAX_USER_AGENT_LENGTH = 2_048;
const ACTIVE_SESSION_WINDOW_MINUTES = 5;
const ANALYTICS_EVENT_BATCH_SIZE = 1_000;
const RECENT_EVENT_STREAM_LIMIT = 100;

interface CurrentProfileContext {
  profile: {
    id: string;
    email?: string | null;
  };
  validation?: {
    session?: {
      id: string;
    } | null;
  };
}

interface ClientUsageEventPayload {
  eventName?: unknown;
  eventCategory?: unknown;
  clientEventId?: unknown;
  clientSessionId?: unknown;
  occurredAt?: unknown;
  path?: unknown;
  referrerPath?: unknown;
  durationMs?: unknown;
  relatedRecordType?: unknown;
  relatedRecordId?: unknown;
  errorLogId?: unknown;
  metadata?: unknown;
}

export interface ClientUsageEventsPayload {
  clientSessionId?: unknown;
  device?: Partial<UsageDeviceContext> | null;
  events?: unknown;
}

export interface TrackServerUsageEventOptions {
  eventName: UserUsageEventName;
  userId?: string | null;
  appSessionId?: string | null;
  request?: Request | null;
  path?: string | null;
  referrerPath?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  errorLogId?: string | null;
}

interface NormalizedUsageEvent {
  event_name: UserUsageEventName;
  event_category: UserUsageEventCategory;
  client_event_id: string | null;
  client_session_id: string | null;
  occurred_at: string;
  event_source: UserUsageEventSource;
  module: string | null;
  path: string | null;
  normalized_path: string | null;
  referrer_path: string | null;
  duration_ms: number | null;
  related_record_type: string | null;
  related_record_id: string | null;
  error_log_id: string | null;
  metadata: Record<string, unknown>;
}

interface ExistingUsageSession {
  id: string;
  event_count: number | null;
  page_view_count: number | null;
  heartbeat_count: number | null;
}

export interface UsageAnalyticsSummary {
  totalEvents: number;
  uniqueUsers: number;
  sessionCount: number;
  pageViews: number;
  errorEvents: number;
  activeSessions: number;
  avgDurationMs: number | null;
}

export interface UsageAnalyticsBreakdown {
  label: string;
  events: number;
  users: number;
  sessions: number;
  pageViews: number;
}

export interface UsageAnalyticsInsight {
  title: string;
  value: string;
  detail: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

export interface UsageAnalyticsPlainSummary {
  headline: string;
  highlights: UsageAnalyticsInsight[];
}

export interface UsageAnalyticsDebugPayload {
  success: true;
  generatedAt: string;
  range: {
    start: string;
    end: string;
  };
  summary: UsageAnalyticsSummary;
  topModules: Array<{ module: string; events: number; users: number }>;
  topPages: Array<{ path: string; views: number; users: number }>;
  topEvents: Array<{ eventName: string; events: number; users: number }>;
  usageSummary: UsageAnalyticsPlainSummary;
  topTeams: UsageAnalyticsBreakdown[];
  roleBreakdown: UsageAnalyticsBreakdown[];
  deviceBreakdown: UsageAnalyticsBreakdown[];
  activeSessions: Array<{
    id: string;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    lastSeenAt: string;
    entryPath: string | null;
    exitPath: string | null;
    deviceType: string | null;
    browserName: string | null;
    eventCount: number;
    pageViewCount: number;
  }>;
  recentEvents: Array<{
    id: string;
    occurredAt: string;
    eventName: string;
    eventCategory: string;
    module: string | null;
    path: string | null;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    deviceType: string | null;
    sessionId: string | null;
    metadata: Record<string, unknown>;
  }>;
}

export interface DebugAnalyticsAccessResult {
  ok: boolean;
  status: number;
  error: string | null;
  code?: string;
  sensitive_access?: unknown;
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function getUsageSessionCount(value: number | null): number {
  return typeof value === 'number' ? value : 0;
}

function isDuplicateUsageSessionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;

  const message = (error.message || '').toLowerCase();
  return (
    error.code === '23505' ||
    (message.includes('duplicate key value') && message.includes('user_usage_sessions_client_session_id_key'))
  );
}

function normalizeDeviceContext(device: Partial<UsageDeviceContext> | null | undefined, request?: Request | null): UsageDeviceContext {
  const fallbackUserAgent = request?.headers.get('user-agent') || null;
  const userAgent = normalizeText(device?.userAgent, MAX_USER_AGENT_LENGTH) || fallbackUserAgent;
  const browser = parseBrowserName(userAgent);
  const viewportWidth = normalizeNumber(device?.viewportWidth);
  const viewportHeight = normalizeNumber(device?.viewportHeight);

  return {
    userAgent,
    browserName: normalizeText(device?.browserName, 80) || browser.name,
    browserVersion: normalizeText(device?.browserVersion, 80) || browser.version,
    osName: normalizeText(device?.osName, 80) || parseOsName(userAgent),
    deviceType: device?.deviceType || detectUsageDeviceType(userAgent),
    viewportWidth,
    viewportHeight,
    locale: normalizeText(device?.locale, 40),
    timezone: normalizeText(device?.timezone, 80),
  };
}

function normalizeClientUsageEvent(payload: ClientUsageEventPayload, fallbackClientSessionId: string | null): NormalizedUsageEvent | null {
  if (!isUserUsageEventName(payload.eventName)) {
    return null;
  }

  const path = normalizeText(payload.path, 1_000);
  const normalizedPath = normalizeUsagePath(path);
  const eventCategory =
    typeof payload.eventCategory === 'string'
      ? (payload.eventCategory as UserUsageEventCategory)
      : getUserUsageEventCategory(payload.eventName);

  return {
    event_name: payload.eventName,
    event_category: ['session', 'navigation', 'auth', 'error', 'performance'].includes(eventCategory)
      ? eventCategory
      : getUserUsageEventCategory(payload.eventName),
    client_event_id: normalizeText(payload.clientEventId, 120),
    client_session_id: normalizeText(payload.clientSessionId, 120) || fallbackClientSessionId,
    occurred_at: normalizeTimestamp(payload.occurredAt),
    event_source: 'client',
    module: getUsageModuleFromPath(normalizedPath),
    path: path ? path.slice(0, 1_000) : normalizedPath,
    normalized_path: normalizedPath,
    referrer_path: normalizeUsagePath(normalizeText(payload.referrerPath, 1_000)),
    duration_ms: normalizeNumber(payload.durationMs),
    related_record_type: normalizeText(payload.relatedRecordType, 80),
    related_record_id: normalizeText(payload.relatedRecordId, 120),
    error_log_id: normalizeText(payload.errorLogId, 80),
    metadata: sanitizeAnalyticsMetadata(payload.metadata || {}),
  };
}

async function findUsageSessionByClientId(
  admin: ReturnType<typeof createAdminClient>,
  clientSessionId: string
): Promise<ExistingUsageSession | null> {
  const { data: existing, error: selectError } = await admin
    .from('user_usage_sessions')
    .select('id, event_count, page_view_count, heartbeat_count')
    .eq('client_session_id', clientSessionId)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  return existing;
}

async function updateUsageSession({
  admin,
  existing,
  current,
  appSessionId,
  device,
  lastEvent,
  eventsLength,
  pageViewCount,
  heartbeatCount,
}: {
  admin: ReturnType<typeof createAdminClient>;
  existing: ExistingUsageSession;
  current: CurrentProfileContext;
  appSessionId: string | null;
  device: UsageDeviceContext;
  lastEvent: NormalizedUsageEvent | null;
  eventsLength: number;
  pageViewCount: number;
  heartbeatCount: number;
}): Promise<string> {
  const { error: updateError } = await admin
    .from('user_usage_sessions')
    .update({
      user_id: current.profile.id,
      app_session_id: appSessionId,
      last_seen_at: lastEvent?.occurred_at || new Date().toISOString(),
      exit_path: lastEvent?.normalized_path || lastEvent?.path || null,
      user_agent: device.userAgent,
      browser_name: device.browserName,
      browser_version: device.browserVersion,
      os_name: device.osName,
      device_type: device.deviceType,
      viewport_width: device.viewportWidth,
      viewport_height: device.viewportHeight,
      locale: device.locale,
      timezone: device.timezone,
      event_count: getUsageSessionCount(existing.event_count) + eventsLength,
      page_view_count: getUsageSessionCount(existing.page_view_count) + pageViewCount,
      heartbeat_count: getUsageSessionCount(existing.heartbeat_count) + heartbeatCount,
    })
    .eq('id', existing.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return existing.id;
}

async function getUsageSessionId({
  admin,
  current,
  clientSessionId,
  appSessionId,
  device,
  events,
}: {
  admin: ReturnType<typeof createAdminClient>;
  current: CurrentProfileContext;
  clientSessionId: string | null;
  appSessionId: string | null;
  device: UsageDeviceContext;
  events: NormalizedUsageEvent[];
}): Promise<string | null> {
  if (!clientSessionId) return null;

  const firstEvent = events[0] || null;
  const lastEvent = events[events.length - 1] || firstEvent;
  const pageViewCount = events.filter((event) => event.event_name === 'page_view').length;
  const heartbeatCount = events.filter((event) => event.event_name === 'session_heartbeat').length;

  const existing = await findUsageSessionByClientId(admin, clientSessionId);

  if (existing?.id) {
    return updateUsageSession({
      admin,
      existing,
      current,
      appSessionId,
      device,
      lastEvent,
      eventsLength: events.length,
      pageViewCount,
      heartbeatCount,
    });
  }

  const { data: created, error: insertError } = await admin
    .from('user_usage_sessions')
    .insert({
      user_id: current.profile.id,
      app_session_id: appSessionId,
      client_session_id: clientSessionId,
      first_seen_at: firstEvent?.occurred_at || new Date().toISOString(),
      last_seen_at: lastEvent?.occurred_at || new Date().toISOString(),
      entry_path: firstEvent?.normalized_path || firstEvent?.path || null,
      exit_path: lastEvent?.normalized_path || lastEvent?.path || null,
      referrer_path: firstEvent?.referrer_path || null,
      user_agent: device.userAgent,
      browser_name: device.browserName,
      browser_version: device.browserVersion,
      os_name: device.osName,
      device_type: device.deviceType,
      viewport_width: device.viewportWidth,
      viewport_height: device.viewportHeight,
      locale: device.locale,
      timezone: device.timezone,
      event_count: events.length,
      page_view_count: pageViewCount,
      heartbeat_count: heartbeatCount,
    })
    .select('id')
    .single();

  if (insertError) {
    if (isDuplicateUsageSessionError(insertError)) {
      const racedSession = await findUsageSessionByClientId(admin, clientSessionId);
      if (racedSession?.id) {
        return updateUsageSession({
          admin,
          existing: racedSession,
          current,
          appSessionId,
          device,
          lastEvent,
          eventsLength: events.length,
          pageViewCount,
          heartbeatCount,
        });
      }
    }

    throw new Error(insertError.message);
  }

  if (!created?.id) {
    throw new Error('Failed to create usage session');
  }

  return created.id as string;
}

export async function insertClientUsageEvents({
  request,
  current,
  payload,
}: {
  request: Request;
  current: CurrentProfileContext;
  payload: ClientUsageEventsPayload;
}): Promise<number> {
  const fallbackClientSessionId = normalizeText(payload.clientSessionId, 120);
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  const events = rawEvents
    .slice(0, MAX_BATCH_SIZE)
    .map((entry) => normalizeClientUsageEvent((entry || {}) as ClientUsageEventPayload, fallbackClientSessionId))
    .filter((entry): entry is NormalizedUsageEvent => entry !== null);

  if (events.length === 0) return 0;

  const admin = createAdminClient();
  const appSessionId = current.validation?.session?.id || null;
  const device = normalizeDeviceContext(payload.device || null, request);
  const sessionId = await getUsageSessionId({
    admin,
    current,
    clientSessionId: events[0]?.client_session_id || fallbackClientSessionId,
    appSessionId,
    device,
    events,
  });

  const rows = events.map((event) => ({
    session_id: sessionId,
    user_id: current.profile.id,
    app_session_id: appSessionId,
    client_session_id: event.client_session_id,
    client_event_id: event.client_event_id,
    occurred_at: event.occurred_at,
    event_name: event.event_name,
    event_category: event.event_category,
    module: event.module,
    path: event.path,
    normalized_path: event.normalized_path,
    referrer_path: event.referrer_path,
    event_source: event.event_source,
    duration_ms: event.duration_ms,
    related_record_type: event.related_record_type,
    related_record_id: event.related_record_id,
    error_log_id: event.error_log_id,
    metadata: event.metadata,
  }));

  const { error } = await admin
    .from('user_usage_events')
    .upsert(rows, {
      onConflict: 'client_event_id',
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  return rows.length;
}

export async function trackServerUsageEvent(options: TrackServerUsageEventOptions): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    const admin = createAdminClient();
    const userAgent = options.request?.headers.get('user-agent') || null;
    const referer = options.request?.headers.get('referer') || null;
    const requestUrl = options.request ? new URL(options.request.url) : null;
    const path = normalizeUsagePath(options.path || requestUrl?.pathname || null);

    const { error } = await admin.from('user_usage_events').insert({
      user_id: options.userId || null,
      app_session_id: options.appSessionId || null,
      occurred_at: new Date().toISOString(),
      event_name: options.eventName,
      event_category: getUserUsageEventCategory(options.eventName),
      module: getUsageModuleFromPath(path),
      path,
      normalized_path: path,
      referrer_path: normalizeUsagePath(options.referrerPath || referer),
      event_source: 'server',
      duration_ms: options.durationMs ?? null,
      related_record_type: options.relatedRecordType || null,
      related_record_id: options.relatedRecordId || null,
      error_log_id: options.errorLogId || null,
      metadata: sanitizeAnalyticsMetadata({
        ...options.metadata,
        userAgent,
        deviceType: detectUsageDeviceType(userAgent),
        osName: parseOsName(userAgent),
        browserName: parseBrowserName(userAgent).name,
      }),
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.warn('[User Analytics] Failed to track server event:', error);
  }
}

export async function requireDebugAnalyticsAccess(): Promise<DebugAnalyticsAccessResult> {
  return requireDebugConsoleAccess();
}

function getSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function addAggregate<K extends string>(
  map: Map<K, { label: K; events: number; users: Set<string> }>,
  key: K,
  userId: string | null
) {
  const current = map.get(key) || { label: key, events: 0, users: new Set<string>() };
  current.events += 1;
  if (userId) current.users.add(userId);
  map.set(key, current);
}

function addBreakdownAggregate(
  map: Map<string, { label: string; events: number; users: Set<string>; sessions: Set<string>; pageViews: number }>,
  key: string,
  userId: string | null,
  sessionId: string | null,
  isPageView: boolean
) {
  const label = key || 'Unknown';
  const current = map.get(label) || {
    label,
    events: 0,
    users: new Set<string>(),
    sessions: new Set<string>(),
    pageViews: 0,
  };
  current.events += 1;
  if (userId) current.users.add(userId);
  if (sessionId) current.sessions.add(sessionId);
  if (isPageView) current.pageViews += 1;
  map.set(label, current);
}

function sortAggregates<T extends { events: number }>(items: T[], limit: number): T[] {
  return items.sort((a, b) => b.events - a.events).slice(0, limit);
}

function sortBreakdowns(
  map: Map<string, { label: string; events: number; users: Set<string>; sessions: Set<string>; pageViews: number }>,
  limit: number
): UsageAnalyticsBreakdown[] {
  return Array.from(map.values())
    .map((entry) => ({
      label: entry.label,
      events: entry.events,
      users: entry.users.size,
      sessions: entry.sessions.size,
      pageViews: entry.pageViews,
    }))
    .sort((a, b) => b.events - a.events)
    .slice(0, limit);
}

function formatInsightNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function formatInsightDuration(value: number | null): string {
  if (value === null) return 'not enough data yet';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function buildUsagePlainSummary(params: {
  summary: UsageAnalyticsSummary;
  topModules: Array<{ module: string; events: number; users: number }>;
  topTeams: UsageAnalyticsBreakdown[];
  roleBreakdown: UsageAnalyticsBreakdown[];
  deviceBreakdown: UsageAnalyticsBreakdown[];
}): UsageAnalyticsPlainSummary {
  const { summary, topModules, topTeams, roleBreakdown, deviceBreakdown } = params;
  if (summary.totalEvents === 0) {
    return {
      headline: 'No usage has been recorded for the selected filters and date range.',
      highlights: [
        {
          title: 'What this means',
          value: 'No activity',
          detail: 'Either the selected filters are too narrow, or users have not used the tracked parts of the app during this period.',
          tone: 'neutral',
        },
      ],
    };
  }

  const topModule = topModules[0] || null;
  const topTeam = topTeams[0] || null;
  const topRole = roleBreakdown[0] || null;
  const topDevice = deviceBreakdown[0] || null;
  const errorRate = summary.totalEvents > 0 ? (summary.errorEvents / summary.totalEvents) * 100 : 0;
  const reliabilityTone: UsageAnalyticsInsight['tone'] = summary.errorEvents === 0
    ? 'success'
    : errorRate >= 5
      ? 'danger'
      : 'warning';

  return {
    headline: `${formatInsightNumber(summary.uniqueUsers)} people used the app in this range, creating ${formatInsightNumber(summary.totalEvents)} tracked events across ${formatInsightNumber(summary.sessionCount)} sessions.`,
    highlights: [
      {
        title: 'Busiest app area',
        value: topModule?.module || 'Unknown',
        detail: topModule
          ? `${formatInsightNumber(topModule.users)} users generated ${formatInsightNumber(topModule.events)} events here, making it the clearest signal of day-to-day usage.`
          : 'There is not enough module data to identify the busiest area yet.',
        tone: 'info',
      },
      {
        title: 'Most active team',
        value: topTeam?.label || 'Unknown team',
        detail: topTeam
          ? `${formatInsightNumber(topTeam.users)} users created ${formatInsightNumber(topTeam.events)} events and ${formatInsightNumber(topTeam.pageViews)} page views.`
          : 'Team information was not available on the recorded events.',
        tone: 'success',
      },
      {
        title: 'Primary user group',
        value: topRole?.label || 'Unknown role',
        detail: topRole
          ? `${formatInsightNumber(topRole.users)} users in this group account for ${formatInsightNumber(topRole.events)} events.`
          : 'Role information was not available on the recorded events.',
        tone: 'neutral',
      },
      {
        title: 'Device pattern',
        value: topDevice?.label || 'Unknown device',
        detail: topDevice
          ? `${formatInsightNumber(topDevice.events)} events came from ${topDevice.label}, which helps explain how people are accessing the app on site or in the office.`
          : 'Device information was not available on the recorded events.',
        tone: 'info',
      },
      {
        title: 'Reliability signal',
        value: `${formatInsightNumber(summary.errorEvents)} errors`,
        detail: summary.errorEvents === 0
          ? 'No client-observed error events were recorded in this range.'
          : `${errorRate.toFixed(1)}% of tracked events were error events, so the error log should be reviewed alongside this usage picture.`,
        tone: reliabilityTone,
      },
      {
        title: 'Engagement signal',
        value: `${formatInsightNumber(summary.pageViews)} page views`,
        detail: `${formatInsightNumber(summary.activeSessions)} sessions are active now. Average measured event duration is ${formatInsightDuration(summary.avgDurationMs)}.`,
        tone: summary.activeSessions > 0 ? 'success' : 'neutral',
      },
    ],
  };
}

export async function getUserAnalyticsDebugPayload(params: URLSearchParams): Promise<UsageAnalyticsDebugPayload> {
  const range = params.get('range') || '7d';
  const rangeDays = range === '24h' ? 1 : range === '30d' ? 30 : range === '90d' ? 90 : 7;
  const end = new Date();
  const start = new Date(end.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const moduleFilter = normalizeText(params.get('module'), 80);
  const eventFilter = normalizeText(params.get('event'), 80);
  const userFilter = normalizeText(params.get('userId'), 80);

  const admin = createAdminClient();
  const activeSince = new Date(Date.now() - ACTIVE_SESSION_WINDOW_MINUTES * 60 * 1000).toISOString();
  const sessionsPromise = admin
    .from('user_usage_sessions')
    .select(`
      id,
      user_id,
      last_seen_at,
      entry_path,
      exit_path,
      device_type,
      browser_name,
      event_count,
      page_view_count,
      profile:profiles!user_usage_sessions_user_id_fkey(
        full_name,
        team:org_teams!profiles_team_id_fkey(name),
        role:roles(display_name)
      )
    `)
    .gte('last_seen_at', activeSince)
    .order('last_seen_at', { ascending: false })
    .limit(25);

  const recentEvents: Array<Record<string, unknown>> = [];
  let totalEvents = 0;
  let offset = 0;
  let hasMoreEvents = true;
  const uniqueUsers = new Set<string>();
  const uniqueSessions = new Set<string>();
  const moduleMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  const pageMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  const eventMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  const teamMap = new Map<string, { label: string; events: number; users: Set<string>; sessions: Set<string>; pageViews: number }>();
  const roleMap = new Map<string, { label: string; events: number; users: Set<string>; sessions: Set<string>; pageViews: number }>();
  const deviceMap = new Map<string, { label: string; events: number; users: Set<string>; sessions: Set<string>; pageViews: number }>();
  let pageViews = 0;
  let errorEvents = 0;
  let durationTotal = 0;
  let durationCount = 0;

  while (hasMoreEvents) {
    let eventQuery = admin
      .from('user_usage_events')
      .select(`
        id,
        occurred_at,
        event_name,
        event_category,
        module,
        path,
        normalized_path,
        user_id,
        session_id,
        duration_ms,
        metadata,
        profile:profiles!user_usage_events_user_id_fkey(
          full_name,
          team:org_teams!profiles_team_id_fkey(name),
          role:roles(display_name)
        ),
        session:user_usage_sessions(device_type)
      `)
      .gte('occurred_at', start.toISOString())
      .lte('occurred_at', end.toISOString());

    if (moduleFilter && moduleFilter !== 'all') {
      eventQuery = eventQuery.eq('module', moduleFilter);
    }
    if (eventFilter && eventFilter !== 'all') {
      eventQuery = eventQuery.eq('event_name', eventFilter);
    }
    if (userFilter && userFilter !== 'all') {
      eventQuery = eventQuery.eq('user_id', userFilter);
    }

    const eventsResult = await eventQuery
      .order('occurred_at', { ascending: false })
      .range(offset, offset + ANALYTICS_EVENT_BATCH_SIZE - 1);
    if (eventsResult.error) {
      throw new Error(eventsResult.error.message);
    }

    const eventBatch = (eventsResult.data || []) as Array<Record<string, unknown>>;
    totalEvents += eventBatch.length;
    if (recentEvents.length < RECENT_EVENT_STREAM_LIMIT) {
      recentEvents.push(...eventBatch.slice(0, RECENT_EVENT_STREAM_LIMIT - recentEvents.length));
    }

    for (const event of eventBatch) {
      const userId = typeof event.user_id === 'string' ? event.user_id : null;
      const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
      const eventName = typeof event.event_name === 'string' ? event.event_name : 'unknown';
      const isPageView = eventName === 'page_view';
      const profile = getSingle(event.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const team = getSingle(profile?.team as Record<string, unknown> | Record<string, unknown>[] | null);
      const role = getSingle(profile?.role as Record<string, unknown> | Record<string, unknown>[] | null);
      const session = getSingle(event.session as Record<string, unknown> | Record<string, unknown>[] | null);
      const teamName = typeof team?.name === 'string' ? team.name : 'Unknown team';
      const roleName = typeof role?.display_name === 'string' ? role.display_name : 'Unknown role';
      const deviceType = typeof session?.device_type === 'string' ? session.device_type : 'unknown';

      if (userId) uniqueUsers.add(userId);
      if (sessionId) uniqueSessions.add(sessionId);
      if (isPageView) pageViews += 1;
      if (event.event_category === 'error') errorEvents += 1;

      const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : null;
      if (durationMs !== null) {
        durationTotal += durationMs;
        durationCount += 1;
      }

      addAggregate(moduleMap, (typeof event.module === 'string' && event.module) || 'unknown', userId);
      addAggregate(eventMap, eventName, userId);
      if (isPageView) {
        addAggregate(pageMap, (typeof event.normalized_path === 'string' && event.normalized_path) || 'unknown', userId);
      }
      addBreakdownAggregate(teamMap, teamName, userId, sessionId, isPageView);
      addBreakdownAggregate(roleMap, roleName, userId, sessionId, isPageView);
      addBreakdownAggregate(deviceMap, deviceType, userId, sessionId, isPageView);
    }

    hasMoreEvents = eventBatch.length === ANALYTICS_EVENT_BATCH_SIZE;
    offset += ANALYTICS_EVENT_BATCH_SIZE;
  }

  const sessionsResult = await sessionsPromise;
  if (sessionsResult.error) {
    throw new Error(sessionsResult.error.message);
  }

  const rawSessions = (sessionsResult.data || []) as Array<Record<string, unknown>>;
  const summary: UsageAnalyticsSummary = {
    totalEvents,
    uniqueUsers: uniqueUsers.size,
    sessionCount: uniqueSessions.size,
    pageViews,
    errorEvents,
    activeSessions: rawSessions.length,
    avgDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
  };
  const topModules = sortAggregates(
    Array.from(moduleMap.values()).map((entry) => ({
      module: entry.label,
      events: entry.events,
      users: entry.users.size,
    })),
    10
  );
  const topPages = sortAggregates(
    Array.from(pageMap.values()).map((entry) => ({
      path: entry.label,
      views: entry.events,
      users: entry.users.size,
      events: entry.events,
    })),
    10
  ).map(({ path, views, users }) => ({ path, views, users }));
  const topEvents = sortAggregates(
    Array.from(eventMap.values()).map((entry) => ({
      eventName: entry.label,
      events: entry.events,
      users: entry.users.size,
    })),
    10
  );
  const topTeams = sortBreakdowns(teamMap, 10);
  const roleBreakdown = sortBreakdowns(roleMap, 10);
  const deviceBreakdown = sortBreakdowns(deviceMap, 10);

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    summary,
    topModules,
    topPages,
    topEvents,
    usageSummary: buildUsagePlainSummary({ summary, topModules, topTeams, roleBreakdown, deviceBreakdown }),
    topTeams,
    roleBreakdown,
    deviceBreakdown,
    activeSessions: rawSessions.map((session) => {
      const profile = getSingle(session.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const team = getSingle(profile?.team as Record<string, unknown> | Record<string, unknown>[] | null);
      const role = getSingle(profile?.role as Record<string, unknown> | Record<string, unknown>[] | null);
      return {
        id: String(session.id || ''),
        userId: typeof session.user_id === 'string' ? session.user_id : null,
        userName: typeof profile?.full_name === 'string' ? profile.full_name : 'Unknown User',
        teamName: typeof team?.name === 'string' ? team.name : null,
        roleName: typeof role?.display_name === 'string' ? role.display_name : null,
        lastSeenAt: String(session.last_seen_at || ''),
        entryPath: typeof session.entry_path === 'string' ? session.entry_path : null,
        exitPath: typeof session.exit_path === 'string' ? session.exit_path : null,
        deviceType: typeof session.device_type === 'string' ? session.device_type : null,
        browserName: typeof session.browser_name === 'string' ? session.browser_name : null,
        eventCount: typeof session.event_count === 'number' ? session.event_count : 0,
        pageViewCount: typeof session.page_view_count === 'number' ? session.page_view_count : 0,
      };
    }),
    recentEvents: recentEvents.map((event) => {
      const profile = getSingle(event.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const team = getSingle(profile?.team as Record<string, unknown> | Record<string, unknown>[] | null);
      const role = getSingle(profile?.role as Record<string, unknown> | Record<string, unknown>[] | null);
      const session = getSingle(event.session as Record<string, unknown> | Record<string, unknown>[] | null);
      return {
        id: String(event.id || ''),
        occurredAt: String(event.occurred_at || ''),
        eventName: String(event.event_name || ''),
        eventCategory: String(event.event_category || ''),
        module: typeof event.module === 'string' ? event.module : null,
        path: typeof event.normalized_path === 'string' ? event.normalized_path : typeof event.path === 'string' ? event.path : null,
        userId: typeof event.user_id === 'string' ? event.user_id : null,
        userName: typeof profile?.full_name === 'string' ? profile.full_name : 'Unknown User',
        teamName: typeof team?.name === 'string' ? team.name : null,
        roleName: typeof role?.display_name === 'string' ? role.display_name : null,
        deviceType: typeof session?.device_type === 'string' ? session.device_type : null,
        sessionId: typeof event.session_id === 'string' ? event.session_id : null,
        metadata: sanitizeAnalyticsMetadata(event.metadata || {}),
      };
    }),
  };
}
