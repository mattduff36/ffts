'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchAbsenceMessage, updateAbsenceMessage } from '@/lib/client/absence-message';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { fetchEmployeeWorkShift, fetchWorkShiftMatrix } from '@/lib/client/work-shifts';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowUpDown, Calendar, ChevronLeft, ChevronRight, Plus, Filter, Trash2, Search, ExternalLink, Wrench, Briefcase, Clock, Pencil, Lock } from 'lucide-react';
import { 
  useAllAbsences, 
  useAllAbsenceReasons,
  useCreateAbsence,
  useDeleteAbsence,
  useAbsenceSummaryForEmployee,
  useAbsenceRealtimeQueryInvalidation
} from '@/lib/hooks/useAbsence';
import { formatDate, calculateDurationDays } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { AbsenceReasonsContent } from '@/app/(dashboard)/absence/manage/components/AbsenceReasonsContent';
import { AllowancesContent } from '@/app/(dashboard)/absence/manage/components/AllowancesContent';
import { AbsenceCalendarAdmin } from '@/app/(dashboard)/absence/manage/components/AbsenceCalendarAdmin';
import {
  AbsenceEditDialog,
  type AbsenceEditDialogMode,
} from '@/app/(dashboard)/absence/manage/components/AbsenceEditDialog';
import { AbsenceAboutHelper } from '@/app/(dashboard)/absence/components/AbsenceAboutHelper';
import { AllowanceDetailsPanel } from '@/app/(dashboard)/absence/components/AllowanceDetailsPanel';
import { ManageOverviewAdminActions } from '@/app/(dashboard)/absence/manage/components/ManageOverviewAdminActions';
import { WorkShiftsContent } from '@/app/(dashboard)/absence/manage/components/WorkShiftsContent';
import { getErrorMessage, shouldLogAbsenceManageError } from '@/lib/utils/absence-error-handling';
import {
  buildAbsenceTimesheetImpactMessage,
  getLockedAbsenceTimesheetImpacts,
  resolveAbsenceTimesheetImpacts,
} from '@/lib/utils/absence-timesheet-impact';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  canUseScopedAbsencePermission,
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import { canOpenAbsenceManageArea } from '@/types/absence-permissions';
import type { AbsenceWithRelations } from '@/types/absence';
import type { WorkShiftPattern } from '@/types/work-shifts';

type ManageSortField = 'employee' | 'reason' | 'status' | 'date' | 'duration' | 'approved_at';
type ManageSortDirection = 'asc' | 'desc';
type ManageTab = 'overview' | 'calendar' | 'reasons' | 'allowances' | 'work-shifts';
type ProtectedManageTab = 'overview' | 'allowances' | 'reasons';
const ANNUAL_LEAVE_REASON_NAME = 'annual leave';

function normalizeReasonName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function isDirectoryAccessError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    message.includes('forbidden') ||
    message.includes('unauthorized') ||
    message.includes('jwt expired')
  );
}

