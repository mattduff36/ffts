'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CalendarCheck, Clock, MapPin, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import type { InventoryItem, InventoryItemGroupSummary } from '../../types';
import {
  CHECK_INTERVAL_DAYS,
  formatInventoryDate,
  getCheckStatusLabel,
  getInventoryCheckIntervalDays,
  getInventoryCheckStatus,
  getInventoryDueDate,
} from '../../utils';

interface MovementProfile {
  full_name: string | null;
}

interface MovementLocation {
  name: string | null;
}

interface InventoryMovement {
  id: string;
  from_location: MovementLocation | null;
  to_location: MovementLocation | null;
  note: string | null;
  moved_at: string;
  moved_by_profile: MovementProfile | null;
  batch?: {
    move_scope: string;
    group?: InventoryItemGroupSummary | null;
  } | null;
}

interface InventoryCheck {
  id: string;
  checked_at: string;
  interval_days: number;
  note: string | null;
  created_at: string;
  checked_by_profile: MovementProfile | null;
}

interface InventoryHistoryPayload {
  item: InventoryItem;
  movements: InventoryMovement[];
  checks: InventoryCheck[];
  group: InventoryItemGroupSummary | null;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusBadgeClass(item: InventoryItem): string {
  const status = getInventoryCheckStatus(item);
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

export default function InventoryItemDetailPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = params.itemId;
  const [payload, setPayload] = useState<InventoryHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [intervalDays, setIntervalDays] = useState('');
  const [checkedAt, setCheckedAt] = useState(new Date().toISOString().slice(0, 10));
  const [checkNote, setCheckNote] = useState('');
  const [savingInterval, setSavingInterval] = useState(false);
  const [savingCheck, setSavingCheck] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/inventory/${itemId}/history`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch inventory item history');

      setPayload(data);
      setIntervalDays(data.item.check_interval_days ? String(data.item.check_interval_days) : '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load inventory item');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function parseResponse(response: Response, fallbackMessage: string) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || fallbackMessage);
    return data;
  }

  async function handleSaveInterval(event: React.FormEvent) {
    event.preventDefault();
    setSavingInterval(true);
    try {
      const parsedInterval = Number.parseInt(intervalDays, 10);
      const response = await fetch(`/api/inventory/${itemId}/check-interval`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_interval_days: Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : null,
        }),
      });
      await parseResponse(response, 'Failed to update check interval');
      toast.success('Check interval updated');
      await fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update check interval');
    } finally {
      setSavingInterval(false);
    }
  }

  async function handleRecordCheck(event: React.FormEvent) {
    event.preventDefault();
    setSavingCheck(true);
    try {
      const response = await fetch(`/api/inventory/${itemId}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checked_at: checkedAt,
          note: checkNote,
        }),
      });
      await parseResponse(response, 'Failed to record check');
      toast.success('Inventory check recorded');
      setCheckNote('');
      await fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to record check');
    } finally {
      setSavingCheck(false);
    }
  }

  if (loading) return <PageLoader message="Loading inventory item..." />;
  if (!payload) {
    return (
      <AppPageShell width="wide">
        <BackButton fallbackHref="/inventory" />
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="py-12 text-center text-muted-foreground">Inventory item not found.</CardContent>
        </Card>
      </AppPageShell>
    );
  }

  const { item, movements, checks, group } = payload;
  const checkStatus = getInventoryCheckStatus(item);
  const interval = getInventoryCheckIntervalDays(item);

  return (
    <AppPageShell width="wide">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/inventory" />
        <AppPageHeader
          title={item.name}
          description={`${item.item_number} · ${item.location?.name || 'No location assigned'}`}
          icon={<PackageSearch className="h-5 w-5" />}
          actions={(
            <Badge variant="outline" className={getStatusBadgeClass(item)}>
              {getCheckStatusLabel(checkStatus)}
            </Badge>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Location</div>
            <div className="mt-2 flex items-center gap-2 font-semibold text-white">
              <MapPin className="h-4 w-4 text-inventory" />
              {item.location?.name || 'No location assigned'}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Checked</div>
            <div className="mt-2 font-semibold text-white">{formatInventoryDate(item.last_checked_at)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Due Date</div>
            <div className="mt-2 font-semibold text-white">{getInventoryDueDate(item.last_checked_at, interval)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Check Interval</div>
            <div className="mt-2 font-semibold text-white">{interval} days</div>
            {!item.check_interval_days ? <div className="text-xs text-muted-foreground">Default cadence</div> : null}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Item Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Status" value={item.status} />
              <DetailRow label="Category" value={item.category.replace(/_/g, ' ')} />
              <DetailRow label="Source" value={item.source || 'Not recorded'} />
              <DetailRow label="Source Reference" value={item.source_reference || 'Not recorded'} />
              <DetailRow label="Group" value={group?.name || 'No group'} />
              {item.location?.linked_asset_label ? (
                <DetailRow label="Linked Location Asset" value={`${item.location.linked_asset_label}${item.location.linked_asset_nickname ? ` · ${item.location.linked_asset_nickname}` : ''}`} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Check Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <form className="space-y-3" onSubmit={handleSaveInterval}>
                <div className="space-y-2">
                  <Label htmlFor="interval_days">Item Check Interval</Label>
                  <Input
                    id="interval_days"
                    type="number"
                    min={1}
                    max={3650}
                    value={intervalDays}
                    onChange={(event) => setIntervalDays(event.target.value)}
                    placeholder={`Default ${CHECK_INTERVAL_DAYS}`}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <Button type="submit" variant="outline" disabled={savingInterval}>
                  Save Interval
                </Button>
              </form>

              <form className="space-y-3" onSubmit={handleRecordCheck}>
                <div className="space-y-2">
                  <Label htmlFor="checked_at">Record Check Date</Label>
                  <Input
                    id="checked_at"
                    type="date"
                    value={checkedAt}
                    onChange={(event) => setCheckedAt(event.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="check_note">Check Note</Label>
                  <Textarea
                    id="check_note"
                    value={checkNote}
                    onChange={(event) => setCheckNote(event.target.value)}
                    className="bg-slate-800 border-slate-600"
                    rows={3}
                  />
                </div>
                <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={savingCheck || !checkedAt}>
                  <CalendarCheck className="mr-2 h-4 w-4" />
                  Record Check
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-0">
          <TimelineCard
            title="Transfer / Location History"
            emptyMessage="No movement history has been recorded for this item yet."
            icon={<MapPin className="h-5 w-5 text-inventory" />}
          >
            {movements.map((movement) => (
              <TimelineEntry
                key={movement.id}
                title={`${movement.from_location?.name || 'Unknown'} → ${movement.to_location?.name || 'Unknown'}`}
                meta={`${formatTimestamp(movement.moved_at)} · ${movement.moved_by_profile?.full_name || 'Unknown user'}`}
                note={movement.note}
                badge={movement.batch?.move_scope === 'group' ? `Group: ${movement.batch.group?.name || 'group move'}` : movement.batch?.move_scope || null}
              />
            ))}
          </TimelineCard>
        </TabsContent>

        <TabsContent value="checks" className="mt-0">
          <TimelineCard
            title="Check History"
            emptyMessage="No check history has been recorded for this item yet."
            icon={<Clock className="h-5 w-5 text-inventory" />}
          >
            {checks.map((check) => (
              <TimelineEntry
                key={check.id}
                title={`Checked ${formatInventoryDate(check.checked_at)}`}
                meta={`${check.checked_by_profile?.full_name || 'Unknown user'} · interval ${check.interval_days} days`}
                note={check.note}
              />
            ))}
          </TimelineCard>
        </TabsContent>
      </Tabs>

      {checkStatus === 'overdue' ? (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            This item is overdue for its check.
          </CardContent>
        </Card>
      ) : null}
    </AppPageShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize text-white">{value}</span>
    </div>
  );
}

function TimelineCard({
  title,
  emptyMessage,
  icon,
  children,
}: {
  title: string;
  emptyMessage: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasChildren ? children : <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>}
      </CardContent>
    </Card>
  );
}

function TimelineEntry({
  title,
  meta,
  note,
  badge,
}: {
  title: string;
  meta: string;
  note?: string | null;
  badge?: string | null;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold text-white">{title}</div>
          <div className="text-xs text-muted-foreground">{meta}</div>
        </div>
        {badge ? <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-200">{badge}</Badge> : null}
      </div>
      {note ? <p className="mt-3 text-sm text-slate-300">{note}</p> : null}
    </div>
  );
}
