'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/page-loader';
import { Send, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Info, User, Camera, ArrowLeft } from 'lucide-react';
import { formatDateISO, formatDate, getDayOfWeek } from '@/lib/utils/date';
import { InspectionStatus } from '@/types/inspection';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { Database } from '@/types/database';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { buildInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';
import { scrollAndHighlightValidationTarget } from '@/lib/utils/validation-scroll';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import { getRecentVehicleIds, recordRecentVehicleId, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { getReadingDigitGrowthWarning } from '@/lib/utils/readingDigitGrowthWarning';
import { getInspectionErrorMessage, isDuplicateInspectionError, isMissingDraftError } from '@/lib/utils/inspection-error-handling';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { completeInspectionReminder } from '@/lib/client/complete-inspection-reminder';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

// Dynamic imports for heavy components
const PhotoUpload = dynamic(() => import('@/components/forms/PhotoUpload'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });

// Type definitions
type InspectionItem = {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  day_of_week: number;
  comments?: string | null;
};

type PlantWithCategory = {
  id: string;
  plant_id: string;
  nickname?: string | null;
  van_categories?: { name: string } | null;
};

type InspectionWithRelations = {
  id: string;
  user_id: string;
  plant_id: string;
  inspection_date: string;
  inspection_end_date: string;
  status: string;
  plant?: PlantWithCategory;
  inspection_items?: InspectionItem[];
};
type RecentCompletedDefect = { completedAt: string };

type PendingNavigation = { type: 'href'; href: string } | { type: 'back' };
type ExistingInspectionConflict = { id: string; status: 'draft' | 'submitted' };

const STICKY_NAV_OFFSET_PX = 96;

function NewPlantInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
  const { user, profile, effectiveRole, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { loading: permissionLoading } = usePermissionCheck('plant-inspections');
  const { canManageInspections: canManageCrossUserInspections } = getInspectionVisibilityFlags({
    teamName: effectiveRole?.team_name ?? profile?.team?.name,
    isManager,
    isAdmin,
    isSuperAdmin,
  });
  const { tabletModeEnabled } = useTabletMode();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;
  
  const [plants, setPlants] = useState<Array<{ 
    id: string; 
    plant_id: string; 
    nickname?: string | null;
    current_hours?: number | null;
    van_categories?: { name: string } | null;
  }>>([]);
  const [recentPlantIds, setRecentPlantIds] = useState<string[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  
  // Current hours state (single value, like vehicle mileage)
  const [currentHours, setCurrentHours] = useState('');
  const [digitGrowthWarning, setDigitGrowthWarning] = useState<string | null>(null);
  const [digitGrowthConfirmed, setDigitGrowthConfirmed] = useState(false);
  const [showDigitGrowthWarningDialog, setShowDigitGrowthWarningDialog] = useState(false);
  // Track original current_mileage for backward compatibility with old drafts
  const [originalCurrentMileage, setOriginalCurrentMileage] = useState<number | null | undefined>(undefined);
  
  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const currentChecklist = PLANT_INSPECTION_ITEMS;
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const saveInspectionInFlightRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const [error, setError] = useState('');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [, setSignature] = useState<string | null>(null);
  const [showConfirmSubmitDialog, setShowConfirmSubmitDialog] = useState(false);
  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(draftId);
  const existingInspectionIdRef = useRef<string | null>(draftId);
  existingInspectionIdRef.current = existingInspectionId;
  const isDraftHydratedRef = useRef(!draftId);
  const draftSavePromiseRef = useRef<Promise<string | null> | null>(null);
  const activeDraftLoadIdRef = useRef<string | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);
  const loadLockedDefectsRef = useRef<((plantId: string, mode?: 'replace' | 'merge') => Promise<void>) | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [submittedConflictInspectionId, setSubmittedConflictInspectionId] = useState<string | null>(null);
  const [showSubmittedConflictDialog, setShowSubmittedConflictDialog] = useState(false);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Logged defects tracking
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
  
  const [checklistStarted, setChecklistStarted] = useState(false);
  
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number } | null>(null);
  const [savingDraftForPhoto, setSavingDraftForPhoto] = useState(false);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(existingInspectionId, {
    enabled: Boolean(existingInspectionId),
  });
  
  // End of inspection comment + inform workshop states
  const [inspectorComments, setInspectorComments] = useState('');
  const [informWorkshop, setInformWorkshop] = useState(false);
  const hasOptionalInspectorComment = inspectorComments.trim().length > 0;

  const getPhotosForItem = useCallback(
    (itemNumber: number, dayOfWeek: number) =>
      photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [],
    [photoMap]
  );

  const [, setCreatingWorkshopTask] = useState(false);

  // Hired plant states
  const HIRED_PLANT_SENTINEL = '__hired__';
  const [isHiredPlant, setIsHiredPlant] = useState(false);
  const [hiredPlantIdSerial, setHiredPlantIdSerial] = useState('');
  const [hiredPlantDescription, setHiredPlantDescription] = useState('');
  const [hiredPlantHiringCompany, setHiredPlantHiringCompany] = useState('');

  const showPermissionLoader = permissionLoading;

  useEffect(() => {
    if (!hasOptionalInspectorComment && informWorkshop) {
      setInformWorkshop(false);
    }
  }, [hasOptionalInspectorComment, informWorkshop]);

  const findExistingInspectionConflict = useCallback(async (): Promise<ExistingInspectionConflict | null> => {
    if (!inspectionDate || inspectionDate.trim() === '' || !selectedEmployeeId) return null;

    const hiredSerial = hiredPlantIdSerial.trim();
    if (isHiredPlant) {
      if (!hiredSerial) return null;
    } else if (!selectedPlantId) {
      return null;
    }

    let query = supabase
      .from('plant_inspections')
      .select('id, status')
      .eq('inspection_date', inspectionDate)
      .eq('user_id', selectedEmployeeId)
      .limit(1);

    if (isHiredPlant) {
      query = query
        .eq('is_hired_plant', true)
        .eq('hired_plant_id_serial', hiredSerial);
    } else {
      query = query.eq('plant_id', selectedPlantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      const status = getErrorStatus(error);
      if (!isAuthErrorStatus(status) && !isNetworkFetchError(error)) {
        console.error('Failed to check for existing plant inspection:', error, {
          errorContextId: 'plant-inspections-new-check-existing-error',
        });
      }
      return null;
    }

    if (!data || data.id === existingInspectionId) {
      return null;
    }

    return {
      id: data.id,
      status: data.status as 'draft' | 'submitted',
    };
  }, [existingInspectionId, hiredPlantIdSerial, inspectionDate, isHiredPlant, selectedEmployeeId, selectedPlantId, supabase]);

  const handleSubmittedInspectionConflict = useCallback((inspectionId: string) => {
    setSubmittedConflictInspectionId(inspectionId);
    setShowSubmittedConflictDialog(true);
    toast.info('A daily check has already been submitted for this employee, asset and date.');
  }, []);

  const buildCurrentInspectionItemsPayload = useCallback((inspectionId: string) => {
    if (!inspectionDate) return [] as Database['public']['Tables']['inspection_items']['Insert'][];

    const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
    const items: Database['public']['Tables']['inspection_items']['Insert'][] = [];

    currentChecklist.forEach((item, index) => {
      const itemNumber = index + 1;
      const key = `${itemNumber}`;
      if (checkboxStates[key]) {
        items.push({
          inspection_id: inspectionId,
          item_number: itemNumber,
          item_description: item,
          day_of_week: dayOfWeek,
          status: checkboxStates[key],
          comments: comments[key] || null,
        });
      }
    });

    return items;
  }, [checkboxStates, comments, currentChecklist, inspectionDate]);

  const getParsedHours = useCallback((): number | null => {
    if (!currentHours || currentHours.trim() === '') return null;
    const hoursValue = parseInt(currentHours, 10);
    if (Number.isNaN(hoursValue) || hoursValue < 0) return null;
    return hoursValue;
  }, [currentHours]);

  const resolveDigitGrowthWarning = useCallback(
    (rawHours: string, previousHours: number | null | undefined): string | null => {
      if (!rawHours || rawHours.trim() === '') return null;
      const hoursValue = parseInt(rawHours, 10);
      if (Number.isNaN(hoursValue) || hoursValue < 0) return null;
      return (
        getReadingDigitGrowthWarning({
          enteredReading: hoursValue,
          previousReading: previousHours,
          unitName: 'hours',
        }).warning || null
      );
    },
    []
  );

  useEffect(() => {
    if (isHiredPlant) {
      setDigitGrowthWarning(null);
      setDigitGrowthConfirmed(true);
      return;
    }

    const selectedPlant = plants.find((plant) => plant.id === selectedPlantId);
    const warningMessage = resolveDigitGrowthWarning(currentHours, selectedPlant?.current_hours ?? null);
    setDigitGrowthWarning(warningMessage);
    if (!warningMessage) {
      setDigitGrowthConfirmed(true);
      return;
    }
    setDigitGrowthConfirmed(false);
  }, [currentHours, isHiredPlant, plants, resolveDigitGrowthWarning, selectedPlantId]);

  const mergeIntoExistingDraft = useCallback(async (
    inspectionId: string,
    options: { showToast?: boolean } = {}
  ): Promise<boolean> => {
    const { showToast = true } = options;
    const errorContextId = 'plant-inspections-new-merge-draft-error';
    if (!selectedEmployeeId || !inspectionDate) {
      toast.error('Select an employee and inspection date before continuing', {
        id: 'plant-inspections-new-validation-missing-employee-date',
      });
      return false;
    }
    if (!isHiredPlant && !selectedPlantId) {
      toast.error('Select a plant before continuing', { id: 'plant-inspections-new-validation-missing-plant' });
      return false;
    }
    if (isHiredPlant && !hiredPlantIdSerial.trim()) {
      toast.error('Enter the hired plant ID / serial before continuing', {
        id: 'plant-inspections-new-validation-missing-hired-serial',
      });
      return false;
    }

    const payload: Database['public']['Tables']['plant_inspections']['Update'] = {
      plant_id: isHiredPlant ? null : selectedPlantId,
      user_id: selectedEmployeeId,
      inspection_date: inspectionDate,
      inspection_end_date: inspectionDate,
      current_mileage: getParsedHours(),
      status: 'draft',
      submitted_at: null,
      signature_data: null,
      signed_at: null,
      inspector_comments: inspectorComments.trim() || null,
      is_hired_plant: isHiredPlant,
      hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() : null,
      hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() : null,
      hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() : null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: updatedDraft, error: updateError } = await supabase
        .from('plant_inspections')
        .update(payload)
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
      setSubmittedConflictInspectionId(null);
      setShowSubmittedConflictDialog(false);
      window.history.replaceState(null, '', `/plant-inspections/new?id=${inspectionId}`);
      if (showToast) {
        toast.info('Merged with existing draft for this plant and date.');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not merge with existing draft';
      if (isNetworkFetchError(err) || isMissingDraftError(err)) {
        console.warn('Plant draft merge temporarily unavailable:', err, { errorContextId });
      } else if (!isAuthErrorStatus(getErrorStatus(err))) {
        console.error('Failed to merge into existing plant draft:', err, { errorContextId });
      }
      if (showToast && !isAuthErrorStatus(getErrorStatus(err))) {
        toast.error(message, { id: errorContextId });
      }
      return false;
    }
  }, [
    buildCurrentInspectionItemsPayload,
    getParsedHours,
    hiredPlantDescription,
    hiredPlantHiringCompany,
    hiredPlantIdSerial,
    inspectionDate,
    inspectorComments,
    isHiredPlant,
    selectedEmployeeId,
    selectedPlantId,
    supabase,
  ]);

  const discardDraftById = useCallback(async (inspectionId: string, showToast = true): Promise<boolean> => {
    try {
      const response = await fetch(`/api/plant-inspections/${inspectionId}/discard`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to discard draft');
      }

      if (existingInspectionId === inspectionId) {
        setExistingInspectionId(null);
        setPhotoUploadItem(null);
        window.history.replaceState(null, '', '/plant-inspections/new');
      }

      if (showToast) {
        toast.success('Draft discarded');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to discard draft';
      const errorContextId = 'plant-inspections-new-discard-draft-error';
      console.error('Failed to discard plant draft:', err, { errorContextId });
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
        router.push('/plant-inspections');
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
            toast.error('Could not auto-save draft. Please try again.', { id: 'plant-inspections-new-autosave-draft-error' });
          }
          return merged ? existingInspectionId : null;
        } finally {
          saveInspectionInFlightRef.current = false;
        }
      }
      if (!user || !selectedEmployeeId) {
        if (!silent) toast.error('Select an employee before adding photos', {
          id: 'plant-inspections-new-validation-photos-employee-required',
        });
        return null;
      }
      if (!isHiredPlant && !selectedPlantId) {
        if (!silent) toast.error('Select a plant before adding photos', {
          id: 'plant-inspections-new-validation-photos-plant-required',
        });
        return null;
      }
      if (!inspectionDate || inspectionDate.trim() === '') {
        if (!silent) toast.error('Select an inspection date before adding photos', {
          id: 'plant-inspections-new-validation-photos-date-required',
        });
        return null;
      }
      if (saveInspectionInFlightRef.current) {
        return existingInspectionIdRef.current;
      }

      saveInspectionInFlightRef.current = true;
      setSavingDraftForPhoto(true);
      try {
        const conflict = await findExistingInspectionConflict();
        if (conflict) {
          if (conflict.status === 'draft') {
            const merged = await mergeIntoExistingDraft(conflict.id, { showToast: !silent });
            return merged ? conflict.id : null;
          }
          handleSubmittedInspectionConflict(conflict.id);
          return null;
        }

        const { data: draft, error: draftError } = await supabase
          .from('plant_inspections')
          .insert({
            plant_id: isHiredPlant ? null : selectedPlantId,
            user_id: selectedEmployeeId,
            inspection_date: inspectionDate,
            inspection_end_date: inspectionDate,
            current_mileage: getParsedHours(),
            status: 'draft' as const,
            inspector_comments: inspectorComments.trim() || null,
            is_hired_plant: isHiredPlant,
            hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() : null,
            hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() : null,
            hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() : null,
          })
          .select('id')
          .single();

        if (draftError) {
          if (draftError.code === '23505') {
            const retryConflict = await findExistingInspectionConflict();
            if (retryConflict) {
              if (retryConflict.status === 'draft') {
                const merged = await mergeIntoExistingDraft(retryConflict.id, { showToast: !silent });
                return merged ? retryConflict.id : null;
              }
              handleSubmittedInspectionConflict(retryConflict.id);
              return null;
            }
          }
          throw draftError;
        }

        const items = buildCurrentInspectionItemsPayload(draft.id);
        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('inspection_items')
            .insert(items);
          if (itemsError) throw itemsError;
        }

        setExistingInspectionId(draft.id);
        setSubmittedConflictInspectionId(null);
        setShowSubmittedConflictDialog(false);
        window.history.replaceState(null, '', `/plant-inspections/new?id=${draft.id}`);
        return draft.id;
      } catch (err) {
        const errorContextId = 'plant-inspections-new-silent-draft-save-error';
        if (isNetworkFetchError(err)) {
          console.warn('Silent plant draft save skipped due transient network error', { errorContextId });
        } else if (isMissingDraftError(err)) {
          console.warn('Silent plant draft save skipped because the draft no longer exists', {
            errorContextId,
            existingInspectionId: existingInspectionId || null,
          });
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

  useEffect(() => {
    if (authLoading || permissionLoading || !user) {
      return;
    }

    const fetchPlants = async () => {
      try {
        const { data, error } = await supabase
          .from('plant')
          .select(`
            *,
            van_categories (
              name
            )
          `)
          .eq('status', 'active')
          .order('plant_id');

        if (error) throw error;
        setPlants(data || []);
      } catch (err) {
        if (!isAuthErrorStatus(getErrorStatus(err))) {
          console.error('Error fetching plants:', err);
          setError('Failed to load plants');
        }
      }
    };

    void fetchPlants();
  }, [authLoading, permissionLoading, supabase, user]);

  const loadDraftInspection = useCallback(async (id: string) => {
    if (activeDraftLoadIdRef.current === id || loadedDraftIdRef.current === id) {
      return;
    }

    activeDraftLoadIdRef.current = id;
    try {
      loadingRef.current = true;
      isDraftHydratedRef.current = false;
      setLoading(true);
      setError('');
      const currentUserId = user?.id;
      if (!currentUserId) {
        setError('You must be logged in to edit an inspection');
        return;
      }

      const { data: inspection, error: inspectionError } = await supabase
        .from('plant_inspections')
        .select(`
          *,
          plant (
            id,
            plant_id,
            nickname,
            van_categories (name)
          )
        `)
        .eq('id', id)
        .maybeSingle();

      if (inspectionError) throw inspectionError;
      if (!inspection) {
        setError('Draft inspection could not be found or is no longer available');
        return;
      }

      if (!canManageCrossUserInspections && inspection.user_id !== user?.id) {
        setError('You do not have permission to edit this inspection');
        return;
      }

      if (inspection.status !== 'draft') {
        setError('Only draft inspections can be edited here');
        isDraftHydratedRef.current = true;
        return;
      }

      const { data: items, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', id)
        .order('item_number');

      if (itemsError) throw itemsError;

      setExistingInspectionId(id);
      setSubmittedConflictInspectionId(null);
      setShowSubmittedConflictDialog(false);
      const inspectionData = inspection as InspectionWithRelations;
      
      if (inspection.is_hired_plant) {
        setIsHiredPlant(true);
        setSelectedPlantId('');
        setRecentlyCompletedDefects(new Map());
        setConfirmedRepeatDefects(new Set());
        setHiredPlantIdSerial(inspection.hired_plant_id_serial || '');
        setHiredPlantDescription(inspection.hired_plant_description || '');
        setHiredPlantHiringCompany(inspection.hired_plant_hiring_company || '');
      } else {
        setIsHiredPlant(false);
        setSelectedPlantId(inspectionData.plant?.id || '');
      }
      
      setInspectionDate(inspection.inspection_date || formatDateISO(new Date()));
      setSelectedEmployeeId(inspection.user_id);

      setOriginalCurrentMileage(inspection.current_mileage);
      setCurrentHours(inspection.current_mileage?.toString() || '');

      const newCheckboxStates: Record<string, InspectionStatus> = {};
      const newComments: Record<string, string> = {};
      
      (items as InspectionItem[] | null)?.forEach((item: InspectionItem) => {
        const key = `${item.item_number}`;
        const existing = newCheckboxStates[key];
        if (existing && existing === 'attention') return;
        newCheckboxStates[key] = item.status;
        if (item.comments) {
          newComments[key] = item.comments;
        }
      });

      setCheckboxStates(newCheckboxStates);
      setComments(newComments);
      
      if (Object.keys(newCheckboxStates).length > 0) {
        setChecklistStarted(true);
      }

      if (!inspection.is_hired_plant && inspectionData.plant?.id) {
        void loadLockedDefectsRef.current?.(inspectionData.plant.id, 'merge');
      }

      loadedDraftIdRef.current = id;
      toast.success('Draft inspection loaded');
    } catch (err) {
      const errorContextId = 'plant-inspections-new-load-draft-error';
      if (isNetworkFetchError(err)) {
        console.warn('Unable to load plant draft inspection (network):', err, { errorContextId });
        setError('Could not load draft inspection because the network request failed. Please refresh and try again.');
        toast.error('Could not load draft inspection. Please refresh and try again.', { id: errorContextId });
      } else {
        if (!isAuthErrorStatus(getErrorStatus(err))) {
          console.error('Error loading draft inspection:', err, { errorContextId });
        }
        setError(getInspectionErrorMessage(err, 'Failed to load draft inspection'));
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
      setRecentPlantIds(getRecentVehicleIds(user.id, 'plant'));
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

    window.addEventListener('pagehide', persistDraft);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', persistDraft);
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
    if (user && canManageCrossUserInspections) {
      const fetchEmployees = async () => {
        try {
          const typedProfiles = await fetchUserDirectory({ module: 'plant-inspections' });
          const formattedEmployees: Employee[] = typedProfiles
            .map((emp) => ({
              id: emp.id,
              full_name: emp.full_name || 'Unnamed User',
              employee_id: emp.employee_id || null,
              has_module_access: emp.has_module_access,
            }))
            .sort((a: Employee, b: Employee) => a.full_name.localeCompare(b.full_name));
          
          setEmployees(formattedEmployees);
          
          if (user) {
            setSelectedEmployeeId(user.id);
          }
        } catch (err) {
          const status = getErrorStatus(err);
          if (!isAuthErrorStatus(status) && !isNetworkFetchError(err)) {
            console.error('Error fetching employees:', err);
          }
        }
      };

      fetchEmployees();
    } else if (user) {
      setSelectedEmployeeId(user.id);
    }
  }, [canManageCrossUserInspections, user]);

  const loadLockedDefects = async (plantId: string, mode: 'replace' | 'merge' = 'replace') => {
    try {
      const [lockedResponse, recentCompletedResponse] = await Promise.all([
        fetch(`/api/plant-inspections/locked-defects?plantId=${plantId}`),
        fetch(`/api/plant-inspections/recent-completed-defects?plantId=${plantId}&days=7`),
      ]);
      
      if (lockedResponse.ok) {
        const { lockedItems } = await lockedResponse.json();
        const recentCompletedItems = recentCompletedResponse.ok
          ? ((await recentCompletedResponse.json()) as {
              recentlyCompletedItems: Array<{ signature: string; completedAt: string }>;
            }).recentlyCompletedItems
          : [];
        
        const loggedMap = new Map<string, { comment: string; actionId: string }>();
        const recentCompletedMap = new Map<string, RecentCompletedDefect>();

        recentCompletedItems.forEach((item) => {
          recentCompletedMap.set(item.signature, { completedAt: item.completedAt });
        });
        
        lockedItems.forEach((item: { item_number?: string; status?: string; comment?: string; actionId?: string }) => {
          const key = `${item.item_number ?? ''}`;
          const statusLabel = 
            item.status === 'pending' ? 'pending' :
            item.status === 'on_hold' ? 'on hold' :
            item.status === 'logged' ? 'logged' :
            'in progress';
          loggedMap.set(key, {
            comment: item.comment || `Defect ${statusLabel} with workshop`,
            actionId: item.actionId ?? ''
          });
        });

        setRecentlyCompletedDefects(recentCompletedMap);
        setConfirmedRepeatDefects(new Set());
        setLoggedDefects(loggedMap);
        const newCheckboxStates: Record<string, InspectionStatus> = {};
        const newComments: Record<string, string> = {};

        loggedMap.forEach((loggedInfo, itemNum) => {
          newCheckboxStates[itemNum] = 'attention';
          newComments[itemNum] = loggedInfo.comment ?? '';
        });

        if (mode === 'merge') {
          setCheckboxStates((prev) => ({ ...prev, ...newCheckboxStates }));
          setComments((prev) => ({ ...prev, ...newComments }));
        } else {
          setCheckboxStates(newCheckboxStates);
          setComments(newComments);
        }
      } else {
        console.error('Failed to fetch locked defects');
        setRecentlyCompletedDefects(new Map());
        setConfirmedRepeatDefects(new Set());
        setError('Warning: Unable to check for existing defects. Please refresh the page before continuing.');
      }
    } catch (err) {
      console.error('Error loading locked defects:', err);
      setLoggedDefects(new Map());
      setRecentlyCompletedDefects(new Map());
      setConfirmedRepeatDefects(new Set());
    }
  };
  loadLockedDefectsRef.current = loadLockedDefects;

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const key = `${itemNumber}`;
    
    if (!checklistStarted) {
      setChecklistStarted(true);
    }

    if (status === 'attention') {
      const itemDescription = currentChecklist[itemNumber - 1];
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
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const handleSubmit = () => {
    if (!existingInspectionId) {
      setShowConfirmSubmitDialog(true);
      return;
    }
    
    validateAndSubmit();
  };

  const scrollToTarget = (el: Element | null) =>
    scrollAndHighlightValidationTarget(el, STICKY_NAV_OFFSET_PX);

  const validateAndSubmit = () => {
    if (!isHiredPlant && !selectedPlantId) {
      setError('Please select a plant');
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('plant'));
      return;
    }

    if (isHiredPlant) {
      if (!hiredPlantIdSerial.trim()) {
        setError('Please enter the hired plant ID / serial number');
        setShowConfirmSubmitDialog(false);
        scrollToTarget(document.getElementById('hiredPlantId'));
        return;
      }
      if (!hiredPlantDescription.trim()) {
        setError('Please enter a plant description');
        setShowConfirmSubmitDialog(false);
        scrollToTarget(document.getElementById('hiredPlantDesc'));
        return;
      }
      if (!hiredPlantHiringCompany.trim()) {
        setError('Please enter the hiring company');
        setShowConfirmSubmitDialog(false);
        scrollToTarget(document.getElementById('hiredPlantCompany'));
        return;
      }
    }

    const hoursValue = getParsedHours();
    // Allow null hours only for existing inspections that originally had null (backward compatibility)
    const isOldDraftWithoutHours = existingInspectionId && originalCurrentMileage === null;
    if (hoursValue === null && !isOldDraftWithoutHours) {
      setError('Please enter a valid current hours reading');
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('currentHours'));
      return;
    }

    if (!isHiredPlant && hoursValue !== null) {
      const selectedPlant = plants.find((plant) => plant.id === selectedPlantId);
      const warningMessage = resolveDigitGrowthWarning(currentHours, selectedPlant?.current_hours ?? null);
      if (warningMessage) {
        setDigitGrowthWarning(warningMessage);
        if (!digitGrowthConfirmed) {
          setError('Please confirm the current hours reading before submitting');
          setShowDigitGrowthWarningDialog(true);
          setShowConfirmSubmitDialog(false);
          scrollToTarget(document.getElementById('currentHours'));
          return;
        }
      }
    }

    // Validate: every checklist item must have a status selected
    const missingItems: string[] = [];
    currentChecklist.forEach((item, index) => {
      const key = `${index + 1}`;
      if (!checkboxStates[key]) {
        missingItems.push(item);
      }
    });

    if (missingItems.length > 0) {
      setError(`Please select Pass, Fail, or N/A for all items. Missing: ${missingItems.slice(0, 3).join(', ')}${missingItems.length > 3 ? ` and ${missingItems.length - 3} more` : ''}`);
      toast.error('Incomplete checklist', {
        id: 'plant-inspections-new-validation-incomplete-checklist',
        description: `${missingItems.length} item${missingItems.length > 1 ? 's' : ''} still need a status`,
      });
      setShowConfirmSubmitDialog(false);
      const firstMissingItemNumber = currentChecklist.findIndex((_, idx) => !checkboxStates[`${idx + 1}`]) + 1;
      scrollToTarget(document.querySelector(`[data-checklist-item="${firstMissingItemNumber}"]`));
      return;
    }

    // Validate: all defects must have comments
    const defectsWithoutComments: string[] = [];
    let firstDefectWithoutCommentKey: string | null = null;
    Object.entries(checkboxStates).forEach(([key, status]) => {
      if (status === 'attention' && !loggedDefects.has(key) && !comments[key]) {
        if (!firstDefectWithoutCommentKey) firstDefectWithoutCommentKey = key;
        const itemNumber = parseInt(key);
        const itemName = currentChecklist[itemNumber - 1] || `Item ${itemNumber}`;
        defectsWithoutComments.push(itemName);
      }
    });

    if (defectsWithoutComments.length > 0) {
      setError(`Please add comments for all defects: ${defectsWithoutComments.join(', ')}`);
      toast.error('Missing defect comments', {
        id: 'plant-inspections-new-validation-missing-defect-comments',
        description: `Please add comments for: ${defectsWithoutComments.slice(0, 3).join(', ')}${defectsWithoutComments.length > 3 ? '...' : ''}`,
      });
      setShowConfirmSubmitDialog(false);
      if (firstDefectWithoutCommentKey) {
        scrollToTarget(document.querySelector(`[data-comment-input="${firstDefectWithoutCommentKey}"]`));
      }
      return;
    }

    // Validate inform workshop (not applicable for hired plant)
    if (!isHiredPlant && informWorkshop && inspectorComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      setError(`Workshop notification requires at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters in the comment field`);
      toast.error('Comment too short', { id: 'plant-inspections-new-validation-workshop-comment-too-short' });
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('inspector-comments'));
      return;
    }
    
    setError('');
    setShowConfirmSubmitDialog(false);
    
    setTimeout(() => {
      setShowSignatureDialog(true);
    }, 100);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveInspection('submitted', sig);
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
    router.push(`/plant-inspections/${inspectionId}`);
  };

  const handleUseDifferentDateForSubmittedConflict = () => {
    setShowSubmittedConflictDialog(false);
    setSubmittedConflictInspectionId(null);
    setError('A daily check is already submitted for this employee, asset and date. Choose a different date or employee to continue.');
    scrollToTarget(document.getElementById('inspectionDate'));
  };

  const saveInspection = async (status: 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId) return;
    if (!isHiredPlant && !selectedPlantId) return;
    
    if (!inspectionDate || inspectionDate.trim() === '') {
      setError('Please select an inspection date');
      return;
    }

    if (loading || saveInspectionInFlightRef.current) {
      return;
    }

    saveInspectionInFlightRef.current = true;
    setError('');
    setLoading(true);

    try {
      let workingInspectionId = existingInspectionId;
      if (!workingInspectionId) {
        const inspectionConflict = await findExistingInspectionConflict();
        if (inspectionConflict) {
          if (inspectionConflict.status === 'draft') {
            const merged = await mergeIntoExistingDraft(inspectionConflict.id);
            if (!merged) {
              return;
            }
            workingInspectionId = inspectionConflict.id;
          } else {
            handleSubmittedInspectionConflict(inspectionConflict.id);
            return;
          }
        }
      }

      type InspectionInsert = Database['public']['Tables']['plant_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        plant_id: isHiredPlant ? null : selectedPlantId,
        user_id: selectedEmployeeId,
        inspection_date: inspectionDate,
        inspection_end_date: inspectionDate,
        current_mileage: getParsedHours(),
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
        inspector_comments: inspectorComments.trim() || null,
        is_hired_plant: isHiredPlant,
        hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() : null,
        hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() : null,
        hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() : null,
      };

      let inspection: { id: string };

      if (workingInspectionId) {
        const { data: existingItems, error: fetchError } = await supabase
          .from('inspection_items')
          .select('id')
          .eq('inspection_id', workingInspectionId);

        if (fetchError) throw new Error(`Failed to fetch existing items: ${fetchError.message}`);

        if (existingItems && existingItems.length > 0) {
          const { error: deleteError } = await supabase
            .from('inspection_items')
            .delete()
            .eq('inspection_id', workingInspectionId);

          if (deleteError) throw new Error(`Failed to delete existing items: ${deleteError.message}`);
        }

        inspection = { id: workingInspectionId };
      } else {
        const { data: newInspection, error: insertError } = await supabase
          .from('plant_inspections')
          .insert(inspectionData)
          .select()
          .single();

        if (insertError) throw insertError;
        inspection = newInspection;
      }

      if (!inspection) throw new Error('Failed to save inspection');

      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const items: InspectionItemInsert[] = [];
      const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
      
      currentChecklist.forEach((item, index) => {
        const itemNumber = index + 1;
        const key = `${itemNumber}`;
        
        if (checkboxStates[key]) {
          items.push({
            inspection_id: inspection.id,
            item_number: itemNumber,
            item_description: item,
            day_of_week: dayOfWeek,
            status: checkboxStates[key],
            comments: comments[key] || null,
          });
        }
      });

      let insertedItems: InspectionItem[] = [];
      if (items.length > 0) {
        const { data, error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items)
          .select();

        if (itemsError) throw new Error(`Failed to save inspection items: ${itemsError.message}`);
        
        insertedItems = (data || []) as InspectionItem[];
      }

      if (workingInspectionId) {
        type InspectionUpdate = Database['public']['Tables']['plant_inspections']['Update'];
        const inspectionUpdate: InspectionUpdate = {
          plant_id: isHiredPlant ? null : selectedPlantId,
          user_id: selectedEmployeeId,
          inspection_date: inspectionDate,
          inspection_end_date: inspectionDate,
          current_mileage: getParsedHours(),
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
          inspector_comments: inspectorComments.trim() || null,
          updated_at: new Date().toISOString(),
          is_hired_plant: isHiredPlant,
          hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() : null,
          hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() : null,
          hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() : null,
        };

        const { data: updatedInspection, error: updateError } = await supabase
          .from('plant_inspections')
          .update(inspectionUpdate)
          .eq('id', workingInspectionId)
          .select();

        if (updateError) throw updateError;
        
        if (!updatedInspection || updatedInspection.length === 0) {
          throw new Error('Failed to update inspection');
        }
        
        inspection = updatedInspection[0];
      }

      // Sync defect tasks (skip for hired plant)
      if (!isHiredPlant && insertedItems && insertedItems.length > 0) {
        const failedItems = insertedItems.filter((item: InspectionItem) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          const groupedDefects = new Map<string, { 
            item_number: number; 
            item_description: string; 
            days: number[]; 
            comments: string[];
            item_ids: string[];
          }>();

          failedItems.forEach((item: InspectionItem) => {
            const key = `${item.item_number}-${item.item_description}`;
            if (!groupedDefects.has(key)) {
              groupedDefects.set(key, {
                item_number: item.item_number,
                item_description: item.item_description,
                days: [],
                comments: [],
                item_ids: []
              });
            }
            const group = groupedDefects.get(key)!;
            group.days.push(item.day_of_week);
            group.item_ids.push(item.id);
            if (item.comments) {
              group.comments.push(item.comments);
            }
          });

          const defects = Array.from(groupedDefects.values()).map(group => ({
            item_number: group.item_number,
            item_description: group.item_description,
            days: group.days,
            comment: group.comments.length > 0 ? group.comments[0] : '',
            primaryInspectionItemId: group.item_ids[0]
          }));

          try {
            const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inspectionId: inspection.id,
                plantId: selectedPlantId,
                createdBy: user!.id,
                defects,
                confirmedRepeatDefectSignatures: Array.from(confirmedRepeatDefects),
              })
            });

            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log(`✅ Sync complete: ${syncResult.message}`);
            } else {
              const errorData = await syncResponse.json();
              throw new Error(errorData.error || 'Failed to sync defect tasks');
            }
          } catch (error) {
            const errorContextId = 'plant-inspections-new-sync-defect-tasks-error';
            console.error('Error syncing defect tasks:', error, { errorContextId });
            const errorMsg = error instanceof Error ? error.message : 'Failed to sync defect tasks';
            toast.error(`Warning: Inspection saved, but ${errorMsg}`, { id: errorContextId });
          }
        }
      }

      // Handle inform workshop (skip for hired plant)
      if (!isHiredPlant && informWorkshop && inspectorComments.trim().length >= WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
        try {
          setCreatingWorkshopTask(true);
          
          const informResponse = await fetch('/api/plant-inspections/inform-workshop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inspectionId: inspection.id,
              plantId: selectedPlantId,
              createdBy: user!.id,
              comments: inspectorComments.trim(),
            }),
          });

          if (informResponse.ok) {
            await informResponse.json();
            toast.success('Workshop task created');
          } else {
            const errorData = await informResponse.json();
            throw new Error(errorData.error || 'Failed to create workshop task');
          }
        } catch (informError) {
          const errorContextId = 'plant-inspections-new-inform-workshop-error';
          console.error('Error in inform-workshop flow:', informError, { errorContextId });
          const errorMsg = informError instanceof Error ? informError.message : 'Failed to create workshop task';
          setError(`Inspection saved, but workshop task creation failed: ${errorMsg}`);
          setLoading(false);
          setCreatingWorkshopTask(false);
          return;
        } finally {
          setCreatingWorkshopTask(false);
        }
      }

      if (!isHiredPlant) {
        try {
          await completeInspectionReminder({
            assetType: 'plant',
            assetId: selectedPlantId,
            assignedTo: selectedEmployeeId,
          });
        } catch (reminderError) {
          console.warn('Reminder completion skipped after plant daily check submission:', reminderError);
        }
      }

      toast.success('Daily check submitted successfully');
      allowNavigationRef.current = true;
      router.push('/plant-inspections');
    } catch (err) {
      const errorContextId = 'plant-inspections-new-save-inspection-error';
      const errMessage = getInspectionErrorMessage(err, 'An unexpected error occurred');

      if (isDuplicateInspectionError(err)) {
        const inspectionConflict = await findExistingInspectionConflict();
        if (inspectionConflict) {
          if (inspectionConflict.status === 'draft') {
            const merged = await mergeIntoExistingDraft(inspectionConflict.id);
            if (merged) {
              toast.info('Draft merged. Submit again to finish this daily check.');
            }
          } else {
            handleSubmittedInspectionConflict(inspectionConflict.id);
          }
        } else {
          setError('An inspection for this employee, asset and date already exists. Please select a different date or employee.');
          toast.error('Duplicate inspection', {
            id: 'plant-inspections-new-duplicate-inspection-error',
            description: 'An inspection already exists for this employee, asset and date.',
          });
        }
        return;
      }

      if (isNetworkFetchError(err)) {
        console.warn('Inspection save failed due transient network error', {
          errorContextId,
          plantId: selectedPlantId,
          inspectionDate,
          existingInspectionId: existingInspectionId || null,
        });
      } else {
        console.error('Error saving inspection:', err, {
          errorContextId,
          plantId: selectedPlantId,
          inspectionDate,
          existingInspectionId: existingInspectionId || null,
        });
      }

      toast.error('Failed to save inspection', {
        id: errorContextId,
        description: errMessage,
      });
    } finally {
      saveInspectionInFlightRef.current = false;
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-muted-foreground'}`} />;
      case 'na':
        return <span className={`text-sm md:text-xs font-extrabold tracking-wide ${isSelected ? 'text-slate-200' : 'text-muted-foreground'}`}>N/A</span>;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50';
    
    switch (status) {
      case 'ok':
        return 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20';
      case 'attention':
        return 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20';
      case 'na':
        return 'bg-slate-500/20 border-slate-400 shadow-lg shadow-slate-500/20';
      default:
        return 'bg-slate-800/30 border-border';
    }
  };

  const totalItems = currentChecklist.length;
  const completedItems = Object.keys(checkboxStates).length;
  const progressPercent = Math.round((completedItems / totalItems) * 100);

  if (showPermissionLoader) {
    return <PageLoader message="Loading plant inspection form..." />;
  }

  return (
    <div className={`space-y-4 max-w-6xl ${tabletModeEnabled ? 'pb-36' : 'pb-32 md:pb-6'}`}>
      
      {/* Header */}
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
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {existingInspectionId ? 'Edit Plant Daily Check' : 'New Plant Daily Check'}
              </h1>
              <p className="text-sm text-muted-foreground hidden md:block">
                Daily safety check
              </p>
            </div>
          </div>
          {(selectedPlantId || isHiredPlant) && (
            <div className="bg-plant-inspection/10 dark:bg-plant-inspection/20 border border-plant-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-muted-foreground">Progress</div>
              <div className="text-lg font-bold text-foreground">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
        {(selectedPlantId || isHiredPlant) && (
          <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-plant-inspection transition-all duration-300"
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

      {/* Plant Details Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Daily Check Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            {inspectionDate ? `Date: ${formatDate(inspectionDate)}` : 'Select a date'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager: Employee Selector */}
          {canManageCrossUserInspections && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label htmlFor="employee" className="text-foreground text-base flex items-center gap-2">
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
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.id === user?.id && ' (You)'}
                      {employee.has_module_access === false && ' - No Plant Checks access'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plant" className="text-foreground text-base flex items-center gap-2">
                Plant
                <span className="text-red-400">*</span>
              </Label>
              <Select 
                value={isHiredPlant ? HIRED_PLANT_SENTINEL : selectedPlantId} 
                disabled={checklistStarted}
                onValueChange={(value) => {
                  setShowDigitGrowthWarningDialog(false);
                  if (value === HIRED_PLANT_SENTINEL) {
                    setIsHiredPlant(true);
                    setSelectedPlantId('');
                    setLoggedDefects(new Map());
                    setRecentlyCompletedDefects(new Map());
                    setConfirmedRepeatDefects(new Set());
                    setPendingRepeatDefect(null);
                    setShowRepeatDefectDialog(false);
                    setCheckboxStates({});
                    setComments({});
                  } else {
                    setIsHiredPlant(false);
                    setHiredPlantIdSerial('');
                    setHiredPlantDescription('');
                    setHiredPlantHiringCompany('');
                    setSelectedPlantId(value);
                    if (user?.id) {
                      const updatedRecent = recordRecentVehicleId(user.id, value, 3, 'plant');
                      setRecentPlantIds(updatedRecent);
                    }
                    setRecentlyCompletedDefects(new Map());
                    setConfirmedRepeatDefects(new Set());
                    setPendingRepeatDefect(null);
                    setShowRepeatDefectDialog(false);
                    loadLockedDefects(value);
                  }
                }}
              >
                <SelectTrigger id="plant" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white" disabled={checklistStarted}>
                  <SelectValue placeholder="Select a plant" />
                </SelectTrigger>
                <SelectContent className="border-border max-h-[300px] md:max-h-[400px]">
                  <SelectItem value={HIRED_PLANT_SENTINEL} className="font-semibold !text-amber-400 focus:!text-amber-400">
                    Hired Plant
                  </SelectItem>
                  {plants.length > 0 && <SelectSeparator className="bg-slate-700" />}
                  {(() => {
                    const { recentVehicles: recentPlants, otherVehicles: otherPlants } = splitVehiclesByRecent(plants, recentPlantIds);
                    return (
                      <>
                        {recentPlants.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                            {recentPlants.map((plant) => (
                              <SelectItem key={plant.id} value={plant.id}>
                                {plant.plant_id} {plant.nickname ? `- ${plant.nickname}` : ''} ({plant.van_categories?.name || 'Uncategorized'})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {recentPlants.length > 0 && otherPlants.length > 0 && (
                          <SelectSeparator className="bg-slate-700" />
                        )}
                        {otherPlants.length > 0 && (
                          <SelectGroup>
                            {recentPlants.length > 0 && (
                              <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All Plants</SelectLabel>
                            )}
                            {otherPlants.map((plant) => (
                              <SelectItem key={plant.id} value={plant.id}>
                                {plant.plant_id} {plant.nickname ? `- ${plant.nickname}` : ''} ({plant.van_categories?.name || 'Uncategorized'})
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

          {/* Hired Plant Details */}
          {isHiredPlant && (
            <div className="p-4 bg-amber-500/5 border border-amber-500/30 rounded-lg space-y-4">
              <p className="text-sm font-medium text-amber-400">Hired Plant Details</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="hiredPlantId" className="text-foreground text-sm flex items-center gap-2">
                    Plant ID / Serial Number <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="hiredPlantId"
                    value={hiredPlantIdSerial}
                    onChange={(e) => setHiredPlantIdSerial(e.target.value)}
                    placeholder="e.g. SN-12345"
                    disabled={checklistStarted}
                    className="h-12 text-base bg-slate-900/50 border-slate-600 text-white"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hiredPlantDesc" className="text-foreground text-sm flex items-center gap-2">
                    Plant Description <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="hiredPlantDesc"
                    value={hiredPlantDescription}
                    onChange={(e) => setHiredPlantDescription(e.target.value)}
                    placeholder="e.g. 20T Excavator"
                    disabled={checklistStarted}
                    className="h-12 text-base bg-slate-900/50 border-slate-600 text-white"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hiredPlantCompany" className="text-foreground text-sm flex items-center gap-2">
                    Hiring Company <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="hiredPlantCompany"
                    value={hiredPlantHiringCompany}
                    onChange={(e) => setHiredPlantHiringCompany(e.target.value)}
                    placeholder="e.g. ABC Plant Hire Ltd"
                    disabled={checklistStarted}
                    className="h-12 text-base bg-slate-900/50 border-slate-600 text-white"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Current Hours */}
          <div className="space-y-2">
            <Label htmlFor="currentHours" className="text-foreground text-base flex items-center gap-2">
              Current Hours
              {!(existingInspectionId && originalCurrentMileage === null) && (
                <span className="text-red-400">*</span>
              )}
            </Label>
            <Input
              id="currentHours"
              type="number"
              value={currentHours}
              onChange={(e) => {
                setCurrentHours(e.target.value);
                setShowDigitGrowthWarningDialog(false);
              }}
              placeholder={(() => {
                const sel = plants.find(p => p.id === selectedPlantId);
                return sel?.current_hours != null ? `e.g. ${sel.current_hours}` : 'e.g. 45000';
              })()}
              min="0"
              step="1"
              className={`h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
                digitGrowthWarning && !digitGrowthConfirmed ? 'border-amber-500' : ''
              }`}
              required={!(existingInspectionId && originalCurrentMileage === null)}
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
                      Confirm Hours is Correct
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {digitGrowthWarning && digitGrowthConfirmed && (
              <p className="text-xs text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Hours confirmed
              </p>
            )}
            {existingInspectionId && originalCurrentMileage === null && (
              <p className="text-xs text-muted-foreground">
                Optional for this draft (created before current hours was required)
              </p>
            )}
          </div>
          
          {checklistStarted && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                <Info className="h-4 w-4 inline mr-2" />
                Plant and date are locked once you start filling the checklist.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Check */}
      {(selectedPlantId || isHiredPlant) && inspectionDate && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">{currentChecklist.length}-Point Plant Safety Check</CardTitle>
          <CardDescription className="text-muted-foreground">
            Mark each item as Pass, Fail, or N/A
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">

          {/* Mobile View */}
          <div className={tabletModeEnabled ? 'space-y-3' : 'md:hidden space-y-3'}>
            {currentChecklist.map((item, index) => {
              const itemNumber = index + 1;
              const key = `${itemNumber}`;
              const currentStatus = checkboxStates[key];
              const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
              const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
              
              const isLogged = loggedDefects.has(`${itemNumber}`);
        
              return (
                <div key={itemNumber} data-checklist-item={key} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${
                  isLogged ? 'border-red-500/50 bg-red-500/5' : 'border-border/50'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-muted-foreground">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                      {isLogged && (
                        <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/30">
                          LOCKED DEFECT
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(['ok', 'attention', 'na'] as InspectionStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                        disabled={isLogged}
                        className={`flex flex-col items-center justify-center h-14 rounded-xl border-3 transition-all ${
                          getStatusColor(status, currentStatus === status)
                        } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {getStatusIcon(status, currentStatus === status)}
                      </button>
                    ))}
                  </div>

                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-foreground text-sm">
                        {currentStatus === 'attention' ? (isLogged ? 'Manager Comment' : 'Comments (Required)') : 'Notes'}
                      </Label>
                      <Textarea
                        data-comment-input={key}
                        value={comments[key] || ''}
                        onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                        placeholder={isLogged ? '' : 'Add details...'}
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white ${
                          currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                        } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                        required={currentStatus === 'attention' && !isLogged}
                        readOnly={isLogged}
                      />
                    </div>
                  )}

                  {currentStatus === 'attention' && !isLogged && (
                    <InspectionPhotoTiles
                      photos={itemPhotos}
                      onManage={async () => {
                        const id = await ensureDraftSaved();
                        if (id) setPhotoUploadItem({ itemNumber, dayOfWeek: getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) });
                      }}
                      title={`Item #${itemNumber} photos`}
                      description={`Uploaded photos for ${item}.`}
                      emptyLabel={savingDraftForPhoto ? 'Saving draft...' : 'Add / View Photos'}
                      emptyHint="No photos saved yet"
                      manageLabel="Add / View"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop View */}
          <div className={tabletModeEnabled ? 'hidden' : 'hidden md:block overflow-x-auto'}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 w-12 font-medium text-white">#</th>
                  <th className="text-left p-3 font-medium text-white">Item</th>
                  <th className="text-center p-3 w-48 font-medium text-white">Status</th>
                  <th className="text-left p-3 font-medium text-white">Comments</th>
                  <th className="text-center p-3 w-20 font-medium text-white">Photo</th>
                </tr>
              </thead>
              <tbody>
                {currentChecklist.map((item, index) => {
                  const itemNumber = index + 1;
                  const key = `${itemNumber}`;
                  const currentStatus = checkboxStates[key];
                  const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
                  const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                  
                  const isLogged = loggedDefects.has(`${itemNumber}`);
                  
                  return (
                    <tr key={itemNumber} data-checklist-item={key} className={`border-b border-border/50 hover:bg-slate-800/30 ${
                      isLogged ? 'bg-red-500/5' : ''
                    }`}>
                      <td className="p-3 text-sm text-muted-foreground">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">
                        {item}
                        {isLogged && (
                          <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                            LOCKED
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          {(['ok', 'attention', 'na'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                              disabled={isLogged}
                              className={`flex flex-col items-center justify-center w-14 h-14 rounded-lg border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
                              title={status === 'ok' ? 'Pass' : status === 'attention' ? 'Fail' : 'N/A'}
                            >
                              {getStatusIcon(status, currentStatus === status)}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <Input
                          data-comment-input={key}
                          value={comments[key] || ''}
                          onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                          placeholder={isLogged ? '' : (currentStatus === 'attention' ? 'Required for defects' : 'Optional notes')}
                          className={`bg-slate-900/50 border-slate-600 text-white ${
                            currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                          } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                          readOnly={isLogged}
                        />
                      </td>
                      <td className="p-3 text-center align-middle">
                        {currentStatus === 'attention' && !isLogged ? (
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
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* End of Daily Check Comments */}
          <div className="mt-6 p-4 bg-slate-800/40 border border-border/50 rounded-lg">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inspector-comments" className="text-white text-base">
                  End of Daily Check Notes <span className="text-muted-foreground text-sm">(Optional)</span>
                </Label>
                <Textarea
                  id="inspector-comments"
                  value={inspectorComments}
                  onChange={(e) => setInspectorComments(e.target.value)}
                  placeholder="Do not add any notes regarding a reported defect. Only add additional notes NOT linked to a defect..."
                  className="min-h-[100px] bg-slate-900/50 border-slate-600 text-white"
                  maxLength={500}
                />
              </div>

              {isHiredPlant ? (
                <div className="p-3 bg-slate-900/30 rounded-lg border border-border/30">
                  <p className="text-xs text-muted-foreground">
                    Workshop tasks are not created for hired plant inspections.
                  </p>
                </div>
              ) : hasOptionalInspectorComment ? (
                <div className="flex items-start space-x-3 p-3 bg-slate-900/30 rounded-lg border border-border/30">
                  <Checkbox
                    id="inform-workshop"
                    checked={informWorkshop}
                    onCheckedChange={(checked) => setInformWorkshop(checked === true)}
                    className="mt-0.5 border-slate-500 data-[state=checked]:bg-workshop data-[state=checked]:border-workshop"
                  />
                  <div className="flex-1">
                    <Label 
                      htmlFor="inform-workshop" 
                      className="text-white cursor-pointer flex items-center gap-2"
                    >
                      Inform Workshop
                      <Badge variant="outline" className="text-xs border-workshop/50 text-workshop">
                        Creates Task
                      </Badge>
                    </Label>
                    <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-workshop/35 bg-workshop/10 px-2.5 py-1.5 text-xs text-workshop/90">
                      <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-workshop" />
                      <span className="leading-5">
                        Do not tick &quot;Inform Workshop&quot; for defects already reported above. A failed item already creates a workshop task.
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Desktop Action Buttons */}
          <div className={tabletModeEnabled ? 'hidden' : 'hidden md:flex flex-row gap-3 justify-end pt-4'}>
            <Button
              onClick={handleSubmit}
              disabled={loading || (!selectedPlantId && !isHiredPlant)}
              className="bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              {loading ? 'Submitting...' : 'Submit Daily Check'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Mobile Sticky Footer */}
      <div className={`${tabletModeEnabled ? 'fixed bottom-0 left-0 right-0' : 'md:hidden fixed bottom-0 left-0 right-0'} bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20`}>
        <Button
          onClick={handleSubmit}
          disabled={loading || (!selectedPlantId && !isHiredPlant)}
          className="w-full h-14 bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold text-base"
        >
          <Send className="h-5 w-5 mr-2" />
          {loading ? 'Submitting...' : 'Submit Daily Check'}
        </Button>
      </div>

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
              Leaving this page will discard your hidden Plant draft so it does not block another check for this asset today.
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
              A Plant daily check already exists for this employee, asset and date. You can view the submitted check or pick another date.
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

      {/* Confirmation Dialog */}
      <Dialog 
        open={showConfirmSubmitDialog} 
        onOpenChange={(open) => {
          if (!open && error) return;
          if (!open) setError('');
          setShowConfirmSubmitDialog(open);
        }}
      >
        <DialogContent className={dialogContentViewportClassName({ size: 'md', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Confirm Submission</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Before you submit, please confirm
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-400 font-semibold mb-1">Validation Error</p>
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
              <p className="text-slate-200">
                Have you completed this plant inspection for {inspectionDate ? formatDate(inspectionDate) : 'today'}?
              </p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Plant inspections should be submitted <strong className="text-white">daily</strong>.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setShowConfirmSubmitDialog(false);
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={validateAndSubmit}
              className="bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              Submit Daily Check
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle className="text-white text-xl">Confirm Hours Entry</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Your hours reading needs confirmation before submission.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-200">{digitGrowthWarning}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter only the FULL hours reading and ignore any fractional part.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDigitGrowthWarningDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Edit Hours
            </Button>
            <Button
              onClick={() => {
                setDigitGrowthConfirmed(true);
                setShowDigitGrowthWarningDialog(false);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Confirm Hours is Correct
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: 'lg', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Daily Check</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Sign below to confirm your inspection is accurate
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={handleSignatureComplete}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSignatureDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Upload Modal */}
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

export default function NewPlantInspectionPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading plant inspection form..." />}>
      <NewPlantInspectionContent />
    </Suspense>
  );
}