export default function AdminAbsencePage() {
  const { profile, isAdmin, isManager, isSuperAdmin, isActualSuperAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canAccessAbsenceModule, loading: absencePermissionLoading } = usePermissionCheck('absence', false);
  const { data: absenceSecondarySnapshot, isLoading: absenceSecondaryLoading, isFetchedAfterMount: absenceSecondaryFetchedAfterMount } = useAbsenceSecondaryPermissions(
    canAccessAbsenceModule
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const isAdminTier = Boolean(isAdmin || isSuperAdmin);
  const canViewBookings = Boolean(absenceSecondarySnapshot?.flags.can_view_bookings || isAdminTier);
  const canAddEditBookings = Boolean(absenceSecondarySnapshot?.flags.can_add_edit_bookings || isAdminTier);
  const canViewAllowances = Boolean(absenceSecondarySnapshot?.flags.can_view_allowances || isAdminTier);
  const canAddEditAllowances = Boolean(absenceSecondarySnapshot?.flags.can_add_edit_allowances || isAdminTier);
  const canAuthoriseBookings = Boolean(absenceSecondarySnapshot?.flags.can_authorise_bookings || isAdminTier);
  const canViewOverviewTab = Boolean(absenceSecondarySnapshot?.flags.can_view_manage_overview || isAdminTier);
  const canViewOverviewAllScope = Boolean(absenceSecondarySnapshot?.flags.can_view_manage_overview_all || isAdminTier);
  const canViewOverviewTeamScope = Boolean(
    !canViewOverviewAllScope && absenceSecondarySnapshot?.flags.can_view_manage_overview_team
  );
  const canViewReasonsTab = Boolean(absenceSecondarySnapshot?.flags.can_view_manage_reasons || isAdminTier);
  const canViewWorkShiftsTab = Boolean(absenceSecondarySnapshot?.flags.can_view_manage_work_shifts || isAdminTier);
  const canViewWorkShiftsAllScope = Boolean(absenceSecondarySnapshot?.flags.can_view_manage_work_shifts_all || isAdminTier);
  const canEditWorkShifts = Boolean(absenceSecondarySnapshot?.flags.can_edit_manage_work_shifts || isAdminTier);
  const canEditWorkShiftsAllScope = Boolean(absenceSecondarySnapshot?.flags.can_edit_manage_work_shifts_all || isAdminTier);
  const canRunGlobalOverviewActions = Boolean(isAdminTier || canViewOverviewAllScope);
  const canOpenManagePage = canOpenAbsenceManageArea({
    permissions: absenceSecondarySnapshot?.permissions,
    isAdminTier,
  });
  const hasAbsenceSecondarySnapshot = Boolean(absenceSecondarySnapshot?.permissions && absenceSecondarySnapshot?.flags);
  const isAbsenceSecondaryContextLoading =
    canAccessAbsenceModule && (absenceSecondaryLoading || (!absenceSecondaryFetchedAfterMount && !hasAbsenceSecondarySnapshot));
  
  // Filters
  const [profileId, setProfileId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [listSearch, setListSearch] = useState('');

  // Sort + pagination
  const [sortField, setSortField] = useState<ManageSortField>('date');
  const [sortDirection, setSortDirection] = useState<ManageSortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;
  const [activeTab, setActiveTab] = useState<ManageTab>('overview');
  
  // Data
  const { data: absences, isLoading } = useAllAbsences({ 
    profileId, 
    dateFrom, 
    dateTo, 
    reasonId, 
    status,
    includeArchived,
  });
  const actorProfileId = profile?.id || '';
  const scopedAbsences = useMemo(() => {
    return (absences || []).filter((absence) => {
      const isAllowedByScope =
        isAdminTier ||
        (canViewBookings &&
          Boolean(
            actorProfileId &&
              absenceSecondarySnapshot &&
              canUseScopedAbsencePermission(
                {
                  permissions: absenceSecondarySnapshot.permissions,
                  team_id: absenceSecondarySnapshot.team_id,
                },
                actorProfileId,
                {
                  profile_id: absence.profile_id,
                  team_id: absence.profiles.team_id || null,
                },
                {
                  all: 'see_bookings_all',
                  team: 'see_bookings_team',
                  own: 'see_bookings_own',
                }
              )
          ));
      return isAllowedByScope;
    });
  }, [
    absences,
    actorProfileId,
    canViewBookings,
    absenceSecondarySnapshot,
    isAdminTier,
  ]);

  const overviewScopedAbsences = useMemo(() => {
    return scopedAbsences.filter((absence) => {
      if (isAdminTier || canViewOverviewAllScope) return true;
      if (!canViewOverviewTeamScope) return false;
      const targetTeamId = absence.profiles.team_id || null;
      return Boolean(
        absenceSecondarySnapshot?.team_id &&
          targetTeamId &&
          absenceSecondarySnapshot.team_id === targetTeamId
      );
    });
  }, [scopedAbsences, isAdminTier, canViewOverviewAllScope, canViewOverviewTeamScope, absenceSecondarySnapshot?.team_id]);

  const filteredAbsences = useMemo(() => {
    const term = listSearch.trim().toLowerCase();
    const filtered = overviewScopedAbsences.filter((absence) => {
      if (!term) return true;
      return (
        absence.profiles.full_name.toLowerCase().includes(term) ||
        (absence.profiles.employee_id || '').toLowerCase().includes(term) ||
        absence.absence_reasons.name.toLowerCase().includes(term) ||
        (absence.notes || '').toLowerCase().includes(term)
      );
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Keep pending leave requests at the top so managers/admins can review immediately.
      const pendingPriority = (statusValue: string) => (statusValue === 'pending' ? 0 : 1);
      const pendingOrder = pendingPriority(a.status) - pendingPriority(b.status);
      if (pendingOrder !== 0) {
        return pendingOrder;
      }

      switch (sortField) {
        case 'employee':
          return dir * a.profiles.full_name.localeCompare(b.profiles.full_name);
        case 'reason':
          return dir * a.absence_reasons.name.localeCompare(b.absence_reasons.name);
        case 'status':
          return dir * a.status.localeCompare(b.status);
        case 'date':
          return dir * a.date.localeCompare(b.date);
        case 'duration':
          return dir * ((a.duration_days || 0) - (b.duration_days || 0));
        case 'approved_at': {
          const aDate = a.approved_at || '';
          const bDate = b.approved_at || '';
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return dir * aDate.localeCompare(bDate);
        }
        default:
          return 0;
      }
    });
  }, [
    overviewScopedAbsences,
    listSearch,
    sortField,
    sortDirection,
  ]);
  const pendingCount = useMemo(
    () => overviewScopedAbsences.filter((absence) => absence.status === 'pending').length,
    [overviewScopedAbsences]
  );

  const totalPages = Math.max(1, Math.ceil(filteredAbsences.length / PAGE_SIZE));
  const paginatedAbsences = useMemo(
    () => filteredAbsences.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredAbsences, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [listSearch, sortField, sortDirection, profileId, dateFrom, dateTo, reasonId, status]);

  const { data: reasons } = useAllAbsenceReasons();
  const [profiles, setProfiles] = useState<
    Array<{ id: string; full_name: string; employee_id: string | null; team_id: string | null }>
  >([]);
  const [workShiftPatternByProfileId, setWorkShiftPatternByProfileId] = useState<Record<string, WorkShiftPattern>>({});
  const [absenceAnnouncementInput, setAbsenceAnnouncementInput] = useState('');
  const [savedAbsenceAnnouncement, setSavedAbsenceAnnouncement] = useState('');
  const [loadingAbsenceAnnouncement, setLoadingAbsenceAnnouncement] = useState(false);
  const [savingAbsenceAnnouncement, setSavingAbsenceAnnouncement] = useState(false);
  const [isAbsenceAnnouncementFocused, setIsAbsenceAnnouncementFocused] = useState(false);
  
  // Mutations
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();
  useAbsenceRealtimeQueryInvalidation();
  const [allowancesRefreshKey, setAllowancesRefreshKey] = useState(0);
  // Temporary gate is intentionally kept in code for future re-enable.
  const isProtectedTabGateEnabled = false;
  const [protectedTabsUnlocked, setProtectedTabsUnlocked] = useState(false);
  const [pendingProtectedTab, setPendingProtectedTab] = useState<ProtectedManageTab>('overview');
  const [isUnlockingProtectedTab, setIsUnlockingProtectedTab] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<AbsenceWithRelations | null>(null);
  const [editMode, setEditMode] = useState<AbsenceEditDialogMode>('full');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { data: selectedProfileSummary, isLoading: loadingSelectedProfileSummary } =
    useAbsenceSummaryForEmployee(selectedProfileId);
  
  const isProtectedTab = useCallback((tab: ManageTab): tab is ProtectedManageTab => {
    return tab === 'overview' || tab === 'allowances' || tab === 'reasons';
  }, []);

  const openPasswordGate = useCallback((tab: ProtectedManageTab) => {
    setPendingProtectedTab(tab);
    setPasswordInput('');
    setPasswordError('');
    setShowPasswordDialog(true);
  }, []);

  // Check admin/manager access
  useEffect(() => {
    if (
      !authLoading &&
      !absencePermissionLoading &&
      !isAbsenceSecondaryContextLoading &&
      (!canAccessAbsenceModule || !canOpenManagePage)
    ) {
      router.push('/dashboard');
    }
  }, [authLoading, absencePermissionLoading, isAbsenceSecondaryContextLoading, canAccessAbsenceModule, canOpenManagePage, router]);

  useEffect(() => {
    if (authLoading || isAbsenceSecondaryContextLoading) return;
    const tabParam = searchParams.get('tab');
    const resolvedTabParam = tabParam || 'calendar';
    if (!tabParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'calendar');
      if (includeArchived) {
        params.set('archived', '1');
      } else {
        params.delete('archived');
      }
      router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
    }
    const requestedTab = resolvedTabParam === 'records' ? 'overview' : resolvedTabParam;

    // While protected-tab unlock URL/state sync is in progress, keep the target tab rendered
    // so users never see a temporary fallback tab flash.
    if (isProtectedTabGateEnabled && isUnlockingProtectedTab) {
      setActiveTab(pendingProtectedTab);
      if (requestedTab === pendingProtectedTab) {
        setIsUnlockingProtectedTab(false);
      }
      return;
    }

    const allowedTabs: ManageTab[] = [];
    if (canViewBookings) {
      allowedTabs.push('calendar');
    }
    if (canViewOverviewTab) {
      allowedTabs.push('overview');
    }
    if (canViewAllowances) {
      allowedTabs.push('allowances');
    }
    if (canViewReasonsTab) {
      allowedTabs.push('reasons');
    }
    if (canViewWorkShiftsTab) {
      allowedTabs.push('work-shifts');
    }

    if (allowedTabs.length > 0 && allowedTabs.includes(requestedTab as typeof allowedTabs[number])) {
      if (isProtectedTabGateEnabled && isProtectedTab(requestedTab as ManageTab) && !protectedTabsUnlocked) {
        const params = new URLSearchParams(searchParams.toString());
        const protectedTabFallback = allowedTabs.includes('calendar') ? 'calendar' : allowedTabs[0];
        params.set('tab', protectedTabFallback);
        if (includeArchived) {
          params.set('archived', '1');
        } else {
          params.delete('archived');
        }
        setActiveTab(protectedTabFallback);
        router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
        openPasswordGate(requestedTab as ProtectedManageTab);
      } else {
        setActiveTab(requestedTab as ManageTab);
      }
    } else {
      const fallback = allowedTabs[0] || 'calendar';
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', fallback);
      if (includeArchived) {
        params.set('archived', '1');
      } else {
        params.delete('archived');
      }
      router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
    }
  }, [
    searchParams,
    authLoading,
    isAdmin,
    router,
    includeArchived,
    canViewBookings,
    canViewOverviewTab,
    canViewAllowances,
    canViewReasonsTab,
    canViewWorkShiftsTab,
    protectedTabsUnlocked,
    isProtectedTab,
    openPasswordGate,
    isProtectedTabGateEnabled,
    isUnlockingProtectedTab,
    pendingProtectedTab,
    isAbsenceSecondaryContextLoading,
  ]);

  useEffect(() => {
    const archivedParam = searchParams.get('archived');
    setIncludeArchived(archivedParam === '1');
  }, [searchParams]);

  useEffect(() => {
    const fallbackTab: ManageTab = canViewBookings
      ? 'calendar'
      : canViewAllowances
      ? 'allowances'
      : canViewOverviewTab
      ? 'overview'
      : canViewWorkShiftsTab
      ? 'work-shifts'
      : canViewReasonsTab
      ? 'reasons'
      : 'calendar';

    if (!canViewReasonsTab && activeTab === 'reasons') {
      setActiveTab(fallbackTab);
    }
    if (!canViewWorkShiftsTab && activeTab === 'work-shifts') {
      setActiveTab(fallbackTab);
    }
  }, [
    canViewReasonsTab,
    canViewWorkShiftsTab,
    activeTab,
    canViewBookings,
    canViewAllowances,
    canViewOverviewTab,
  ]);

  useEffect(() => {
    async function loadAbsenceAnnouncement() {
      setLoadingAbsenceAnnouncement(true);
      try {
        const payload = await fetchAbsenceMessage();
        const message = payload.message || '';
        setAbsenceAnnouncementInput(message);
        setSavedAbsenceAnnouncement(message);
      } catch (error) {
        const errorContextId = 'absence-manage-load-announcement-error';
        console.error('Error loading absence announcement:', error, { errorContextId });
        toast.error('Failed to load absence message', { id: errorContextId });
      } finally {
        setLoadingAbsenceAnnouncement(false);
      }
    }

    if (isAdmin) {
      void loadAbsenceAnnouncement();
    }
  }, [isAdmin]);

  const hasUnsavedAbsenceAnnouncement = absenceAnnouncementInput.trim() !== savedAbsenceAnnouncement.trim();

  function handleTabChange(nextTab: ManageTab) {
    if (!canViewReasonsTab && nextTab === 'reasons') return;
    if (!canViewWorkShiftsTab && nextTab === 'work-shifts') return;
    if (!canViewAllowances && nextTab === 'allowances') return;
    if (!canViewBookings && nextTab === 'calendar') return;
    if (!canViewOverviewTab && nextTab === 'overview') return;
    if (isProtectedTabGateEnabled && isProtectedTab(nextTab) && !protectedTabsUnlocked) {
      openPasswordGate(nextTab);
      return;
    }
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    if (includeArchived) {
      params.set('archived', '1');
    } else {
      params.delete('archived');
    }
    router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
  }

  const unlockProtectedTab = useCallback((tab: ProtectedManageTab) => {
    setPendingProtectedTab(tab);
    setIsUnlockingProtectedTab(true);
    setProtectedTabsUnlocked(true);
    setShowPasswordDialog(false);
    setPasswordInput('');
    setPasswordError('');
    setActiveTab(tab);

    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    if (includeArchived) {
      params.set('archived', '1');
    } else {
      params.delete('archived');
    }
    router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
  }, [searchParams, includeArchived, router]);

  const handlePasswordSubmit = useCallback(() => {
    const unlockCode =
      process.env.NEXT_PUBLIC_ABSENCE_MANAGE_UNLOCK_CODE || 'template-unlock-code';

    if (passwordInput === unlockCode) {
      unlockProtectedTab(pendingProtectedTab);
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
      setTimeout(() => passwordInputRef.current?.focus(), 0);
    }
  }, [passwordInput, pendingProtectedTab, unlockProtectedTab]);

  const handleSuperAdminBypass = useCallback(() => {
    if (!isActualSuperAdmin) {
      return;
    }

    unlockProtectedTab(pendingProtectedTab);
  }, [isActualSuperAdmin, pendingProtectedTab, unlockProtectedTab]);

  function handlePasswordDialogClose() {
    setShowPasswordDialog(false);
    setPasswordInput('');
    setPasswordError('');
  }

  async function handleSaveAbsenceAnnouncement(nextMessage: string | null = absenceAnnouncementInput) {
    setIsAbsenceAnnouncementFocused(false);
    setSavingAbsenceAnnouncement(true);
    try {
      const payload = await updateAbsenceMessage(nextMessage);
      const message = payload.message || '';
      setAbsenceAnnouncementInput(message);
      setSavedAbsenceAnnouncement(message);
      setIsAbsenceAnnouncementFocused(false);
      toast.success(message ? 'Absence message updated' : 'Absence message cleared');
    } catch (error) {
      const errorContextId = 'absence-manage-save-announcement-error';
      console.error('Error saving absence announcement:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to save absence message', { id: errorContextId });
    } finally {
      setIsAbsenceAnnouncementFocused(false);
      setSavingAbsenceAnnouncement(false);
    }
  }

  function handleIncludeArchivedChange(nextValue: boolean) {
    setIncludeArchived(nextValue);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', activeTab);
    if (nextValue) {
      params.set('archived', '1');
    } else {
      params.delete('archived');
    }
    router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
  }
  
  // Fetch profiles
  useEffect(() => {
    if (authLoading || !canOpenManagePage) {
      return;
    }

    async function fetchProfiles() {
      try {
        const [directory, workShiftMatrix] = await Promise.all([
          fetchUserDirectory(),
          canViewWorkShiftsTab ? fetchWorkShiftMatrix() : Promise.resolve(null),
        ]);
        setProfiles(
          directory.map((profile) => ({
            id: profile.id,
            full_name: profile.full_name || 'Unknown User',
            employee_id: profile.employee_id,
            team_id: profile.team?.id || null,
          }))
        );

        if (workShiftMatrix) {
          const nextPatternByProfileId: Record<string, WorkShiftPattern> = {};
          workShiftMatrix.employees.forEach((employee) => {
            nextPatternByProfileId[employee.profile_id] = employee.pattern;
          });
          setWorkShiftPatternByProfileId(nextPatternByProfileId);
        }
      } catch (error) {
        if (isDirectoryAccessError(error)) {
          console.warn('Skipping profile directory load due permissions/session');
          setProfiles([]);
          setWorkShiftPatternByProfileId({});
          return;
        }
        console.error('Error fetching profiles:', error);
        return;
      }
    }
    
    void fetchProfiles();
  }, [authLoading, canOpenManagePage, canViewWorkShiftsTab]);

  useEffect(() => {
    async function loadSelectedProfileShift() {
      if (!selectedProfileId || workShiftPatternByProfileId[selectedProfileId]) {
        return;
      }

      try {
        const payload = await fetchEmployeeWorkShift(selectedProfileId);
        setWorkShiftPatternByProfileId((current) => ({
          ...current,
          [selectedProfileId]: payload.pattern,
        }));
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to load selected employee work shift');
        if (shouldLogAbsenceManageError(error)) {
          console.error('Error loading selected employee work shift:', error);
        } else {
          console.warn('Skipping selected employee work shift load:', message);
        }
      }
    }

    void loadSelectedProfileShift();
  }, [selectedProfileId, workShiftPatternByProfileId]);

  const profileTeamIdById = useMemo(() => {
    const map = new Map<string, string | null>();
    profiles.forEach((entry) => {
      map.set(entry.id, entry.team_id || null);
    });
    return map;
  }, [profiles]);

  const canPerformScopedBookingAction = useCallback(
    (targetProfileId: string, targetTeamId: string | null, mode: 'view' | 'edit') => {
      if (isAdminTier) return true;
      if (!actorProfileId || !absenceSecondarySnapshot) return false;

      const keys =
        mode === 'view'
          ? {
              all: 'see_bookings_all' as const,
              team: 'see_bookings_team' as const,
              own: 'see_bookings_own' as const,
            }
          : {
              all: 'add_edit_bookings_all' as const,
              team: 'add_edit_bookings_team' as const,
              own: 'add_edit_bookings_own' as const,
            };

      return canUseScopedAbsencePermission(
        {
          permissions: absenceSecondarySnapshot.permissions,
          team_id: absenceSecondarySnapshot.team_id,
        },
        actorProfileId,
        {
          profile_id: targetProfileId,
          team_id: targetTeamId,
        },
        keys
      );
    },
    [isAdminTier, actorProfileId, absenceSecondarySnapshot]
  );
  
  // Calculate duration
  const duration = startDate 
    ? calculateDurationDays(
        new Date(startDate),
        endDate ? new Date(endDate) : null,
        isHalfDay,
        {
          pattern: selectedProfileId ? workShiftPatternByProfileId[selectedProfileId] : undefined,
          halfDaySession,
        }
      )
    : 0;
  
  function handleSort(field: ManageSortField) {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'approved_at' || field === 'date' ? 'desc' : 'asc');
  }

  function formatDuration(days: number): string {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  function isAnnualLeaveAbsence(absence: AbsenceWithRelations): boolean {
    return normalizeReasonName(absence.absence_reasons.name) === ANNUAL_LEAVE_REASON_NAME;
  }

  function canEditAbsenceByScope(absence: AbsenceWithRelations): boolean {
    const targetTeamId = absence.profiles.team_id || profileTeamIdById.get(absence.profile_id) || null;
    return (
      canAddEditBookings &&
      canPerformScopedBookingAction(absence.profile_id, targetTeamId, 'edit') &&
      absence.record_source !== 'archived'
    );
  }

  function getAbsenceEditMode(absence: AbsenceWithRelations): AbsenceEditDialogMode | null {
    if (!canEditAbsenceByScope(absence)) {
      return null;
    }

    const isProtectedConfirmedBooking =
      (absence.status === 'approved' || absence.status === 'processed') &&
      (absence.is_bank_holiday || absence.auto_generated || Boolean(absence.bulk_batch_id));

    if (isProtectedConfirmedBooking) {
      return isAnnualLeaveAbsence(absence) ? 'override-only' : null;
    }

    return 'full';
  }

  function canDeleteAbsence(absence: AbsenceWithRelations): boolean {
    return (
      canEditAbsenceByScope(absence) &&
      !absence.is_bank_holiday &&
      !absence.auto_generated
    );
  }

  async function confirmAbsenceTimesheetImpactBeforeSave(): Promise<boolean> {
    const selectedReasonName = reasons?.find((reason) => reason.id === selectedReasonId)?.name || '';
    if (!selectedReasonName || !selectedProfileId || !startDate) return true;

    const impacts = await resolveAbsenceTimesheetImpacts(supabase, {
      profileId: selectedProfileId,
      startDate,
      endDate: isHalfDay ? null : endDate || null,
      isHalfDay,
    });
    const message = buildAbsenceTimesheetImpactMessage(selectedReasonName, impacts);
    if (!message) return true;
    if (getLockedAbsenceTimesheetImpacts(impacts).length > 0) {
      window.alert(message);
      return false;
    }

    return window.confirm(message);
  }

  // Handle create
  async function handleCreate() {
    if (!selectedProfileId || !selectedReasonId || !startDate) {
      toast.error('Please fill in all required fields', { id: 'absence-manage-create-validation-required-fields' });
      return;
    }

    if (
      !canAddEditBookings ||
      !canPerformScopedBookingAction(selectedProfileId, profileTeamIdById.get(selectedProfileId) || null, 'edit')
    ) {
      toast.error('You do not have permission to create bookings for this user', {
        id: 'absence-manage-create-validation-permission-denied',
      });
      return;
    }
    
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const canContinue = await confirmAbsenceTimesheetImpactBeforeSave();
      if (!canContinue) return;
      
      await createAbsence.mutateAsync({
        profile_id: selectedProfileId,
        date: startDate,
        end_date: endDate || null,
        reason_id: selectedReasonId,
        duration_days: duration,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: 'approved',
        created_by: user.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      });
      
      toast.success('Absence created and approved');
      setAllowancesRefreshKey((k) => k + 1);
      
      // Reset form
      setSelectedProfileId('');
      setSelectedReasonId('');
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setNotes('');
      setShowCreateDialog(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to create absence');
      const errorContextId = 'absence-manage-create-error';
      if (shouldLogAbsenceManageError(error)) {
        console.error('Error creating absence:', error, { errorContextId });
      } else {
        console.warn('Create absence request rejected:', message);
      }
      toast.error(message, { id: errorContextId });
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle delete
  function handleDelete(id: string) {
    setDeleteTargetId(id);
    setShowDeleteDialog(true);
  }

  async function confirmDeleteAbsence() {
    if (!deleteTargetId) return;
    setDeleteSubmitting(true);
    try {
      await deleteAbsence.mutateAsync(deleteTargetId);
      toast.success('Absence deleted');
      setAllowancesRefreshKey((k) => k + 1);
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to delete absence');
      const errorContextId = 'absence-manage-delete-error';
      if (shouldLogAbsenceManageError(error)) {
        console.error('Error deleting:', error, { errorContextId });
      } else {
        console.warn('Delete absence request rejected:', message);
      }
      toast.error(message, { id: errorContextId });
    } finally {
      setDeleteSubmitting(false);
    }
  }
  
  if (authLoading || absencePermissionLoading || isAbsenceSecondaryContextLoading || isLoading) {
    return <PageLoader message="Loading absence management..." />;
  }
  
  if (!canAccessAbsenceModule || !canOpenManagePage) return null;
  
  return (
    <AppPageShell width="wide">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Absence Management
              </h1>
              <p className="text-muted-foreground">
                View and manage all employee absences
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {canAddEditBookings ? (
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="w-full sm:w-auto bg-absence hover:bg-absence-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Absence
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="hidden sm:block" aria-hidden="true" />
              <div className="flex justify-center sm:justify-self-center">
                <Label htmlFor="absence-announcement" className="text-center text-base font-semibold text-foreground">
                  Scrolling Absence Message:
                </Label>
              </div>
              <div className="flex items-center justify-end gap-2 sm:justify-self-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleSaveAbsenceAnnouncement()}
                  disabled={loadingAbsenceAnnouncement || savingAbsenceAnnouncement || !hasUnsavedAbsenceAnnouncement}
                  className="h-8 bg-absence px-3 hover:bg-absence-dark text-white"
                >
                  {savingAbsenceAnnouncement ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleSaveAbsenceAnnouncement('')}
                  disabled={loadingAbsenceAnnouncement || savingAbsenceAnnouncement || savedAbsenceAnnouncement.trim().length === 0}
                  className="h-8 border-border px-3 text-muted-foreground"
                >
                  Clear
                </Button>
              </div>
            </div>
            <div>
              <Input
                id="absence-announcement"
                value={absenceAnnouncementInput}
                onChange={(event) => setAbsenceAnnouncementInput(event.target.value)}
                onFocus={() => setIsAbsenceAnnouncementFocused(true)}
                onBlur={() => setIsAbsenceAnnouncementFocused(false)}
                placeholder={
                  loadingAbsenceAnnouncement
                    ? 'Loading current message...'
                    : 'Enter scrolling message. Leave blank to hide it. Shown on Absence & Leave module home page.'
                }
                disabled={loadingAbsenceAnnouncement || savingAbsenceAnnouncement}
                className={`bg-background border-border ${
                  !hasUnsavedAbsenceAnnouncement && !isAbsenceAnnouncementFocused
                    ? '!text-muted-foreground'
                    : '!text-foreground'
                }`}
                maxLength={500}
              />
            </div>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as ManageTab)} className="space-y-6">
        <TabsList>
          {canViewBookings && (
            <TabsTrigger value="calendar" className="gap-2">
              <Calendar className="h-4 w-4" />
              Calendar
            </TabsTrigger>
          )}
          {canViewWorkShiftsTab && (
            <TabsTrigger value="work-shifts" className="gap-2">
              <Clock className="h-4 w-4" />
              Work Shifts
            </TabsTrigger>
          )}
          {canViewAllowances && (
            <TabsTrigger value="allowances" className="gap-2">
              <Briefcase className="h-4 w-4" />
              Allowances
            </TabsTrigger>
          )}
          {canViewReasonsTab && (
            <TabsTrigger value="reasons" className="gap-2">
              <Filter className="h-4 w-4" />
              Reasons
            </TabsTrigger>
          )}
          {canViewOverviewTab && (
            <TabsTrigger value="overview" className="gap-2">
              <Wrench className="h-4 w-4" />
              Records & Admin
            </TabsTrigger>
          )}
        </TabsList>

        {canViewOverviewTab && (
          <TabsContent value="overview" className="space-y-6 mt-0">
            {(isAdmin || isManager) && (
              <Card className="border-border">
                <ManageOverviewAdminActions
                  canRunGlobalActions={canRunGlobalOverviewActions}
                  isTeamScoped={!canRunGlobalOverviewActions && canViewOverviewTeamScope}
                />
              </Card>
            )}

            {/* Absences Table */}
            {canViewBookings ? (
              <Card className="border-border">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="text-foreground">
                      Absence Records
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {filteredAbsences.length} records found{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
                    </CardDescription>
                  </div>
                  {pendingCount > 0 && canAuthoriseBookings && (
                    <Link href="/approvals?tab=absences" className="w-full md:w-auto">
                      <Button
                        variant="outline"
                        className="w-full md:w-auto border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Review Pending in Approvals
                      </Button>
                    </Link>
                  )}
                </div>
              </CardHeader>
              <CardContent>
              <div className="rounded-lg border border-border/60 bg-slate-900/20 p-4 mb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-foreground font-medium">
                    <Filter className="h-4 w-4" />
                    Filters
                  </h3>
                  {(profileId || dateFrom || dateTo || reasonId || status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setProfileId('');
                        setDateFrom('');
                        setDateTo('');
                        setReasonId('');
                        setStatus('');
                      }}
                      className="border-border text-muted-foreground"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <Label>Employee</Label>
                    <Select value={profileId || 'all'} onValueChange={(value) => setProfileId(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All employees" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All employees</SelectItem>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>From Date</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label>To Date</Label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label>Reason</Label>
                    <Select value={reasonId || 'all'} onValueChange={(value) => setReasonId(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All reasons" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All reasons</SelectItem>
                        {reasons?.map((reason) => (
                          <SelectItem key={reason.id} value={reason.id}>
                            {reason.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Status</Label>
                    <Select value={status || 'all'} onValueChange={(value) => setStatus(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="processed">Processed</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeArchived}
                      onChange={(event) => handleIncludeArchivedChange(event.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-muted-foreground">Include archived records</span>
                  </label>
                  <Link href="/absence/archive-report" className="text-sm text-absence hover:underline">
                    Open archive report
                  </Link>
                </div>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                  placeholder="Search records..."
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>

              {filteredAbsences.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">No absences found</h3>
                  <p className="text-muted-foreground">Try adjusting your filters</p>
                </div>
              ) : (
                <>
                  <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('employee')}>
                            <div className="flex items-center gap-2">Employee <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('reason')}>
                            <div className="flex items-center gap-2">Reason <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('date')}>
                            <div className="flex items-center gap-2">Date <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('duration')}>
                            <div className="flex items-center gap-2">Duration <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('approved_at')}>
                            <div className="flex items-center gap-2">Date Approved <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedAbsences.map((absence) => {
                          const nextEditMode = getAbsenceEditMode(absence);
                          const canEdit = Boolean(nextEditMode);
                          const canDelete = canDeleteAbsence(absence);

                          return (
                          <TableRow key={absence.id} className="border-slate-700 hover:bg-slate-800/30">
                            <TableCell className={
                              absence.status === 'pending'
                                ? 'text-amber-300'
                                : absence.status === 'processed'
                                ? 'text-blue-300'
                                : absence.status === 'rejected'
                                ? 'text-red-400'
                                : 'text-white'
                            }>
                              {absence.profiles.full_name}
                              {absence.profiles.employee_id && (
                                <span className="text-muted-foreground"> ({absence.profiles.employee_id})</span>
                              )}
                              {absence.record_source === 'archived' && (
                                <span className="ml-2 text-xs px-2 py-0.5 rounded border border-blue-500/30 text-blue-300">
                                  Archived
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={
                                    absence.absence_reasons.is_paid
                                      ? { backgroundColor: absence.absence_reasons.color || '#6b7280' }
                                      : { border: `1.5px solid ${absence.absence_reasons.color || '#6b7280'}` }
                                  }
                                />
                                <span className="text-muted-foreground">{absence.absence_reasons.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {absence.end_date && absence.date !== absence.end_date
                                ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                : formatDate(absence.date)}
                              {absence.is_half_day && ` (${absence.half_day_session})`}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDuration(absence.duration_days)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {absence.approved_at ? formatDate(absence.approved_at) : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      if (!nextEditMode) return;
                                      setEditMode(nextEditMode);
                                      setEditTarget(absence);
                                    }}
                                    className="px-2 text-absence hover:text-absence hover:bg-absence/10"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDelete(absence.id)}
                                    disabled={absence.record_source === 'archived'}
                                    className="px-2 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                                {canAuthoriseBookings && (absence.status === 'pending' || absence.status === 'approved') && absence.record_source !== 'archived' && (
                                  <Link href="/approvals?tab=absences">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                                    >
                                      Review
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden space-y-3">
                    {paginatedAbsences.map((absence) => {
                      const nextEditMode = getAbsenceEditMode(absence);
                      const canEdit = Boolean(nextEditMode);
                      const canDelete = canDeleteAbsence(absence);

                      return (
                      <div
                        key={absence.id}
                        className="p-4 rounded-lg bg-slate-800/30 border border-border/50 hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className={`font-semibold ${
                                absence.status === 'pending'
                                  ? 'text-amber-300'
                                  : absence.status === 'processed'
                                  ? 'text-blue-300'
                                  : absence.status === 'rejected'
                                  ? 'text-red-400'
                                  : 'text-white'
                              }`}>
                                {absence.profiles.full_name}
                                {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
                              </h3>
                              {absence.record_source === 'archived' && (
                                <span className="text-[10px] px-2 py-0.5 rounded border border-blue-500/30 text-blue-300">
                                  Archived
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={
                                  absence.absence_reasons.is_paid
                                    ? { backgroundColor: absence.absence_reasons.color || '#6b7280' }
                                    : { border: `1.5px solid ${absence.absence_reasons.color || '#6b7280'}` }
                                }
                              />
                              <span className="text-sm text-muted-foreground">{absence.absence_reasons.name}</span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {absence.end_date && absence.date !== absence.end_date
                                ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                : formatDate(absence.date)}
                              {absence.is_half_day && ` (${absence.half_day_session})`}
                              {' · '}{formatDuration(absence.duration_days)}
                              {absence.approved_at && ` · Approved ${formatDate(absence.approved_at)}`}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (!nextEditMode) return;
                                  setEditMode(nextEditMode);
                                  setEditTarget(absence);
                                }}
                                className="px-2 text-absence hover:text-absence hover:bg-absence/10"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(absence.id)}
                                disabled={absence.record_source === 'archived'}
                                className="px-2 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            {canAuthoriseBookings && (absence.status === 'pending' || absence.status === 'approved') && absence.record_source !== 'archived' && (
                              <Link href="/approvals?tab=absences">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                                >
                                  Review
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredAbsences.length)} of {filteredAbsences.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => p - 1)}
                          className="border-slate-600"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => p + 1)}
                          className="border-slate-600"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              </CardContent>
              </Card>
            ) : (
              <Card className="border-border">
                <CardContent className="py-12 text-center text-muted-foreground">
                  No booking records are available for your current permissions.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {canViewBookings && (
          <TabsContent value="calendar" className="space-y-6 mt-0">
            <AbsenceCalendarAdmin />
          </TabsContent>
        )}

        {canViewReasonsTab && (
          <TabsContent value="reasons" className="space-y-6 mt-0">
            <AbsenceReasonsContent />
          </TabsContent>
        )}

        {canViewAllowances && (
          <TabsContent value="allowances" className="space-y-6 mt-0">
            <AllowancesContent
              refreshKey={allowancesRefreshKey}
              isReadOnly={!canAddEditAllowances}
              scopeTeamOnly={!isAdminTier && canViewAllowances && !absenceSecondarySnapshot?.permissions.see_allowances_all}
              actorTeamId={absenceSecondarySnapshot?.team_id || null}
            />
          </TabsContent>
        )}

        {canViewWorkShiftsTab && (
          <TabsContent value="work-shifts" className="space-y-6 mt-0">
            <WorkShiftsContent
              isReadOnly={!canEditWorkShifts}
              scopeTeamOnly={!canViewWorkShiftsAllScope && !canEditWorkShiftsAllScope}
              actorTeamId={absenceSecondarySnapshot?.team_id || null}
            />
          </TabsContent>
        )}
      </Tabs>

      <AbsenceAboutHelper variant="manage" />

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Absence Entry</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Create an absence entry for any employee
            </DialogDescription>
          </DialogHeader>
          <AllowanceDetailsPanel
            summary={selectedProfileSummary}
            loading={Boolean(selectedProfileId) && loadingSelectedProfileSummary}
            empty={!selectedProfileId}
          />
          
          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Employee *</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Reason *</Label>
              <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                <SelectTrigger className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasons?.filter(r => r.is_active).map(reason => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">Start Date *</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && endDate < e.target.value) {
                      setEndDate('');
                    }
                  }}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
              
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">End Date (optional)</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  disabled={!startDate || isHalfDay}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Duration options</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={isHalfDay}
                  onChange={(e) => {
                    setIsHalfDay(e.target.checked);
                    if (e.target.checked) setEndDate('');
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm text-slate-400/90">Half Day</span>
              </div>
              
              {isHalfDay && (
                <div className="flex gap-3 pt-1">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="AM"
                      checked={halfDaySession === 'AM'}
                      onChange={() => setHalfDaySession('AM')}
                    />
                    <span className="text-sm text-slate-400/90">AM</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="PM"
                      checked={halfDaySession === 'PM'}
                      onChange={() => setHalfDaySession('PM')}
                    />
                    <span className="text-sm text-slate-400/90">PM</span>
                  </label>
                </div>
              )}
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="bg-slate-950 border-border text-foreground"
              />
            </div>
            
            
            {startDate && (
              <div className="bg-slate-800/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Duration: <span className="text-white font-medium">{formatDuration(duration)}</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !selectedProfileId || !selectedReasonId || !startDate}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AbsenceEditDialog
        absence={editTarget}
        reasons={reasons || []}
        mode={editMode}
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditMode('full');
          }
        }}
      />

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Absence</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Are you sure you want to delete this absence record? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">This will permanently remove the absence record.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteAbsence} disabled={deleteSubmitting || !deleteTargetId}>
              {deleteSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isProtectedTabGateEnabled ? (
        <Dialog open={showPasswordDialog} onOpenChange={(open) => { if (!open) handlePasswordDialogClose(); }}>
          <DialogContent className="border-border max-w-sm" onOpenAutoFocus={(e) => { e.preventDefault(); setTimeout(() => passwordInputRef.current?.focus(), 0); }}>
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Lock className="h-5 w-5 text-absence" />
                {pendingProtectedTab === 'overview'
                  ? 'Records & Admin — Protected'
                  : pendingProtectedTab === 'reasons'
                  ? 'Reasons — Protected'
                  : 'Allowances — Protected'}
              </DialogTitle>
              <DialogDescription className="text-slate-400/90">
                Enter the password to access the{' '}
                {pendingProtectedTab === 'overview'
                  ? 'Records & Admin'
                  : pendingProtectedTab === 'reasons'
                  ? 'Reasons'
                  : 'Allowances'}{' '}
                tab.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); handlePasswordSubmit(); }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="protected-tab-password" className="text-foreground font-medium">Password</Label>
                <Input
                  ref={passwordInputRef}
                  id="protected-tab-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); if (passwordError) setPasswordError(''); }}
                  placeholder="Enter password..."
                  className="bg-slate-950 border-border text-foreground"
                  autoComplete="off"
                />
                {passwordError && (
                  <p className="text-sm text-red-400">{passwordError}</p>
                )}
              </div>
              <DialogFooter>
                {isActualSuperAdmin && (
                  <Button
                    type="button"
                    onClick={handleSuperAdminBypass}
                    variant="outline"
                    className="border-red-500 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    SuperAdmin Bypass
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={handlePasswordDialogClose} className="border-border text-muted-foreground">
                  Cancel
                </Button>
                <Button type="submit" disabled={!passwordInput} className="bg-absence hover:bg-absence-dark text-white">
                  Unlock
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </AppPageShell>
  );
}

