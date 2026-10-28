import { NextRequest, NextResponse } from 'next/server';
import { normalizeSiteUsageBatch, SITE_USAGE_MAX_BODY_BYTES } from '@/lib/analytics/site-usage';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { originMatchesRequest } from '@/lib/server/sample-data/api';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    if (!originMatchesRequest(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const current = await getCurrentAuthenticatedProfile();
    const userId = current?.profile?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > SITE_USAGE_MAX_BODY_BYTES) {
          await reader.cancel();
          return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid site usage payload' }, { status: 400 });
    }

    const normalized = normalizeSiteUsageBatch(payload);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const rows = normalized.events.map((event) => ({
      user_id: userId,
      recording_id: normalized.recordingId,
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      route: event.route,
      duration_ms: event.duration_ms,
      details: event.details,
    }));

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('site_usage_events')
      .upsert(rows, { onConflict: 'user_id,event_id', ignoreDuplicates: true })
      .select('event_id');

    if (error) {
      return NextResponse.json({ error: 'Failed to store site usage' }, { status: 500 });
    }

    const inserted = data?.length ?? 0;
    return NextResponse.json({
      success: true,
      accepted: rows.length,
      inserted,
      deduped: rows.length - inserted,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to store site usage' }, { status: 500 });
  }
}
