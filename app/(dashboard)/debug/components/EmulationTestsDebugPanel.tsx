'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, DatabaseZap, TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  activateDatabaseOutageEmulation,
  clearDatabaseOutageEmulation,
  DATABASE_OUTAGE_EMULATION_MS,
  scheduleDatabaseOutageEmulation,
} from '@/lib/database/client-health';
import { useDatabaseHealthOutage } from '@/lib/hooks/useDatabaseHealthOutage';

const DEFAULT_DELAY_SECONDS = 0;
const MAX_DELAY_SECONDS = 300;

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function EmulationTestsDebugPanel() {
  const databaseHealthState = useDatabaseHealthOutage();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [delaySeconds, setDelaySeconds] = useState(DEFAULT_DELAY_SECONDS.toString());
  const emulationActive = Boolean(
    databaseHealthState.emulatedOutageActive
      && databaseHealthState.emulatedOutageExpiresAt
      && databaseHealthState.emulatedOutageExpiresAt > currentTime
  );
  const emulationScheduled = Boolean(
    !emulationActive
      && databaseHealthState.emulatedOutageStartsAt
      && databaseHealthState.emulatedOutageStartsAt > currentTime
  );
  const switchChecked = emulationActive || emulationScheduled;

  useEffect(() => {
    if (!databaseHealthState.emulatedOutageActive && !databaseHealthState.emulatedOutageStartsAt) {
      return undefined;
    }

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [databaseHealthState.emulatedOutageActive, databaseHealthState.emulatedOutageStartsAt]);

  const remainingTime = useMemo(() => {
    if (!databaseHealthState.emulatedOutageExpiresAt) {
      return DATABASE_OUTAGE_EMULATION_MS;
    }

    return Math.max(0, databaseHealthState.emulatedOutageExpiresAt - currentTime);
  }, [currentTime, databaseHealthState.emulatedOutageExpiresAt]);

  const startsInTime = useMemo(() => {
    if (!databaseHealthState.emulatedOutageStartsAt) {
      return 0;
    }

    return Math.max(0, databaseHealthState.emulatedOutageStartsAt - currentTime);
  }, [currentTime, databaseHealthState.emulatedOutageStartsAt]);

  const normalizedDelaySeconds = useMemo(() => {
    const parsedDelaySeconds = Number(delaySeconds);
    if (!Number.isFinite(parsedDelaySeconds)) {
      return DEFAULT_DELAY_SECONDS;
    }

    return Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.floor(parsedDelaySeconds)));
  }, [delaySeconds]);

  function handleEmulationToggle(checked: boolean) {
    if (checked) {
      setCurrentTime(Date.now());
      if (normalizedDelaySeconds > 0) {
        scheduleDatabaseOutageEmulation(normalizedDelaySeconds * 1000);
        return;
      }

      activateDatabaseOutageEmulation();
      return;
    }

    clearDatabaseOutageEmulation();
  }

  function handleDelaySecondsChange(value: string) {
    if (value === '') {
      setDelaySeconds(value);
      return;
    }

    const parsedDelaySeconds = Number(value);
    if (!Number.isFinite(parsedDelaySeconds)) {
      return;
    }

    setDelaySeconds(String(Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.floor(parsedDelaySeconds)))));
  }

  return (
    <Card className="overflow-hidden border-brand-yellow/20 bg-slate-950/60">
      <div className="pointer-events-none h-1 bg-gradient-to-r from-orange-500 to-red-600" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="h-5 w-5 text-brand-yellow" />
          Emulation Tests
        </CardTitle>
        <CardDescription>
          Trigger safe client-side operational states without changing production data or database connectivity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-200" />
              <div>
                <Label htmlFor="database-outage-emulation" className="text-base font-semibold text-red-50">
                  Emulate lost database connection
                </Label>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-red-100/85">
                  Shows the same database connection warning for 5 minutes. The test is client-side only,
                  does not block real database access, and automatically switches itself off.
                </p>
                <div className="mt-4 max-w-xs space-y-2">
                  <Label htmlFor="database-outage-delay-seconds" className="text-sm text-red-50">
                    Delay start by seconds
                  </Label>
                  <Input
                    id="database-outage-delay-seconds"
                    type="number"
                    min={0}
                    max={MAX_DELAY_SECONDS}
                    step={1}
                    value={delaySeconds}
                    onChange={(event) => handleDelaySecondsChange(event.target.value)}
                    disabled={switchChecked}
                    className="border-red-200/30 bg-slate-950/60 text-red-50"
                  />
                  <p className="text-xs text-red-100/70">
                    Use up to {MAX_DELAY_SECONDS} seconds to navigate before the warning appears.
                  </p>
                </div>
              </div>
            </div>
            <Switch
              id="database-outage-emulation"
              checked={switchChecked}
              onCheckedChange={handleEmulationToggle}
              aria-label="Emulate lost database connection"
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-slate-950/35 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-red-50">
              <TimerReset className="h-4 w-4" />
              {emulationActive
                ? `Emulation active. Auto-off in ${formatDuration(remainingTime)}.`
                : emulationScheduled
                  ? `Emulation scheduled. Starts in ${formatDuration(startsInTime)}.`
                  : 'Emulation is currently off.'}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearDatabaseOutageEmulation}
              disabled={!switchChecked}
              className="border-red-200/40 bg-white/5 text-red-50 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              {emulationScheduled ? 'Cancel scheduled emulation' : 'Turn off emulation'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
