'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchUserDirectory, type DirectoryUser } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageLoader } from '@/components/ui/page-loader';
import { AlertCircle, AlertTriangle, ArrowLeft, Camera, CheckCircle2, Info, Send, Timer, User, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  HGV_ARTIC_ONLY_END_ITEM,
  HGV_ARTIC_ONLY_START_ITEM,
  TRUCK_CHECKLIST_ITEMS,
} from '@/lib/checklists/vehicle-checklists';
import { formatDate, formatDateISO, getDayOfWeek } from '@/lib/utils/date';
import { getRecentVehicleIds, recordRecentVehicleId, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { buildInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';
import { scrollAndHighlightValidationTarget } from '@/lib/utils/validation-scroll';
import type { Database } from '@/types/database';
import type { Employee } from '@/types/common';
import type { InspectionStatus } from '@/types/inspection';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import { getReadingDigitGrowthWarning } from '@/lib/utils/readingDigitGrowthWarning';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { completeInspectionReminder } from '@/lib/client/complete-inspection-reminder';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

const PhotoUpload = dynamic(() => import('@/components/forms/PhotoUpload'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });

type HgvAsset = {
  id: string;
  reg_number: string;
  nickname: string | null;
  current_mileage?: number | null;
  hgv_categories?: { name: string } | null;
};

type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
type InspectionInsert = Database['public']['Tables']['hgv_inspections']['Insert'];
type PendingNavigation = { type: 'href'; href: string } | { type: 'back' };
type ExistingInspectionConflict = { id: string; status: 'draft' | 'submitted' };

const MIN_HGV_INSPECTION_SECONDS = 10 * 60;
const STICKY_NAV_OFFSET_PX = 96;
const getInspectionTimerStorageKey = (inspectionId: string): string => `hgv-inspection-timer-start:${inspectionId}`;
type RecentCompletedDefect = { completedAt: string };

function isArticOnlyItem(itemNumber: number): boolean {
  return itemNumber >= HGV_ARTIC_ONLY_START_ITEM && itemNumber <= HGV_ARTIC_ONLY_END_ITEM;
}

function normalizeChecklistLabel(label?: string | null): string {
  return (label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveCurrentHgvChecklistItemNumber(itemDescription?: string | null, fallbackItemNumber?: number): number {
  const normalizedDescription = normalizeChecklistLabel(itemDescription);
  const currentIndex = TRUCK_CHECKLIST_ITEMS.findIndex(
    (checklistItem) => normalizeChecklistLabel(checklistItem) === normalizedDescription
  );

  return currentIndex >= 0 ? currentIndex + 1 : fallbackItemNumber || 0;
}

function resolveCurrentHgvDefectSignature(signature: string): string {
  const match = signature.match(/^\s*(\d+)\s*-\s*(.+?)\s*$/);
  if (!match) return signature;

  const itemDescription = match[2];
  return buildInspectionDefectSignature({
    item_number: resolveCurrentHgvChecklistItemNumber(itemDescription, Number(match[1])),
    item_description: itemDescription,
  });
}

function NewHgvInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;
  const { user, profile, effectiveRole, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { loading: permissionLoading } = usePermissionCheck('hgv-inspections');
  const { canManageInspections: canManageCrossUserInspections } = getInspectionVisibilityFlags({
    teamName: effectiveRole?.team_name ?? profile?.team?.name,
    isManager,
    isAdmin,
    isSuperAdmin,
  });
  const { tabletModeEnabled } = useTabletMode();

  const [hgvs, setHgvs] = useState<HgvAsset[]>([]);
  const [recentHgvIds, setRecentHgvIds] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [hgvId, setHgvId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [currentMileage, setCurrentMileage] = useState('');
  const [digitGrowthWarning, setDigitGrowthWarning] = useState<string | null>(null);
  const [digitGrowthConfirmed, setDigitGrowthConfirmed] = useState(false);
  const [showDigitGrowthWarningDialog, setShowDigitGrowthWarningDialog] = useState(false);

  const [checklistStarted, setChecklistStarted] = useState(false);
  const [inspectionStartMs, setInspectionStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const lockedDefectsRequestIdRef = useRef(0);

  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loggedDefects, setLoggedDefects] = useState<Map<string, { comment: string; actionId: string }>>(new Map());
  const [recentlyCompletedDefects, setRecentlyCompletedDefects] = useState<Map<string, RecentCompletedDefect>>(new Map());
  const [confirmedRepeatDefects, setConfirmedRepeatDefects] = useState<Set<string>>(new Set());
  const [showRepeatDefectDialog, setShowRepeatDefectDialog] = useState(false);
  const [pendingRepeatDefect, setPendingRepeatDefect] = useState<{
    itemNum: number;
    itemDesc: string;
    signature: string;
    completedAt: string;
  } | null>(null);

  const [inspectorComments, setInspectorComments] = useState('');
  const [informWorkshop, setInformWorkshop] = useState(false);
  const hasOptionalInspectorComment = inspectorComments.trim().length > 0;

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const saveInspectionInFlightRef = useRef(false);
  const allowNavigationRef = useRef(false);

  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(draftId);
  const existingInspectionIdRef = useRef<string | null>(draftId);
  existingInspectionIdRef.current = existingInspectionId;
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number } | null>(null);
  const [savingDraftForPhoto, setSavingDraftForPhoto] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [submittedConflictInspectionId, setSubmittedConflictInspectionId] = useState<string | null>(null);
  const [showSubmittedConflictDialog, setShowSubmittedConflictDialog] = useState(false);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(existingInspectionId, {
    enabled: Boolean(existingInspectionId),
  });
  const isDraftHydratedRef = useRef(!draftId);
  const draftSavePromiseRef = useRef<Promise<string | null> | null>(null);
  const activeDraftLoadIdRef = useRef<string | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);
  const loadLockedDefectsRef = useRef<((selectedHgvId: string, mode?: 'replace' | 'merge') => Promise<void>) | null>(null);

  const showPermissionLoader = permissionLoading;

  useEffect(() => {
    if (!hasOptionalInspectorComment && informWorkshop) {
      setInformWorkshop(false);
    }
  }, [hasOptionalInspectorComment, informWorkshop]);

  const resolveDigitGrowthWarning = useCallback(
    (rawMileage: string, previousMileage: number | null | undefined): string | null => {
      if (!rawMileage || rawMileage.trim() === '') return null;
      const mileageValue = parseInt(rawMileage, 10);
      if (Number.isNaN(mileageValue) || mileageValue < 0) return null;
      return (
        getReadingDigitGrowthWarning({
          enteredReading: mileageValue,
          previousReading: previousMileage,
          unitName: 'KM',
        }).warning || null
      );
    },
    []
  );

  useEffect(() => {
    const selectedHgv = hgvs.find((candidate) => candidate.id === hgvId);
    const warningMessage = resolveDigitGrowthWarning(currentMileage, selectedHgv?.current_mileage ?? null);
    setDigitGrowthWarning(warningMessage);
    if (!warningMessage) {
      setDigitGrowthConfirmed(true);
      return;
    }
    setDigitGrowthConfirmed(false);
  }, [currentMileage, hgvId, hgvs, resolveDigitGrowthWarning]);

  const getPhotosForItem = useCallback(
    (itemNumber: number, dayOfWeek: number) =>
      photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [],
    [photoMap]
  );

  const beginChecklist = useCallback(() => {
    const startedAt = Date.now();
    setChecklistStarted(true);
    setInspectionStartMs(startedAt);
    setNowMs(startedAt);
  }, []);

  const findExistingInspectionConflict = useCallback(async (): Promise<ExistingInspectionConflict | null> => {
    if (!hgvId || !inspectionDate || !selectedEmployeeId) {
      return null;
    }

    const { data, error } = await supabase
      .from('hgv_inspections')
      .select('id, status')
      .eq('hgv_id', hgvId)
      .eq('user_id', selectedEmployeeId)
      .eq('inspection_date', inspectionDate)
      .limit(1)
      .maybeSingle();

    if (error) {
      const status = getErrorStatus(error);
      if (!isAuthErrorStatus(status) && !isNetworkFetchError(error)) {
        console.error('Failed to check for existing inspection:', error, {
          errorContextId: 'hgv-inspections-new-check-existing-error',
        });
      } else if (isNetworkFetchError(error)) {
        console.warn('Unable to check existing HGV inspection (network):', error, {
          errorContextId: 'hgv-inspections-new-check-existing-error',
        });
      }
      return null;
    }

    if (!data) {
      return null;
    }

    if (data.id === existingInspectionId) {
      return null;
    }

    return {
      id: data.id,
      status: data.status as 'draft' | 'submitted',
    };
  }, [existingInspectionId, hgvId, inspectionDate, selectedEmployeeId, supabase]);

  const handleInspectionConflict = useCallback((conflict: ExistingInspectionConflict): void => {
    if (conflict.status !== 'submitted') return;
    setSubmittedConflictInspectionId(conflict.id);
    setShowSubmittedConflictDialog(true);
    toast.info('A daily check has already been submitted for this employee, HGV and date.');
  }, []);

  const buildCurrentInspectionItemsPayload = useCallback((inspectionId: string): InspectionItemInsert[] => {
    if (!inspectionDate) return [];

    const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
    const items: InspectionItemInsert[] = [];
    TRUCK_CHECKLIST_ITEMS.forEach((itemDescription, idx) => {
      const itemNumber = idx + 1;
      const key = `${itemNumber}`;
      if (checkboxStates[key]) {
        items.push({
          inspection_id: inspectionId,
          item_number: itemNumber,
          item_description: itemDescription,
          day_of_week: dayOfWeek,
          status: checkboxStates[key],
          comments: comments[key] || null,
        });
      }
    });
    return items;
  }, [checkboxStates, comments, inspectionDate]);

  const mergeIntoExistingDraft = useCallback(async (
    inspectionId: string,
    options: { showToast?: boolean } = {}
  ): Promise<boolean> => {
    const { showToast = true } = options;
    const errorContextId = 'hgv-inspections-new-merge-draft-error';
    if (!hgvId || !inspectionDate || !selectedEmployeeId) {
      toast.error('Select an HGV, employee and date before continuing', {
        id: 'hgv-inspections-new-validation-missing-core-fields',
      });
      return false;
    }

    const mileageValue = parseInt(currentMileage, 10);
    const draftPayload: Database['public']['Tables']['hgv_inspections']['Update'] = {
      hgv_id: hgvId,
      user_id: selectedEmployeeId,
      inspection_date: inspectionDate,
      inspection_end_date: inspectionDate,
      current_mileage: Number.isNaN(mileageValue) ? null : mileageValue,
      status: 'draft',
      submitted_at: null,
      signature_data: null,
      signed_at: null,
      inspector_comments: inspectorComments.trim() || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: updatedDraft, error: updateError } = await supabase
        .from('hgv_inspections')
        .update(draftPayload)
        .eq('id', inspectionId)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle();

      if (updateError || !updatedDraft) {
        throw updateError ?? new Error('Draft not found');
      }

      const { error: deleteItemsError } = await supabase
        .from('inspection_items')
        .delete()
        .eq('inspection_id', inspectionId);
      if (deleteItemsError) throw deleteItemsError;

      const items = buildCurrentInspectionItemsPayload(inspectionId);
      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items);
        if (itemsError) throw itemsError;
      }

      setExistingInspectionId(inspectionId);
      window.history.replaceState(null, '', `/hgv-inspections/new?id=${inspectionId}`);
      if (showToast) {
        toast.info('Merged with existing draft for this HGV and date.');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not merge with existing draft';
      if (!isAuthErrorStatus(getErrorStatus(err))) {
        if (isNetworkFetchError(err)) {
          console.warn('HGV draft merge temporarily unavailable:', err, { errorContextId });
        } else {
          console.error('Failed to merge into existing HGV draft:', err, { errorContextId });
        }
      }
      if (showToast && !isAuthErrorStatus(getErrorStatus(err))) {
        toast.error(message, { id: errorContextId });
      }
      return false;
    }
  }, [
    buildCurrentInspectionItemsPayload,
    currentMileage,
    hgvId,
    inspectionDate,
    inspectorComments,
    selectedEmployeeId,
    supabase,
  ]);

  const discardDraftById = useCallback(async (inspectionId: string, showToast = true): Promise<boolean> => {
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/discard`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to discard draft');
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(getInspectionTimerStorageKey(inspectionId));
      }

      if (existingInspectionId === inspectionId) {
        setExistingInspectionId(null);
        setPhotoUploadItem(null);
        window.history.replaceState(null, '', '/hgv-inspections/new');
      }

      if (showToast) {
        toast.success('Draft discarded');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to discard draft';
      const errorContextId = 'hgv-inspections-new-discard-draft-error';
      console.error('Failed to discard HGV draft:', err, { errorContextId });
      toast.error(message, { id: errorContextId });
      return false;
    }
  }, [existingInspectionId]);

  const navigateWithoutPrompt = useCallback((navigation: PendingNavigation) => {
    allowNavigationRef.current = true;
    if (navigation.type === 'back') {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push('/hgv-inspections');
      }
      return;
    }

    router.push(navigation.href);
  }, [router]);

  const requestNavigation = useCallback((navigation: PendingNavigation) => {
    if (!existingInspectionId || saveInspectionInFlightRef.current || allowNavigationRef.current) {
      navigateWithoutPrompt(navigation);
      return;
    }
    setPendingNavigation(navigation);
    setShowDiscardDraftDialog(true);
  }, [existingInspectionId, navigateWithoutPrompt]);

  const ensureDraftSaved = async (
    options: { silent?: boolean; source?: 'auto' | 'user' } = {}
  ): Promise<string | null> => {
    if (draftSavePromiseRef.current) {
      return draftSavePromiseRef.current;
    }

    const pendingDraftSave = (async () => {
      const { silent = false, source = 'user' } = options;

      if (existingInspectionId) {
        if (source === 'auto' && !isDraftHydratedRef.current) {
          return existingInspectionId;
        }
        if (saveInspectionInFlightRef.current) {
          return existingInspectionIdRef.current;
        }
        saveInspectionInFlightRef.current = true;
        try {
          const merged = await mergeIntoExistingDraft(existingInspectionId, { showToast: false });
          if (!merged && !silent) {
            toast.error('Could not auto-save draft. Please try again.', { id: 'hgv-inspections-new-autosave-draft-error' });
          }
          return merged ? existingInspectionId : null;
        } finally {
          saveInspectionInFlightRef.current = false;
        }
      }
      if (!user || !selectedEmployeeId || !hgvId) {
        if (!silent) toast.error('Select an HGV, employee and date before adding photos', {
          id: 'hgv-inspections-new-validation-photos-core-fields',
        });
        return null;
      }
      if (!inspectionDate) {
        if (!silent) toast.error('Select an inspection date before adding photos', {
          id: 'hgv-inspections-new-validation-photos-date-required',
        });
        return null;
      }
      if (saveInspectionInFlightRef.current) {
        return existingInspectionIdRef.current;
      }

      saveInspectionInFlightRef.current = true;
      setSavingDraftForPhoto(true);
      try {
        const inspectionConflict = await findExistingInspectionConflict();
        if (inspectionConflict) {
          if (inspectionConflict.status === 'draft') {
            const merged = await mergeIntoExistingDraft(inspectionConflict.id, { showToast: !silent });
            return merged ? inspectionConflict.id : null;
          }
          handleInspectionConflict(inspectionConflict);
          return null;
        }

        const mileageValue = parseInt(currentMileage, 10);
        const { data: draft, error: draftError } = await supabase
          .from('hgv_inspections')
          .insert({
            hgv_id: hgvId,
            user_id: selectedEmployeeId,
            inspection_date: inspectionDate,
            inspection_end_date: inspectionDate,
            current_mileage: Number.isNaN(mileageValue) ? null : mileageValue,
            status: 'draft' as const,
            inspector_comments: inspectorComments.trim() || null,
          })
          .select('id')
          .single();

        if (draftError) {
          if (draftError.code === '23505') {
            const inspectionConflict = await findExistingInspectionConflict();
            if (inspectionConflict) {
              if (inspectionConflict.status === 'draft') {
                const merged = await mergeIntoExistingDraft(inspectionConflict.id, { showToast: !silent });
                return merged ? inspectionConflict.id : null;
              }
              handleInspectionConflict(inspectionConflict);
              return null;
            }
          }
          throw draftError;
        }

        const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
        const items: InspectionItemInsert[] = [];
        TRUCK_CHECKLIST_ITEMS.forEach((itemDescription, idx) => {
          const itemNumber = idx + 1;
          const key = `${itemNumber}`;
          if (checkboxStates[key]) {
            items.push({
              inspection_id: draft.id,
              item_number: itemNumber,
              item_description: itemDescription,
              day_of_week: dayOfWeek,
              status: checkboxStates[key],
              comments: comments[key] || null,
            });
          }
        });

        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('inspection_items')
            .insert(items);
          if (itemsError) throw itemsError;
        }

        setExistingInspectionId(draft.id);
        window.history.replaceState(null, '', `/hgv-inspections/new?id=${draft.id}`);
        return draft.id;
      } catch (err) {
        const errorContextId = 'hgv-inspections-new-silent-draft-save-error';
        if (isNetworkFetchError(err)) {
          console.warn('Silent HGV draft save skipped due transient network error', { errorContextId });
        } else if (!isAuthErrorStatus(getErrorStatus(err))) {
          console.error('Silent draft save failed:', err, { errorContextId });
        }
        if (!silent) {
          toast.error('Could not auto-save draft. Please try again.', { id: errorContextId });
        }
        return null;
      } finally {
        saveInspectionInFlightRef.current = false;
        setSavingDraftForPhoto(false);
      }
    })();

    draftSavePromiseRef.current = pendingDraftSave;
    try {
      return await pendingDraftSave;
    } finally {
      if (draftSavePromiseRef.current === pendingDraftSave) {
        draftSavePromiseRef.current = null;
      }
    }
  };

  const autoSaveDraftRef = useRef<(() => Promise<string | null>) | null>(null);
  autoSaveDraftRef.current = () => ensureDraftSaved({ silent: true, source: 'auto' });

  const loadDraftInspection = useCallback(async (id: string) => {
    if (activeDraftLoadIdRef.current === id || loadedDraftIdRef.current === id) {
      return;
    }

    activeDraftLoadIdRef.current = id;
    try {
      loadingRef.current = true;
      isDraftHydratedRef.current = false;
      setLoading(true);
      const { data: draft, error: draftError } = await supabase
        .from('hgv_inspections')
        .select('id, hgv_id, user_id, inspection_date, current_mileage, inspector_comments')
        .eq('id', id)
        .eq('status', 'draft')
        .single();

      if (draftError || !draft) {
        setExistingInspectionId(null);
        window.history.replaceState(null, '', '/hgv-inspections/new');
        isDraftHydratedRef.current = true;
        return;
      }

      if (!canManageCrossUserInspections && draft.user_id !== user?.id) {
        setExistingInspectionId(null);
        window.history.replaceState(null, '', '/hgv-inspections/new');
        setError('You do not have permission to edit this inspection');
        isDraftHydratedRef.current = true;
        return;
      }

      setExistingInspectionId(id);
      setSubmittedConflictInspectionId(null);
      setShowSubmittedConflictDialog(false);
      setHgvId(draft.hgv_id || '');
      setInspectionDate(draft.inspection_date || '');
      setCurrentMileage(draft.current_mileage != null ? String(draft.current_mileage) : '');
      setSelectedEmployeeId(draft.user_id || '');
      setInspectorComments(draft.inspector_comments || '');

      const { data: items } = await supabase
        .from('inspection_items')
        .select('item_number, item_description, status, comments')
        .eq('inspection_id', id);

      const restoredStates: Record<string, InspectionStatus> = {};
      const restoredComments: Record<string, string> = {};
      for (const item of (items || []) as Array<{ item_number: number; item_description: string | null; status: InspectionStatus; comments: string | null }>) {
        const itemNumber = resolveCurrentHgvChecklistItemNumber(item.item_description, item.item_number);
        const key = `${itemNumber}`;
        restoredStates[key] = item.status;
        if (item.comments) restoredComments[key] = item.comments;
      }
      setCheckboxStates(restoredStates);
      setComments(restoredComments);

      setChecklistStarted(true);
      const startedAt = Date.now();
      let inspectionTimerStartMs = startedAt;
      if (typeof window !== 'undefined') {
        const timerKey = getInspectionTimerStorageKey(id);
        const storedTimerValue = window.sessionStorage.getItem(timerKey);
        const parsedStoredTimer = storedTimerValue ? Number.parseInt(storedTimerValue, 10) : NaN;
        if (!Number.isNaN(parsedStoredTimer) && parsedStoredTimer > 0) {
          inspectionTimerStartMs = parsedStoredTimer;
        } else {
          window.sessionStorage.setItem(timerKey, String(startedAt));
        }
      }
      setInspectionStartMs(inspectionTimerStartMs);
      setNowMs(inspectionTimerStartMs);

      if (draft.hgv_id) {
        await loadLockedDefectsRef.current?.(draft.hgv_id, 'merge');
      }
      loadedDraftIdRef.current = id;
    } catch (err) {
      const errorContextId = 'hgv-inspections-new-load-draft-error';
      if (isNetworkFetchError(err)) {
        console.warn('Unable to load HGV draft inspection (network):', err, { errorContextId });
        setError('Could not load draft inspection because the network request failed. Please refresh and try again.');
        toast.error('Could not load draft inspection. Please refresh and try again.', { id: errorContextId });
      } else {
        if (!isAuthErrorStatus(getErrorStatus(err))) {
          console.error('Error loading HGV draft:', err, { errorContextId });
        }
        setError(err instanceof Error ? err.message : 'Failed to load draft inspection');
        toast.error('Failed to load draft inspection', { id: errorContextId });
      }
    } finally {
      if (activeDraftLoadIdRef.current === id) {
        activeDraftLoadIdRef.current = null;
      }
      loadingRef.current = false;
      isDraftHydratedRef.current = true;
      setLoading(false);
    }
  }, [canManageCrossUserInspections, supabase, user?.id]);

  useEffect(() => {
    if (authLoading || permissionLoading || !user) {
      return;
    }

    const loadData = async () => {
      try {
        const [{ data: hgvData }, employeeData] = await Promise.all([
          supabase
            .from('hgvs')
            .select('id, reg_number, nickname, current_mileage, hgv_categories(name)')
            .eq('status', 'active')
            .order('reg_number'),
          canManageCrossUserInspections
            ? fetchUserDirectory({ module: 'hgv-inspections' })
            : Promise.resolve([] as DirectoryUser[]),
        ]);

        setHgvs((hgvData || []) as HgvAsset[]);
        setEmployees(
          employeeData.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            employee_id: employee.employee_id,
            has_module_access: employee.has_module_access,
          })) as Employee[]
        );
        setSelectedEmployeeId(user.id);
      } catch (error) {
        if (!isAuthErrorStatus(getErrorStatus(error))) {
          console.error('Error loading HGV inspection setup data:', error);
        }
      }
    };

    void loadData();
  }, [authLoading, canManageCrossUserInspections, permissionLoading, supabase, user]);

  useEffect(() => {
    if (
      draftId &&
      user &&
      !loadingRef.current &&
      loadedDraftIdRef.current !== draftId &&
      activeDraftLoadIdRef.current !== draftId
    ) {
      isDraftHydratedRef.current = false;
      const timer = setTimeout(() => {
        void loadDraftInspection(draftId);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      if (!draftId) {
        loadedDraftIdRef.current = null;
      }
      isDraftHydratedRef.current = true;
    }
  }, [draftId, user, loadDraftInspection]);

  useEffect(() => {
    if (user?.id) {
      setRecentHgvIds(getRecentVehicleIds(user.id, 'hgvs'));
    }
  }, [user?.id]);

  useEffect(() => {
    const persistDraft = () => {
      if (existingInspectionId && !isDraftHydratedRef.current) return;
      if (
        loadingRef.current ||
        saveInspectionInFlightRef.current ||
        draftSavePromiseRef.current ||
        allowNavigationRef.current
      ) return;
      void autoSaveDraftRef.current?.();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistDraft();
      }
    };

    const handlePageHide = () => persistDraft();
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [existingInspectionId]);

  useEffect(() => {
    if (!existingInspectionId) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveInspectionInFlightRef.current || allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [existingInspectionId]);

  useEffect(() => {
    if (!existingInspectionId) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (saveInspectionInFlightRef.current || allowNavigationRef.current) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }

      const nextUrl = new URL(rawHref, window.location.origin);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;

      const nextPathWithSearch = `${nextUrl.pathname}${nextUrl.search}`;
      const currentPathWithSearch = `${currentUrl.pathname}${currentUrl.search}`;
      if (nextPathWithSearch === currentPathWithSearch) return;

      event.preventDefault();
      event.stopPropagation();
      requestNavigation({ type: 'href', href: nextPathWithSearch });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [existingInspectionId, requestNavigation]);

  useEffect(() => {
    if (!checklistStarted || !inspectionStartMs) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [checklistStarted, inspectionStartMs]);

  useEffect(() => {
    if (!existingInspectionId || !inspectionStartMs) return;
    if (typeof window === 'undefined') return;
    const timerKey = getInspectionTimerStorageKey(existingInspectionId);
    const hasStoredTimer = window.sessionStorage.getItem(timerKey);
    if (!hasStoredTimer) {
      window.sessionStorage.setItem(timerKey, String(inspectionStartMs));
    }
  }, [existingInspectionId, inspectionStartMs]);

  const elapsedSeconds = useMemo(() => {
    if (!inspectionStartMs) return 0;
    return Math.max(0, Math.floor((nowMs - inspectionStartMs) / 1000));
  }, [inspectionStartMs, nowMs]);

  const remainingSeconds = Math.max(0, MIN_HGV_INSPECTION_SECONDS - elapsedSeconds);
  const canSubmitNow = checklistStarted && inspectionStartMs !== null && remainingSeconds === 0;

  const countdownLabel = useMemo(() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [remainingSeconds]);

  const loadLockedDefects = async (
    selectedHgvId: string,
    mode: 'replace' | 'merge' = 'replace'
  ) => {
    const requestId = ++lockedDefectsRequestIdRef.current;
    try {
      const [lockedResponse, recentCompletedResponse] = await Promise.all([
        fetch(`/api/hgv-inspections/locked-defects?hgvId=${selectedHgvId}`),
        fetch(`/api/hgv-inspections/recent-completed-defects?hgvId=${selectedHgvId}&days=7`),
      ]);

      if (requestId !== lockedDefectsRequestIdRef.current) return;

      if (!lockedResponse.ok) {
        setRecentlyCompletedDefects(new Map());
        setConfirmedRepeatDefects(new Set());
        return;
      }
      const { lockedItems } = await lockedResponse.json();
      const recentCompletedItems = recentCompletedResponse.ok
        ? ((await recentCompletedResponse.json()) as {
            recentlyCompletedItems: Array<{ signature: string; completedAt: string }>;
          }).recentlyCompletedItems
        : [];

      if (requestId !== lockedDefectsRequestIdRef.current) return;

      const map = new Map<string, { comment: string; actionId: string }>();
      const initialStates: Record<string, InspectionStatus> = {};
      const initialComments: Record<string, string> = {};

      for (const item of lockedItems as Array<{ item_number: number; item_description?: string | null; status?: string; comment: string; actionId: string }>) {
        const itemNumber = resolveCurrentHgvChecklistItemNumber(item.item_description, item.item_number);
        const key = `${itemNumber}`;
        map.set(key, { comment: item.comment, actionId: item.actionId });
        initialStates[key] = 'attention';
        initialComments[key] = item.comment || '';
      }

      const recentCompletedMap = new Map<string, RecentCompletedDefect>();
      recentCompletedItems.forEach((item) => {
        recentCompletedMap.set(resolveCurrentHgvDefectSignature(item.signature), { completedAt: item.completedAt });
      });

      setRecentlyCompletedDefects(recentCompletedMap);
      setConfirmedRepeatDefects(new Set());
      setLoggedDefects(map);
      if (mode === 'merge') {
        setCheckboxStates((prev) => ({ ...prev, ...initialStates }));
        setComments((prev) => ({ ...prev, ...initialComments }));
      } else {
        setCheckboxStates(initialStates);
        setComments(initialComments);
      }
    } catch {
      if (requestId !== lockedDefectsRequestIdRef.current) return;
      setRecentlyCompletedDefects(new Map());
      setConfirmedRepeatDefects(new Set());
      // Non-blocking.
    }
  };
  loadLockedDefectsRef.current = loadLockedDefects;

  const startInspection = async () => {
    if (!hgvId) {
      setError('Please select an HGV first');
      return;
    }
    if (!inspectionDate) {
      setError('Please select an inspection date');
      return;
    }
    const mileageValue = parseInt(currentMileage, 10);
    if (!currentMileage || Number.isNaN(mileageValue) || mileageValue < 0) {
      setError('Please enter a valid current KM');
      return;
    }

    if (!existingInspectionId) {
      const inspectionConflict = await findExistingInspectionConflict();
      if (inspectionConflict) {
        if (inspectionConflict.status === 'draft') {
          const merged = await mergeIntoExistingDraft(inspectionConflict.id);
          if (!merged) {
            return;
          }
        } else {
          handleInspectionConflict(inspectionConflict);
          return;
        }
      }
    }

    setError('');
    beginChecklist();
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const key = `${itemNumber}`;
    if (loggedDefects.has(key)) return;
    if (status === 'attention') {
      const itemDescription = TRUCK_CHECKLIST_ITEMS[itemNumber - 1];
      const defectSignature = buildInspectionDefectSignature({
        item_number: itemNumber,
        item_description: itemDescription,
      });
      const recentCompletedDefect = recentlyCompletedDefects.get(defectSignature);

      if (recentCompletedDefect && !confirmedRepeatDefects.has(defectSignature)) {
        setPendingRepeatDefect({
          itemNum: itemNumber,
          itemDesc: itemDescription,
          signature: defectSignature,
          completedAt: recentCompletedDefect.completedAt,
        });
        setShowRepeatDefectDialog(true);
        return;
      }
    }
    setCheckboxStates(prev => ({ ...prev, [key]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    const key = `${itemNumber}`;
    if (loggedDefects.has(key)) return;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const validate = () => {
    if (!hgvId) return 'Please select an HGV';
    if (!inspectionDate) return 'Please select an inspection date';
    if (!selectedEmployeeId) return 'Please select an employee';

    const mileageValue = parseInt(currentMileage, 10);
    if (Number.isNaN(mileageValue) || mileageValue < 0) {
      return 'Please enter a valid current KM';
    }

    const selectedHgv = hgvs.find((candidate) => candidate.id === hgvId);
    const warningMessage = resolveDigitGrowthWarning(currentMileage, selectedHgv?.current_mileage ?? null);
    if (warningMessage) {
      setDigitGrowthWarning(warningMessage);
      if (!digitGrowthConfirmed) {
        setShowDigitGrowthWarningDialog(true);
        return 'Please confirm the current KM is correct before submitting';
      }
    }

    if (!checklistStarted) {
      return 'Click Start Daily Check before completing the checklist';
    }

    const missingStatus = TRUCK_CHECKLIST_ITEMS
      .map((label, idx) => ({ label, key: `${idx + 1}` }))
      .filter(item => !checkboxStates[item.key]);
    if (missingStatus.length > 0) {
      return `Please complete all checklist items before submitting (${missingStatus.length} remaining)`;
    }

    const defectsWithoutComments = Object.entries(checkboxStates)
      .filter(([itemKey, status]) =>
        status === 'attention' &&
        !loggedDefects.has(itemKey) &&
        !comments[itemKey]?.trim()
      );
    if (defectsWithoutComments.length > 0) {
      return 'Please add comments for all failed items';
    }

    if (informWorkshop && inspectorComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      return `Workshop notification requires at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters in notes`;
    }

    if (!canSubmitNow) {
      return `HGV inspections require a 10 minute minimum duration. Remaining: ${countdownLabel}`;
    }

    return null;
  };

  const scrollToValidationTarget = () => {
    const scroll = (el: Element | null) =>
      scrollAndHighlightValidationTarget(el, STICKY_NAV_OFFSET_PX);

    if (!hgvId) {
      scroll(document.getElementById('hgv'));
      return;
    }

    if (!inspectionDate) {
      scroll(document.getElementById('inspectionDate'));
      return;
    }

    if (!selectedEmployeeId) {
      scroll(document.getElementById('selectedEmployeeId'));
      return;
    }

    const mileageValue = parseInt(currentMileage, 10);
    if (Number.isNaN(mileageValue) || mileageValue < 0) {
      scroll(document.getElementById('currentMileage'));
      return;
    }

    const selectedHgv = hgvs.find((candidate) => candidate.id === hgvId);
    const warningMessage = resolveDigitGrowthWarning(currentMileage, selectedHgv?.current_mileage ?? null);
    if (warningMessage && !digitGrowthConfirmed) {
      scroll(document.getElementById('currentMileage'));
      return;
    }

    const firstMissingStatus = TRUCK_CHECKLIST_ITEMS
      .map((_, idx) => `${idx + 1}`)
      .find((itemKey) => !checkboxStates[itemKey]);
    if (firstMissingStatus) {
      scroll(document.querySelector(`[data-checklist-item="${firstMissingStatus}"]`));
      return;
    }

    const firstMissingComment = Object.entries(checkboxStates)
      .find(([itemKey, status]) =>
        status === 'attention' &&
        !loggedDefects.has(itemKey) &&
        !comments[itemKey]?.trim()
      );
    if (firstMissingComment) {
      const [itemKey] = firstMissingComment;
      scroll(document.querySelector(`[data-comment-input="${itemKey}"]`));
      return;
    }

    if (informWorkshop && inspectorComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      scroll(document.getElementById('inspectorComments'));
    }
  };

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || saveInspectionInFlightRef.current) return;
    saveInspectionInFlightRef.current = true;
    setLoading(true);
    setError('');

    try {
      if (status === 'submitted') {
        const validationError = validate();
        if (validationError) {
          setError(validationError);
          setLoading(false);
          return;
        }
      }

      if (!hgvId || !inspectionDate || !selectedEmployeeId) {
        throw new Error('Select an HGV, employee and date before saving');
      }

      const mileageValue = parseInt(currentMileage, 10);
      if (Number.isNaN(mileageValue) || mileageValue < 0) {
        throw new Error('Please enter a valid current KM');
      }

      const inspectionPayload: InspectionInsert = {
        hgv_id: hgvId,
        user_id: selectedEmployeeId,
        inspection_date: inspectionDate,
        inspection_end_date: inspectionDate,
        current_mileage: mileageValue,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: status === 'submitted' ? signatureData || null : null,
        signed_at: status === 'submitted' && signatureData ? new Date().toISOString() : null,
        inspector_comments: inspectorComments.trim() || null,
      };

      let inspectionId = existingInspectionId;

      if (existingInspectionId) {
        const { data: updatedInspection, error: updateError } = await supabase
          .from('hgv_inspections')
          .update(inspectionPayload)
          .eq('id', existingInspectionId)
          .select('id')
          .single();

        if (updateError || !updatedInspection) {
          throw updateError || new Error('Failed to update inspection');
        }
        inspectionId = updatedInspection.id;
      } else {
        const { data: newInspection, error: insertInspectionError } = await supabase
          .from('hgv_inspections')
          .insert(inspectionPayload)
          .select('id')
          .single();

        if (insertInspectionError || !newInspection) {
          throw insertInspectionError || new Error('Failed to create inspection');
        }
        inspectionId = newInspection.id;
        setExistingInspectionId(newInspection.id);
        window.history.replaceState(null, '', `/hgv-inspections/new?id=${newInspection.id}`);
      }

      if (!inspectionId) {
        throw new Error('Failed to resolve inspection id');
      }

      if (existingInspectionId) {
        const { error: deleteItemsError } = await supabase
          .from('inspection_items')
          .delete()
          .eq('inspection_id', existingInspectionId);
        if (deleteItemsError) {
          throw deleteItemsError;
        }
      }

      const dayOfWeek = getDayOfWeek(new Date(`${inspectionDate}T00:00:00`));
      const itemsToInsert: InspectionItemInsert[] = [];
      TRUCK_CHECKLIST_ITEMS.forEach((itemDescription, idx) => {
        const itemNumber = idx + 1;
        const key = `${itemNumber}`;
        const itemStatus = checkboxStates[key];

        if (!itemStatus) {
          return;
        }

        itemsToInsert.push({
          inspection_id: inspectionId,
          item_number: itemNumber,
          item_description: itemDescription,
          day_of_week: dayOfWeek,
          status: itemStatus,
          comments: comments[key] || null,
        });
      });

      type InsertedItem = {
        id: string;
        item_number: number;
        item_description: string;
        day_of_week: number | null;
        status: InspectionStatus;
        comments: string | null;
      };
      let insertedItems: InsertedItem[] = [];

      if (itemsToInsert.length > 0) {
        const { data, error: insertItemsError } = await supabase
          .from('inspection_items')
          .insert(itemsToInsert)
          .select('id, item_number, item_description, day_of_week, status, comments');

        if (insertItemsError) {
          throw insertItemsError;
        }
        insertedItems = (data || []) as InsertedItem[];
      }

      if (status === 'submitted') {
        const { error: updateHgvMileageError } = await supabase
          .from('hgvs')
          .update({ current_mileage: mileageValue })
          .eq('id', hgvId);

        if (updateHgvMileageError) {
          throw updateHgvMileageError;
        }
      }

      const failedItems = insertedItems.filter((item) => item.status === 'attention');
      if (status === 'submitted' && failedItems.length > 0) {
        const defects = failedItems.map((item: InsertedItem) => ({
          item_number: item.item_number,
          item_description: item.item_description,
          dayOfWeek: item.day_of_week,
          comment: item.comments || '',
          primaryInspectionItemId: item.id,
        }));

        await fetch('/api/hgv-inspections/sync-defect-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId,
            hgvId,
            createdBy: user.id,
            defects,
            confirmedRepeatDefectSignatures: Array.from(confirmedRepeatDefects),
          }),
        });
      }

      if (status === 'submitted' && informWorkshop && inspectorComments.trim().length >= WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
        await fetch('/api/hgv-inspections/inform-workshop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId,
            hgvId,
            createdBy: user.id,
            comments: inspectorComments.trim(),
          }),
        });
      }

      if (status === 'submitted') {
        try {
          await completeInspectionReminder({
            assetType: 'hgv',
            assetId: hgvId,
            assignedTo: selectedEmployeeId,
          });
        } catch (reminderError) {
          console.warn('Reminder completion skipped after HGV daily check submission:', reminderError);
        }

        toast.success('HGV inspection submitted successfully');
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(getInspectionTimerStorageKey(inspectionId));
        }
        allowNavigationRef.current = true;
        router.push(`/hgv-inspections/${inspectionId}`);
      } else {
        toast.success('Draft saved');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save inspection';
      const errorContextId = 'hgv-inspections-new-save-inspection-error';
      console.error('Error saving HGV inspection:', err, { errorContextId });
      setError(message);
      toast.error(message, { id: errorContextId });
    } finally {
      saveInspectionInFlightRef.current = false;
      setLoading(false);
    }
  };

  const onSubmitClicked = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      scrollToValidationTarget();
      return;
    }
    setShowSignatureDialog(true);
  };

  const handleBackButtonClick = () => {
    requestNavigation({ type: 'back' });
  };

  const handleStayOnPage = () => {
    setPendingNavigation(null);
    setShowDiscardDraftDialog(false);
  };

  const handleDiscardAndContinueNavigation = async () => {
    if (!pendingNavigation) {
      setShowDiscardDraftDialog(false);
      return;
    }

    if (!existingInspectionId) {
      setShowDiscardDraftDialog(false);
      const nextNavigation = pendingNavigation;
      setPendingNavigation(null);
      navigateWithoutPrompt(nextNavigation);
      return;
    }

    setDiscardingDraft(true);
    const discarded = await discardDraftById(existingInspectionId, false);
    setDiscardingDraft(false);
    if (!discarded) {
      return;
    }

    setShowDiscardDraftDialog(false);
    const nextNavigation = pendingNavigation;
    setPendingNavigation(null);
    navigateWithoutPrompt(nextNavigation);
  };

  const handleViewSubmittedConflictInspection = () => {
    if (!submittedConflictInspectionId) return;
    allowNavigationRef.current = true;
    setShowSubmittedConflictDialog(false);
    const inspectionId = submittedConflictInspectionId;
    setSubmittedConflictInspectionId(null);
    router.push(`/hgv-inspections/${inspectionId}`);
  };

  const handleUseDifferentDateForSubmittedConflict = () => {
    setShowSubmittedConflictDialog(false);
    setSubmittedConflictInspectionId(null);
    setError('A daily check is already submitted for this employee, HGV and date. Choose a different date or employee to continue.');
    scrollAndHighlightValidationTarget(document.getElementById('inspectionDate'), STICKY_NAV_OFFSET_PX);
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-muted-foreground'}`} />;
      case 'na':
        return <span className={`text-sm md:text-xs font-extrabold tracking-wide ${isSelected ? 'text-blue-200' : 'text-muted-foreground'}`}>N/A</span>;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50';
    if (status === 'ok') return 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20';
    if (status === 'attention') return 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20';
    if (status === 'na') return 'bg-blue-500/20 border-blue-400 shadow-lg shadow-blue-500/20';
    return 'bg-slate-500/20 border-slate-400 shadow-lg shadow-slate-500/20';
  };

  const getStatusOptions = (itemNumber: number): InspectionStatus[] =>
    isArticOnlyItem(itemNumber) ? ['ok', 'attention', 'na'] : ['ok', 'attention'];

  const completedItems = Object.keys(checkboxStates).length;
  const totalItems = TRUCK_CHECKLIST_ITEMS.length;
  const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  if (showPermissionLoader) {
    return <PageLoader message="Loading HGV inspection form..." />;
  }

  return (
    <div className={`space-y-4 max-w-6xl ${tabletModeEnabled ? 'pb-36' : 'pb-32 md:pb-6'}`}>
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="icon"
              onClick={handleBackButtonClick}
              className="border-slate-600 text-white bg-slate-900/50 hover:bg-slate-800"
              aria-label="Back"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">New HGV Daily Check</h1>
              <p className="text-sm text-muted-foreground hidden md:block">Daily safety check</p>
            </div>
          </div>
          {hgvId && (
            <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-muted-foreground">Progress</div>
              <div className="text-lg font-bold text-foreground">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
        {hgvId && (
          <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-inspection transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Daily Check Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            {inspectionDate ? `Date: ${formatDate(inspectionDate)}` : 'Select a date'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageCrossUserInspections && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label className="text-foreground text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating daily check for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="selectedEmployeeId" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.id === user?.id ? ' (You)' : ''}
                      {employee.has_module_access === false ? ' - No HGV Checks access' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hgv" className="text-foreground text-base flex items-center gap-2">
                HGV
                <span className="text-red-400">*</span>
              </Label>
              <Select
                value={hgvId}
                disabled={checklistStarted}
                onValueChange={(value) => {
                  setHgvId(value);
                  setShowDigitGrowthWarningDialog(false);
                  if (user?.id) {
                    const updatedRecent = recordRecentVehicleId(user.id, value, 3, 'hgvs');
                    setRecentHgvIds(updatedRecent);
                  }
                  setCheckboxStates({});
                  setComments({});
                  setLoggedDefects(new Map());
                  setRecentlyCompletedDefects(new Map());
                  setConfirmedRepeatDefects(new Set());
                  setPendingRepeatDefect(null);
                  setShowRepeatDefectDialog(false);
                  if (value) {
                    void loadLockedDefects(value, 'replace');
                  }
                }}
              >
                <SelectTrigger id="hgv" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select an HGV" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const { recentVehicles, otherVehicles } = splitVehiclesByRecent(hgvs, recentHgvIds);
                    return (
                      <>
                        {recentVehicles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                            {recentVehicles.map((hgv) => (
                              <SelectItem key={hgv.id} value={hgv.id}>
                                {hgv.reg_number} {hgv.nickname ? `- ${hgv.nickname}` : ''} ({hgv.hgv_categories?.name || 'Uncategorised'})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {recentVehicles.length > 0 && otherVehicles.length > 0 && (
                          <SelectSeparator className="bg-slate-700" />
                        )}
                        {otherVehicles.length > 0 && (
                          <SelectGroup>
                            {recentVehicles.length > 0 && (
                              <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All HGVs</SelectLabel>
                            )}
                            {otherVehicles.map((hgv) => (
                              <SelectItem key={hgv.id} value={hgv.id}>
                                {hgv.reg_number} {hgv.nickname ? `- ${hgv.nickname}` : ''} ({hgv.hgv_categories?.name || 'Uncategorised'})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspectionDate" className="text-foreground text-base flex items-center gap-2">
                Daily Check Date
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="inspectionDate"
                type="date"
                value={inspectionDate}
                onChange={(e) => {
                  setError('');
                  setInspectionDate(e.target.value);
                }}
                max={formatDateISO(new Date())}
                disabled={checklistStarted}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
                required
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="currentMileage" className="text-foreground text-base flex items-center gap-2">
                Current KM
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="currentMileage"
                type="number"
                min="0"
                step="1"
                value={currentMileage}
                onChange={(e) => {
                  setCurrentMileage(e.target.value);
                  setShowDigitGrowthWarningDialog(false);
                }}
                placeholder={(() => {
                  const selectedHgv = hgvs.find((hgv) => hgv.id === hgvId);
                  return selectedHgv?.current_mileage != null ? `e.g. ${selectedHgv.current_mileage}` : 'e.g. 245000';
                })()}
                className={`h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
                  digitGrowthWarning && !digitGrowthConfirmed ? 'border-amber-500' : ''
                }`}
                required
              />
              {digitGrowthWarning && !digitGrowthConfirmed && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-amber-400">{digitGrowthWarning}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowDigitGrowthWarningDialog(true)}
                        className="mt-2 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                      >
                        Confirm KM is Correct
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {digitGrowthWarning && digitGrowthConfirmed && (
                <p className="text-xs text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  KM confirmed
                </p>
              )}
            </div>

            {!checklistStarted ? (
              <Button
                onClick={startInspection}
                disabled={!hgvId || !inspectionDate || !currentMileage}
                className="w-full md:w-auto h-12 bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold whitespace-nowrap"
              >
                <Timer className="h-4 w-4 mr-2" />
                Start Daily Check
              </Button>
            ) : (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-400">
                  <Info className="h-4 w-4 inline mr-2" />
                  Daily check started. The submit button unlocks after 10 minutes.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {checklistStarted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground">{TRUCK_CHECKLIST_ITEMS.length}-Point HGV Safety Check</CardTitle>
            <CardDescription className="text-muted-foreground">
              Mark each item as Pass or Fail (items {HGV_ARTIC_ONLY_START_ITEM}-{HGV_ARTIC_ONLY_END_ITEM} also allow N/A)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 md:p-6">
            <div className={tabletModeEnabled ? 'hidden' : 'hidden md:block overflow-x-auto'}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 w-12 font-medium text-white">#</th>
                    <th className="text-left p-3 font-medium text-white">Item</th>
                    <th className="text-center p-3 w-64 font-medium text-white">Status</th>
                    <th className="text-left p-3 font-medium text-white">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {TRUCK_CHECKLIST_ITEMS.map((item, index) => {
                    const itemNumber = index + 1;
                    const key = `${itemNumber}`;
                    const currentStatus = checkboxStates[key];
                    const isLocked = loggedDefects.has(key);
                    const statusOptions = getStatusOptions(itemNumber);
                    return (
                      <Fragment key={itemNumber}>
                        {itemNumber === HGV_ARTIC_ONLY_START_ITEM && (
                          <tr className="bg-blue-500/10 border-y border-blue-400/40">
                            <td colSpan={4} className="p-2 text-center text-xs font-semibold tracking-wide text-blue-200 uppercase">
                              Artics only
                            </td>
                          </tr>
                        )}
                        <tr data-checklist-item={key} className={`border-b border-border/50 hover:bg-slate-800/30 ${isLocked ? 'bg-red-500/5' : ''}`}>
                          <td className="p-3 text-sm text-muted-foreground">{itemNumber}</td>
                          <td className="p-3 text-sm text-white">
                            {item}
                            {isLocked && <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">LOCKED</Badge>}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              {statusOptions.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => handleStatusChange(itemNumber, status)}
                                  disabled={isLocked}
                                  className={`flex flex-col items-center justify-center w-14 h-14 rounded-lg border-2 transition-all ${getStatusColor(status, currentStatus === status)} ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  {getStatusIcon(status, currentStatus === status)}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="p-3">
                            <Input
                              id={`hgv-comment-${itemNumber}`}
                              data-comment-input={key}
                              value={comments[key] || ''}
                              onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                              placeholder={currentStatus === 'attention' ? 'Required for failed items' : 'Optional notes'}
                              readOnly={isLocked}
                              className={`bg-slate-900/50 border-slate-600 text-white ${currentStatus === 'attention' && !comments[key] && !isLocked ? 'border-red-500' : ''} ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                            />
                            {currentStatus === 'attention' && !isLocked && (() => {
                              const dayOfWeek = inspectionDate ? getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) : 1;
                              const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                              return (
                                <div className="mt-3">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      const id = await ensureDraftSaved();
                                      if (id) setPhotoUploadItem({ itemNumber, dayOfWeek });
                                    }}
                                    disabled={savingDraftForPhoto}
                                    title={itemPhotos.length > 0 ? `${itemPhotos.length} photo(s) saved` : 'Add photo'}
                                    className={`h-10 min-w-24 gap-1.5 text-xs ${
                                      itemPhotos.length > 0
                                        ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                                        : 'border-border text-muted-foreground hover:text-white'
                                    }`}
                                  >
                                    <Camera className="h-3.5 w-3.5" />
                                    {savingDraftForPhoto ? 'Saving...' : itemPhotos.length > 0 ? `${itemPhotos.length} saved` : 'Add photo'}
                                  </Button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={tabletModeEnabled ? 'space-y-3' : 'md:hidden space-y-3'}>
              {TRUCK_CHECKLIST_ITEMS.map((item, index) => {
                const itemNumber = index + 1;
                const key = `${itemNumber}`;
                const currentStatus = checkboxStates[key];
                const isLocked = loggedDefects.has(key);
                const statusOptions = getStatusOptions(itemNumber);
                return (
                  <Fragment key={itemNumber}>
                    {itemNumber === HGV_ARTIC_ONLY_START_ITEM && (
                      <div className="rounded-md border border-blue-400/50 bg-blue-500/10 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-blue-200">
                        Artics only
                      </div>
                    )}
                    <div data-checklist-item={key} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${isLocked ? 'border-red-500/50 bg-red-500/5' : 'border-border/50'}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                          <span className="text-sm font-bold text-muted-foreground">{itemNumber}</span>
                        </div>
                        <div className="flex-1">
                          <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                          {isLocked && (
                            <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/30">
                              LOCKED DEFECT
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className={`grid ${statusOptions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                        {statusOptions.map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleStatusChange(itemNumber, status)}
                            disabled={isLocked}
                            className={`flex flex-col items-center justify-center h-14 rounded-xl border-3 transition-all ${getStatusColor(status, currentStatus === status)} ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {getStatusIcon(status, currentStatus === status)}
                          </button>
                        ))}
                      </div>
                      {(currentStatus === 'attention' || comments[key]) && (
                        <div className="space-y-2">
                          <Label className="text-foreground text-sm">
                            {currentStatus === 'attention' ? 'Comments (Required)' : 'Notes'}
                          </Label>
                          <Textarea
                            id={`hgv-comment-${itemNumber}`}
                            data-comment-input={key}
                            value={comments[key] || ''}
                            onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                            placeholder="Add details..."
                            readOnly={isLocked}
                            className={`min-h-[80px] bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
                              currentStatus === 'attention' && !comments[key] && !isLocked ? 'border-red-500' : ''
                            } ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                          />
                        </div>
                      )}
                      {currentStatus === 'attention' && !isLocked && (() => {
                        const dayOfWeek = inspectionDate ? getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) : 1;
                        const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                        return (
                          <InspectionPhotoTiles
                            photos={itemPhotos}
                            onManage={async () => {
                              const id = await ensureDraftSaved();
                              if (id) setPhotoUploadItem({ itemNumber, dayOfWeek });
                            }}
                            title={`Item #${itemNumber} photos`}
                            description={`Uploaded photos for ${item}.`}
                            emptyLabel={savingDraftForPhoto ? 'Saving draft...' : 'Add / View Photos'}
                            emptyHint="No photos saved yet"
                            manageLabel="Add / View"
                          />
                        );
                      })()}
                    </div>
                  </Fragment>
                );
              })}
            </div>

            <div className="mt-6 p-4 bg-slate-800/40 border border-border/50 rounded-lg space-y-4">
              <div className="space-y-2">
                <Label className="text-white text-base">
                  End of Daily Check Notes <span className="text-muted-foreground text-sm">(Optional)</span>
                </Label>
                <Textarea
                  id="inspectorComments"
                  value={inspectorComments}
                  onChange={(e) => setInspectorComments(e.target.value)}
                  placeholder="Do not add any notes regarding a reported defect. Only add additional notes NOT linked to a defect..."
                  className="min-h-[100px] bg-slate-900/50 border-slate-600 text-white"
                  maxLength={500}
                />
              </div>
              {hasOptionalInspectorComment && (
                <div className="flex items-start space-x-3 p-3 bg-slate-900/30 rounded-lg border border-border/30">
                  <Checkbox
                    id="inform-workshop"
                    checked={informWorkshop}
                    onCheckedChange={(checked) => setInformWorkshop(checked === true)}
                    className="mt-0.5 border-slate-500 data-[state=checked]:bg-workshop data-[state=checked]:border-workshop"
                  />
                  <div className="flex-1">
                    <Label htmlFor="inform-workshop" className="text-white cursor-pointer">Inform Workshop</Label>
                    <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-workshop/35 bg-workshop/10 px-2.5 py-1.5 text-xs text-workshop/90">
                      <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-workshop" />
                      <span className="leading-5">
                        Do not tick &quot;Inform Workshop&quot; for defects already reported above. A failed item already creates a workshop task.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={tabletModeEnabled ? 'hidden' : 'hidden md:flex flex-row gap-3 justify-end pt-4'}>
              <Button
                onClick={onSubmitClicked}
                disabled={loading || !canSubmitNow}
                className="bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold disabled:opacity-70"
              >
                <Send className="h-4 w-4 mr-2" />
                {canSubmitNow ? 'Submit Daily Check' : `Submit available in ${countdownLabel}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {checklistStarted && (
        <div className={`${tabletModeEnabled ? 'fixed bottom-0 left-0 right-0' : 'md:hidden fixed bottom-0 left-0 right-0'} bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20`}>
          <Button
            onClick={onSubmitClicked}
            disabled={loading || !canSubmitNow}
            className="w-full h-14 bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold text-base disabled:opacity-70"
          >
            <Send className="h-5 w-5 mr-2" />
            {canSubmitNow ? 'Submit Daily Check' : `Submit in ${countdownLabel}`}
          </Button>
        </div>
      )}

      <AlertDialog
        open={showDiscardDraftDialog}
        onOpenChange={(open) => {
          setShowDiscardDraftDialog(open);
          if (!open) setPendingNavigation(null);
        }}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard draft inspection?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Leaving this page will discard your hidden HGV draft so it does not block another check for this HGV today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStayOnPage} disabled={discardingDraft}>
              Stay on page
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await handleDiscardAndContinueNavigation();
              }}
              disabled={discardingDraft}
              className="bg-red-600 hover:bg-red-700"
            >
              {discardingDraft ? 'Discarding...' : 'Discard and leave'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showSubmittedConflictDialog}
        onOpenChange={(open) => {
          setShowSubmittedConflictDialog(open);
          if (!open) setSubmittedConflictInspectionId(null);
        }}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Daily check already submitted</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              An HGV daily check already exists for this employee, vehicle and date. You can view the submitted check or pick another date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUseDifferentDateForSubmittedConflict}>
              Choose different date
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleViewSubmittedConflictInspection}>
              View existing check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showRepeatDefectDialog} onOpenChange={(open) => {
        if (!open && pendingRepeatDefect) {
          setPendingRepeatDefect(null);
        }
        setShowRepeatDefectDialog(open);
      }}>
        <DialogContent className={dialogContentViewportClassName({ size: 'lg', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Repeat Defect
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This same checklist item was recently completed by workshop.
            </DialogDescription>
          </DialogHeader>

          {pendingRepeatDefect && (
            <div className="py-4 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-sm text-amber-200">
                  <strong>Item {pendingRepeatDefect.itemNum}:</strong> {pendingRepeatDefect.itemDesc}
                </p>
                <p className="text-xs text-amber-300 mt-2">
                  The most recent workshop task for this defect was completed on{' '}
                  {formatDate(pendingRepeatDefect.completedAt)}.
                </p>
                <p className="text-xs text-amber-300 mt-2">
                  Please confirm this is a new defect before logging it again.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRepeatDefectDialog(false);
                setPendingRepeatDefect(null);
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingRepeatDefect) {
                  return;
                }

                const key = `${pendingRepeatDefect.itemNum}`;
                setCheckboxStates((prev) => ({ ...prev, [key]: 'attention' }));
                setConfirmedRepeatDefects((prev) => new Set(prev).add(pendingRepeatDefect.signature));
                setShowRepeatDefectDialog(false);
                setPendingRepeatDefect(null);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Yes, log new defect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDigitGrowthWarningDialog} onOpenChange={setShowDigitGrowthWarningDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: 'md', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Confirm KM Entry</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Your KM reading needs confirmation before submission.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-200">{digitGrowthWarning}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter only the FULL KM reading and ignore any fractional part.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDigitGrowthWarningDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Edit KM
            </Button>
            <Button
              onClick={() => {
                setDigitGrowthConfirmed(true);
                setShowDigitGrowthWarningDialog(false);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Confirm KM is Correct
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: 'lg', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Daily Check</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Sign below to confirm your inspection is accurate.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              disabled={loading}
              onSave={async (signatureData: string) => {
                setShowSignatureDialog(false);
                await saveInspection('submitted', signatureData);
              }}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {photoUploadItem && existingInspectionId && (
        <PhotoUpload
          inspectionId={existingInspectionId}
          itemNumber={photoUploadItem.itemNumber}
          dayOfWeek={photoUploadItem.dayOfWeek}
          onClose={() => setPhotoUploadItem(null)}
          onUploadComplete={() => {
            void refreshInspectionPhotos();
          }}
        />
      )}
    </div>
  );
}

export default function NewHgvInspectionPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading HGV inspection form..." />}>
      <NewHgvInspectionContent />
    </Suspense>
  );
}
