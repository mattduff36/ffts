import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDebugAccessErrorBody,
  requireDebugConsoleAccess,
} from '@/lib/server/debug-console-access';
import { createAdminClient } from '@/lib/supabase/admin';

const SUMMARY_SCAN_LIMIT = 2000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_OFFSET = 5_000;

const EVENT_COLUMNS = 'user_id,recording_id,event_id,event_type,occurred_at,route,duration_ms,details';
const SUMMARY_COLUMNS = 'user_id,recording_id,event_type,occurred_at,profile:profiles!site_usage_events_user_id_fkey(full_name)';

interface UsageRow {
  user_id: string;
  recording_id: string;
  event_id?: string;
  event_type: string;
  occurred_at: string;
  route?: string | null;
  duration_ms?: number | null;
  details?: Record<string, string | number>;
  profile?: { full_name: string } | null;
}

interface UsageQuery {
  select(columns: string): UsageQuery;
  eq(column: string, value: string): UsageQuery;
  lt(column: string, value: string): UsageQuery;
  order(column: string, options: { ascending: boolean }): UsageQuery;
  limit(count: number): Promise<{ data: UsageRow[] | null; error: { message: string } | null }>;
  range(from: number, to: number): Promise<{ data: UsageRow[] | null; error: { message: string } | null }>;
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function pageOptions(request: NextRequest) {
  const limitValue = Number(request.nextUrl.searchParams.get('limit') ?? DEFAULT_PAGE_LIMIT);
  const offsetValue = Number(request.nextUrl.searchParams.get('offset') ?? 0);
  const limit = Number.isInteger(limitValue)
    ? Math.min(Math.max(limitValue, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const offset = Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  return { limit, offset };
}

function summarize(rows: UsageRow[]) {
  const summaries = new Map<string, {
    recording_id: string;
    user_id: string;
    user_name: string;
    event_count: number;
    first_occurred_at: string;
    last_occurred_at: string;
    event_types: string[];
  }>();
  for (const row of rows) {
    const key = `${row.user_id}:${row.recording_id}`;
    const current = summaries.get(key);
    if (!current) {
      summaries.set(key, {
        recording_id: row.recording_id,
        user_id: row.user_id,
        user_name: row.profile?.full_name || row.user_id,
        event_count: 1,
        first_occurred_at: row.occurred_at,
        last_occurred_at: row.occurred_at,
        event_types: [row.event_type],
      });
      continue;
    }
    current.event_count += 1;
    if (row.occurred_at < current.first_occurred_at) current.first_occurred_at = row.occurred_at;
    if (row.occurred_at > current.last_occurred_at) current.last_occurred_at = row.occurred_at;
    if (!current.event_types.includes(row.event_type)) current.event_types.push(row.event_type);
  }
  return Array.from(summaries.values()).sort((left, right) => (
    right.last_occurred_at.localeCompare(left.last_occurred_at)
  ));
}

export async function GET(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return noStore(createDebugAccessErrorBody(access), access.status);
  }

  const recordingId = request.nextUrl.searchParams.get('recording_id');
  if (recordingId && !z.uuid().safeParse(recordingId).success) {
    return noStore({ error: 'Invalid recording id' }, 400);
  }
  const cursor = request.nextUrl.searchParams.get('cursor');
  const userId = request.nextUrl.searchParams.get('user_id');
  if (userId && !z.uuid().safeParse(userId).success) return noStore({ error: 'Invalid user id' }, 400);
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    return noStore({ error: 'Invalid cursor' }, 400);
  }

  try {
    const admin = createAdminClient();
    let query = (admin.from('site_usage_events') as unknown as UsageQuery).select(
      recordingId ? EVENT_COLUMNS : SUMMARY_COLUMNS,
    );
    if (recordingId) query = query.eq('recording_id', recordingId);
    if (userId) query = query.eq('user_id', userId);
    if (!recordingId && cursor) query = query.lt('occurred_at', new Date(cursor).toISOString());

    if (!recordingId) {
      const { data, error } = await query
        .order('occurred_at', { ascending: false })
        .limit(SUMMARY_SCAN_LIMIT + 1);
      if (error) return noStore({ error: 'Failed to read site usage' }, 500);
      const rows = data ?? [];
      const hasMore = rows.length > SUMMARY_SCAN_LIMIT;
      const scannedRows = rows.slice(0, SUMMARY_SCAN_LIMIT);
      return noStore({
        mode: 'summaries',
        recordings: summarize(scannedRows),
        scanned: scannedRows.length,
        scan_limit: SUMMARY_SCAN_LIMIT,
        has_more: hasMore,
        truncated: hasMore,
        next_cursor: hasMore ? scannedRows[scannedRows.length - 1]?.occurred_at ?? null : null,
      });
    }

    const { limit, offset } = pageOptions(request);
    if (offset >= MAX_OFFSET) {
      return noStore({
        mode: 'events',
        recording_id: recordingId,
        events: [],
        limit,
        offset,
        has_more: false,
        truncated: true,
        next_offset: null,
      });
    }

    const { data, error } = await query
      .order('occurred_at', { ascending: true })
      .order('event_id', { ascending: true })
      .range(offset, offset + limit);
    if (error) return noStore({ error: 'Failed to read site usage' }, 500);
    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row) => ({
      user_id: row.user_id,
      recording_id: row.recording_id,
      event_id: row.event_id,
      event_type: row.event_type,
      occurred_at: row.occurred_at,
      route: row.route ?? null,
      duration_ms: row.duration_ms ?? null,
      details: row.details ?? {},
    }));
    const reachedCap = offset + events.length >= MAX_OFFSET;
    return noStore({
      mode: 'events',
      recording_id: recordingId,
      events,
      limit,
      offset,
      has_more: hasMore && !reachedCap,
      truncated: hasMore || reachedCap,
      next_offset: hasMore && !reachedCap ? offset + events.length : null,
    });
  } catch {
    return noStore({ error: 'Failed to read site usage' }, 500);
  }
}
