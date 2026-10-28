'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Recording {
  recording_id: string;
  user_id: string;
  user_name: string;
  first_occurred_at: string;
  last_occurred_at: string;
  event_count: number;
}
interface UsageEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  route: string | null;
  duration_ms: number | null;
  details: Record<string, string | number>;
}
interface EventPage {
  events: UsageEvent[];
  next_offset: number | null;
  truncated: boolean;
}
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB');

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load recordings');
  return data as T;
}

export function SiteUsageRecordingsPanel() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before?: string) => {
    setBusy(true); setError('');
    try {
      const data = await readJson<{ recordings: Recording[]; next_cursor: string | null }>(
        `/api/debug/site-usage${before ? `?cursor=${encodeURIComponent(before)}` : ''}`
      );
      setRecordings(data.recordings); setCursor(data.next_cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load recordings'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openRecording(recording: Recording) {
    setBusy(true); setError(''); setSelected(null); setEvents([]);
    try {
      const collected: UsageEvent[] = [];
      let offset: number | null = 0;
      let truncated = false;
      while (offset !== null) {
        const query = new URLSearchParams({ recording_id: recording.recording_id,
          user_id: recording.user_id, offset: String(offset), limit: '100' });
        const data: EventPage = await readJson<EventPage>(`/api/debug/site-usage?${query}`);
        collected.push(...data.events);
        truncated = data.truncated && data.next_offset === null;
        if (data.next_offset !== null && data.next_offset <= offset) throw new Error('Invalid recording pagination');
        offset = data.next_offset;
      }
      setEvents(collected); setPartial(truncated); setSelected(recording);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load recording'); }
    finally { setBusy(false); }
  }

  const areas = useMemo(() => {
    const result = new Map<string, { time: number; clicks: number; failures: number }>();
    for (const event of events) {
      const key = event.route || '/unknown';
      const area = result.get(key) || { time: 0, clicks: 0, failures: 0 };
      if (event.event_type === 'dwell') area.time += event.duration_ms || 0;
      if (event.event_type === 'click') area.clicks += 1;
      if (event.event_type === 'runtime_error' || (event.event_type === 'fetch'
        && (event.details.status === 0 || Number(event.details.status) >= 400))) area.failures += 1;
      result.set(key, area);
    }
    return [...result].sort((a, b) => b[1].time - a[1].time);
  }, [events]);

  function download() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify({ recording: selected, exported_at: new Date().toISOString(),
      partial, events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `site-usage-${selected.recording_id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Card data-testid="site-usage-recordings">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Site usage recordings</CardTitle>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh recordings</Button>
      </div>
      <CardDescription>Opt-in sessions from the top navigation. Select a recording to inspect active page time, interactions and request timings, or download its JSON log. Hidden and idle time are excluded. No typed values or page contents are recorded.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {busy && <p role="status">Loading recording data…</p>}
      {!busy && !recordings.length && !error && <p>No recordings yet. Turn on Logging in the top navigation to begin.</p>}
      <div className="flex flex-wrap gap-2">
        {recordings.map((recording) => <Button key={`${recording.user_id}:${recording.recording_id}`}
          variant={selected?.recording_id === recording.recording_id ? 'default' : 'outline'} disabled={busy}
          onClick={() => void openRecording(recording)} className="h-auto whitespace-normal text-left">
          {recording.user_name} · {dateLabel(recording.last_occurred_at)} · {recording.recording_id.slice(0, 8)}
        </Button>)}
      </div>
      {cursor && <Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Older activity</Button>}
      {selected && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>{selected.user_name} · {events.length} events · {events[0] ? dateLabel(events[0].occurred_at) : 'Empty session'}</p>
          <Button onClick={download}>Download JSON log</Button>
        </div>
        {partial && <p role="alert" className="text-amber-300">This view and download are limited to the first 5,000 events and are marked partial.</p>}
        <div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Area</th><th>Active time</th><th>Clicks</th><th>Failures</th></tr></thead>
          <tbody>{areas.map(([route, value]) => <tr key={route} className="border-t border-border">
            <td className="py-2">{route}</td><td>{(value.time / 1000).toFixed(1)}s</td><td>{value.clicks}</td><td>{value.failures}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="text-sm text-muted-foreground">Latest 100 loaded events shown below. The download includes all {events.length} loaded events. Reload the recording for new uploads.</p>
        <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Time</th><th>Event</th><th>Route</th><th>Duration</th><th>Detail</th></tr></thead>
          <tbody>{events.slice(-100).map((event) => <tr key={event.event_id} className="border-t border-border">
            <td className="py-2 whitespace-nowrap">{dateLabel(event.occurred_at)}</td><td>{event.event_type}</td>
            <td>{event.route}</td><td>{event.duration_ms === null ? '—' : `${event.duration_ms}ms`}</td>
            <td>{Object.entries(event.details).map(([key, value]) => `${key}: ${value}`).join(', ')}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </CardContent>
  </Card>;
}
