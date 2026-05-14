'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { getRecentVehicleIds, recordRecentVehicleId, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { isUuid } from '@/lib/utils/uuid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/page-loader';
import { Save, Send, CheckCircle2, XCircle, AlertCircle, Info, User, Plus, Check, Camera, AlertTriangle } from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import { formatDateISO, formatDate, getWeekEnding } from '@/lib/utils/date';
import { INSPECTION_ITEMS, InspectionStatus, getChecklistForCategory } from '@/types/inspection';
import { checkMileageSanity, formatMileage, type MileageSanityResult } from '@/lib/utils/mileageSanity';
import { getReadingDigitGrowthWarning } from '@/lib/utils/readingDigitGrowthWarning';
import { Database } from '@/types/database';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { getInspectionErrorMessage, isDuplicateInspectionError } from '@/lib/utils/inspection-error-handling';
import { getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { buildInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';
import { type PreviousDefectSummary } from '@/lib/utils/inspectionPreviousDefects';
import { scrollAndHighlightValidationTarget } from '@/lib/utils/validation-scroll';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import {
  findVanInspectionOverlap,
  formatVanInspectionDayList,
  getInspectionDaysFromRows,
  getStartedVanInspectionDays,
  type VanInspectionDayRow,
  type VanInspectionOverlapConflict,
} from '@/lib/utils/van-inspection-overlap';
import { isClientSessionPausedError } from '@/lib/app-auth/session-error';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';

// Dynamic imports for heavy components - loaded only when needed
const PhotoUpload = dynamic(() => import('@/components/forms/PhotoUpload'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const INVALID_VAN_SELECTION_MESSAGE = 'Please select a valid van';

// Type definitions for inspection data
type InspectionItem = {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  day_of_week: number;
  comments?: string | null;
};

type VehicleWithCategory = {
  id: string;
  reg_number: string;
  vehicle_type: string;
  van_categories?: { name: string } | null;
};

type InspectionWithRelations = {
  id: string;
  user_id: string;
  van_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: string;
  vans?: VehicleWithCategory;
  inspection_items?: InspectionItem[];
};

type LoggedAction = {
  id: string;
  status: string;
  logged_comment: string | null;
  inspection_items?: {
    item_number: number;
    item_description: string;
  } | null;
  van_inspections?: {
    van_id: string;
  };
};

type PreviousDefect = PreviousDefectSummary;
type RecentCompletedDefect = { completedAt: string };

type ExistingInspectionConflict = VanInspectionOverlapConflict;
type LoadPreviousDefectsOptions = {
  mode?: 'replace' | 'merge';
  baseCheckboxStates?: Record<string, InspectionStatus>;
  baseComments?: Record<string, string>;
};

const STICKY_NAV_OFFSET_PX = 96;

function isTransientNetworkError(error: unknown): boolean {
  if (isNetworkFetchError(error)) return true;

  const message = getInspectionErrorMessage(error, '').toLowerCase();
  if (!message) return false;

  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('err_internet_disconnected') ||
    message.includes('err_network_changed') ||
    message.includes('aborterror') ||
    message.includes('the user aborted a request')
  );
}

function NewInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id'); // Get draft ID from URL if editing
  const { user, profile, effectiveRole, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { loading: permissionLoading } = usePermissionCheck('inspections');
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
  
  const [vehicles, setVehicles] = useState<Array<{ 
    id: string; 
    reg_number: string; 
    vehicle_type: string;
    current_mileage?: number | null;
    van_categories?: { name: string } | null;
  }>>([]);
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [weekEnding, setWeekEnding] = useState('');
  const [activeDay, setActiveDay] = useState('0'); // 0-6 for Monday-Sunday
  const [currentMileage, setCurrentMileage] = useState('');
  // Store checkbox states as "dayOfWeek-itemNumber": status (e.g., "1-5": "ok")
  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const checkboxStatesRef = useRef<Record<string, InspectionStatus>>({});
  checkboxStatesRef.current = checkboxStates;
  const commentsRef = useRef<Record<string, string>>({});
  commentsRef.current = comments;
  // Dynamic checklist items based on selected vehicle category
  const [currentChecklist, setCurrentChecklist] = useState<string[]>(INSPECTION_ITEMS);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const [error, setError] = useState('');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [, setSignature] = useState<string | null>(null);
  const [showConfirmSubmitDialog, setShowConfirmSubmitDialog] = useState(false);
  const [savingDraftFromConfirm, setSavingDraftFromConfirm] = useState(false);
  const [showAddVehicleDialog, setShowAddVehicleDialog] = useState(false);
  const [newVehicleReg, setNewVehicleReg] = useState('');
  const [newVehicleCategoryId, setNewVehicleCategoryId] = useState('');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const addVehicleDialogContentRef = useRef<HTMLDivElement>(null);
  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(null);
  const existingInspectionIdRef = useRef<string | null>(null);
  existingInspectionIdRef.current = existingInspectionId;
  const inspectionWriteInProgressRef = useRef(false);
  const draftSavePromiseRef = useRef<Promise<string | null> | null>(null);
  const activeDraftLoadIdRef = useRef<string | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);
  const loadPreviousDefectsRef = useRef<((selectedVehicleId: string, options?: LoadPreviousDefectsOptions) => Promise<void>) | null>(null);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Resolution tracking states
  const [previousDefects, setPreviousDefects] = useState<Map<string, PreviousDefect>>(new Map());
  const [showResolutionDialog, setShowResolutionDialog] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<{ day: number; itemNum: number; itemDesc: string } | null>(null);
  const [resolutionComment, setResolutionComment] = useState('');
  const [resolvedItems, setResolvedItems] = useState<Map<string, string>>(new Map()); // key: "day-itemNum", value: resolution comment
  const [recentlyCompletedDefects, setRecentlyCompletedDefects] = useState<Map<string, RecentCompletedDefect>>(new Map());
  const [confirmedRepeatDefects, setConfirmedRepeatDefects] = useState<Set<string>>(new Set());
  const [showRepeatDefectDialog, setShowRepeatDefectDialog] = useState(false);
  const [pendingRepeatDefect, setPendingRepeatDefect] = useState<{
    day: number;
    itemNum: number;
    itemDesc: string;
    signature: string;
    completedAt: string;
  } | null>(null);
  
  // Logged defects tracking (read-only auto-marked items)
  const [loggedDefects, setLoggedDefects] = useState<Map<string, { comment: string; actionId: string }>>(new Map()); // key: "itemNum-itemDesc", value: { comment, actionId }
  
  // Track if user has started filling checklist (to lock vehicle/date fields)
  const [checklistStarted, setChecklistStarted] = useState(false);
  // Mileage sanity check states
  const [baselineMileage, setBaselineMileage] = useState<number | null>(null);
  const [, setBaselineMileageSource] = useState<string>('none');
  const [mileageWarning, setMileageWarning] = useState<MileageSanityResult | null>(null);
  const [digitGrowthWarning, setDigitGrowthWarning] = useState<string | null>(null);
  const [mileageConfirmed, setMileageConfirmed] = useState(false);
  const [showMileageWarningDialog, setShowMileageWarningDialog] = useState(false);
  
  // Photo upload state
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number } | null>(null);
  const [savingDraftForPhoto, setSavingDraftForPhoto] = useState(false);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(existingInspectionId, {
    enabled: Boolean(existingInspectionId),
  });
  
  // End of inspection comment + inform workshop states
  const [inspectorComments, setInspectorComments] = useState('');
  const [informWorkshop, setInformWorkshop] = useState(false);
  const [, setCreatingWorkshopTask] = useState(false);
  const hasOptionalInspectorComment = inspectorComments.trim().length > 0;

  const showPermissionLoader = permissionLoading;

  useEffect(() => {
    if (!hasOptionalInspectorComment && informWorkshop) {
      setInformWorkshop(false);
    }
  }, [hasOptionalInspectorComment, informWorkshop]);

  const getPhotosForItem = useCallback(
    (itemNumber: number, dayOfWeek: number) =>
      photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [],
    [photoMap]
  );

  const ensureDraftSaved = async (options: { silent?: boolean } = {}): Promise<string | null> => {
    if (draftSavePromiseRef.current) {
      return draftSavePromiseRef.current;
    }

    const pendingDraftSave = (async () => {
      const { silent = false } = options;
      if (!user || !selectedEmployeeId || !vehicleId) {
        if (!silent) toast.error('Select a vehicle, employee and week before adding photos', {
          id: 'van-inspections-new-validation-photos-core-fields',
        });
        return null;
      }
      if (!isUuid(vehicleId)) {
        if (!silent) {
          setError(INVALID_VAN_SELECTION_MESSAGE);
          toast.error(INVALID_VAN_SELECTION_MESSAGE, {
            id: 'van-inspections-new-invalid-vehicle-draft-save',
            description: 'Please reselect the van before continuing.',
          });
        }
        return null;
      }
      if (!weekEnding || weekEnding.trim() === '') {
        if (!silent) toast.error('Select a week ending date before adding photos', {
          id: 'van-inspections-new-validation-photos-week-required',
        });
        return null;
      }
      if (inspectionWriteInProgressRef.current) {
        return existingInspectionIdRef.current;
      }

      inspectionWriteInProgressRef.current = true;
      setSavingDraftForPhoto(true);
      try {
        const weekEndDate = new Date(weekEnding + 'T00:00:00');
        const startDate = new Date(weekEndDate);
        startDate.setDate(weekEndDate.getDate() - 6);

        if (existingInspectionId) {
          const draftPayload: Database['public']['Tables']['van_inspections']['Update'] = {
            van_id: vehicleId,
            user_id: selectedEmployeeId,
            inspection_date: formatDateISO(startDate),
            inspection_end_date: weekEnding,
            current_mileage: getParsedMileage(),
            status: 'draft',
            submitted_at: null,
            signature_data: null,
            signed_at: null,
            inspector_comments: inspectorComments.trim() || null,
            updated_at: new Date().toISOString(),
          };

          const { data: updatedDraft, error: updateError } = await supabase
            .from('van_inspections')
            .update(draftPayload)
            .eq('id', existingInspectionId)
            .eq('status', 'draft')
            .select('id')
            .maybeSingle();

          if (updateError || !updatedDraft) {
            throw updateError ?? new Error('Draft not found');
          }

          const { error: deleteItemsError } = await supabase
            .from('inspection_items')
            .delete()
            .eq('inspection_id', existingInspectionId);
          if (deleteItemsError) throw deleteItemsError;

          const updatedItems = buildCurrentInspectionItemsPayload(existingInspectionId);
          if (updatedItems.length > 0) {
            const { error: itemsError } = await supabase
              .from('inspection_items')
              .insert(updatedItems);
            if (itemsError) throw itemsError;
          }

          return existingInspectionId;
        }

        const currentStartedDays = getCurrentStartedDays();
        const conflict = await findExistingInspectionConflict(currentStartedDays);
        if (conflict) {
          const canReuseExactDraft =
            conflict.status === 'draft' &&
            conflict.conflictCount === 1 &&
            hasExactMatchingDays(conflict.inspectionDays, currentStartedDays);

          if (canReuseExactDraft) {
            const merged = await mergeIntoExistingDraft(conflict.id, { showToast: !silent });
            return merged ? conflict.id : null;
          }
          applyInspectionConflictMessage(conflict);
          return null;
        }

        const { data: draft, error: draftError } = await supabase
          .from('van_inspections')
          .insert({
            van_id: vehicleId,
            user_id: selectedEmployeeId,
            inspection_date: formatDateISO(startDate),
            inspection_end_date: weekEnding,
            current_mileage: getParsedMileage(),
            status: 'draft' as const,
            inspector_comments: inspectorComments.trim() || null,
          })
          .select('id')
          .single();

        if (draftError) throw draftError;

        const items = buildCurrentInspectionItemsPayload(draft.id);
        if (items.length > 0) {
          const { error: itemsError } = await supabase
            .from('inspection_items')
            .insert(items);
          if (itemsError) throw itemsError;
        }

        setExistingInspectionId(draft.id);
        window.history.replaceState(null, '', `/van-inspections/new?id=${draft.id}`);
        return draft.id;
      } catch (err) {
        const errorContextId = 'van-inspections-new-silent-draft-save-error';
        if (!existingInspectionId && isDuplicateInspectionError(err)) {
          const currentStartedDays = getCurrentStartedDays();
          const conflict = await findExistingInspectionConflict(currentStartedDays);
          const canReuseExactDraft = Boolean(
            conflict &&
            conflict.status === 'draft' &&
            conflict.conflictCount === 1 &&
            hasExactMatchingDays(conflict.inspectionDays, currentStartedDays)
          );

          if (conflict && canReuseExactDraft) {
            const merged = await mergeIntoExistingDraft(conflict.id, { showToast: !silent });
            return merged ? conflict.id : null;
          }
          if (conflict) {
            applyInspectionConflictMessage(conflict);
            return null;
          }
        }

        if (isTransientNetworkError(err)) {
          console.warn('Silent draft save skipped due transient network error');
        } else {
          if (!isAuthErrorStatus(getErrorStatus(err)) && !isClientSessionPausedError(err)) {
            console.error('Silent draft save failed:', err, { errorContextId });
          }
        }
        if (!silent) {
          toast.error(getInspectionErrorMessage(err, 'Could not auto-save draft. Please try again.'), { id: errorContextId });
        }
        return null;
      } finally {
        inspectionWriteInProgressRef.current = false;
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
  autoSaveDraftRef.current = () => ensureDraftSaved({ silent: true });

  const isAddVehicleFormDirty = Boolean(newVehicleReg.trim() || newVehicleCategoryId);

  const fetchVehicles = useCallback(async () => {
    if (!user || authLoading || permissionLoading) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('vans')
        .select(`
          *,
          van_categories (
            name
          )
        `)
        .eq('status', 'active')
        .order('reg_number');

      if (error) throw error;
      setVehicles(data || []);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Unable to load vehicles (network):', err);
      } else if (!isAuthErrorStatus(getErrorStatus(err)) && !isClientSessionPausedError(err)) {
        console.error('Error fetching vehicles:', err);
        setError('Failed to load vehicles');
      }
    }
  }, [authLoading, permissionLoading, supabase, user]);

  useEffect(() => {
    if (!user || authLoading || permissionLoading) {
      return;
    }

    fetchVehicles();
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('van_categories')
          .select('id, name')
          .order('name');

        if (error) throw error;
        setCategories(data || []);
      } catch (err) {
        if (isTransientNetworkError(err)) {
          console.warn('Unable to load van categories (network):', err);
        } else if (!isAuthErrorStatus(getErrorStatus(err)) && !isClientSessionPausedError(err)) {
          console.error('Error fetching categories:', err);
        }
      }
    };
    fetchCategories();
  }, [authLoading, fetchVehicles, permissionLoading, supabase, user]);

  const loadDraftInspection = useCallback(async (id: string) => {
    if (activeDraftLoadIdRef.current === id || loadedDraftIdRef.current === id) {
      return;
    }

    activeDraftLoadIdRef.current = id;
    try {
      loadingRef.current = true;
      setLoading(true);
      setError('');
      const currentUserId = user?.id;
      if (!currentUserId) {
        setError('You must be logged in to edit an inspection');
        return;
      }

      const { data: inspection, error: inspectionError } = await supabase
        .from('van_inspections')
        .select(`
          *,
          vans (
            id,
            reg_number,
            vehicle_type,
            van_categories (name)
          )
        `)
        .eq('id', id)
        .single();

      if (inspectionError) throw inspectionError;

      if (!canManageCrossUserInspections && inspection.user_id !== user?.id) {
        setError('You do not have permission to edit this inspection');
        return;
      }

      if (inspection.status !== 'draft') {
        setError('Only draft inspections can be edited here');
        return;
      }

      let checklist = INSPECTION_ITEMS;
      const inspectionData = inspection as unknown as InspectionWithRelations;
      if (inspectionData.vans?.van_categories?.name || inspectionData.vans?.vehicle_type) {
        const categoryName = inspectionData.vans?.van_categories?.name || inspectionData.vans?.vehicle_type;
        checklist = getChecklistForCategory(categoryName);
        setCurrentChecklist(checklist);
      }

      const { data: items, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', id)
        .order('item_number');

      if (itemsError) throw itemsError;

      setExistingInspectionId(id);
      setVehicleId(inspectionData.vans?.id || '');
      setWeekEnding(inspection.inspection_end_date || formatDateISO(getWeekEnding()));
      setCurrentMileage(inspection.current_mileage?.toString() || '');
      setSelectedEmployeeId(inspection.user_id);

      const newCheckboxStates: Record<string, InspectionStatus> = {};
      const newComments: Record<string, string> = {};
      
      (items as InspectionItem[] | null)?.forEach((item: InspectionItem) => {
        const key = `${item.day_of_week}-${item.item_number}`;
        newCheckboxStates[key] = item.status;
        if (item.comments) {
          newComments[key] = item.comments;
        }
      });

      if (inspectionData.vans?.id) {
        await loadPreviousDefectsRef.current?.(inspectionData.vans.id, {
          mode: 'merge',
          baseCheckboxStates: newCheckboxStates,
          baseComments: newComments,
        });
      } else {
        setCheckboxStates(newCheckboxStates);
        setComments(newComments);
      }

      if (Object.keys(newCheckboxStates).length > 0) {
        setChecklistStarted(true);
      }

      loadedDraftIdRef.current = id;
      toast.success('Draft inspection loaded');
    } catch (err) {
      console.error('Error loading draft inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to load draft inspection');
    } finally {
      if (activeDraftLoadIdRef.current === id) {
        activeDraftLoadIdRef.current = null;
      }
      loadingRef.current = false;
      setLoading(false);
    }
  }, [canManageCrossUserInspections, supabase, user?.id]);

  // Load draft inspection if ID is provided in URL
  useEffect(() => {
    if (
      draftId &&
      user &&
      !loadingRef.current &&
      loadedDraftIdRef.current !== draftId &&
      activeDraftLoadIdRef.current !== draftId
    ) {
      const timer = setTimeout(() => {
        void loadDraftInspection(draftId);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [draftId, user, loadDraftInspection]);

  useEffect(() => {
    const persistDraft = () => {
      if (loadingRef.current || savingDraftForPhoto || inspectionWriteInProgressRef.current || draftSavePromiseRef.current) return;
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
  }, [savingDraftForPhoto]);

  // Fetch employees only for roles that can manage other users' inspections.
  useEffect(() => {
    if (user && canManageCrossUserInspections) {
      const fetchEmployees = async () => {
        try {
          const allEmployees = await fetchUserDirectory({ module: 'inspections' });
          const formattedEmployees: Employee[] = allEmployees
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
          if (isTransientNetworkError(err)) {
            console.warn('Employee directory fetch skipped due transient network error');
          } else {
            console.error('Error fetching employees:', err);
          }
        }
      };
      fetchEmployees();
    } else if (user) {
      // If not a manager, set selected employee to current user
      setSelectedEmployeeId(user.id);
    }
  }, [canManageCrossUserInspections, user]);

  // Load recent vehicle IDs for the user
  useEffect(() => {
    if (user?.id) {
      setRecentVehicleIds(getRecentVehicleIds(user.id));
    }
  }, [user?.id]);

  const buildCurrentInspectionItemsPayload = useCallback((inspectionId: string) => {
    type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
    const items: InspectionItemInsert[] = [];

    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
      currentChecklist.forEach((item, index) => {
        const itemNumber = index + 1;
        const key = `${dayOfWeek}-${itemNumber}`;
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
    }

    return items;
  }, [checkboxStates, comments, currentChecklist]);

  const getCurrentStartedDays = useCallback(() => getStartedVanInspectionDays(checkboxStates), [checkboxStates]);

  const hasExactMatchingDays = useCallback((left: number[], right: number[]) => {
    if (left.length !== right.length) return false;
    return left.every((day, index) => day === right[index]);
  }, []);

  const applyInspectionConflictMessage = useCallback((conflict: ExistingInspectionConflict) => {
    const dayLabel = formatVanInspectionDayList(conflict.overlappingDays);

    if (conflict.status === 'submitted') {
      setError(`This employee already has a submitted van inspection covering ${dayLabel} in the selected week.`);
      toast.info(`A daily check has already been submitted for ${dayLabel}.`);
      return;
    }

    if (conflict.conflictCount > 1) {
      setError(`This employee already has multiple van drafts covering ${dayLabel} in the selected week. Open an existing draft instead of creating another overlapping one.`);
      toast.info('Overlapping van draft days already exist for this employee and week.');
      return;
    }

    setError(`This employee already has a van draft covering ${dayLabel} in the selected week. Continue that draft or clear the overlapping day here.`);
    toast.info(`An existing van draft already covers ${dayLabel}.`);
  }, []);

  const findExistingInspectionConflict = useCallback(async (
    currentDays: number[] = getCurrentStartedDays()
  ): Promise<ExistingInspectionConflict | null> => {
    if (!vehicleId || !weekEnding || !selectedEmployeeId || !isUuid(vehicleId) || currentDays.length === 0) {
      return null;
    }

    let inspectionsQuery = supabase
      .from('van_inspections')
      .select('id, status, updated_at, created_at')
      .eq('van_id', vehicleId)
      .eq('user_id', selectedEmployeeId)
      .eq('inspection_end_date', weekEnding);

    if (existingInspectionId) {
      inspectionsQuery = inspectionsQuery.neq('id', existingInspectionId);
    }

    const { data: inspections, error: inspectionsError } = await inspectionsQuery;

    if (inspectionsError) {
      const shouldLogError =
        !isAuthErrorStatus(getErrorStatus(inspectionsError)) &&
        !isClientSessionPausedError(inspectionsError) &&
        !isTransientNetworkError(inspectionsError);

      if (shouldLogError) {
        console.error('Failed to check for overlapping van inspections:', inspectionsError, {
          errorContextId: 'van-inspections-new-check-existing-error',
        });
      } else if (isTransientNetworkError(inspectionsError)) {
        console.warn('Unable to check overlapping van inspections (network):', inspectionsError, {
          errorContextId: 'van-inspections-new-check-existing-error',
        });
      }
      return null;
    }

    if (!inspections || inspections.length === 0) {
      return null;
    }

    const inspectionIds = inspections.map((inspection) => inspection.id);
    const { data: inspectionItems, error: itemsError } = await supabase
      .from('inspection_items')
      .select('inspection_id, day_of_week')
      .in('inspection_id', inspectionIds);

    if (itemsError) {
      console.error('Failed to load van inspection day coverage:', itemsError, {
        errorContextId: 'van-inspections-new-check-existing-items-error',
      });
      return null;
    }

    const daysByInspection = getInspectionDaysFromRows(
      ((inspectionItems || []) as VanInspectionDayRow[])
    );

    return findVanInspectionOverlap(
      currentDays,
      inspections.map((inspection) => ({
        id: inspection.id,
        status: inspection.status === 'draft' ? 'draft' : 'submitted',
        days: daysByInspection.get(inspection.id) || [],
        updated_at: inspection.updated_at,
        created_at: inspection.created_at,
      }))
    );
  }, [existingInspectionId, getCurrentStartedDays, selectedEmployeeId, supabase, vehicleId, weekEnding]);

  const mergeIntoExistingDraft = useCallback(async (
    inspectionId: string,
    options: { showToast?: boolean } = {}
  ): Promise<boolean> => {
    const { showToast = true } = options;
    const errorContextId = 'van-inspections-new-merge-draft-error';

    if (!selectedEmployeeId || !vehicleId || !weekEnding) {
      if (showToast) {
        toast.error('Select a vehicle, employee and week before continuing', {
          id: 'van-inspections-new-validation-merge-draft-core-fields',
        });
      }
      return false;
    }
    if (!isUuid(vehicleId)) {
      if (showToast) {
        toast.error(INVALID_VAN_SELECTION_MESSAGE, {
          id: 'van-inspections-new-invalid-vehicle-merge-draft',
        });
      }
      return false;
    }

    const weekEndDate = new Date(weekEnding + 'T00:00:00');
    const startDate = new Date(weekEndDate);
    startDate.setDate(weekEndDate.getDate() - 6);
    const draftMileage = currentMileage.trim() === '' ? null : parseInt(currentMileage, 10);

    const payload: Database['public']['Tables']['van_inspections']['Update'] = {
      van_id: vehicleId,
      user_id: selectedEmployeeId,
      inspection_date: formatDateISO(startDate),
      inspection_end_date: weekEnding,
      current_mileage: Number.isNaN(draftMileage) || draftMileage === null || draftMileage < 0 ? null : draftMileage,
      status: 'draft',
      submitted_at: null,
      signature_data: null,
      signed_at: null,
      inspector_comments: inspectorComments.trim() || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: updatedDraft, error: updateError } = await supabase
        .from('van_inspections')
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
      window.history.replaceState(null, '', `/van-inspections/new?id=${inspectionId}`);
      if (showToast) {
        toast.info('Merged with the existing draft for this van and week.');
      }
      return true;
    } catch (err) {
      const message = getInspectionErrorMessage(err, 'Could not merge with existing draft');
      console.error('Failed to merge into existing van draft:', err, { errorContextId });
      if (showToast) {
        toast.error(message, { id: errorContextId });
      }
      return false;
    }
  }, [
    buildCurrentInspectionItemsPayload,
    currentMileage,
    inspectorComments,
    selectedEmployeeId,
    supabase,
    vehicleId,
    weekEnding,
  ]);

  // Fetch baseline mileage for sanity checking
  const fetchBaselineMileage = async (selectedVehicleId: string) => {
    if (!isUuid(selectedVehicleId)) {
      setBaselineMileage(null);
      setBaselineMileageSource('none');
      return;
    }

    try {
      const response = await fetch(`/api/vans/mileage-baseline?vehicleId=${selectedVehicleId}`);
      if (response.ok) {
        const data = await response.json();
        setBaselineMileage(data.baselineMileage);
        setBaselineMileageSource(data.baselineSource);
      } else {
        // Fallback - don't block if API fails
        setBaselineMileage(null);
        setBaselineMileageSource('none');
      }
    } catch (err) {
      console.error('Error fetching baseline mileage:', err);
      setBaselineMileage(null);
      setBaselineMileageSource('none');
    }
  };

  // Handle mileage change with sanity check
  const handleMileageChange = (value: string) => {
    setCurrentMileage(value);
    
    // Reset confirmation when mileage changes
    setMileageConfirmed(false);
    setMileageWarning(null);
    setDigitGrowthWarning(null);
    
    // Check sanity if we have a value
    if (value && !Number.isNaN(parseInt(value, 10))) {
      const mileageValue = parseInt(value, 10);
      const sanityResult = checkMileageSanity(mileageValue, baselineMileage);
      const digitGrowthResult = getReadingDigitGrowthWarning({
        enteredReading: mileageValue,
        previousReading: baselineMileage,
        unitName: 'miles',
      });
      
      if (sanityResult.warning) {
        setMileageWarning(sanityResult);
      } else {
        setMileageWarning(null);
      }

      if (digitGrowthResult.warning) {
        setDigitGrowthWarning(digitGrowthResult.warning);
      } else {
        setDigitGrowthWarning(null);
      }

      if (!sanityResult.warning && !digitGrowthResult.warning) {
        setMileageConfirmed(true); // Auto-confirm if no warning
      }
    }
  };

  // Confirm mileage warning
  const handleConfirmMileage = () => {
    setMileageConfirmed(true);
    setShowMileageWarningDialog(false);
  };

  const activeMileageWarningMessage = digitGrowthWarning || mileageWarning?.warning || null;

  const getParsedMileage = (): number | null => {
    if (!currentMileage || currentMileage.trim() === '') return null;
    const mileageValue = parseInt(currentMileage, 10);
    if (Number.isNaN(mileageValue) || mileageValue < 0) return null;
    return mileageValue;
  };

  // Load previous defects for the selected vehicle
  const loadPreviousDefects = useCallback(async (
    selectedVehicleId: string,
    options: LoadPreviousDefectsOptions = {}
  ) => {
    const mode = options.mode ?? 'replace';
    const baseCheckboxStates =
      options.baseCheckboxStates ?? (mode === 'merge' ? checkboxStatesRef.current : {});
    const baseComments =
      options.baseComments ?? (mode === 'merge' ? commentsRef.current : {});

    if (!isUuid(selectedVehicleId)) {
      setPreviousDefects(new Map());
      setLoggedDefects(new Map());
      setRecentlyCompletedDefects(new Map());
      setConfirmedRepeatDefects(new Set());
      setCheckboxStates(mode === 'merge' ? baseCheckboxStates : {});
      setComments(mode === 'merge' ? baseComments : {});
      return;
    }

    try {
      const [previousDefectsResponse, recentCompletedResponse, response] = await Promise.all([
        fetch(`/api/van-inspections/previous-defects?vehicleId=${selectedVehicleId}`),
        fetch(`/api/van-inspections/recent-completed-defects?vehicleId=${selectedVehicleId}&days=7`),
        fetch(`/api/van-inspections/locked-defects?vehicleId=${selectedVehicleId}`),
      ]);

      if (previousDefectsResponse.ok) {
        const { previousDefects: previousDefectItems } = await previousDefectsResponse.json();
        const defectsMap = new Map<string, PreviousDefect>();

        (previousDefectItems as Array<PreviousDefectSummary & { signature: string }>).forEach((item) => {
          defectsMap.set(item.signature, {
            item_number: item.item_number,
            item_description: item.item_description,
            days: item.days,
          });
        });

        setPreviousDefects(defectsMap);
      } else {
        setPreviousDefects(new Map());
      }

      if (recentCompletedResponse.ok) {
        const { recentlyCompletedItems } = await recentCompletedResponse.json();
        const recentCompletedMap = new Map<string, RecentCompletedDefect>();

        (recentlyCompletedItems as Array<{ signature: string; completedAt: string }>).forEach((item) => {
          recentCompletedMap.set(item.signature, { completedAt: item.completedAt });
        });

        setRecentlyCompletedDefects(recentCompletedMap);
      } else {
        setRecentlyCompletedDefects(new Map());
      }

      setConfirmedRepeatDefects(new Set());

      // Load locked defects from server (includes logged, on_hold, in_progress)
      let loggedActionsData: Array<{
        inspection_items: { item_number: number; item_description: string };
        status: string;
        logged_comment: string | null;
        id: string;
      }> = [];
      
      let loggedError: Error | null = null;
      
      if (response.ok) {
        const { lockedItems } = await response.json();
        
        // Transform to match existing data structure
        loggedActionsData = lockedItems.map((item: { id: string; [key: string]: unknown }) => ({
          inspection_items: {
            item_number: item.item_number,
            item_description: item.item_description
          },
          status: item.status,
          logged_comment: item.comment,
          id: item.actionId
        }));
      } else {
        // API call failed - log error and show user warning
        loggedError = new Error(`Failed to fetch locked defects: ${response.status} ${response.statusText}`);
        console.error('[Inspection] Locked defects API failed:', loggedError);
        
        // Show user-friendly error
        setError('Warning: Unable to check for existing defects. Please refresh the page before continuing.');
      }

      const nextCheckboxStates =
        mode === 'merge' ? { ...baseCheckboxStates } : {};
      const nextComments =
        mode === 'merge' ? { ...baseComments } : {};

      if (!loggedError && loggedActionsData) {
        const loggedMap = new Map<string, { comment: string; actionId: string }>();
        
        (loggedActionsData as LoggedAction[]).forEach((action: LoggedAction) => {
          if (action.inspection_items) {
            const key = `${action.inspection_items.item_number}-${action.inspection_items.item_description}`;
            const statusLabel = 
              action.status === 'on_hold' ? 'on hold' :
              action.status === 'logged' ? 'logged' :
              'in progress';
            loggedMap.set(key, {
              comment: action.logged_comment || `Defect ${statusLabel} by management`,
              actionId: action.id
            });
          }
        });

        setLoggedDefects(loggedMap);

        loggedMap.forEach((loggedInfo, key) => {
          const [itemNumStr] = key.split('-');
          const itemNum = parseInt(itemNumStr);
          
          // Mark as defective for all 7 days
          for (let day = 1; day <= 7; day++) {
            const stateKey = `${day}-${itemNum}`;
            nextCheckboxStates[stateKey] = 'attention';
            nextComments[stateKey] = loggedInfo.comment;
          }
        });
      } else {
        setLoggedDefects(new Map());
      }

      setCheckboxStates(nextCheckboxStates);
      setComments(nextComments);
    } catch (err) {
      console.error('Error loading previous defects:', err);
      setPreviousDefects(new Map());
      setLoggedDefects(new Map());
      setRecentlyCompletedDefects(new Map());
      setConfirmedRepeatDefects(new Set());
      setCheckboxStates(mode === 'merge' ? baseCheckboxStates : {});
      setComments(mode === 'merge' ? baseComments : {});
    }
  }, []);
  loadPreviousDefectsRef.current = loadPreviousDefects;

  // Format UK registration plates (LLNNLLL -> LLNN LLL)
  const formatRegistration = (reg: string): string => {
    const cleaned = reg.replace(/\s/g, '').toUpperCase();
    
    // Check if it matches UK format: 2 letters, 2 numbers, 3 letters (7 chars total)
    if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    }
    
    return cleaned;
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    
    // Mark checklist as started (locks vehicle/date fields)
    if (!checklistStarted) {
      setChecklistStarted(true);
    }
    
    // Check if marking previously-defective item as OK
    if (status === 'ok') {
      const itemDescription = currentChecklist[itemNumber - 1];
      const defectKey = `${itemNumber}-${itemDescription}`;
      
      if (previousDefects.has(defectKey)) {
        // This item was defective in the last inspection
        // Show modal requiring resolution comment
        setPendingResolution({ day: dayOfWeek, itemNum: itemNumber, itemDesc: itemDescription });
        setShowResolutionDialog(true);
        return; // Don't set the status yet
      }
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
          day: dayOfWeek,
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
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const handleMarkAllPass = () => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const allPassStates: Record<string, InspectionStatus> = {};
    currentChecklist.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      allPassStates[key] = 'ok';
    });
    setCheckboxStates(prev => ({ ...prev, ...allPassStates }));
    // Clear comments for this day
    const updatedComments = { ...comments };
    currentChecklist.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      delete updatedComments[key];
    });
    setComments(updatedComments);
  };

  const handleSubmit = () => {
    // For NEW submissions (not editing existing), show confirmation dialog first
    if (!existingInspectionId) {
      setShowConfirmSubmitDialog(true);
      return;
    }
    
    // For editing existing inspections, proceed directly to validation
    validateAndSubmit();
  };

  const scrollToTarget = (el: Element | null) =>
    scrollAndHighlightValidationTarget(el, STICKY_NAV_OFFSET_PX);

  const openDayAndScrollToChecklistTarget = (dayOfWeek: number, selector: string) => {
    setActiveDay(String(dayOfWeek - 1));
    requestAnimationFrame(() => {
      scrollToTarget(document.querySelector(selector));
    });
  };

  const validateAndSubmit = () => {
    if (!vehicleId) {
      setError('Please select a vehicle');
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('vehicle'));
      return;
    }

    const mileageValue = getParsedMileage();
    if (mileageValue === null) {
      setError('Please enter a valid current mileage');
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('mileage'));
      return;
    }

    // Check mileage warning confirmation
    const submitSanityResult = checkMileageSanity(mileageValue, baselineMileage);
    const submitDigitGrowthResult = getReadingDigitGrowthWarning({
      enteredReading: mileageValue,
      previousReading: baselineMileage,
      unitName: 'miles',
    });
    const warningMessageForSubmit =
      submitDigitGrowthResult.warning || submitSanityResult.warning || activeMileageWarningMessage;
    if (submitDigitGrowthResult.warning) {
      setDigitGrowthWarning(submitDigitGrowthResult.warning);
    }
    if (submitSanityResult.warning) {
      setMileageWarning(submitSanityResult);
    }
    if (warningMessageForSubmit && !mileageConfirmed) {
      setError('Please confirm the mileage is correct before submitting');
      setShowMileageWarningDialog(true);
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('mileage'));
      return;
    }

    // Validate week ending is a Sunday
    const weekEndDate = new Date(weekEnding + 'T00:00:00');
    if (weekEndDate.getDay() !== 0) {
      setError('Week ending must be a Sunday');
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('weekEnding'));
      return;
    }

    // Validate: at least 1 day must be fully completed, and any started day must be finished
    const { completedDays, partiallyCompleteDayKey } = (() => {
      let completed = 0;
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
        let dayItemCount = 0;
        let firstMissingKey: string | null = null;
        for (let itemNumber = 1; itemNumber <= currentChecklist.length; itemNumber += 1) {
          const key = `${dayOfWeek}-${itemNumber}`;
          if (checkboxStates[key]) {
            dayItemCount++;
          } else if (!firstMissingKey) {
            firstMissingKey = key;
          }
        }
        if (dayItemCount === currentChecklist.length) {
          completed++;
        } else if (dayItemCount > 0 && firstMissingKey) {
          return { completedDays: completed, partiallyCompleteDayKey: firstMissingKey };
        }
      }
      return { completedDays: completed, partiallyCompleteDayKey: null };
    })();

    if (partiallyCompleteDayKey) {
      const [dayOfWeek] = partiallyCompleteDayKey.split('-').map(Number);
      const dayName = DAY_NAMES[dayOfWeek - 1] || `Day ${dayOfWeek}`;
      setError(`${dayName} is partially completed. Please finish all items for that day or clear it entirely.`);
      setShowConfirmSubmitDialog(false);
      openDayAndScrollToChecklistTarget(dayOfWeek, `[data-checklist-item="${partiallyCompleteDayKey}"]`);
      return;
    }

    if (completedDays === 0) {
      setError('Please complete at least one day before submitting');
      setShowConfirmSubmitDialog(false);
      return;
    }

    // Validate: all defects must have comments
    const defectsWithoutComments: string[] = [];
    let firstDefectWithoutCommentKey: string | null = null;
    Object.entries(checkboxStates).forEach(([key, status]) => {
      const keyStr = String(key);
      if (status === 'attention' && !comments[keyStr]) {
        if (!firstDefectWithoutCommentKey) firstDefectWithoutCommentKey = keyStr;
        const [dayOfWeek, itemNumber] = keyStr.split('-').map(Number);
        const dayName = DAY_NAMES[dayOfWeek - 1] || `Day ${dayOfWeek}`;
        const itemName = currentChecklist[itemNumber - 1] || `Item ${itemNumber}`;
        defectsWithoutComments.push(`${itemName} (${dayName})`);
      }
    });

    if (defectsWithoutComments.length > 0) {
      setError(`Please add comments for all defects: ${defectsWithoutComments.join(', ')}`);
      toast.error('Missing defect comments', {
        id: 'van-inspections-new-validation-missing-defect-comments',
        description: `Please add comments for: ${defectsWithoutComments.slice(0, 3).join(', ')}${defectsWithoutComments.length > 3 ? '...' : ''}`,
      });
      setShowConfirmSubmitDialog(false);
      const keyToScroll: string = firstDefectWithoutCommentKey ?? '';
      if (keyToScroll) {
        const parts = keyToScroll.split('-');
        const dayOfWeek = parts.length >= 1 ? Number(parts[0]) : 1;
        openDayAndScrollToChecklistTarget(dayOfWeek, `[data-comment-input="${keyToScroll}"]`);
      }
      return;
    }

    // Validate inform workshop has sufficient comment
    if (informWorkshop && inspectorComments.trim().length < 10) {
      setError('Workshop notification requires at least 10 characters in the comment field');
      toast.error('Comment too short', {
        id: 'van-inspections-new-validation-workshop-comment-too-short',
        description: 'Add at least 10 characters to your end-of-inspection notes to create a workshop task.',
      });
      setShowConfirmSubmitDialog(false);
      scrollToTarget(document.getElementById('inspector-comments'));
      return;
    }
    
    // All validation passed - clear any previous errors and close confirmation dialog
    setError('');
    setShowConfirmSubmitDialog(false);
    
    // Use setTimeout to ensure dialog state updates before opening signature dialog
    setTimeout(() => {
      setShowSignatureDialog(true);
    }, 100);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveInspection('submitted', sig);
  };

  const handleAddVehicle = async () => {
    if (!newVehicleReg.trim()) {
      setError('Please enter a registration number');
      return;
    }

    if (!newVehicleCategoryId) {
      setError('Please select a vehicle category');
      return;
    }

    setAddingVehicle(true);
    setError('');

    try {
      // Format the registration before saving
      const formattedReg = formatRegistration(newVehicleReg.trim());
      
      type VehicleInsert = Database['public']['Tables']['vans']['Insert'];
      const vehicleData: VehicleInsert = {
        reg_number: formattedReg,
        category_id: newVehicleCategoryId,
        // vehicle_type auto-syncs from category via database trigger
        status: 'active',
      };

      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vans')
        .insert(vehicleData)
        .select()
        .single();

      if (vehicleError) {
        if (vehicleError.code === '23505') {
          throw new Error('A vehicle with this registration already exists');
        }
        throw vehicleError;
      }

      // Refresh vehicles list
      await fetchVehicles();
      
      // Select the new vehicle and update checklist based on its category
      if (newVehicle) {
        setVehicleId(newVehicle.id);
        
        // Find the category name and update checklist
        const category = categories.find(c => c.id === newVehicleCategoryId);
        if (category) {
          const checklist = getChecklistForCategory(category.name);
          setCurrentChecklist(checklist);
        }
      }

      // Close dialog and reset form
      // Use setTimeout to ensure dialog closes properly on mobile
      setTimeout(() => {
        setShowAddVehicleDialog(false);
        setNewVehicleReg('');
        setNewVehicleCategoryId('');
      }, 100);
    } catch (err) {
      console.error('Error adding vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to add vehicle');
    } finally {
      setAddingVehicle(false);
    }
  };

  const handleAddVehicleDialogOpenChange = (open: boolean) => {
    if (!open && isAddVehicleFormDirty && !addingVehicle) {
      triggerShakeAnimation(addVehicleDialogContentRef.current);
      return;
    }

    setShowAddVehicleDialog(open);
  };

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !vehicleId) return;
    if (!isUuid(vehicleId)) {
      setError(INVALID_VAN_SELECTION_MESSAGE);
      toast.error(INVALID_VAN_SELECTION_MESSAGE, {
        id: 'van-inspections-new-invalid-vehicle-save',
        description: 'Please reselect the van and try again.',
      });
      return;
    }
    
    // Validate week ending is provided
    if (!weekEnding || weekEnding.trim() === '') {
      setError('Please select a week ending date');
      return;
    }

    const mileageValue = getParsedMileage();
    if (status === 'submitted' && mileageValue === null) {
      setError('Please enter a valid current mileage');
      return;
    }

    if (inspectionWriteInProgressRef.current) {
      console.log('Save already in progress, ignoring duplicate request');
      return;
    }

    inspectionWriteInProgressRef.current = true;
    loadingRef.current = true;
    setError('');
    setLoading(true);

    try {
      const currentStartedDays = getCurrentStartedDays();
      const conflict = await findExistingInspectionConflict(currentStartedDays);
      if (conflict) {
        const canReuseExactDraft =
          !existingInspectionId &&
          conflict.status === 'draft' &&
          conflict.conflictCount === 1 &&
          hasExactMatchingDays(conflict.inspectionDays, currentStartedDays);

        if (canReuseExactDraft) {
          const merged = await mergeIntoExistingDraft(conflict.id);
          if (merged) {
            if (status === 'submitted') {
              toast.info('Existing draft loaded. Submit again to finish this daily check.');
            }
            return;
          }
        }

        applyInspectionConflictMessage(conflict);
        return;
      }

      // Calculate inspection start date (Monday of the week)
      const weekEndDate = new Date(weekEnding + 'T00:00:00');
      const startDate = new Date(weekEndDate);
      startDate.setDate(weekEndDate.getDate() - 6); // Go back 6 days to Monday
      
      // Create inspection record
      type InspectionInsert = Database['public']['Tables']['van_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        van_id: vehicleId,
        user_id: selectedEmployeeId, // Use selected employee ID (can be manager's own ID or another employee's)
        inspection_date: formatDateISO(startDate),
        inspection_end_date: weekEnding,
        current_mileage: mileageValue,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
        inspector_comments: inspectorComments.trim() || null,
      };

      let inspection: { id: string };

      // Update existing draft or create new inspection
      if (existingInspectionId) {
        // IMPORTANT: Delete and insert items BEFORE updating inspection status
        // This ensures RLS policies work correctly (they require status = 'draft')
        
        // Delete existing items first (while inspection is still in 'draft' status)
        console.log(`Fetching existing items for inspection ${existingInspectionId}...`);
        const { data: existingItems, error: fetchError } = await supabase
          .from('inspection_items')
          .select('id, item_number, day_of_week')
          .eq('inspection_id', existingInspectionId);

        if (fetchError) {
          console.error('Error fetching existing items:', fetchError);
          throw new Error(`Failed to fetch existing items: ${fetchError.message}`);
        }

        if (existingItems && existingItems.length > 0) {
          console.log(`Deleting ${existingItems.length} existing items...`);
          const { error: deleteError } = await supabase
            .from('inspection_items')
            .delete()
            .eq('inspection_id', existingInspectionId);

          if (deleteError) {
            console.error('Error deleting existing items:', deleteError);
            throw new Error(`Failed to delete existing items: ${deleteError.message}`);
          }
          console.log(`Successfully deleted existing items`);
        } else {
          console.log('No existing items to delete');
        }

        // Set inspection reference for items insertion (below)
        inspection = { id: existingInspectionId };

        // Note: Inspection update happens AFTER items are inserted (see below)
      } else {
        // Create new inspection
        const { data: newInspection, error: insertError } = await supabase
          .from('van_inspections')
          .insert(inspectionData)
          .select()
          .single();

        if (insertError) throw insertError;
        inspection = newInspection;
      }

      if (!inspection) throw new Error('Failed to save inspection');

      // Create inspection items ONLY for items that have been explicitly set by the user
      // This prevents drafts from showing all items as 'ok' when they haven't been completed
      const items = buildCurrentInspectionItemsPayload(inspection.id);

      // Only insert if there are items to save
      let insertedItems: InspectionItem[] = [];
      if (items.length > 0) {
        console.log(`Saving ${items.length} inspection items for inspection ${inspection.id}...`);
        
        // Use regular INSERT since we already deleted all existing items
        // This avoids RLS policy issues with UPSERT triggering UPDATE policies
        const { data, error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items)
          .select();

        if (itemsError) {
          console.error('Error saving items:', itemsError);
          console.error('Items that failed:', JSON.stringify(items.slice(0, 3))); // Log first 3 for debugging
          throw new Error(`Failed to save inspection items: ${itemsError.message}`);
        }
        
        insertedItems = (data || []) as InspectionItem[];
        console.log(`Successfully saved ${insertedItems.length} items`);
      } else {
        console.warn('No items to save - inspection has no completed items');
      }

      // NOW update the inspection (after items are saved)
      // This is important for existing inspections to avoid RLS issues
      if (existingInspectionId) {
        type InspectionUpdate = Database['public']['Tables']['van_inspections']['Update'];
        const inspectionUpdate: InspectionUpdate = {
          van_id: vehicleId,
          user_id: selectedEmployeeId,
          inspection_date: formatDateISO(startDate),
          inspection_end_date: weekEnding,
          current_mileage: mileageValue,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
          inspector_comments: inspectorComments.trim() || null,
          updated_at: new Date().toISOString(),
        };

        const { data: updatedInspection, error: updateError } = await supabase
          .from('van_inspections')
          .update(inspectionUpdate)
          .eq('id', existingInspectionId)
          .select();

        if (updateError) {
          console.error('Update error:', updateError);
          throw updateError;
        }
        
        if (!updatedInspection || updatedInspection.length === 0) {
          throw new Error('Failed to update inspection - no rows returned. You may not have permission to edit this inspection.');
        }
        
        inspection = updatedInspection[0];
      }

      // Auto-create/update actions for failed items via server endpoint
      if (insertedItems && insertedItems.length > 0) {
        const failedItems = insertedItems.filter((item: InspectionItem) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          // Group defects by item_number and description
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

          // Prepare defects for sync endpoint
          const defects = Array.from(groupedDefects.values()).map(group => ({
            item_number: group.item_number,
            item_description: group.item_description,
            days: group.days,
            comment: group.comments.length > 0 ? group.comments[0] : '',
            primaryInspectionItemId: group.item_ids[0]
          }));

          // Call server endpoint to sync tasks
          try {
            const syncResponse = await fetch('/api/van-inspections/sync-defect-tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inspectionId: inspection.id,
                vehicleId,
                createdBy: user!.id,
                defects,
                confirmedRepeatDefectSignatures: Array.from(confirmedRepeatDefects),
              })
            });

            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log(`✅ Sync complete: ${syncResult.message}`);
              
              if (syncResult.duplicates && syncResult.duplicates.length > 0) {
                console.warn('⚠️  Duplicates detected:', syncResult.duplicates);
              }
            } else {
              console.error('Error syncing defect tasks:', await syncResponse.text());
            }
          } catch (error) {
            console.error('Error calling sync endpoint:', error);
            // Don't throw - we don't want to fail the inspection if sync fails
          }
        }
      }

      // Auto-complete actions for resolved items (works for both draft and submitted)
      if (resolvedItems.size > 0 && vehicleId) {
        try {
          // Find pending or logged actions for this vehicle's defects
          const { data: pendingActions } = await supabase
            .from('actions')
            .select(`
              id,
              inspection_item_id,
              inspection_id,
              status,
              description,
              van_inspections!inner (
                van_id
              )
            `)
            .in('status', ['pending', 'logged'])
            .eq('van_inspections.van_id', vehicleId);

          if (pendingActions && pendingActions.length > 0) {
            // Get the inspection items from the previous inspection to match with actions
            const { data: previousInspectionItems } = await supabase
              .from('inspection_items')
              .select('id, item_number, item_description')
              .in(
                'id',
                pendingActions
                  .map((action: { inspection_item_id: string | null }) => action.inspection_item_id)
                  .filter((inspectionItemId): inspectionItemId is string => Boolean(inspectionItemId)),
              );

            // For each resolved item, find matching action and complete it
            for (const [key, resolutionComment] of resolvedItems.entries()) {
              const [, itemNumStr] = key.split('-');
              const itemNum = parseInt(itemNumStr);
              const itemDesc = currentChecklist[itemNum - 1];

              // Find matching action
              const matchingItem = previousInspectionItems?.find(
                (item: { id: string; item_number: number; item_description: string }) => item.item_number === itemNum && item.item_description === itemDesc
              );

              if (matchingItem) {
                const matchingAction = pendingActions.find((action: { inspection_item_id: string | null; description: string | null; id: string }) => action.inspection_item_id === matchingItem.id);

                if (matchingAction) {
                  // Complete the action with resolution comment
                  await supabase
                    .from('actions')
                    .update({
                      status: 'completed',
                      actioned: true,
                      actioned_at: new Date().toISOString(),
                      actioned_by: user!.id,
                      description: `${matchingAction.description || ''}\n\nResolution: ${resolutionComment}`
                    })
                    .eq('id', matchingAction.id);

                  console.log(`✅ Auto-completed action ${matchingAction.id} for resolved item ${itemNum}`);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error completing resolved actions:', err);
          // Don't throw - we don't want to fail the inspection if this fails
        }
      }

      // Handle "Inform Workshop" task creation if enabled
      if (informWorkshop && inspectorComments.trim().length >= 10) {
        try {
          setCreatingWorkshopTask(true);
          
          const informResponse = await fetch('/api/van-inspections/inform-workshop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inspectionId: inspection.id,
              vehicleId,
              comment: inspectorComments.trim(),
            }),
          });

          if (informResponse.ok) {
            const result = await informResponse.json();
            console.log(`✅ Workshop task ${result.action}: ${result.taskId} (Category: ${result.subcategory.name})`);
            toast.success('Workshop task created', {
              description: `Task categorized as "${result.subcategory.name}"`,
            });
          } else {
            const errorData = await informResponse.json();
            console.error('Error creating workshop task:', errorData);
            // If inform workshop was enabled, this is a strict error - don't proceed
            throw new Error(errorData.error || 'Failed to create workshop task');
          }
        } catch (informError) {
          const errorContextId = 'van-inspections-new-inform-workshop-error';
          console.error('Error in inform-workshop flow:', informError, { errorContextId });
          const errorMsg = informError instanceof Error ? informError.message : 'Failed to create workshop task';
          setError(`Inspection saved, but workshop task creation failed: ${errorMsg}`);
          toast.error('Workshop task creation failed', {
            id: errorContextId,
            description: errorMsg,
          });
          setLoading(false);
          setCreatingWorkshopTask(false);
          // Don't navigate away - let user retry or disable inform workshop
          return;
        } finally {
          setCreatingWorkshopTask(false);
        }
      }

      // Show success message based on status
      if (status === 'draft') {
        toast.success('Draft saved successfully', {
          description: 'Your inspection has been saved as a draft.',
        });
      } else {
        toast.success('Daily check submitted successfully', {
          description: 'Your inspection has been submitted for review.',
        });
      }

      // Navigate back to inspections list
      router.push('/van-inspections');
    } catch (err) {
      const errorContextId = 'van-inspections-new-save-inspection-error';
      if (!existingInspectionId && isDuplicateInspectionError(err)) {
        const currentStartedDays = getCurrentStartedDays();
        const conflict = await findExistingInspectionConflict(currentStartedDays);
        const canReuseExactDraft = Boolean(
          conflict &&
          conflict.status === 'draft' &&
          conflict.conflictCount === 1 &&
          hasExactMatchingDays(conflict.inspectionDays, currentStartedDays)
        );

        if (conflict && canReuseExactDraft) {
          const merged = await mergeIntoExistingDraft(conflict.id, { showToast: false });
          if (merged) {
            if (status === 'submitted') {
              toast.info('An existing draft was found and updated. Submit again to finish this daily check.');
            } else {
              toast.info('Your changes were saved into the existing draft for this van and week.');
            }
            return;
          }
        } else if (conflict) {
          applyInspectionConflictMessage(conflict);
          return;
        }
      }

      if (isTransientNetworkError(err)) {
        console.warn('Inspection save failed due transient network error', {
          errorContextId,
          vehicleId,
          weekEnding,
          existingInspectionId: existingInspectionId || null,
        });
      } else {
        console.error('Error saving inspection:', err, {
          errorContextId,
          vehicleId,
          weekEnding,
          existingInspectionId: existingInspectionId || null,
        });
        console.error('Error details:', JSON.stringify(err, null, 2), {
          errorContextId,
          vehicleId,
          weekEnding,
          existingInspectionId: existingInspectionId || null,
        });
      }
      
      const errorMessage = getInspectionErrorMessage(err, 'An unexpected error occurred');

      if (err instanceof Error) {
        console.error('Error stack:', err.stack, {
          errorContextId,
          vehicleId,
          weekEnding,
          existingInspectionId: existingInspectionId || null,
        });
      }
      
      toast.error('Failed to save inspection', {
        id: errorContextId,
        description: errorMessage,
      });
    } finally {
      inspectionWriteInProgressRef.current = false;
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-muted-foreground'}`} />;
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
      default:
        return 'bg-slate-800/30 border-border';
    }
  };

  // Calculate progress based on started days only
  const startedDayCount = (() => {
    let count = 0;
    for (let d = 1; d <= 7; d++) {
      if (currentChecklist.some((_, i) => checkboxStates[`${d}-${i + 1}`])) count++;
    }
    return count;
  })();
  const totalItems = currentChecklist.length * (startedDayCount || 7);
  const completedItems = Object.keys(checkboxStates).length;
  const progressPercent = Math.round((completedItems / totalItems) * 100);

  if (showPermissionLoader) {
    return <PageLoader message="Loading van inspection form..." />;
  }

  return (
    <div className={`space-y-4 max-w-6xl ${tabletModeEnabled ? 'pb-36' : 'pb-32 md:pb-6'}`}>
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <BackButton fallbackHref="/van-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {existingInspectionId ? 'Edit Van Daily Check' : 'New Van Daily Check'}
              </h1>
              <p className="text-sm text-muted-foreground hidden md:block">
                {existingInspectionId ? 'Continue editing your draft' : 'Daily safety check'}
              </p>
            </div>
          </div>
          {/* Progress Badge - Only show when vehicle is selected */}
          {vehicleId && (
            <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-muted-foreground">Progress</div>
              <div className="text-lg font-bold text-foreground">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
        {/* Progress Bar - Only show when vehicle is selected */}
        {vehicleId && (
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

      {/* Van Details Card */}
      <Card className="">
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Daily Check Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            {weekEnding ? `Week ending: ${formatDate(weekEnding)}` : 'Select a date'}
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
                      {employee.has_module_access === false && ' - No Van Checks access'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle" className="text-foreground text-base flex items-center gap-2">
                Van
                <span className="text-red-400">*</span>
              </Label>
              <Select 
                value={vehicleId} 
                disabled={checklistStarted}
                onValueChange={(value) => {
                  if (value === 'add-new') {
                    // Don't set the value, just open the dialog
                    setShowAddVehicleDialog(true);
                  } else if (!isUuid(value)) {
                    setVehicleId('');
                    setError(INVALID_VAN_SELECTION_MESSAGE);
                    toast.error(INVALID_VAN_SELECTION_MESSAGE, {
                      id: 'van-inspections-new-invalid-vehicle-selection',
                      description: 'Please reselect the van and try again.',
                    });
                  } else {
                    setError('');
                    setVehicleId(value);
                    // Record as recent vehicle selection
                    if (user?.id) {
                      const updatedRecent = recordRecentVehicleId(user.id, value);
                      setRecentVehicleIds(updatedRecent);
                    }
                    // Update checklist based on vehicle category
                    const selectedVehicle = vehicles.find(v => v.id === value);
                    if (selectedVehicle) {
                      const categoryName = selectedVehicle.van_categories?.name || selectedVehicle.vehicle_type || '';
                      const checklist = getChecklistForCategory(categoryName);
                      setCurrentChecklist(checklist);
                    }
                    // Load previous defects for resolution tracking
                    loadPreviousDefects(value);
                    // Fetch baseline mileage for sanity checking
                    fetchBaselineMileage(value);
                    // Reset mileage confirmation when vehicle changes
                    setMileageConfirmed(false);
                    setMileageWarning(null);
                    setDigitGrowthWarning(null);
                  }
                }}
                onOpenChange={(open) => {
                  // Ensure select closes when dialog opens
                  if (open && showAddVehicleDialog) {
                    return;
                  }
                }}
              >
                <SelectTrigger id="vehicle" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white" disabled={checklistStarted}>
                  <SelectValue placeholder="Select a van" />
                </SelectTrigger>
                <SelectContent className="border-border max-h-[300px] md:max-h-[400px] dark:text-slate-100 text-slate-900">
                  <SelectItem value="add-new" className="text-brand-yellow font-semibold border-b border-border">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add New Van
                    </div>
                  </SelectItem>
                  {(() => {
                    const { recentVehicles, otherVehicles } = splitVehiclesByRecent(vehicles, recentVehicleIds);
                    return (
                      <>
                        {recentVehicles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                            {recentVehicles.map((vehicle) => (
                              <SelectItem key={vehicle.id} value={vehicle.id} className="text-white">
                                {vehicle.reg_number} - {vehicle.van_categories?.name || vehicle.vehicle_type || 'Uncategorized'}
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
                              <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All Vans</SelectLabel>
                            )}
                            {otherVehicles.map((vehicle) => (
                              <SelectItem key={vehicle.id} value={vehicle.id} className="text-white">
                                {vehicle.reg_number} - {vehicle.van_categories?.name || vehicle.vehicle_type || 'Uncategorized'}
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
              <Label htmlFor="weekEnding" className="text-foreground text-base flex items-center gap-2">
                Week Ending (Sunday)
                <span className="text-red-400">*</span>
              </Label>
              <Select
                value={weekEnding}
                disabled={checklistStarted}
                onValueChange={(value) => {
                  setError('');
                  setWeekEnding(value);
                }}
              >
                <SelectTrigger id="weekEnding" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select a Sunday" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px] md:max-h-[280px]">
                  {(() => {
                    const sundays: Date[] = [];
                    const nextSunday = getWeekEnding();
                    for (let i = 0; i < 12; i++) {
                      const d = new Date(nextSunday);
                      d.setDate(d.getDate() - i * 7);
                      sundays.push(d);
                    }
                    return sundays.map((d) => {
                      const iso = formatDateISO(d);
                      return (
                        <SelectItem key={iso} value={iso}>
                          {formatDate(iso)}
                        </SelectItem>
                      );
                    });
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mileage" className="text-foreground text-base flex items-center gap-2">
              Current Mileage
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="mileage"
              type="number"
              value={currentMileage}
              onChange={(e) => handleMileageChange(e.target.value)}
              placeholder={(() => {
                const sel = vehicles.find(v => v.id === vehicleId);
                return sel?.current_mileage != null ? `e.g. ${sel.current_mileage}` : 'e.g. 45000';
              })()}
              min="0"
              step="1"
              className={`h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
                activeMileageWarningMessage && !mileageConfirmed ? 'border-amber-500' : ''
              }`}
              required
            />
            {activeMileageWarningMessage && !mileageConfirmed && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-400">{activeMileageWarningMessage}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowMileageWarningDialog(true)}
                      className="mt-2 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                    >
                      Confirm Mileage is Correct
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {activeMileageWarningMessage && mileageConfirmed && (
              <p className="text-xs text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Mileage confirmed
              </p>
            )}
          </div>
          
          {checklistStarted && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                <Info className="h-4 w-4 inline mr-2" />
                Van and week ending are locked once you start filling the checklist. Save or leave the page to unlock.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Check - shown once van and week ending are selected */}
      {vehicleId && weekEnding && (
      <Card className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">{currentChecklist.length}-Point Safety Check</CardTitle>
          <CardDescription className="text-muted-foreground">
            Mark each item as Pass or Fail for each day
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">
          
          <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
            <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4">
              {DAY_NAMES.map((day, index) => {
                const dayOfWeek = index + 1;
                // Check if all items for this day have a status
                const isComplete = currentChecklist.every((_, itemIndex) => {
                  const itemNumber = itemIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  return checkboxStates[key] !== undefined;
                });
                
                return (
                  <TabsTrigger 
                    key={index} 
                    value={index.toString()} 
                    className={`text-xs py-3 data-[state=active]:bg-inspection data-[state=active]:text-slate-900 text-muted-foreground ${
                      isComplete 
                        ? 'data-[state=active]:border-2 data-[state=active]:border-green-500 border-2 border-green-500/50' 
                        : 'data-[state=active]:border-2 data-[state=active]:border-white'
                    }`}
                  >
                    {day.substring(0, 3)}
                    {isComplete && (
                      <Check className="h-3 w-3 ml-1" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {DAY_NAMES.map((_day, dayIndex) => (
              <TabsContent key={dayIndex} value={dayIndex.toString()} className="mt-0">
                {/* Mark All Pass Button - Mobile */}
                <div className="md:hidden mb-4 hidden">
                  <Button
                    type="button"
                    onClick={handleMarkAllPass}
                    variant="outline"
                    className="w-full h-12 border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                  >
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Mark All as PASS
                  </Button>
                </div>

                {/* Mobile View - Card-based */}
          <div className={tabletModeEnabled ? 'space-y-3' : 'md:hidden space-y-3'}>
                  {currentChecklist.map((item, index) => {
                    const itemNumber = index + 1;
                    const dayOfWeek = dayIndex + 1;
                    const key = `${dayOfWeek}-${itemNumber}`;
                    const currentStatus = checkboxStates[key];
                    const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                    // Check if this item has a logged action (read-only)
                    const loggedKey = `${itemNumber}-${item}`;
                    const isLogged = loggedDefects.has(loggedKey);
              
              return (
                <div key={itemNumber} data-checklist-item={key} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${
                  isLogged ? 'border-red-500/50 bg-red-500/5' : 'border-border/50'
                }`}>
                  {/* Item Header */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-muted-foreground">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                      {isLogged && (
                        <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/30">
                          🔒 LOGGED DEFECT (Read-Only)
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Status Buttons - Pass or Fail */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                        disabled={isLogged}
                        className={`flex items-center justify-center h-12 rounded-xl border-3 transition-all ${
                          getStatusColor(status, currentStatus === status)
                        } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {getStatusIcon(status, currentStatus === status)}
                      </button>
                    ))}
                  </div>

                  {/* Comments/Notes */}
                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-foreground text-sm">
                        {currentStatus === 'attention' ? (isLogged ? 'Manager Comment (Read-Only)' : 'Comments (Required)') : 'Notes'}
                      </Label>
                      <Textarea
                        data-comment-input={key}
                        value={comments[key] || ''}
                        onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                        placeholder={isLogged ? '' : 'Add details...'}
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
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
                        if (id) setPhotoUploadItem({ itemNumber, dayOfWeek });
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

          {/* Mark All Pass Button - Desktop */}
          <div className="hidden md:block mb-4 !hidden">
            <Button
              type="button"
              onClick={handleMarkAllPass}
              variant="outline"
              className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark All as PASS
            </Button>
          </div>

          {/* Desktop View - Table */}
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
                  const dayOfWeek = dayIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  const currentStatus = checkboxStates[key];
                  const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                  
                  // Check if this item has a logged action (read-only)
                  const loggedKey = `${itemNumber}-${item}`;
                  const isLogged = loggedDefects.has(loggedKey);
                  
                  return (
                    <tr key={itemNumber} data-checklist-item={key} className={`border-b border-border/50 hover:bg-slate-800/30 ${
                      isLogged ? 'bg-red-500/5' : ''
                    }`}>
                      <td className="p-3 text-sm text-muted-foreground">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">
                        {item}
                        {isLogged && (
                          <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                            🔒 LOGGED
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-3">
                          {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                              disabled={isLogged}
                              className={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
                              title={status === 'ok' ? 'Pass' : 'Fail'}
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
                          className={`bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground ${
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

              </TabsContent>
            ))}
          </Tabs>

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
                  className="min-h-[100px] bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground"
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  {inspectorComments.length}/500 characters
                </p>
              </div>

              {/* Inform Workshop Toggle (shown only when optional notes exist) */}
              {hasOptionalInspectorComment && (
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
                    
                    {/* Validation warning */}
                    {informWorkshop && inspectorComments.trim().length < 10 && (
                      <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Comment must be at least 10 characters to create a workshop task
                      </p>
                    )}
                    
                    {/* Ready indicator */}
                    {informWorkshop && inspectorComments.trim().length >= 10 && (
                      <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Workshop task will be created on submit
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Desktop Action Buttons */}
          <div className={tabletModeEnabled ? 'hidden' : 'hidden md:flex flex-row gap-3 justify-end pt-4'}>
            <Button
              variant="outline"
              onClick={() => saveInspection('draft')}
              disabled={loading || !vehicleId || (informWorkshop && inspectorComments.trim().length < 10)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !vehicleId || (informWorkshop && inspectorComments.trim().length < 10)}
              className="bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold"
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
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => saveInspection('draft')}
            disabled={loading || !vehicleId || (informWorkshop && inspectorComments.trim().length < 10)}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !vehicleId || (informWorkshop && inspectorComments.trim().length < 10)}
            className="flex-1 h-14 bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold text-base"
          >
            <Send className="h-5 w-5 mr-2" />
            Submit
          </Button>
        </div>
      </div>

      {/* Add Van Dialog */}
      <Dialog open={showAddVehicleDialog} onOpenChange={handleAddVehicleDialogOpenChange}>
        <DialogContent
          ref={addVehicleDialogContentRef}
          className={`border-border text-white max-w-md ${tabletModeEnabled ? 'max-w-lg p-5 sm:p-6' : ''}`}
          onInteractOutside={(event) => {
            if (isAddVehicleFormDirty && !addingVehicle) {
              event.preventDefault();
              triggerShakeAnimation(addVehicleDialogContentRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isAddVehicleFormDirty && !addingVehicle) {
              event.preventDefault();
              triggerShakeAnimation(addVehicleDialogContentRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Add New Van</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter the van registration number and select its category
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newVehicleReg" className="text-foreground">
                Registration Number <span className="text-red-400">*</span>
              </Label>
              <Input
                id="newVehicleReg"
                value={newVehicleReg}
                onChange={(e) => setNewVehicleReg(e.target.value.toUpperCase())}
                onBlur={(e) => setNewVehicleReg(formatRegistration(e.target.value))}
                placeholder="e.g., BG21 EXH"
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground uppercase"
                disabled={addingVehicle}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newVehicleCategory" className="text-foreground">
                Van Category <span className="text-red-400">*</span>
              </Label>
              <Select 
                value={newVehicleCategoryId || undefined} 
                onValueChange={(value) => setNewVehicleCategoryId(value || '')}
                disabled={addingVehicle}
              >
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="border-border max-h-[300px] md:max-h-[400px] dark:text-slate-100 text-slate-900">
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddVehicleDialog(false);
                setNewVehicleReg('');
                setNewVehicleCategoryId('');
              }}
              disabled={addingVehicle}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              {isAddVehicleFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={handleAddVehicle}
              disabled={addingVehicle || !newVehicleReg.trim() || !newVehicleCategoryId}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900 font-semibold"
            >
              {addingVehicle ? 'Adding...' : 'Add Van'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolution Dialog - Required when marking previously-defective items as OK */}
      <Dialog open={showResolutionDialog} onOpenChange={(open) => {
        if (!open && pendingResolution) {
          // User cancelled - don't mark as OK
          setPendingResolution(null);
          setResolutionComment('');
        }
        setShowResolutionDialog(open);
      }}>
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Defect Resolution Required
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This item was defective in the previous inspection
            </DialogDescription>
          </DialogHeader>
          
          {pendingResolution && (
            <div className="py-4 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-sm text-amber-200">
                  <strong>Item {pendingResolution.itemNum}:</strong> {pendingResolution.itemDesc}
                </p>
                <p className="text-xs text-amber-300 mt-2">
                  This item was marked as defective in the last inspection. 
                  Please explain why it is now marked as OK.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="resolution-comment" className="text-white">
                  Resolution Explanation *
                </Label>
                <Textarea
                  id="resolution-comment"
                  value={resolutionComment}
                  onChange={(e) => setResolutionComment(e.target.value)}
                  placeholder="e.g., Light bulb replaced on Wednesday by Dave"
                  className="bg-input border-border text-white min-h-[100px]"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  This comment will be added to the action and marked as complete.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowResolutionDialog(false);
                setPendingResolution(null);
                setResolutionComment('');
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!resolutionComment.trim()) {
                  toast.error('Please provide an explanation', {
                    id: 'van-inspections-new-validation-resolution-comment-required',
                  });
                  return;
                }
                if (pendingResolution) {
                  // Mark as OK and store resolution comment
                  const key = `${pendingResolution.day}-${pendingResolution.itemNum}`;
                  setCheckboxStates(prev => ({ ...prev, [key]: 'ok' }));
                  setResolvedItems(prev => new Map(prev).set(key, resolutionComment.trim()));
                  
                  // Close dialog and reset
                  setShowResolutionDialog(false);
                  setPendingResolution(null);
                  setResolutionComment('');
                  
                  toast.success('Resolution recorded');
                }
              }}
              className="bg-green-600 hover:bg-green-700"
              disabled={!resolutionComment.trim()}
            >
              Mark as Resolved
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
        <DialogContent className="border-border text-white max-w-lg">
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

                const key = `${pendingRepeatDefect.day}-${pendingRepeatDefect.itemNum}`;
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

      {/* Confirmation Dialog - NEW SUBMISSIONS ONLY */}
      <Dialog 
        open={showConfirmSubmitDialog} 
        onOpenChange={(open) => {
          // Prevent closing while saving draft or if validation errors exist
          if (!open && (savingDraftFromConfirm || error)) return;
          // Clear error when dialog closes normally
          if (!open) setError('');
          setShowConfirmSubmitDialog(open);
        }}
      >
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Confirm Submission</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Before you submit, please confirm
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {/* Validation Error Display */}
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
                Have you finished using this van for the week?
              </p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Van inspections should be submitted <strong className="text-white">weekly</strong> when you&apos;re done using the van.
              </p>
              <p className="text-amber-400">
                Still using this van this week? Select &apos;Save Draft&apos; instead.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setError(''); // Clear validation errors
                setShowConfirmSubmitDialog(false);
              }}
              disabled={savingDraftFromConfirm}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setSavingDraftFromConfirm(true);
                try {
                  await saveInspection('draft');
                  // If save succeeds, saveInspection navigates away, so dialog closes automatically
                  // If save fails, error is shown and we keep dialog open
                } catch (error) {
                  // Error is already handled in saveInspection
                  // Keep dialog open so user can see the error and try again
                  console.error('Failed to save draft:', error);
                } finally {
                  // Only reset loading state if we're still on the page (save failed)
                  // If navigation happened, component unmounts so this doesn't matter
                  setSavingDraftFromConfirm(false);
                }
              }}
              disabled={savingDraftFromConfirm || loading || (informWorkshop && inspectorComments.trim().length < 10)}
              className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingDraftFromConfirm ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={validateAndSubmit}
              disabled={savingDraftFromConfirm || (informWorkshop && inspectorComments.trim().length < 10)}
              className="bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              Submit Daily Check
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mileage Warning Confirmation Dialog */}
      <Dialog open={showMileageWarningDialog} onOpenChange={setShowMileageWarningDialog}>
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Mileage Entry
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The mileage you entered requires confirmation
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-200">
                {activeMileageWarningMessage}
              </p>
            </div>
            
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Entered mileage:</strong> {currentMileage ? parseInt(currentMileage, 10).toLocaleString() : '0'} miles
              </p>
              {baselineMileage !== null && (
                <p className="text-sm text-muted-foreground">
                  <strong>Last recorded:</strong> {formatMileage(baselineMileage)}
                </p>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground">
              Please double-check the odometer reading. If the value is correct, click &quot;Confirm&quot; to continue.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowMileageWarningDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Edit Mileage
            </Button>
            <Button
              onClick={handleConfirmMileage}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Confirm Mileage is Correct
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Daily Check</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Please sign below to confirm your inspection is accurate
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

export default function NewInspectionPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading van inspection form..." />}>
      <NewInspectionContent />
    </Suspense>
  );
}
