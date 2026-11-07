'use client';

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { SCHEDULING_PANEL_LOCKED, type SchedulingPanelModule } from '@/lib/client/scheduling-panel-events';

export function PanelAccess({ module, children }: { module: SchedulingPanelModule; children: ReactNode }) {
  const permission = usePermissionCheck(module, false);
  const access = useSensitiveModuleAccess(module, { enabled: !permission.loading && permission.hasPermission });
  const refresh = access.refresh;
  const [expired, setExpired] = useState(false);
  const [denied, setDenied] = useState(false);
  const loseAccess = useCallback(() => { setExpired(true); void refresh(); }, [refresh]);
  const expiresAt = access.state?.required ? access.state.expires_at : null;
  useEffect(() => {
    const lock = (event: Event) => {
      const detail = (event as CustomEvent<{ module: SchedulingPanelModule; status: number }>).detail;
      if (detail.module !== module) return;
      setExpired(true);
      if (detail.status !== 428) setDenied(true);
      void refresh();
    };
    window.addEventListener(SCHEDULING_PANEL_LOCKED, lock);
    return () => window.removeEventListener(SCHEDULING_PANEL_LOCKED, lock);
  }, [module, refresh]);

  useLayoutEffect(() => {
    if (!expiresAt) return;
    const expire = () => {
      setExpired(true);
      void refresh();
    };
    const delay = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, refresh]);

  if (permission.loading || access.loading) return <p role="status">Checking {module} access...</p>;
  if (!permission.hasPermission || denied) return <p role="alert">You do not have access to {module}.</p>;
  if (expired || !access.canAccess) return <SensitiveModuleGate moduleLabel={module === 'quotes' ? 'Quotes' : 'Customers'} access={{ ...access, canAccess: false, unlock: async pin => { const unlocked = await access.unlock(pin); if (unlocked) setExpired(false); return unlocked; } }} />;

  return <>
    <SensitiveModuleSessionManager moduleLabel={module === 'quotes' ? 'Quotes' : 'Customers'} access={access} onAccessLost={loseAccess} />
    {children}
  </>;
}
