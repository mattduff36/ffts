'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, CalendarCheck, Clock, Download, Loader2, MapPin, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import {
  EMPTY_INVENTORY_ITEM_FORM,
  INVENTORY_CATEGORY_LABELS,
  formatInventoryCategoryLabel,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemCategory,
  type InventoryItemFormData,
  type InventoryItemGroupSummary,
  type InventoryLocation,
} from '../../types';
import { InventoryCheckModal, type InventoryChecklistSubmitPayload } from '../../components/InventoryCheckModal';
import {
  INVENTORY_CHECKLIST_DEFINITIONS,
  INVENTORY_CHECK_OVERALL_STATUS_LABELS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  getInventoryChecklistDefinition,
  getInventoryChecklistLabel,
  getInventoryChecklistSummary,
  type InventoryChecklistDefinition,
  type InventoryCheckOverallStatus,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';
import {
  CHECK_INTERVAL_MONTHS,
  checkIntervalMonthsToDays,
  formatInventoryCheckIntervalMonths,
  formatInventoryDate,
  formatInventoryUnknownLocationAge,
  getCheckStatusLabel,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
  isInventoryCheckExempt,
  isInventoryUnknownLocation,
  isInventoryYardLocation,
  shouldMuteInventoryCheckBadge,
} from '../../utils';
import { InventoryLocationSelect } from '../../components/InventoryLocationSelect';

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
  checklist_version: string | null;
  checklist_items: InventoryChecklistItemResult[] | null;
  overall_status: InventoryCheckOverallStatus | null;
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
  if (item.status === 'retired') return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
  const status = getInventoryCheckStatus(item);
  if (shouldMuteInventoryCheckBadge(item)) return 'border-slate-600/30 bg-slate-700/20 text-slate-300';
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  if (status === 'not_required') return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function buildItemEditForm(item: InventoryItem): InventoryItemFormData {
  return {
    item_number: item.item_number,
    name: item.name,
    category: item.category,
    location_id: item.location_id || '',
    last_checked_at: item.last_checked_at || '',
    check_interval_months: item.check_interval_days ? String(getInventoryCheckIntervalMonths(item)) : '',
    status: item.status,
  };
}

export default function InventoryItemDetailPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = params.itemId;
  const [payload, setPayload] = useState<InventoryHistoryPayload | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [categories, setCategories] = useState<InventoryItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(new Date().toISOString().slice(0, 10));
  const [showCheckTypeModal, setShowCheckTypeModal] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [selectedChecklistVersion, setSelectedChecklistVersion] = useState(INVENTORY_SERVICE_CHECKLIST_VERSION);
  const [checkModalSession, setCheckModalSession] = useState(0);
  const [savingCheck, setSavingCheck] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState<InventoryItemFormData>(EMPTY_INVENTORY_ITEM_FORM);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSubmitError, setDetailsSubmitError] = useState('');
  const [downloadingCheckId, setDownloadingCheckId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const [historyResponse, locationsResponse, categoriesResponse] = await Promise.all([
        fetch(`/api/inventory/${itemId}/history`, { cache: 'no-store' }),
        fetch('/api/inventory/locations', { cache: 'no-store' }),
        fetch('/api/inventory/categories', { cache: 'no-store' }),
      ]);

      const [historyData, locationsData, categoriesData] = await Promise.all([
        historyResponse.json(),
        locationsResponse.json(),
        categoriesResponse.json(),
      ]);

      if (!historyResponse.ok) throw new Error(historyData.error || 'Failed to fetch inventory item history');
      if (!locationsResponse.ok) throw new Error(locationsData.error || 'Failed to fetch inventory locations');
      if (!categoriesResponse.ok) throw new Error(categoriesData.error || 'Failed to fetch inventory categories');

      setPayload(historyData);
      setLocations(locationsData.locations || []);
      setCategories(categoriesData.categories || []);
      setEditForm(buildItemEditForm(historyData.item));
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

  function updateEditField<K extends keyof InventoryItemFormData>(key: K, value: InventoryItemFormData[K]) {
    setDetailsSubmitError('');
    setEditForm((current) => ({ ...current, [key]: value }));
  }

  function handleCancelDetailsEdit() {
    if (payload?.item) setEditForm(buildItemEditForm(payload.item));
    setDetailsSubmitError('');
    setIsEditingDetails(false);
  }

  async function handleSaveItemDetails(event: React.FormEvent) {
    event.preventDefault();
    setSavingDetails(true);
    setDetailsSubmitError('');
    try {
      const parsedInterval = Number.parseInt(editForm.check_interval_months, 10);
      const response = await fetch(`/api/inventory/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_number: editForm.item_number,
          name: editForm.name,
          category: editForm.category,
          location_id: editForm.location_id,
          last_checked_at: editForm.last_checked_at || null,
          check_interval_days: checkIntervalMonthsToDays(
            Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : null
          ),
        }),
      });
      await parseResponse(response, 'Failed to update inventory item');
      toast.success('Inventory item updated');
      setIsEditingDetails(false);
      await fetchHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update inventory item';
      setDetailsSubmitError(message);
      toast.error(message);
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleRecordCheck(checkPayload: InventoryChecklistSubmitPayload) {
    setSavingCheck(true);
    try {
      const response = await fetch(`/api/inventory/${itemId}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      });
      await parseResponse(response, 'Failed to record check');
      toast.success('Inventory check recorded');
      setShowCheckModal(false);
      setCheckedAt(new Date().toISOString().slice(0, 10));
      await fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to record check');
    } finally {
      setSavingCheck(false);
    }
  }

  function handleChooseCheckType(checklistDefinition: InventoryChecklistDefinition) {
    setSelectedChecklistVersion(checklistDefinition.version);
    setCheckModalSession((current) => current + 1);
    setShowCheckTypeModal(false);
    setShowCheckModal(true);
  }

  async function handleDownloadCheckPdf(checkId: string) {
    setDownloadingCheckId(checkId);
    try {
      const response = await fetch(`/api/inventory/${itemId}/checks/${checkId}/pdf`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to download checklist PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventory-check-${checkId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Checklist PDF downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download checklist PDF');
    } finally {
      setDownloadingCheckId(null);
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
  const intervalMonthsValue = getInventoryCheckIntervalMonths(item);
  const isRetired = item.status === 'retired';
  const isCheckExempt = isInventoryCheckExempt(item);
  const isYardLocation = isInventoryYardLocation(item.location);
  const unknownLocationAgeLabel = formatInventoryUnknownLocationAge(item);
  const selectedChecklistDefinition =
    getInventoryChecklistDefinition(selectedChecklistVersion) || INVENTORY_CHECKLIST_DEFINITIONS[0];
  const categoryLabels = Object.fromEntries(categories.map((category) => [category.slug, category.name]));
  const categoryOptions = categories.length > 0
    ? [...categories]
      .filter((category) => category.is_active || category.slug === item.category)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => [category.slug, category.name] as const)
    : (Object.entries(INVENTORY_CATEGORY_LABELS) as Array<[InventoryCategory, string]>);
  const selectedEditLocation = locations.find((location) => location.id === editForm.location_id) || null;
  const isUnknownLocationSelected = isInventoryUnknownLocation(selectedEditLocation);

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
              {isRetired ? 'Retired' : getCheckStatusLabel(checkStatus)}
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
            {unknownLocationAgeLabel ? (
              <div className="mt-1 text-xs text-muted-foreground">{unknownLocationAgeLabel}</div>
            ) : null}
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
            <div className="mt-2 font-semibold text-white">
              {isCheckExempt ? 'No check required' : getInventoryDueDate(item.last_checked_at, intervalMonthsValue)}
            </div>
            {isYardLocation ? (
              <div className="text-xs text-muted-foreground">Required before moving out of Yard</div>
            ) : null}
            {unknownLocationAgeLabel ? (
              <div className="text-xs text-muted-foreground">{unknownLocationAgeLabel}</div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Check Interval</div>
            <div className="mt-2 font-semibold text-white">
              {isCheckExempt ? 'Not required' : formatInventoryCheckIntervalMonths(intervalMonthsValue)}
            </div>
            {!isCheckExempt && !item.check_interval_days ? <div className="text-xs text-muted-foreground">Default cadence</div> : null}
            {isCheckExempt ? <div className="text-xs text-muted-foreground">Ignored while this special status applies</div> : null}
            {isYardLocation ? <div className="text-xs text-muted-foreground">Applies again once moved from Yard</div> : null}
          </CardContent>
        </Card>
      </div>

      {isRetired ? (
        <Card className="border-slate-500/30 bg-slate-500/10">
          <CardContent className="flex flex-col gap-2 p-4 text-sm text-slate-100 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-medium">This inventory item is retired.</div>
                <div className="text-slate-300">
                  Reason: {item.retire_reason || 'Other'} · Retired: {formatInventoryDate(item.retired_at)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-700 bg-slate-900/70">
            <form onSubmit={handleSaveItemDetails}>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-white">Item Details</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isEditingDetails ? 'Update item identity, category, location, and check cadence.' : 'View item identity, source data, and linked location context.'}
                  </p>
                </div>
                {!isRetired ? (
                  isEditingDetails ? (
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={handleCancelDetailsEdit} disabled={savingDetails}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="bg-inventory text-white hover:bg-inventory-dark"
                        disabled={savingDetails || !editForm.location_id}
                      >
                        {savingDetails && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setIsEditingDetails(true)} className="border-slate-600">
                      Edit Details
                    </Button>
                  )
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {isEditingDetails ? (
                  <>
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                      Fleet Plant guidance: anything with an engine, valued over £1000, or too large for a standard van should normally be added to Fleet Plant instead of Inventory. This is guidance only for this phase.
                    </div>

                    {isUnknownLocationSelected ? (
                      <div className="rounded-md border border-slate-500/25 bg-slate-500/10 p-3 text-xs text-slate-200">
                        Unknown is a system location for lost or missing items. It does not generate check due dates; the item list will show how long the item has been in Unknown.
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="item_number">ID Number *</Label>
                        <Input
                          id="item_number"
                          required
                          value={editForm.item_number}
                          onChange={(event) => updateEditField('item_number', event.target.value)}
                          className="bg-slate-800 border-slate-600"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          required
                          value={editForm.name}
                          onChange={(event) => updateEditField('name', event.target.value)}
                          className="bg-slate-800 border-slate-600"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select
                          value={editForm.category}
                          onValueChange={(value) => updateEditField('category', value as InventoryCategory)}
                        >
                          <SelectTrigger className="bg-slate-800 border-slate-600">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Location *</Label>
                        <InventoryLocationSelect
                          value={editForm.location_id}
                          onValueChange={(value) => updateEditField('location_id', value)}
                          locations={locations}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="last_checked_at">Last Checked</Label>
                        <Input
                          id="last_checked_at"
                          type="date"
                          value={editForm.last_checked_at}
                          onChange={(event) => updateEditField('last_checked_at', event.target.value)}
                          className="bg-slate-800 border-slate-600"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="check_interval_months">Check Interval Months</Label>
                        <Input
                          id="check_interval_months"
                          type="number"
                          min={1}
                          max={120}
                          value={editForm.check_interval_months}
                          onChange={(event) => updateEditField('check_interval_months', event.target.value)}
                          placeholder={`Default ${CHECK_INTERVAL_MONTHS}`}
                          className="bg-slate-800 border-slate-600"
                        />
                      </div>
                    </div>

                    {detailsSubmitError ? (
                      <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                        {detailsSubmitError}
                      </div>
                    ) : null}

                    <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300">
                      Use the table action to retire inventory items so a retirement reason is recorded.
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <DetailRow label="Status" value={item.status} />
                    {isRetired ? (
                      <>
                        <DetailRow label="Retired Date" value={formatInventoryDate(item.retired_at)} />
                        <DetailRow label="Retirement Reason" value={item.retire_reason || 'Other'} />
                      </>
                    ) : null}
                    <DetailRow label="Category" value={formatInventoryCategoryLabel(item.category, categoryLabels)} />
                    <DetailRow label="Source" value={item.source || 'Not recorded'} />
                    <DetailRow label="Source Reference" value={item.source_reference || 'Not recorded'} />
                    <DetailRow label="Group" value={group?.name || 'No group'} />
                    {item.minor_plant_detail ? (
                      <>
                        <DetailRow label="Plant ID" value={item.minor_plant_detail.plant_identifier || 'Not recorded'} />
                        {'serial_number' in item.minor_plant_detail ? (
                          <DetailRow label="Serial Number" value={item.minor_plant_detail.serial_number || 'Not recorded'} />
                        ) : null}
                        <DetailRow label="Make" value={item.minor_plant_detail.make || 'Not recorded'} />
                        <DetailRow label="Model" value={item.minor_plant_detail.model || 'Not recorded'} />
                        <DetailRow label="Registration" value={item.minor_plant_detail.reg_number || 'Not recorded'} />
                      </>
                    ) : null}
                    {item.location?.linked_asset_label ? (
                      <DetailRow label="Linked Location Asset" value={`${item.location.linked_asset_label}${item.location.linked_asset_nickname ? ` · ${item.location.linked_asset_nickname}` : ''}`} />
                    ) : null}
                  </div>
                )}
              </CardContent>
            </form>
          </Card>

          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Check Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                <div>
                  <div className="font-medium text-white">Inventory Checks</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isRetired
                      ? 'Retired items must be restored before new checks can be recorded.'
                      : isCheckExempt
                        ? 'No due date is generated while this special status applies. You can still record a check before moving it back into a regular category.'
                        : 'Choose a PAT Test or Regular Check, then record Pass, Fail, or N/A. Failed items require comments. Edit the item details to change the check interval.'
                    }
                  </p>
                </div>
                <Button
                  type="button"
                  className="bg-inventory text-white hover:bg-inventory-dark"
                  onClick={() => setShowCheckTypeModal(true)}
                  disabled={savingCheck || !checkedAt || isRetired}
                >
                  <CalendarCheck className="mr-2 h-4 w-4" />
                  Start Check
                </Button>
              </div>
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
              <InventoryCheckTimelineEntry
                key={check.id}
                check={check}
                downloading={downloadingCheckId === check.id}
                onDownloadPdf={() => handleDownloadCheckPdf(check.id)}
              />
            ))}
          </TimelineCard>
        </TabsContent>
      </Tabs>

      {!isRetired && checkStatus === 'overdue' ? (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            This item is overdue for its check.
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={showCheckTypeModal} onOpenChange={setShowCheckTypeModal}>
        <DialogContent className="border border-border bg-slate-950 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose Check Type</DialogTitle>
            <DialogDescription>
              Select the checklist to complete for {item.name} ({item.item_number}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVENTORY_CHECKLIST_DEFINITIONS.map((checklistDefinition) => (
              <button
                key={checklistDefinition.version}
                type="button"
                className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-left transition-colors hover:border-inventory/70 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory/60"
                onClick={() => handleChooseCheckType(checklistDefinition)}
                disabled={savingCheck}
              >
                <div className="font-semibold text-white">{checklistDefinition.label}</div>
                <div className="mt-2 text-sm text-muted-foreground">{checklistDefinition.pdfSubtitle}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <InventoryCheckModal
        key={checkModalSession}
        open={showCheckModal}
        onOpenChange={setShowCheckModal}
        itemName={item.name}
        itemNumber={item.item_number}
        checklistDefinition={selectedChecklistDefinition}
        initialCheckedAt={checkedAt}
        saving={savingCheck}
        onSubmit={handleRecordCheck}
      />
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
  actions,
  children,
}: {
  title: string;
  meta: string;
  note?: string | null;
  badge?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold text-white">{title}</div>
          <div className="text-xs text-muted-foreground">{meta}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badge ? <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-200">{badge}</Badge> : null}
          {actions}
        </div>
      </div>
      {note ? <p className="mt-3 text-sm text-slate-300">{note}</p> : null}
      {children}
    </div>
  );
}

function getOverallStatusBadgeClass(status: InventoryCheckOverallStatus): string {
  if (status === 'fail') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (status === 'partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-green-500/30 bg-green-500/10 text-green-200';
}

function InventoryCheckTimelineEntry({
  check,
  downloading,
  onDownloadPdf,
}: {
  check: InventoryCheck;
  downloading: boolean;
  onDownloadPdf: () => void;
}) {
  const checklistItems = Array.isArray(check.checklist_items) ? check.checklist_items : null;
  const summary = checklistItems ? getInventoryChecklistSummary(checklistItems) : null;
  const overallStatus = summary ? check.overall_status || (summary.fail > 0 ? 'fail' : 'pass') : null;
  const failedItems = checklistItems?.filter((item) => item.status === 'attention') || [];
  const checkTypeLabel = getInventoryChecklistLabel(check.checklist_version);

  return (
    <TimelineEntry
      title={`${checkTypeLabel} · ${formatInventoryDate(check.checked_at)}`}
      meta={`${check.checked_by_profile?.full_name || 'Unknown user'} · interval ${formatInventoryCheckIntervalMonths(getInventoryCheckIntervalMonths({ check_interval_days: check.interval_days }))}`}
      note={check.note}
      badge={null}
      actions={checklistItems ? (
        <>
          {overallStatus ? (
            <Badge variant="outline" className={getOverallStatusBadgeClass(overallStatus)}>
              {INVENTORY_CHECK_OVERALL_STATUS_LABELS[overallStatus]}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-slate-600"
            onClick={onDownloadPdf}
            disabled={downloading}
          >
            {downloading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
            PDF
          </Button>
        </>
      ) : null}
    >
      {summary ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-200">Pass {summary.pass}</Badge>
            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-200">Fail {summary.fail}</Badge>
            <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-200">N/A {summary.na}</Badge>
            <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-200">Total {summary.total}</Badge>
          </div>

          {failedItems.length > 0 ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-200">Failed Items</div>
              <div className="mt-2 space-y-2">
                {failedItems.map((item) => (
                  <div key={item.item_number} className="text-sm text-red-50">
                    <span className="font-medium">#{item.item_number} {item.label}</span>
                    {item.comment ? <span className="text-red-100">: {item.comment}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </TimelineEntry>
  );
}
