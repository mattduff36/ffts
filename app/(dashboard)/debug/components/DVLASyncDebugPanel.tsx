'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle, Car, Gauge, RadioTower, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type DvlaSummaryTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface DvlaSummaryMetric {
  title: string;
  value: string;
  detail: string;
  tone: DvlaSummaryTone;
  icon: ReactNode;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function getDvlaMetricClasses(tone: DvlaSummaryTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-100';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
  }
}

function DvlaSummaryMetricCard({ metric }: { metric: DvlaSummaryMetric }) {
  return (
    <div className={`rounded-xl border p-4 ${getDvlaMetricClasses(metric.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{metric.title}</p>
          <p className="mt-2 text-xl font-bold">{metric.value}</p>
        </div>
        <span className="opacity-85">{metric.icon}</span>
      </div>
      <p className="mt-2 text-sm leading-5 opacity-85">{metric.detail}</p>
    </div>
  );
}

export function DVLASyncDebugPanel() {
  const [regNumber, setRegNumber] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  interface SyncResultRow {
    success: boolean;
    registrationNumber?: string;
    assetType?: string;
    updatedFields?: string[];
    fields_updated?: string[];
    error?: string;
    errors?: string[];
    syncedAt?: string;
  }
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message?: string;
    total?: number;
    successful?: number;
    failed?: number;
    results?: SyncResultRow[];
    data?: unknown;
  } | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [vehicleCount, setVehicleCount] = useState(0);
  const successfulSyncs = syncResult?.successful ?? (syncResult?.success ? 1 : 0);
  const failedSyncs = syncResult?.failed ?? (syncResult && !syncResult.success ? 1 : 0);
  const updatedRecords = syncResult?.results?.filter((row) => row.updatedFields?.length || row.fields_updated?.length).length ?? 0;
  const syncSummaryMetrics: DvlaSummaryMetric[] = [
    {
      title: 'Mode',
      value: bulkSyncing ? 'Bulk running' : syncing ? 'Single running' : 'Ready',
      detail: 'Use single sync for spot checks, or bulk sync to refresh every active road asset with a plate.',
      tone: syncing || bulkSyncing ? 'warning' : 'info',
      icon: <RadioTower className="h-5 w-5" />,
    },
    {
      title: 'Known assets',
      value: vehicleCount > 0 ? formatNumber(vehicleCount) : 'Not counted',
      detail: vehicleCount > 0 ? 'Road-eligible assets were counted during the latest bulk-sync confirmation.' : 'Open bulk sync to count active road assets before spending API quota.',
      tone: vehicleCount > 0 ? 'success' : 'neutral',
      icon: <Car className="h-5 w-5" />,
    },
    {
      title: 'Latest result',
      value: syncResult ? `${formatNumber(successfulSyncs)} ok / ${formatNumber(failedSyncs)} failed` : 'No run yet',
      detail: syncResult ? (syncResult.message || 'The latest DVLA sync response is shown below.') : 'Run a single or bulk sync to see live result details.',
      tone: !syncResult ? 'neutral' : failedSyncs > 0 ? 'danger' : 'success',
      icon: <Gauge className="h-5 w-5" />,
    },
    {
      title: 'Updated records',
      value: syncResult ? formatNumber(updatedRecords) : 'Pending',
      detail: syncResult ? 'Records with changed tax or MOT fields in the latest response.' : 'No records have been compared in this view yet.',
      tone: updatedRecords > 0 ? 'success' : 'neutral',
      icon: <ShieldCheck className="h-5 w-5" />,
    },
  ];

  const handleSingleSync = async () => {
    if (!regNumber.trim()) {
      toast.error('Please enter a registration number');
      return;
    }

    setSyncing(true);
    setSyncResult(null);

    try {
      // First, find the vehicle ID from registration
      const vehiclesResponse = await fetch('/api/maintenance');
      const vehiclesData = await vehiclesResponse.json();
      
      if (!vehiclesData.success) {
        throw new Error('Failed to fetch vans');
      }

      const normalizedReg = regNumber.replace(/\s+/g, '').toUpperCase();
      const vehicle = vehiclesData.vehicles.find((v: {
        vehicle?: { reg_number?: string; asset_type?: 'van' | 'hgv' | 'plant' };
        van_id?: string | null;
        hgv_id?: string | null;
        plant_id?: string | null;
        id?: string | null;
      }) => v.vehicle?.reg_number?.replace(/\s+/g, '').toUpperCase() === normalizedReg);

      if (!vehicle) {
        toast.error(`Asset ${regNumber} not found in database.`);
        setSyncing(false);
        return;
      }

      const assetType = vehicle.vehicle?.asset_type || 'van';
      const assetId = vehicle.van_id || vehicle.hgv_id || vehicle.plant_id || vehicle.id;
      if (!assetId) {
        toast.error(`Found ${regNumber}, but no valid asset ID was resolved`);
        setSyncing(false);
        return;
      }

      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, assetType }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      setSyncResult(data);
      
      if (data.successful > 0) {
        toast.success(`Successfully synced ${regNumber}`);
      } else {
        toast.error(`Failed to sync ${regNumber}`);
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to sync asset';
      console.error('Sync error:', error);
      toast.error(errorMessage);
      setSyncResult({ success: false, message: errorMessage });
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkSyncClick = async () => {
      // Get road-eligible asset count first
    try {
      const response = await fetch('/api/maintenance');
      const data = await response.json();
      
      if (data.success) {
          const activeVehicles = data.vehicles.filter((v: {
            vehicle?: { status?: string; reg_number?: string };
          }) =>
            (v.vehicle?.status === 'active' || !v.vehicle?.status) &&
            Boolean(v.vehicle?.reg_number)
        );
        setVehicleCount(activeVehicles.length);
        setShowBulkConfirm(true);
      }
    } catch {
      toast.error('Failed to get van count');
    }
  };

  const handleBulkSync = async () => {
    setShowBulkConfirm(false);
    setBulkSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAll: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Bulk sync failed');
      }

      setSyncResult(data);
      toast.success(`Bulk sync complete: ${data.successful}/${data.total} successful`);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to bulk sync assets';
      console.error('Bulk sync error:', error);
      toast.error(errorMessage);
      setSyncResult({ success: false, message: errorMessage });
    } finally {
      setBulkSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-brand-yellow/20 bg-slate-950/60">
        <div className="pointer-events-none h-1 bg-gradient-to-r from-orange-500 to-red-600" />
        <CardHeader>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <RefreshCw className="h-5 w-5 text-brand-yellow" />
                DVLA Sync Control
              </CardTitle>
              <CardDescription>
                Refresh tax and MOT dates from GOV.UK APIs for individual or active road fleet assets.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit border-amber-500/30 bg-amber-500/10 text-amber-300">
              Production API quota
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-amber-200">Developer Tool</AlertTitle>
            <AlertDescription className="text-amber-100/80">
              These controls sync tax and MOT due dates from GOV.UK APIs (VES and MOT History). Each sync uses production API quota.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {syncSummaryMetrics.map((metric) => (
              <DvlaSummaryMetricCard key={metric.title} metric={metric} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Single Van Sync */}
      <Card className="border-slate-700/70 bg-slate-950/45">
        <CardHeader>
          <CardTitle className="text-white">Sync Single Asset</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sync tax & MOT due dates for a specific fleet asset by registration number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regNumber" className="text-muted-foreground">Registration Number</Label>
            <div className="flex gap-2">
              <Input
                id="regNumber"
                placeholder="e.g. AB12 CDE"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value.toUpperCase())}
                disabled={syncing}
                className="flex-1 bg-input border-border text-white placeholder:text-muted-foreground"
              />
              <Button
                onClick={handleSingleSync}
                disabled={syncing || !regNumber.trim()}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                {syncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Sync All Road-Eligible Assets */}
      <Card className="border-slate-700/70 bg-slate-950/45">
        <CardHeader>
          <CardTitle className="text-white">Bulk Sync All Road Assets</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sync tax & MOT due dates for all active fleet assets with license plates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleBulkSyncClick}
            disabled={bulkSyncing}
            variant="outline"
            className="w-full border-orange-500/30 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20"
          >
            {bulkSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing All Assets...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync All Assets (Tax & MOT Dates)
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Sync Results */}
      {syncResult && (
        <Card className="overflow-hidden border-slate-700/70 bg-slate-950/45">
          <div className={`pointer-events-none h-1 ${syncResult.success ? 'bg-emerald-500' : 'bg-red-600'}`} />
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              {syncResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              Sync Results
              {syncResult.total != null && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({syncResult.successful ?? 0} ok / {syncResult.failed ?? 0} failed / {syncResult.total} total)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {syncResult.results?.length ? (
              <div className="space-y-1 max-h-[600px] overflow-auto">
                {syncResult.results.map((row, idx) => {
                  const updated = row.updatedFields?.length || row.fields_updated?.length;
                  const hasError = !row.success;
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs font-mono ${
                        hasError
                          ? 'bg-red-950/40 border border-red-800/50'
                          : updated
                            ? 'bg-green-950/40 border border-green-800/50'
                            : 'bg-slate-800/60 border border-slate-700/50'
                      }`}
                    >
                      {hasError ? (
                        <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      ) : updated ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={hasError ? 'text-red-300 font-semibold' : updated ? 'text-green-300 font-semibold' : 'text-slate-400'}>
                            {row.registrationNumber || 'Unknown'}
                          </span>
                          {row.assetType && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-orange-300 uppercase">
                              {row.assetType}
                            </span>
                          )}
                          {updated ? (
                            <span className="text-green-400">
                              Updated: {(row.updatedFields || row.fields_updated || []).join(', ')}
                            </span>
                          ) : !hasError ? (
                            <span className="text-slate-500">No changes</span>
                          ) : null}
                        </div>
                        {hasError && (
                          <div className="text-red-400 mt-1">
                            {row.error || row.errors?.join('; ') || 'Unknown error'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <pre className="bg-slate-800 border border-slate-700 p-4 rounded-md overflow-auto text-xs text-muted-foreground">
                {JSON.stringify(syncResult, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bulk Sync Confirmation Dialog */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
          <DialogContent className="border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Confirm Bulk Sync</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will sync tax & MOT due dates for <strong className="text-white">{vehicleCount} active road-eligible assets</strong> from GOV.UK APIs.
              <br /><br />
              <strong className="text-white">API Usage:</strong> ~{vehicleCount * 2} API calls (VES + MOT)
              <br />
              <strong className="text-white">Time:</strong> ~{Math.ceil(vehicleCount / 60)} minutes (1 call per second)
              <br /><br />
              This will use your production API quota. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowBulkConfirm(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleBulkSync}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Yes, Sync All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

