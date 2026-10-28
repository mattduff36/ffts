'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  bindSiteUsageCapture,
  getBrowserSiteUsageController,
  type SiteUsageStatus,
} from '@/lib/analytics/site-usage';

const IDLE_STATUS: SiteUsageStatus = {
  enabled: false,
  recordingId: null,
  upload: 'idle',
  pendingCount: 0,
  droppedCount: 0,
};

function uploadLabel(status: SiteUsageStatus): 'Pending' | 'Failed' | null {
  if (status.droppedCount > 0 || status.upload === 'failed') return 'Failed';
  if (status.pendingCount > 0 || status.upload === 'pending') return 'Pending';
  return null;
}

export function SiteUsageMonitor() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const profileId = profile?.id ?? null;
  const [status, setStatus] = useState<SiteUsageStatus>(IDLE_STATUS);
  const captureLabel = status.enabled ? 'Recording' : 'Off';
  const pendingLabel = uploadLabel(status);

  useEffect(() => {
    let controller: ReturnType<typeof getBrowserSiteUsageController>;
    try {
      controller = getBrowserSiteUsageController();
      controller.setProfile(profileId);
    } catch {
      return;
    }
    return controller.subscribe(setStatus);
  }, [profileId]);

  useEffect(() => {
    if (!pathname) return;
    try {
      getBrowserSiteUsageController().notePath(pathname);
    } catch {
      // Route changes keep working when capture is unavailable.
    }
  }, [pathname, profileId]);

  useEffect(() => {
    if (!status.enabled) return;
    try {
      return bindSiteUsageCapture(getBrowserSiteUsageController());
    } catch {
      return undefined;
    }
  }, [status.enabled, profileId]);

  const aria = pendingLabel
    ? `Site usage ${captureLabel}, upload ${pendingLabel}`
    : `Site usage ${captureLabel}`;
  const tone = pendingLabel === 'Failed'
    ? 'border-amber-400/70 text-amber-200'
    : status.enabled
      ? 'border-red-400/70 text-red-200'
      : 'border-white/15 text-slate-300';

  return (
    <button
      type="button"
      data-testid="site-usage-monitor"
      aria-pressed={status.enabled}
      aria-label={`Site usage ${captureLabel}`}
      title={`${aria}. Optional diagnostic recording: navigation, active time and control usage. No typed values or page contents. Keep this tab open until uploads finish.`}
      className={`inline-flex max-w-[9.5rem] items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold leading-none hover:bg-slate-800/70 ${tone}`}
      onClick={() => {
        try {
          void getBrowserSiteUsageController().setEnabled(!status.enabled);
        } catch {
          // The switch is optional and must not break navigation.
        }
      }}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${status.enabled ? 'bg-red-400' : 'bg-slate-500'}`} aria-hidden="true" />
      <span>{status.enabled ? 'Recording' : 'Logging off'}</span>
      {pendingLabel === 'Failed' ? <span aria-label="Upload failed">!</span> : null}
    </button>
  );
}
