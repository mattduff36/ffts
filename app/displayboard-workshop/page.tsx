'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Monitor,
  Radio,
  ShieldAlert,
  TimerReset,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWorkshopDisplayBoardRealtime, useDisplayBoardDeviceBroadcast } from '@/lib/hooks/useRealtime';
import {
  DISPLAY_BOARD_LEGACY_TV_PATH,
  isLegacyDisplayBoardBrowser,
} from '@/lib/display-board/compatibility';
import {
  MOBILE_TEXT_SIZE_STEPS,
  type MobileTextSizeStep,
} from '@/lib/config/mobile-text-size-preference';
import {
  WORKSHOP_DISPLAY_BOARD_KEY,
  type DisplayBoardDeviceCommandPayload,
} from '@/lib/display-board/device-notify';
import {
  WORKSHOP_DISPLAY_BOARD_BRAND,
  WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY,
  WORKSHOP_DISPLAY_BOARD_EMPTY_MAINTENANCE_LABEL,
  WORKSHOP_DISPLAY_BOARD_MAINTENANCE_TITLE,
  WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY,
  WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER,
  WORKSHOP_DISPLAY_BOARD_STAT_TILES,
  WORKSHOP_DISPLAY_BOARD_TASK_PANELS,
  WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP,
  WORKSHOP_DISPLAY_BOARD_TITLE,
  WORKSHOP_DISPLAY_BOARD_TOP_MAINTENANCE_LIMIT,
  type WorkshopDisplayBoardStatDefinition,
  type WorkshopDisplayBoardTaskPanelDefinition,
} from '@/lib/display-board/workshop-board-config';
import type {
  DisplayBoardMaintenanceItem,
  DisplayBoardPayload,
  DisplayBoardWorkshopTask,
} from '@/lib/server/display-board';

function parseDisplayBoardTextSizeStep(value: unknown): MobileTextSizeStep | null {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (MOBILE_TEXT_SIZE_STEPS.includes(numericValue as MobileTextSizeStep)) {
    return numericValue as MobileTextSizeStep;
  }
  return null;
}

type BoardState = 'loading' | 'unauthorised' | 'pairing' | 'ready' | 'error';
type AutoScrollScrollerKey = 'maintenance' | 'pending' | 'inProgress' | 'onHold';
const SECTION_TITLE_BASE_CLASS = 'text-sm font-bold uppercase tracking-[0.3em]';

interface AutoScrollScroller {
  key: AutoScrollScrollerKey;
  element: HTMLDivElement;
  speedMultiplier: number;
}

interface PairingState {
  confirmationCode: string;
  expiresAt: string;
}

