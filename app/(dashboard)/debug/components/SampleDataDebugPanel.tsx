'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Database,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import type {
  ManagedFixtureKey,
  SampleDataAction,
  SampleDataFixtureStatus,
  SampleDataMutationResult,
  SampleDataPreview,
  SampleDataRegistryStatus,
  SampleDataState,
} from '@/lib/server/sample-data/types';

interface OperationTarget {
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  label: string;
  destructive?: boolean;
}

const SCHEDULING_ACTIONS: OperationTarget[] = [
  {
    fixtureKey: 'scheduling-sample-v1',
    action: 'create-base',
    label: 'Create Base',
  },
  {
    fixtureKey: 'scheduling-sample-v1',
    action: 'create-queue',
    label: 'Create Queue Extension',
  },
  {
    fixtureKey: 'scheduling-sample-v1',
    action: 'create-complete',
    label: 'Create Complete Sample Set',
  },
  {
    fixtureKey: 'scheduling-sample-v1',
    action: 'remove',
    label: 'Remove Scheduling Sample',
    destructive: true,
  },
];

const FLEET_ACTIONS: OperationTarget[] = [
  {
    fixtureKey: 'fleet-inventory-sample-v1',
    action: 'create',
    label: 'Create Fleet and Inventory Sample',
  },
  {
    fixtureKey: 'fleet-inventory-sample-v1',
    action: 'remove',
    label: 'Remove Fleet and Inventory Sample',
    destructive: true,
  },
];

const STATE_LABELS: Record<SampleDataState, string> = {
  absent: 'Absent',
  installed: 'Installed',
  partial: 'Partial',
  drifted: 'Drifted',
  blocked: 'Blocked',
  unavailable: 'Unavailable',
};

function getStateClasses(state: SampleDataState): string {
  if (state === 'installed') {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  if (state === 'absent') {
    return 'border-slate-500/35 bg-slate-500/10 text-slate-200';
  }
  if (state === 'partial' || state === 'drifted') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-100';
  }
  return 'border-red-500/35 bg-red-500/10 text-red-100';
}

function formatMetricLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function FixtureCard({
  fixture,
  actions,
  isWorking,
  onPreview,
}: {
  fixture: SampleDataFixtureStatus;
  actions: OperationTarget[];
  isWorking: boolean;
  onPreview: (target: OperationTarget) => void;
}) {
  const metrics = Object.entries(fixture.expected).filter(([, value]) => value > 0);
  return (
    <Card className="overflow-hidden border-slate-700/70 bg-slate-950/55">
      <div className="h-1 bg-brand-yellow" />
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-brand-yellow" />
              {fixture.label}
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              {fixture.description}
            </CardDescription>
          </div>
          <Badge variant="outline" className={getStateClasses(fixture.state)}>
            {STATE_LABELS[fixture.state]}
          </Badge>
        </div>
        <p className="font-mono text-xs text-slate-500">
          {fixture.fixtureKey} · {fixture.toolingVersion}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {metrics.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(([key, expected]) => (
              <div
                key={key}
                className="rounded-lg border border-slate-800 bg-slate-900/55 px-3 py-2"
              >
                <p className="text-xs text-slate-400">{formatMetricLabel(key)}</p>
                <p className="mt-1 font-mono text-sm text-slate-100">
                  {fixture.observed[key] ?? 0} / {expected}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {fixture.variants ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(fixture.variants).map(([key, variant]) => (
              <Badge
                key={key}
                variant="outline"
                className={getStateClasses(variant.state)}
              >
                {formatMetricLabel(key)}: {STATE_LABELS[variant.state]}
              </Badge>
            ))}
          </div>
        ) : null}

        {fixture.blockers.length > 0 ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-100">
              <ShieldAlert className="h-4 w-4" />
              Safety blockers
            </p>
            <ul className="mt-2 space-y-1 text-sm text-red-100/80">
              {fixture.blockers.map((blocker) => (
                <li key={blocker}>• {blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
          {actions.map((action) => (
            <Button
              key={`${action.fixtureKey}:${action.action}`}
              type="button"
              variant={action.destructive ? 'destructive' : 'outline'}
              disabled={isWorking || !fixture.available}
              onClick={() => onPreview(action)}
              className={
                action.destructive
                  ? 'border border-red-500/50'
                  : 'border-brand-yellow/30 hover:bg-brand-yellow/10'
              }
            >
              {action.destructive ? <Trash2 className="h-4 w-4" /> : <Database className="h-4 w-4" />}
              {action.label}
            </Button>
          ))}
        </div>

        {fixture.lastOperation ? (
          <p className="text-xs text-slate-500">
            Last operation: {fixture.lastOperation.action} · {fixture.lastOperation.outcome} ·{' '}
            {new Date(fixture.lastOperation.createdAt).toLocaleString('en-GB')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SampleDataDebugPanel() {
  const [registry, setRegistry] = useState<SampleDataRegistryStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [activeTarget, setActiveTarget] = useState<OperationTarget | null>(null);
  const [preview, setPreview] = useState<SampleDataPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/debug/sample-data', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as {
        status?: SampleDataRegistryStatus;
        error?: string;
      } | null;
      if (!response.ok || !payload?.status) {
        throw new Error(payload?.error || 'Unable to load sample-data status.');
      }
      setRegistry(payload.status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load sample-data status.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const fixtureByKey = useMemo(
    () => new Map(registry?.fixtures.map((fixture) => [fixture.fixtureKey, fixture]) || []),
    [registry]
  );

  async function requestPreview(target: OperationTarget) {
    setIsWorking(true);
    try {
      const response = await fetch('/api/debug/sample-data/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixtureKey: target.fixtureKey,
          action: target.action,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        preview?: SampleDataPreview;
        error?: string;
      } | null;
      if (!response.ok || !payload?.preview) {
        throw new Error(payload?.error || 'Unable to preview operation.');
      }
      if (!payload.preview.canExecute) {
        toast.error(payload.preview.blockers.join(' ') || 'Operation is blocked.');
        await fetchStatus();
        return;
      }
      setActiveTarget(target);
      setPreview(payload.preview);
      setConfirmation('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to preview operation.');
    } finally {
      setIsWorking(false);
    }
  }

  async function executePreview() {
    if (!activeTarget || !preview) return;
    setIsWorking(true);
    try {
      const response = await fetch('/api/debug/sample-data/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixtureKey: activeTarget.fixtureKey,
          action: activeTarget.action,
          confirmation,
          fingerprint: preview.fingerprint,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        result?: SampleDataMutationResult;
        error?: string;
      } | null;
      if (!payload?.result) {
        throw new Error(payload?.error || 'Managed sample-data operation failed.');
      }
      setRegistry(payload.result.status);
      if (payload.result.outcome === 'partial') {
        toast.error(
          `${payload.result.message}${payload.result.recovery ? ` ${payload.result.recovery}` : ''}`
        );
      } else {
        toast.success(payload.result.message);
      }
      setActiveTarget(null);
      setPreview(null);
      setConfirmation('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Managed sample-data operation failed.');
      await fetchStatus();
    } finally {
      setIsWorking(false);
    }
  }

  if (isLoading && !registry) {
    return <PanelLoader message="Inspecting managed sample data..." accent="debug" className="min-h-[360px]" />;
  }

  const scheduling = fixtureByKey.get('scheduling-sample-v1');
  const fleet = fixtureByKey.get('fleet-inventory-sample-v1');
  const clearTarget: OperationTarget = {
    fixtureKey: 'all-managed',
    action: 'clear-all',
    label: 'Clear All Managed Sample Data',
    destructive: true,
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-red-500/30 bg-slate-950/70">
        <div className="h-1 bg-red-500" />
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-300" />
                Managed Sample Data
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                Only exact rows owned by the two approved fixture keys are managed here.
                Historical samples, testsuite users, operational seeds and unmanaged ZZ99 records are excluded.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchStatus()}
              disabled={isLoading || isWorking}
            >
              <RefreshCw className={isLoading ? 'animate-spin' : ''} />
              Refresh Status
            </Button>
          </div>
        </CardHeader>
      </Card>

      {scheduling ? (
        <FixtureCard
          fixture={scheduling}
          actions={SCHEDULING_ACTIONS}
          isWorking={isWorking}
          onPreview={(target) => void requestPreview(target)}
        />
      ) : null}
      {fleet ? (
        <FixtureCard
          fixture={fleet}
          actions={FLEET_ACTIONS}
          isWorking={isWorking}
          onPreview={(target) => void requestPreview(target)}
        />
      ) : null}

      <Card className="border-red-500/40 bg-red-950/15">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-100">
            <AlertOctagon className="h-5 w-5" />
            Nuclear cleanup
          </CardTitle>
          <CardDescription>
            Preflights both fixtures first, then removes Scheduling before Fleet and Inventory.
            If either fixture is blocked, nothing is removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {registry?.clearAll.blockers.length ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              {registry.clearAll.blockers.join(' ')}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Full preflight is currently clear.
            </div>
          )}
          <Button
            type="button"
            variant="destructive"
            disabled={isWorking || !registry?.clearAll.canRemove}
            onClick={() => void requestPreview(clearTarget)}
            className="border border-red-400/50"
          >
            <Trash2 className="h-4 w-4" />
            Clear All Managed Sample Data
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(activeTarget && preview)}
        onOpenChange={(open) => {
          if (!open && !isWorking) {
            setActiveTarget(null);
            setPreview(null);
            setConfirmation('');
          }
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-300" />
              Confirm managed sample-data operation
            </AlertDialogTitle>
            <AlertDialogDescription>
              The preview is valid until{' '}
              {preview ? new Date(preview.expiresAt).toLocaleTimeString('en-GB') : '—'}.
              Type the exact phrase below. The server validates the phrase and fresh preview again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 font-mono text-sm text-brand-yellow">
                {preview.confirmationPhrase}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sample-data-confirmation">Typed confirmation</Label>
                <Input
                  id="sample-data-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void executePreview();
              }}
              disabled={
                isWorking
                || !preview
                || confirmation !== preview.confirmationPhrase
              }
              className={
                activeTarget?.destructive
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-brand-yellow text-slate-950 hover:bg-brand-yellow/90'
              }
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Execute exact operation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
