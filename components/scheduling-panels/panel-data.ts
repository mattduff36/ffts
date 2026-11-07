'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { notifySchedulingPanelLocked, notifySchedulingPanelSaved, SCHEDULING_PANEL_SAVED } from '@/lib/client/scheduling-panel-events';
import { createStatusError, getErrorStatus } from '@/lib/utils/http-error';

export async function panelRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json();
  if (!response.ok) {
    notifySchedulingPanelLocked(url, response.status);
    const error = createStatusError(payload.error || 'Unable to complete this request.', response.status, payload);
    Object.assign(error, { fieldErrors: payload.field_errors || {} });
    throw error;
  }
  return payload as T;
}

export function usePanelList<T extends { id: string }>(url: string, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const savedItems = useRef(new Map<string, T>());
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await fetchAllPaginatedItems<T>(url, key, { limit: 250 });
      if (alive.current && request === generation.current) {
        const merged = result.items.map(item => {
          const saved = savedItems.current.get(item.id);
          if (!saved) return item;
          if (panelRecordAcknowledged(item, saved)) {
            savedItems.current.delete(item.id);
            return item;
          }
          return saved;
        });
        for (const saved of savedItems.current.values()) {
          if (!merged.some(item => item.id === saved.id)) merged.unshift(saved);
        }
        setItems(merged);
        setError(null);
      }
    } catch (error) {
      if (alive.current && request === generation.current) notifySchedulingPanelLocked(url, getErrorStatus(error));
      if (alive.current && request === generation.current) {
        const message = error instanceof Error ? error.message : 'Unable to load records.';
        setError(new Error(savedItems.current.size ? `Changes saved. Refresh failed: ${message}` : message));
      }
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [url, key]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);
  useEffect(() => {
    const saved = () => { void refresh(); };
    window.addEventListener(SCHEDULING_PANEL_SAVED, saved);
    return () => window.removeEventListener(SCHEDULING_PANEL_SAVED, saved);
  }, [refresh]);
  const saved = (item?: T) => {
    ++generation.current;
    if (alive.current && item) {
      savedItems.current.set(item.id, item);
      setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    }
    notifySchedulingPanelSaved();
  };
  return { items, setItems, loading, error, refresh, saved };
}

type PanelRecord = { id: string; updated_at?: string; sites?: Array<{ id: string; updated_at?: string }> };

export function panelRecordAcknowledged(remote: PanelRecord, local: PanelRecord): boolean {
  const remoteTime = Date.parse(remote.updated_at || '');
  const localTime = Date.parse(local.updated_at || '');
  if (!Number.isFinite(remoteTime) || !Number.isFinite(localTime) || remoteTime < localTime) return false;
  return !local.sites || local.sites.every(site => {
    const siteTime = Date.parse(site.updated_at || local.updated_at || '');
    return remoteTime > Math.max(localTime, siteTime)
      || remote.sites?.some(candidate => candidate.id === site.id
        && (!site.updated_at || Date.parse(candidate.updated_at || '') >= siteTime));
  });
}

export function savedFollowUpWarning(error: unknown) {
  toast.warning('Quote saved, but a follow-up action failed.', {
    description: error instanceof Error ? error.message : 'Check the quote before retrying.',
  });
}
