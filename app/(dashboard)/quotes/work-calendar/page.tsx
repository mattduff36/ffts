'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { Badge } from '@/components/ui/badge';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';

interface QuoteCalendarRow {
  id: string;
  quote_reference: string;
  subject_line: string | null;
  project_description: string | null;
  start_date: string;
  estimated_duration_days: number | null;
  status: string;
  manager_name: string | null;
  customer?: { company_name?: string | null } | null;
}

interface ManualCalendarEntry {
  id: string;
  quote_id: string | null;
  title: string;
  summary: string | null;
  start_date: string;
  estimated_duration_days: number;
  quote?: {
    quote_reference?: string | null;
    subject_line?: string | null;
    customer?: { company_name?: string | null } | null;
  } | null;
}

interface CalendarEvent {
  id: string;
  source: 'quote' | 'manual';
  title: string;
  subtitle: string;
  startDate: Date;
  endDate: Date;
  reference?: string;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function buildEventEnd(startDate: Date, durationDays: number | null | undefined) {
  const days = Math.max(Number(durationDays || 1), 1);
  return addDays(startDate, days - 1);
}

export default function QuoteWorkCalendarPage() {
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const sensitiveAccess = useSensitiveModuleAccess('quotes');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [quotes, setQuotes] = useState<QuoteCalendarRow[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entryTitle, setEntryTitle] = useState('');
  const [entrySummary, setEntrySummary] = useState('');
  const [entryStartDate, setEntryStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [entryDuration, setEntryDuration] = useState('1');
  const [entryQuoteId, setEntryQuoteId] = useState('');

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursorDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursorDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursorDate]);

  const fetchCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const start = format(calendarDays[0], 'yyyy-MM-dd');
      const end = format(calendarDays[calendarDays.length - 1], 'yyyy-MM-dd');
      const res = await fetch(`/api/quotes/work-calendar?start=${start}&end=${end}`);
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || 'Failed to load work calendar');
      }
      const payload = await res.json();
      setQuotes(payload.quotes || []);
      setManualEntries(payload.manual_entries || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load work calendar');
    } finally {
      setLoading(false);
    }
  }, [calendarDays]);

  useEffect(() => {
    if (!permissionLoading && !sensitiveAccess.loading && canViewQuotes && sensitiveAccess.canAccess) {
      void fetchCalendar();
    }
  }, [permissionLoading, sensitiveAccess.loading, sensitiveAccess.canAccess, canViewQuotes, fetchCalendar]);

  const events = useMemo<CalendarEvent[]>(() => {
    const quoteEvents = quotes.map((quote) => {
      const startDate = parseLocalDate(quote.start_date);
      return {
        id: quote.id,
        source: 'quote' as const,
        title: quote.subject_line || quote.quote_reference,
        subtitle: quote.customer?.company_name || quote.manager_name || 'Quote',
        reference: quote.quote_reference,
        startDate,
        endDate: buildEventEnd(startDate, quote.estimated_duration_days),
      };
    });

    const manualEvents = manualEntries.map((entry) => {
      const startDate = parseLocalDate(entry.start_date);
      return {
        id: entry.id,
        source: 'manual' as const,
        title: entry.title,
        subtitle: entry.quote?.quote_reference || entry.summary || 'Manual entry',
        reference: entry.quote?.quote_reference || undefined,
        startDate,
        endDate: buildEventEnd(startDate, entry.estimated_duration_days),
      };
    });

    return [...quoteEvents, ...manualEvents];
  }, [manualEntries, quotes]);

  async function createManualEntry() {
    setSaving(true);
    try {
      const res = await fetch('/api/quotes/work-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: entryTitle,
          summary: entrySummary,
          start_date: entryStartDate,
          estimated_duration_days: Number(entryDuration || 1),
          quote_id: entryQuoteId || null,
        }),
      });

      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || 'Failed to create calendar entry');
      }

      setEntryTitle('');
      setEntrySummary('');
      setEntryQuoteId('');
      setEntryDuration('1');
      toast.success('Calendar entry added');
      await fetchCalendar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create calendar entry');
    } finally {
      setSaving(false);
    }
  }

  async function deleteManualEntry(id: string) {
    try {
      const res = await fetch(`/api/quotes/work-calendar?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || 'Failed to delete calendar entry');
      }
      toast.success('Calendar entry deleted');
      await fetchCalendar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete calendar entry');
    }
  }

  if (permissionLoading || sensitiveAccess.loading || (sensitiveAccess.canAccess && loading)) return <PageLoader message="Loading work calendar..." />;
  if (!canViewQuotes) return null;
  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell>
        <SensitiveModuleGate moduleLabel="Quotes" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <SensitiveModuleSessionManager moduleLabel="Quotes" access={sensitiveAccess} />
      <AppPageHeader
        title="Quote Work Calendar"
        description="Planned quote starts, estimated durations, and manual work entries."
        icon={<CalendarClock className="h-5 w-5" />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="border-border bg-white dark:bg-slate-900">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-foreground">{format(cursorDate, 'MMMM yyyy')}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCursorDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCursorDate(new Date())}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => setCursorDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 border border-border text-xs font-medium text-muted-foreground">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="border-b border-border p-2">{day}</div>
              ))}
              {calendarDays.map(day => {
                const dayEvents = events.filter(event => day >= event.startDate && day <= event.endDate);
                return (
                  <div key={day.toISOString()} className="min-h-32 border-b border-r border-border p-2">
                    <div className="mb-2 text-sm font-semibold text-foreground">{format(day, 'd')}</div>
                    <div className="space-y-1">
                      {dayEvents.map(event => (
                        <div key={`${event.source}-${event.id}`} className="rounded-md border border-slate-700 bg-slate-800/70 p-2 text-xs text-slate-100">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold truncate">{event.reference || event.title}</span>
                            <Badge variant="outline" className="text-[10px]">{event.source === 'quote' ? 'Quote' : 'Manual'}</Badge>
                          </div>
                          <p className="truncate text-slate-300">{event.title}</p>
                          <p className="truncate text-slate-400">{event.subtitle}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border bg-white dark:bg-slate-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Plus className="h-4 w-4" /> Manual Entry
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={entryTitle} onChange={event => setEntryTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Summary</Label>
                <Textarea value={entrySummary} onChange={event => setEntrySummary(event.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={entryStartDate} onChange={event => setEntryStartDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Duration Days</Label>
                  <Input type="number" min={0} value={entryDuration} onChange={event => setEntryDuration(event.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Optional Quote Link</Label>
                <Select value={entryQuoteId || 'none'} onValueChange={value => setEntryQuoteId(value === 'none' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select quote" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No quote link</SelectItem>
                    {quotes.map(quote => (
                      <SelectItem key={quote.id} value={quote.id}>{quote.quote_reference} - {quote.subject_line || quote.customer?.company_name || 'Quote'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => void createManualEntry()} disabled={saving} className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90">
                Add Entry
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-white dark:bg-slate-900">
            <CardHeader>
              <CardTitle className="text-foreground">Manual Entries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {manualEntries.length ? manualEntries.map(entry => (
                <div key={entry.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="font-medium text-foreground">{entry.title}</p>
                    <p className="text-xs text-muted-foreground">{format(parseLocalDate(entry.start_date), 'dd MMM yyyy')} • {entry.estimated_duration_days} day(s)</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void deleteManualEntry(entry.id)} className="text-muted-foreground hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No manual entries this month.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPageShell>
  );
}
