'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Monitor, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  MOBILE_TEXT_SIZE_LABELS,
  MOBILE_TEXT_SIZE_STEPS,
  type MobileTextSizeStep,
} from '@/lib/config/mobile-text-size-preference';
import type {
  DisplayBoardAdminState,
  DisplayBoardConfig,
  DisplayBoardDevice,
  DisplayBoardPairingSession,
} from '@/lib/server/display-board';

interface DisplayBoardSettingsResponse extends DisplayBoardAdminState {
  success: boolean;
  error?: string;
}

const SETTINGS_HELPER_TEXT_CLASS = 'text-sm leading-relaxed text-slate-400';
const SETTINGS_COMPACT_HELPER_TEXT_CLASS = 'text-xs leading-relaxed text-slate-400';

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function DisplayBoardSettingsCard() {
  const [config, setConfig] = useState<DisplayBoardConfig | null>(null);
  const [activePairing, setActivePairing] = useState<DisplayBoardPairingSession | null>(null);
  const [devices, setDevices] = useState<DisplayBoardDevice[]>([]);
  const [fallbackSeconds, setFallbackSeconds] = useState('60');
  const [debounceMs, setDebounceMs] = useState('750');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTextSizeDeviceId, setSavingTextSizeDeviceId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const syncState = useCallback((payload: DisplayBoardSettingsResponse) => {
    setConfig(payload.config);
    setActivePairing(payload.active_pairing);
    setDevices(payload.devices || []);
    setFallbackSeconds(String(payload.config.fallback_poll_interval_seconds));
    setDebounceMs(String(payload.config.realtime_debounce_ms));
    setEnabled(payload.config.is_enabled);
  }, []);

  const loadSettings = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/admin/settings/display-board', { cache: 'no-store' });
      const payload = await response.json() as DisplayBoardSettingsResponse;
      if (!response.ok) throw new Error(payload.error || 'Unable to load display board settings');
      syncState(payload);
      setError('');
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load display board settings'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [syncState]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!activePairing) return;
    const interval = setInterval(() => {
      void loadSettings(true);
    }, 2000);
    return () => clearInterval(interval);
  }, [activePairing, loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings/display-board', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fallback_poll_interval_seconds: Number.parseInt(fallbackSeconds, 10),
          realtime_debounce_ms: Number.parseInt(debounceMs, 10),
          is_enabled: enabled,
        }),
      });
      const payload = await response.json() as DisplayBoardSettingsResponse;
      if (!response.ok) throw new Error(payload.error || 'Unable to save display board settings');
      syncState(payload);
      setError('');
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Unable to save display board settings'));
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings/display-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = await response.json() as DisplayBoardSettingsResponse;
      if (!response.ok) throw new Error(payload.error || 'Unable to update display board pairing');
      syncState(payload);
      setError('');
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Unable to update display board pairing'));
    } finally {
      setSaving(false);
    }
  };

  const confirmPairing = async () => {
    if (!activePairing?.confirmation_code) return;
    await runAction('confirm_pairing', {
      session_id: activePairing.id,
      confirmation_code: activePairing.confirmation_code,
    });
  };

  const updateDeviceTextSize = async (deviceId: string, value: string) => {
    const numericValue = Number(value);
    if (!MOBILE_TEXT_SIZE_STEPS.includes(numericValue as MobileTextSizeStep)) return;
    const nextStep = numericValue as MobileTextSizeStep;

    setDevices(currentDevices => currentDevices.map(device => (
      device.id === deviceId ? { ...device, display_text_size_step: nextStep } : device
    )));
    setSavingTextSizeDeviceId(deviceId);

    try {
      const response = await fetch('/api/admin/settings/display-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_device_text_size',
          device_id: deviceId,
          display_text_size_step: nextStep,
        }),
      });
      const payload = await response.json() as DisplayBoardSettingsResponse;
      if (!response.ok) throw new Error(payload.error || 'Unable to update display board text size');
      syncState(payload);
      setError('');
    } catch (sizeError) {
      setError(getErrorMessage(sizeError, 'Unable to update display board text size'));
      void loadSettings(true);
    } finally {
      setSavingTextSizeDeviceId(null);
    }
  };

  const canConfirmPairing = activePairing?.confirmation_code?.length === 6;

  return (
    <Card className="border-border bg-slate-900/60">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Monitor className="h-5 w-5 text-workshop" />
              Workshop Display Board
            </CardTitle>
            <CardDescription className={SETTINGS_HELPER_TEXT_CLASS}>
              Configure shared workshop display-board refresh settings and pair workshop TV browsers.
            </CardDescription>
          </div>
          {loading && !config ? (
            <Badge variant="outline" className="border-workshop/40 text-workshop-light">
              Loading
            </Badge>
          ) : (
            <Badge variant="outline" className={enabled ? 'border-green-500/40 text-green-300' : 'border-red-500/40 text-red-300'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading && !config ? (
          <PanelLoader
            message="Loading display board settings..."
            accent="workshop"
            className="rounded-lg border border-border bg-background/80 py-12"
          />
        ) : (
          <>
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-background/80 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,auto)] md:items-end">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="display-board-poll">Fallback poll interval</Label>
              <span className="rounded-md border border-workshop/30 bg-workshop/10 px-2 py-1 text-sm font-semibold text-workshop-light">
                {fallbackSeconds}s
              </span>
            </div>
            <input
              id="display-board-poll"
              type="range"
              min={15}
              max={300}
              step={5}
              value={fallbackSeconds}
              onChange={(event) => setFallbackSeconds(event.target.value)}
              disabled={loading || saving}
              style={{ accentColor: 'hsl(var(--workshop-primary))' }}
              className="h-2 w-full cursor-pointer accent-workshop disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className={SETTINGS_COMPACT_HELPER_TEXT_CLASS}>Visible-tab safety net. Range: 15 to 300 seconds.</p>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="display-board-debounce">Realtime debounce</Label>
              <span className="rounded-md border border-workshop/30 bg-workshop/10 px-2 py-1 text-sm font-semibold text-workshop-light">
                {debounceMs}ms
              </span>
            </div>
            <input
              id="display-board-debounce"
              type="range"
              min={250}
              max={5000}
              step={250}
              value={debounceMs}
              onChange={(event) => setDebounceMs(event.target.value)}
              disabled={loading || saving}
              style={{ accentColor: 'hsl(var(--workshop-primary))' }}
              className="h-2 w-full cursor-pointer accent-workshop disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className={SETTINGS_COMPACT_HELPER_TEXT_CLASS}>Coalesces bursty realtime updates. Range: 250 to 5000ms.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={loading || saving} />
              <span className="text-sm text-foreground">Board enabled</span>
            </div>
            <Button
              type="button"
              onClick={saveSettings}
              disabled={loading || saving}
              className="bg-workshop text-white hover:bg-workshop-dark"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/80 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-foreground">Workshop display board pairing</p>
              <p className={SETTINGS_HELPER_TEXT_CLASS}>
                Start a search, then confirm the code shown on the display board.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-56 md:justify-end">
              <Button
                asChild
                variant="outline"
                className="w-full border-workshop/45 bg-workshop/10 text-workshop-light hover:bg-workshop/20 hover:text-white"
              >
                <a
                  href="/displayboard-workshop"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Launch the Workshop Display Board in a new tab"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Launch Display Board
                </a>
              </Button>
              {activePairing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => runAction('cancel_pairing')}
                  disabled={saving}
                  className="w-full border-amber-500/45 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 hover:text-amber-50"
                >
                  Cancel search
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => runAction('start_pairing')}
                  disabled={saving || loading || !config?.is_enabled}
                  className="w-full bg-workshop text-white hover:bg-workshop-dark"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Search for Display Board
                </Button>
              )}
            </div>
          </div>

          {activePairing ? (
            <div className="mt-4 rounded-lg border border-workshop/35 bg-workshop/10 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1">
                  <p className="font-semibold text-workshop-light">Searching for display board</p>
                  <p className={SETTINGS_HELPER_TEXT_CLASS}>
                    Expires at {formatDateTime(activePairing.expires_at)}. The confirmation code appears after the TV visits the board page.
                  </p>
                  {activePairing.confirmation_code ? (
                    <p className="mt-3 text-4xl font-black tracking-[0.2em] text-white">{activePairing.confirmation_code}</p>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Waiting for a display board browser...</p>
                  )}
                </div>
                <div className="flex min-w-[16rem] flex-col gap-2">
                  <Button
                    type="button"
                    onClick={confirmPairing}
                    disabled={saving || !canConfirmPairing}
                    className="w-full bg-workshop text-white hover:bg-workshop-dark disabled:bg-workshop/45 disabled:text-white/70"
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Confirm display board
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-background/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">Paired Workshop display devices</p>
              <p className={SETTINGS_HELPER_TEXT_CLASS}>Devices remain authorised until revoked here.</p>
            </div>
            <Badge variant="outline">{devices.length}</Badge>
          </div>
          <div className="space-y-2">
            {devices.length > 0 ? devices.map((device) => (
              <div key={device.id} className="flex flex-col gap-3 rounded-lg border border-border bg-slate-950/40 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium text-foreground">{device.label || 'Workshop display board'}</p>
                  <p className="text-sm text-slate-400">
                    Paired {formatDateTime(device.created_at)} · Last seen {formatDateTime(device.last_seen_at)}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-[18rem]">
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Label htmlFor={`display-board-text-size-${device.id}`} className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Text size
                      </Label>
                      <span className="rounded-md border border-workshop/30 bg-workshop/10 px-2 py-0.5 text-xs font-semibold text-workshop-light">
                        {MOBILE_TEXT_SIZE_LABELS[device.display_text_size_step]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span aria-hidden className="text-sm font-bold leading-none text-slate-400">A</span>
                      <input
                        id={`display-board-text-size-${device.id}`}
                        aria-label={`${device.label || 'Workshop display board'} text size`}
                        aria-valuetext={MOBILE_TEXT_SIZE_LABELS[device.display_text_size_step]}
                        className="mobile-text-size-slider"
                        max={5}
                        min={1}
                        onChange={(event) => void updateDeviceTextSize(device.id, event.currentTarget.value)}
                        step={1}
                        type="range"
                        value={device.display_text_size_step}
                        disabled={saving || savingTextSizeDeviceId === device.id}
                      />
                      <span aria-hidden className="text-2xl font-bold leading-none text-slate-400">A</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                    onClick={() => runAction('revoke_device', { device_id: device.id })}
                    disabled={saving || savingTextSizeDeviceId === device.id}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Revoke
                  </Button>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
                No Workshop display boards are paired yet.
              </div>
            )}
          </div>
        </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