function formatTime(value: string | null | undefined) {
  if (!value) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function StatTile({
  definition,
  value,
}: {
  definition: WorkshopDisplayBoardStatDefinition;
  value: number;
}) {
  const toneClass = {
    red: 'border-red-500/45 bg-red-500/15 text-red-200',
    amber: 'border-amber-500/45 bg-amber-500/15 text-amber-200',
    blue: 'border-blue-500/45 bg-blue-500/15 text-blue-200',
    purple: 'border-purple-500/45 bg-purple-500/15 text-purple-200',
    green: 'border-green-500/45 bg-green-500/15 text-green-200',
    slate: 'border-slate-500/45 bg-slate-500/15 text-slate-100',
  }[definition.tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-xl shadow-black/10 ${toneClass}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/70">{definition.label}</p>
      <p className="mt-2 text-5xl font-black leading-none text-white">{value}</p>
    </div>
  );
}

function MaintenanceRow({ item }: { item: DisplayBoardMaintenanceItem }) {
  const isOverdue = item.status === 'overdue';
  return (
    <div className={`rounded-xl border px-4 py-3 ${isOverdue ? 'border-red-500/35 bg-red-500/10' : 'border-amber-500/35 bg-amber-500/10'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-white">{item.asset}</p>
          <p className="truncate text-sm text-white/70">{item.category}</p>
        </div>
        <Badge variant="outline" className={isOverdue ? 'border-red-400/50 text-red-200' : 'border-amber-400/50 text-amber-200'}>
          {item.detail}
        </Badge>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: DisplayBoardWorkshopTask }) {
  const statusClass = task.status === 'pending'
    ? task.is_high_priority
      ? 'border-red-500/35 bg-red-500/10'
      : 'border-amber-500/35 bg-amber-500/10'
    : task.status === 'logged'
      ? 'border-blue-500/35 bg-blue-500/10'
      : 'border-purple-500/35 bg-purple-500/10';

  return (
    <div className={`rounded-xl border px-4 py-3 ${statusClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-lg font-bold text-white">{task.asset}</p>
            {task.is_high_priority ? (
              <Badge variant="outline" className="border-red-400/50 text-red-200">HP</Badge>
            ) : null}
          </div>
          <p className="line-clamp-2 text-sm text-white/75">{task.summary}</p>
        </div>
        <p className="shrink-0 text-xs text-white/50">{formatDateTime(task.created_at)}</p>
      </div>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-white/55">
      {label}
    </div>
  );
}

interface TaskGridProps {
  tasks: DisplayBoardWorkshopTask[];
  emptyLabel: string;
}

function TaskGrid({ tasks, emptyLabel }: TaskGridProps) {
  if (tasks.length === 0) {
    return (
      <div className="col-span-2 min-h-full">
        <EmptyPanel label={emptyLabel} />
      </div>
    );
  }

  return tasks.map(task => <TaskRow key={task.id} task={task} />);
}

function getStatValue(definition: WorkshopDisplayBoardStatDefinition, payload: DisplayBoardPayload): number {
  const source = definition.source === 'maintenance'
    ? payload.maintenance.summary
    : payload.workshop.counts;
  const value = (source as Record<string, number | undefined>)[definition.valueKey];

  return value || 0;
}

function getTaskPanelClasses(panel: WorkshopDisplayBoardTaskPanelDefinition): string {
  const panelClasses = {
    amber: 'border-amber-500/20 bg-amber-500/[0.07]',
    blue: 'border-blue-500/20 bg-blue-500/[0.07]',
    purple: 'border-purple-500/20 bg-purple-500/[0.07]',
  };

  return panelClasses[panel.tone];
}

function getSectionTitleClass(tone: 'red' | WorkshopDisplayBoardTaskPanelDefinition['tone']): string {
  const titleClasses = {
    red: 'text-red-200',
    amber: 'text-amber-200',
    blue: 'text-blue-200',
    purple: 'text-purple-200',
  };

  return `${SECTION_TITLE_BASE_CLASS} ${titleClasses[tone]}`;
}

export default function WorkshopDisplayBoardPage() {
  const [state, setState] = useState<BoardState>('loading');
  const [payload, setPayload] = useState<DisplayBoardPayload | null>(null);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [message, setMessage] = useState('Loading display board...');
  const [now, setNow] = useState(new Date());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maintenanceScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<HTMLDivElement | null>(null);
  const inProgressScrollRef = useRef<HTMLDivElement | null>(null);
  const onHoldScrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollPauseUntilRef = useRef(new WeakMap<HTMLDivElement, number>());
  const scrollPositionRef = useRef<Record<AutoScrollScrollerKey, number>>({
    maintenance: 0,
    pending: 0,
    inProgress: 0,
    onHold: 0,
  });

  const fallbackPollMs = Math.max(15, payload?.config.fallback_poll_interval_seconds || 60) * 1000;
  const realtimeDebounceMs = Math.max(250, payload?.config.realtime_debounce_ms || 750);
  const textSizeStep = payload?.display.text_size_step || WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP;

  useEffect(() => {
    if (isLegacyDisplayBoardBrowser(window.navigator.userAgent)) {
      window.location.replace(DISPLAY_BOARD_LEGACY_TV_PATH);
    }
  }, []);

  const getDeviceToken = useCallback(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY) || '';
  }, []);

  const fetchBoard = useCallback(async () => {
    const deviceToken = getDeviceToken();
    if (!deviceToken) {
      setPayload(null);
      setState(current => current === 'pairing' ? current : 'unauthorised');
      setMessage('This display board is not authorised.');
      return;
    }

    const response = await fetch('/api/display-board/workshop/data', {
      cache: 'no-store',
      headers: {
        'x-display-board-token': deviceToken,
      },
    });
    const body = await response.json() as { status: string; payload?: DisplayBoardPayload; error?: string };

    if (response.status === 401) {
      window.localStorage.removeItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY);
      setPayload(null);
      setState('unauthorised');
      setMessage(body.error || 'This display board is not authorised.');
      return;
    }

    if (!response.ok || !body.payload) {
      throw new Error(body.error || 'Unable to load display board data');
    }

    setPayload(body.payload);
    setState('ready');
    setMessage('Live');
  }, [getDeviceToken]);

  const tryJoinPairing = useCallback(async () => {
    if (getDeviceToken()) return;
    const existingPairingToken = window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY);

    if (existingPairingToken) {
      const response = await fetch(`/api/display-board/workshop/pairing?pairing_token=${encodeURIComponent(existingPairingToken)}`, {
        cache: 'no-store',
      });
      const body = await response.json() as {
        status: string;
        confirmation_code?: string;
        device_token?: string;
        expires_at?: string;
      };

      if (body.status === 'paired' && body.device_token) {
        window.localStorage.setItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY, body.device_token);
        window.localStorage.removeItem(WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY);
        setPairing(null);
        await fetchBoard();
        return;
      }

      if (body.status === 'pairing' && body.confirmation_code && body.expires_at) {
        setPairing({ confirmationCode: body.confirmation_code, expiresAt: body.expires_at });
        setState('pairing');
        setMessage('Waiting for admin confirmation.');
        return;
      }

      window.localStorage.removeItem(WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY);
    }

    const response = await fetch('/api/display-board/workshop/pairing', {
      method: 'POST',
      cache: 'no-store',
    });
    const body = await response.json() as {
      status: string;
      confirmation_code?: string;
      pairing_token?: string;
      expires_at?: string;
      message?: string;
    };

    if (body.status === 'pairing' && body.confirmation_code && body.expires_at) {
      if (body.pairing_token) {
        window.localStorage.setItem(WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY, body.pairing_token);
      }
      setPairing({ confirmationCode: body.confirmation_code, expiresAt: body.expires_at });
      setState('pairing');
      setMessage('Waiting for admin confirmation.');
      return;
    }

    setPairing(null);
    setState('unauthorised');
    setMessage(body.message || 'This display board is not authorised.');
  }, [fetchBoard, getDeviceToken]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void fetchBoard().catch(error => {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'Unable to refresh display board.');
        });
      }
    }, realtimeDebounceMs);
  }, [fetchBoard, realtimeDebounceMs]);

  const handleDeviceCommand = useCallback((command: DisplayBoardDeviceCommandPayload) => {
    if (command.kind === 'text_size') {
      const step = parseDisplayBoardTextSizeStep(command.text_size_step);
      if (step) {
        setPayload(current =>
          current
            ? {
                ...current,
                display: { text_size_step: step },
              }
            : current
        );
      }
      return;
    }

    void fetchBoard().catch(error => {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY);
      }
      setPayload(null);
      setState('unauthorised');
      setMessage(error instanceof Error ? error.message : 'This display board is not authorised.');
    });
  }, [fetchBoard]);

  useDisplayBoardDeviceBroadcast(
    WORKSHOP_DISPLAY_BOARD_KEY,
    payload?.device.id,
    handleDeviceCommand,
    state === 'ready'
  );

  useWorkshopDisplayBoardRealtime((realtimePayload) => {
    if (state === 'ready') {
      if (realtimePayload.table === 'display_board_devices') {
        void fetchBoard().catch(error => {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY);
          }
          setPayload(null);
          setState('unauthorised');
          setMessage(error instanceof Error ? error.message : 'This display board is not authorised.');
        });
        return;
      }

      scheduleRefresh();
    }
  }, state === 'ready');

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.displayBoardTextSize = String(textSizeStep);

    return () => {
      document.documentElement.removeAttribute('data-display-board-text-size');
    };
  }, [textSizeStep]);

  useEffect(() => {
    if (state !== 'ready') return;

    const scrollers = [
      { key: 'maintenance' as const, element: maintenanceScrollRef.current, speedMultiplier: 1 },
      { key: 'pending' as const, element: pendingScrollRef.current, speedMultiplier: WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER },
      { key: 'inProgress' as const, element: inProgressScrollRef.current, speedMultiplier: WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER },
      { key: 'onHold' as const, element: onHoldScrollRef.current, speedMultiplier: WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER },
    ].filter((item): item is AutoScrollScroller => Boolean(item.element));

    if (scrollers.length === 0) return;

    const cleanups = scrollers.map(({ key, element: scroller, speedMultiplier }) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let frameId = 0;
      let cancelled = false;
      let firstLoop = true;

      const clearScheduledWork = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (frameId) {
          cancelAnimationFrame(frameId);
          frameId = 0;
        }
      };

      const schedule = (callback: () => void, delayMs: number) => {
        timeoutId = setTimeout(callback, delayMs);
      };

      const animateTo = (target: number, onComplete: () => void) => {
        const start = scroller.scrollTop;
        const distance = target - start;
        const maxDuration = 12000 * speedMultiplier;
        const duration = Math.max(1200, Math.min(maxDuration, Math.abs(distance) * 35 * speedMultiplier));
        const startTime = performance.now();

        const tick = (timestamp: number) => {
          if (cancelled) return;
          const pauseUntil = autoScrollPauseUntilRef.current.get(scroller) || 0;
          if (Date.now() < pauseUntil) {
            frameId = requestAnimationFrame(tick);
            return;
          }

          const progress = Math.min(1, (timestamp - startTime) / duration);
          scroller.scrollTop = start + distance * progress;

          if (progress < 1) {
            frameId = requestAnimationFrame(tick);
            return;
          }

          onComplete();
        };

        frameId = requestAnimationFrame(tick);
      };

      const loop = () => {
        if (cancelled) return;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll <= 1) {
          scroller.scrollTop = 0;
          scrollPositionRef.current[key] = 0;
          schedule(loop, 2000);
          return;
        }

        if (firstLoop) {
          scroller.scrollTop = Math.min(scrollPositionRef.current[key], maxScroll);
          firstLoop = false;
        } else {
          scroller.scrollTop = 0;
          scrollPositionRef.current[key] = 0;
        }
        schedule(() => {
          animateTo(maxScroll, () => {
            schedule(() => {
              animateTo(0, () => {
                schedule(loop, 2000);
              });
            }, 2000);
          });
        }, 2000);
      };

      const handleWheel = () => {
        autoScrollPauseUntilRef.current.set(scroller, Date.now() + 4000);
        scrollPositionRef.current[key] = scroller.scrollTop;
      };

      const handleScroll = () => {
        scrollPositionRef.current[key] = scroller.scrollTop;
      };

      scroller.addEventListener('wheel', handleWheel, { passive: true });
      scroller.addEventListener('scroll', handleScroll, { passive: true });
      loop();

      return () => {
        cancelled = true;
        scrollPositionRef.current[key] = scroller.scrollTop;
        clearScheduledWork();
        scroller.removeEventListener('wheel', handleWheel);
        scroller.removeEventListener('scroll', handleScroll);
      };
    });

    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  }, [payload, state]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchBoard().catch(() => {
        void tryJoinPairing();
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchBoard, tryJoinPairing]);

  useEffect(() => {
    if (state !== 'unauthorised' && state !== 'pairing') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void tryJoinPairing();
      }
    }, state === 'pairing' ? 3000 : 5000);
    return () => clearInterval(interval);
  }, [state, tryJoinPairing]);

  useEffect(() => {
    if (state !== 'ready') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchBoard().catch(error => {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'Unable to refresh display board.');
        });
      }
    }, fallbackPollMs);
    return () => clearInterval(interval);
  }, [fallbackPollMs, fetchBoard, state]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && state === 'ready') {
        void fetchBoard();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchBoard, state]);

  const topMaintenance = useMemo(
    () => [
      ...(payload?.maintenance.overdue_items || []),
      ...(payload?.maintenance.due_soon_items || []),
    ].slice(0, WORKSHOP_DISPLAY_BOARD_TOP_MAINTENANCE_LIMIT),
    [payload]
  );

  if (state !== 'ready' || !payload) {
    return (
      <main className="flex h-dvh w-screen items-center justify-center overflow-hidden bg-slate-950 text-white">
        <section className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white/[0.04] p-12 text-center shadow-2xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-workshop/20">
            {state === 'pairing' ? <Monitor className="h-10 w-10 text-workshop" /> : <ShieldAlert className="h-10 w-10 text-amber-300" />}
          </div>
          <h1 className="text-5xl font-black tracking-tight">Workshop Display Board</h1>
          {state === 'pairing' && pairing ? (
            <div className="mt-8 space-y-5">
              <p className="text-xl text-white/75">Confirm this code in Admin Settings</p>
              <p className="rounded-3xl border border-workshop/40 bg-workshop/20 px-8 py-6 text-7xl font-black tracking-[0.22em] text-white">
                {pairing.confirmationCode}
              </p>
              <p className="text-white/55">Pairing expires at {formatTime(pairing.expiresAt)}</p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              <p className="text-2xl font-semibold text-white/80">{message}</p>
              <p className="text-white/55">
                Start “Search for display board” from Admin Settings, then reload or leave this screen open.
              </p>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="h-dvh w-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(180,99,68,0.28),transparent_38%),linear-gradient(135deg,#020617,#0f172a_48%,#111827)] p-6 text-white">
      <div className="grid h-full grid-rows-[88px_auto_minmax(0,1fr)] gap-5">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[0.06] px-7 shadow-2xl shadow-black/20">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-workshop text-white">
              <Wrench className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.3em] text-workshop-light">{WORKSHOP_DISPLAY_BOARD_BRAND}</p>
              <h1 className="text-4xl font-black tracking-tight">{WORKSHOP_DISPLAY_BOARD_TITLE}</h1>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div className="flex items-center gap-5">
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-white/50">Last update</p>
                <p className="text-xl font-bold">{formatTime(payload.generated_at)}</p>
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-white/50">Now</p>
                <p className="text-3xl font-black">{formatTime(now.toISOString())}</p>
              </div>
              <Badge className="gap-2 border-green-400/30 bg-green-500/15 px-4 py-2 text-green-100">
                <Radio className="h-4 w-4" />
                {message}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/45">
              <TimerReset className="h-3.5 w-3.5" />
              Fallback refresh every {payload.config.fallback_poll_interval_seconds}s
              <CheckCircle2 className="ml-3 h-3.5 w-3.5 text-green-300" />
              Realtime enabled
            </div>
          </div>
        </header>

        <section className="grid grid-cols-7 gap-4">
          {WORKSHOP_DISPLAY_BOARD_STAT_TILES.map(definition => (
            <StatTile key={definition.id} definition={definition} value={getStatValue(definition, payload)} />
          ))}
        </section>

        <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
          <div className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20">
            <div className="mb-3">
              <h2 className={getSectionTitleClass('red')}>{WORKSHOP_DISPLAY_BOARD_MAINTENANCE_TITLE}</h2>
            </div>
            <div ref={maintenanceScrollRef} className="scrollbar-hidden min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {topMaintenance.length > 0 ? topMaintenance.map(item => (
                <MaintenanceRow key={item.id} item={item} />
              )) : (
                <EmptyPanel label={WORKSHOP_DISPLAY_BOARD_EMPTY_MAINTENANCE_LABEL} />
              )}
            </div>
          </div>

          <div className="grid min-h-0 grid-rows-3 gap-4">
            {WORKSHOP_DISPLAY_BOARD_TASK_PANELS.map(panel => (
              <div key={panel.id} className={`flex min-h-0 flex-col rounded-3xl border p-4 ${getTaskPanelClasses(panel)}`}>
                <div className="mb-3">
                  <h2 className={getSectionTitleClass(panel.tone)}>{panel.title}</h2>
                </div>
                <div ref={panel.id === 'pending' ? pendingScrollRef : panel.id === 'inProgress' ? inProgressScrollRef : onHoldScrollRef} className="scrollbar-hidden grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(2,minmax(0,1fr))] content-start gap-2 overflow-y-auto pr-2">
                  <TaskGrid tasks={payload.workshop[panel.itemsKey]} emptyLabel={panel.emptyLabel} />
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
