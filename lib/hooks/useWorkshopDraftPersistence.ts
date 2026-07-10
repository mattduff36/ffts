'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  deleteWorkshopDraft,
  getWorkshopDraft,
  saveWorkshopDraft,
} from '@/lib/client/workshop-task-drafts';
import { setWorkshopDraftDirty } from '@/lib/client/workshop-draft-activity';

interface UseWorkshopDraftPersistenceOptions<T> {
  enabled: boolean;
  draftId: string;
  kind: string;
  ownerId?: string | null;
  value: T;
  isDirty: boolean;
  onRestore: (value: T) => void;
  onServerAutosave?: (value: T) => Promise<void>;
  autosaveDelayMs?: number;
  clearLocalDraftAfterServerAutosave?: boolean;
}

interface UseWorkshopDraftPersistenceResult {
  clearDraft: () => Promise<void>;
  persistDraftNow: () => Promise<void>;
}

export function useWorkshopDraftPersistence<T>({
  enabled,
  draftId,
  kind,
  ownerId = null,
  value,
  isDirty,
  onRestore,
  onServerAutosave,
  autosaveDelayMs = 2_000,
  clearLocalDraftAfterServerAutosave = false,
}: UseWorkshopDraftPersistenceOptions<T>): UseWorkshopDraftPersistenceResult {
  const valueRef = useRef(value);
  const restoredDraftIdsRef = useRef(new Set<string>());
  const isPersistingRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  const onServerAutosaveRef = useRef(onServerAutosave);

  valueRef.current = value;
  onRestoreRef.current = onRestore;
  onServerAutosaveRef.current = onServerAutosave;

  const clearDraft = useCallback(async () => {
    await deleteWorkshopDraft(draftId);
    setWorkshopDraftDirty(draftId, false);
  }, [draftId]);

  const persistDraftNow = useCallback(async () => {
    if (!enabled || !isDirty || isPersistingRef.current) return;

    isPersistingRef.current = true;
    try {
      await saveWorkshopDraft({
        id: draftId,
        ownerId,
        kind,
        payload: valueRef.current,
      });

      if (onServerAutosaveRef.current) {
        await onServerAutosaveRef.current(valueRef.current);
        if (clearLocalDraftAfterServerAutosave) {
          await deleteWorkshopDraft(draftId);
        }
      }
    } catch (error) {
      console.warn('Failed to persist workshop draft:', error);
    } finally {
      isPersistingRef.current = false;
    }
  }, [clearLocalDraftAfterServerAutosave, draftId, enabled, isDirty, kind, ownerId]);

  useEffect(() => {
    setWorkshopDraftDirty(draftId, enabled && isDirty);
    return () => setWorkshopDraftDirty(draftId, false);
  }, [draftId, enabled, isDirty]);

  useEffect(() => {
    if (!enabled || restoredDraftIdsRef.current.has(draftId)) return;
    restoredDraftIdsRef.current.add(draftId);

    let cancelled = false;
    void getWorkshopDraft<T>(draftId)
      .then((draft) => {
        if (cancelled || !draft) return;

        const shouldRestore = !isDirty || window.confirm('Restore your unsaved workshop draft?');
        if (shouldRestore) {
          onRestoreRef.current(draft.payload);
        }
      })
      .catch((error) => {
        console.warn('Failed to restore workshop draft:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [draftId, enabled, isDirty]);

  useEffect(() => {
    if (!enabled || !isDirty) return undefined;

    const timeoutId = window.setTimeout(() => {
      void persistDraftNow();
    }, autosaveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [autosaveDelayMs, enabled, isDirty, persistDraftNow, value]);

  useEffect(() => {
    if (!enabled) return undefined;

    const flushDraft = () => {
      void persistDraftNow();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };

    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, persistDraftNow]);

  return { clearDraft, persistDraftNow };
}
