'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isThisMonth } from 'date-fns';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClientServiceOutage } from '@/lib/hooks/useClientServiceOutage';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  canUseScopedAbsencePermission,
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { clearClientServiceOutage } from '@/lib/app-auth/client-service-health';
import { fetchAbsenceMessage } from '@/lib/client/absence-message';
import { fetchCurrentWorkShift, fetchWorkShiftMatrix } from '@/lib/client/work-shifts';
import { canOpenAbsenceManageArea } from '@/types/absence-permissions';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/page-loader';
import { ServiceUnavailableState } from '@/components/ui/service-unavailable-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { AbsenceScrollingMessage } from '@/app/(dashboard)/absence/components/AbsenceScrollingMessage';
import { AllowanceDetailsPanel } from '@/app/(dashboard)/absence/components/AllowanceDetailsPanel';
import {
  useAbsencesForUserFinancialYear,
  useAllAbsences,
  useAbsenceReasons,
  useAbsenceRealtimeQueryInvalidation,
  useAbsenceSummaryForUserFinancialYear,
  useCreateAbsence,
} from '@/lib/hooks/useAbsence';
import { formatDate, formatDateISO, calculateDurationDays, getFinancialYearMonths, getCurrentFinancialYear, getFinancialYear } from '@/lib/utils/date';
import { getWorkingDisplayDatesForAbsence } from '@/lib/utils/absence-calendar-display';
import { ANNUAL_LEAVE_MIN_REMAINING_DAYS } from '@/lib/utils/annual-leave';
import {
  canEmployeeSelfBookAbsenceRange,
  getEmployeeAbsenceSelfServiceDeadlineForRange,
} from '@/lib/utils/absence-self-service-deadline';
import { createStatusError, getErrorStatus, isAuthErrorStatus, isServerErrorStatus } from '@/lib/utils/http-error';
import {
  clearPageServiceError,
  getFirstPageServiceError,
  setPageServiceError,
  type PageServiceErrorMap,
} from '@/lib/utils/page-service-errors';
import type { WorkShiftPattern } from '@/types/work-shifts';

type GenerationStatus = {
  currentFinancialYearStartYear: number;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  latestGeneratedFinancialYearEndDate: string;
  nextFinancialYearStartYear: number;
  nextFinancialYearLabel: string;
  closedFinancialYearStartYears: number[];
};

type PageServiceRequestKey =
  | 'generationStatus'
  | 'absenceAnnouncement'
  | 'currentWorkShift';

interface ContactLineManagerTarget {
  id: string;
  status: string;
  date: string;
  endDate: string | null;
  reasonName: string;
}

const PAGE_SERVICE_ERROR_PRIORITY: readonly PageServiceRequestKey[] = [
  'generationStatus',
  'absenceAnnouncement',
  'currentWorkShift',
];

function isAnnualLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'annual leave';
}

function isUnpaidLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'unpaid leave';
}

function buildRequestLeaveDirtySnapshot({
  selectedReasonId,
  startDate,
  endDate,
  isHalfDay,
  halfDaySession,
  notes,
}: {
  selectedReasonId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM';
  notes: string;
}) {
  return JSON.stringify({
    selectedReasonId,
    startDate,
    endDate,
    isHalfDay,
    halfDaySession,
    notes,
  });
}

function getOldestOpenFinancialYearStartYear(
  currentFinancialYearStartYear: number,
  latestGeneratedFinancialYearStartYear: number,
  closedFinancialYearStartYears: number[]
): number {
  const closedYears = new Set(closedFinancialYearStartYears);
  for (let year = currentFinancialYearStartYear; year <= latestGeneratedFinancialYearStartYear; year += 1) {
    if (!closedYears.has(year)) {
      return year;
    }
  }
  return latestGeneratedFinancialYearStartYear;
}

function getReasonColor(name: string, color?: string | null): string {
  if (color && color.trim().length > 0) {
    return color;
  }

  const reasonName = name.trim().toLowerCase();
  const fallbackByReason: Record<string, string> = {
    'annual leave': '#8b5cf6',
    'unpaid leave': '#64748b',
    sickness: '#ef4444',
    'maternity leave': '#ec4899',
    'paternity leave': '#3b82f6',
    'public duties': '#14b8a6',
    'dependant emergency': '#f97316',
    'medical appointment': '#06b6d4',
    'parental leave': '#10b981',
    bereavement: '#6366f1',
    sabbatical: '#a855f7',
  };

  return fallbackByReason[reasonName] || '#6366f1';
}

function parseIsoDateAsLocalMidnight(isoDate: string): Date {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(isoDate);
  }

  return new Date(year, month - 1, day);
}

function getErrorMessage(error: unknown, fallback: string): string {
  const rawMessage = error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  const normalized = rawMessage.trim().toLowerCase();

  if (normalized.includes('new row violates row-level security policy for table "absences"')) {
    return 'This request could not be submitted with your current permissions. Please choose Annual Leave or Unpaid Leave, or contact your manager.';
  }

  return rawMessage;
}

function formatAbsenceRangeLabel(startDate: string, endDate: string | null): string {
  if (endDate && endDate !== startDate) {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }

  return formatDate(startDate);
}

function isExpectedAbsenceSubmissionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('annual leave request exceeds available allowance') ||
    normalized.includes('conflicts with an existing approved/pending booking') ||
    normalized.includes('conflicts with an existing approved/processed/pending booking') ||
    normalized.includes('half-day conflicts') ||
    normalized.includes('half-day is already booked') ||
    normalized.includes('financial year is closed for employee bookings') ||
    normalized.includes('could not be submitted with your current permissions') ||
    normalized.includes('not authenticated') ||
    normalized.includes('unauthorized') ||
    normalized.includes('session is locked') ||
    normalized.includes('jwt expired')
  );
}

function isExpectedAccessStatus(status: number | null): boolean {
  return isAuthErrorStatus(status) || status === 403;
}

export default function AbsencePage() {
  const { profile, isManager, isAdmin, isSuperAdmin } = useAuth();
  const clientServiceOutage = useClientServiceOutage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    hasPermission,
    loading: permissionLoading,
    serviceUnavailable: permissionServiceUnavailable,
  } = usePermissionCheck('absence');
  const shouldLoadSecondaryPermissions = hasPermission && !permissionServiceUnavailable && !clientServiceOutage;
  const {
    data: absenceSecondarySnapshot,
    isLoading: secondaryLoading,
    isFetchedAfterMount: secondaryFetchedAfterMount,
    serviceUnavailable: secondaryServiceUnavailable,
  } = useAbsenceSecondaryPermissions(shouldLoadSecondaryPermissions);
  const hasAbsenceSecondarySnapshot = Boolean(absenceSecondarySnapshot?.permissions && absenceSecondarySnapshot?.flags);
  const isSecondaryContextLoading =
    shouldLoadSecondaryPermissions &&
    !secondaryServiceUnavailable &&
    (secondaryLoading || (!secondaryFetchedAfterMount && !hasAbsenceSecondarySnapshot));
  const actorProfileId = profile?.id || '';
  const isAdminTier = Boolean(isAdmin || isSuperAdmin);
  const canViewBookings = Boolean(absenceSecondarySnapshot?.flags.can_view_bookings || isAdminTier || isManager);
  const canViewMoreThanOwnBookings = Boolean(
    isAdminTier ||
      absenceSecondarySnapshot?.permissions.see_bookings_all ||
      absenceSecondarySnapshot?.permissions.see_bookings_team
  );
  const canRequestLeave =
    isAdminTier ||
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
            profile_id: actorProfileId,
            team_id: absenceSecondarySnapshot.team_id || null,
          },
          {
            all: 'add_edit_bookings_all',
            team: 'add_edit_bookings_team',
            own: 'add_edit_bookings_own',
          }
        )
    );
  const canOpenManageLink = canOpenAbsenceManageArea({
    permissions: absenceSecondarySnapshot?.permissions,
    isAdminTier,
  });
  const [activeTab, setActiveTab] = useState<'calendar' | 'bookings'>('calendar');
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [generationStatusLoading, setGenerationStatusLoading] = useState(true);
  const [currentWorkShiftPattern, setCurrentWorkShiftPattern] = useState<WorkShiftPattern | null>(null);
  const [calendarWorkShiftPatterns, setCalendarWorkShiftPatterns] = useState<Record<string, WorkShiftPattern>>({});
  const [absenceAnnouncement, setAbsenceAnnouncement] = useState<string | null>(null);
  const [pageServiceErrors, setPageServiceErrors] = useState<PageServiceErrorMap<PageServiceRequestKey>>({});
  const pageServiceError = getFirstPageServiceError(
    pageServiceErrors,
    PAGE_SERVICE_ERROR_PRIORITY
  );
  const pageServiceErrorStatus = pageServiceError?.status ?? null;
  const pageServiceErrorMessage = pageServiceError?.message ?? null;
  const pageServiceUnavailable =
    pageServiceErrorMessage !== null &&
    (pageServiceErrorStatus === null || isServerErrorStatus(pageServiceErrorStatus));
  const shouldPauseDataLoading = Boolean(
    clientServiceOutage ||
    permissionServiceUnavailable ||
    secondaryServiceUnavailable ||
    pageServiceUnavailable
  );
  const canLoadAbsencePageData = hasPermission && !shouldPauseDataLoading;
  
  // Financial year months
  const currentFinancialYear = getCurrentFinancialYear();
  const currentFinancialYearStartYear = currentFinancialYear.start.getFullYear();
  const generationCurrentFinancialYearStartYear =
    generationStatus?.currentFinancialYearStartYear ?? currentFinancialYearStartYear;
  const latestGeneratedFinancialYearStartYear =
    generationStatus?.latestGeneratedFinancialYearStartYear || currentFinancialYearStartYear;

  const availableFinancialYearStartYears = useMemo(() => {
    const fromYear = Math.min(generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear);
    const toYear = Math.max(generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear);
    const years: number[] = [];
    for (let year = fromYear; year <= toYear; year += 1) {
      years.push(year);
    }
    return years.reverse();
  }, [generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear]);

  const oldestOpenFinancialYearStartYear = useMemo(
    () =>
      getOldestOpenFinancialYearStartYear(
        generationCurrentFinancialYearStartYear,
        latestGeneratedFinancialYearStartYear,
        generationStatus?.closedFinancialYearStartYears || []
      ),
    [generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear, generationStatus?.closedFinancialYearStartYears]
  );

  const [selectedFinancialYearStartYear, setSelectedFinancialYearStartYear] = useState(currentFinancialYearStartYear);

  useEffect(() => {
    if (!generationStatus) return;
    setSelectedFinancialYearStartYear(oldestOpenFinancialYearStartYear);
  }, [generationStatus, oldestOpenFinancialYearStartYear]);

  useEffect(() => {
    if (!availableFinancialYearStartYears.includes(selectedFinancialYearStartYear)) {
      setSelectedFinancialYearStartYear(oldestOpenFinancialYearStartYear);
    }
  }, [availableFinancialYearStartYears, selectedFinancialYearStartYear, oldestOpenFinancialYearStartYear]);

  const displayFinancialYear = useMemo(() => {
    const startYear = selectedFinancialYearStartYear;
    const label =
      startYear === generationStatus?.latestGeneratedFinancialYearStartYear && generationStatus?.latestGeneratedFinancialYearLabel
        ? generationStatus.latestGeneratedFinancialYearLabel
        : `${startYear}/${(startYear + 1).toString().slice(-2)}`;
    return {
      start: new Date(startYear, 3, 1),
      end: new Date(startYear + 1, 2, 31),
      label,
    };
  }, [selectedFinancialYearStartYear, generationStatus]);
  const bookingMaxDate = generationStatus?.latestGeneratedFinancialYearEndDate || formatDateISO(displayFinancialYear.end);
  const closedFinancialYearStartYears = useMemo(
    () => new Set(generationStatus?.closedFinancialYearStartYears || []),
    [generationStatus?.closedFinancialYearStartYears]
  );
  const isSelectedFinancialYearClosed = closedFinancialYearStartYears.has(selectedFinancialYearStartYear);
  const months = useMemo(() => getFinancialYearMonths(displayFinancialYear), [displayFinancialYear]);
  
  // Find current month index in financial year
  const initialMonthIndex = useMemo(() => {
    const index = months.findIndex(m => isThisMonth(m));
    return index >= 0 ? index : 0;
  }, [months]);
  
  const [currentMonthIndex, setCurrentMonthIndex] = useState(initialMonthIndex);
  const currentMonth = months[currentMonthIndex];

  useEffect(() => {
    setCurrentMonthIndex(initialMonthIndex);
  }, [initialMonthIndex]);
  
  const [showDayModal, setShowDayModal] = useState(false);
  const [contactLineManagerTarget, setContactLineManagerTarget] = useState<ContactLineManagerTarget | null>(null);
  const [contactLineManagerSubmitting, setContactLineManagerSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [bookingsPage, setBookingsPage] = useState(1);
  const BOOKINGS_PAGE_SIZE = 15;
  
  // Fetch data - use all absences for managers/admins
  const { data: userAbsences, isLoading: loadingUserAbsences } = useAbsencesForUserFinancialYear(
    {
      start: displayFinancialYear.start,
      end: displayFinancialYear.end,
    },
    { enabled: canLoadAbsencePageData }
  );
  const { data: allAbsencesData, isLoading: loadingAllAbsences } = useAllAbsences(
    canLoadAbsencePageData && canViewBookings
      ? {
          dateFrom: formatDateISO(displayFinancialYear.start),
          dateTo: formatDateISO(displayFinancialYear.end),
          includeArchived: true,
          matchOverlappingDateRange: true,
        }
      : undefined
  );
  const { data: summary, isLoading: loadingSummary } = useAbsenceSummaryForUserFinancialYear(
    {
      start: displayFinancialYear.start,
      end: displayFinancialYear.end,
    },
    { enabled: canLoadAbsencePageData }
  );
  const { data: reasons } = useAbsenceReasons({ enabled: canLoadAbsencePageData });
  const createAbsence = useCreateAbsence();
  useAbsenceRealtimeQueryInvalidation(canLoadAbsencePageData);
  
  const calendarAbsences = useMemo(() => {
    if (!canViewBookings) {
      return userAbsences?.filter((absence) => absence.status !== 'cancelled') || [];
    }

    if (!actorProfileId || !absenceSecondarySnapshot) {
      return userAbsences?.filter((absence) => absence.status !== 'cancelled') || [];
    }

    return (allAbsencesData || []).filter((absence) => {
      if (absence.status === 'cancelled') return false;
      if (isAdminTier) return true;
      return canUseScopedAbsencePermission(
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
      );
    });
  }, [
    canViewBookings,
    isAdminTier,
    actorProfileId,
    absenceSecondarySnapshot,
    userAbsences,
    allAbsencesData,
  ]);

  const calendarDisplayPatternByProfileId = useMemo(() => {
    const nextPatterns = { ...calendarWorkShiftPatterns };
    if (actorProfileId && currentWorkShiftPattern) {
      nextPatterns[actorProfileId] = currentWorkShiftPattern;
    }
    return nextPatterns;
  }, [calendarWorkShiftPatterns, actorProfileId, currentWorkShiftPattern]);

  const calendarAbsencesByDate = useMemo(() => {
    const absencesByDate = new Map<string, typeof calendarAbsences>();

    calendarAbsences.forEach((absence) => {
      const visibleDates = getWorkingDisplayDatesForAbsence(
        {
          date: absence.date,
          endDate: absence.end_date,
          isHalfDay: Boolean(absence.is_half_day),
          halfDaySession: absence.half_day_session,
        },
        calendarDisplayPatternByProfileId[absence.profile_id]
      );

      visibleDates.forEach((dateKey) => {
        const existingAbsences = absencesByDate.get(dateKey);
        if (existingAbsences) {
          existingAbsences.push(absence);
          return;
        }

        absencesByDate.set(dateKey, [absence]);
      });
    });

    return absencesByDate;
  }, [calendarAbsences, calendarDisplayPatternByProfileId]);
  
  const loadingAbsences = canViewBookings ? loadingAllAbsences : loadingUserAbsences;
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestDialogBaselineSnapshot, setRequestDialogBaselineSnapshot] = useState('');
  const currentRequestDialogSnapshot = buildRequestLeaveDirtySnapshot({
    selectedReasonId,
    startDate,
    endDate,
    isHalfDay,
    halfDaySession,
    notes,
  });
  const isRequestDialogDirty = showRequestDialog
    && Boolean(requestDialogBaselineSnapshot)
    && currentRequestDialogSnapshot !== requestDialogBaselineSnapshot;
  const {
    contentRef: requestDialogContentRef,
    handleOpenChange: handleRequestDialogOpenChange,
    handleInteractOutside: handleRequestDialogInteractOutside,
    handleEscapeKeyDown: handleRequestDialogEscapeKeyDown,
    discard: discardRequestDialog,
  } = useDirtyDialogGuard({
    isDirty: isRequestDialogDirty,
    disabled: submitting,
    onOpenChange: setShowRequestDialog,
  });

  function openRequestDialog(nextStartDate = '') {
    setStartDate(nextStartDate);
    setEndDate('');
    setIsHalfDay(false);
    setHalfDaySession('AM');
    setNotes('');
    setRequestDialogBaselineSnapshot(buildRequestLeaveDirtySnapshot({
      selectedReasonId,
      startDate: nextStartDate,
      endDate: '',
      isHalfDay: false,
      halfDaySession: 'AM',
      notes: '',
    }));
    setShowRequestDialog(true);
  }

  function resetRequestForm() {
    setStartDate('');
    setEndDate('');
    setIsHalfDay(false);
    setHalfDaySession('AM');
    setNotes('');
    setRequestDialogBaselineSnapshot(buildRequestLeaveDirtySnapshot({
      selectedReasonId,
      startDate: '',
      endDate: '',
      isHalfDay: false,
      halfDaySession: 'AM',
      notes: '',
    }));
  }

  const handleUnavailableError = useCallback((
    source: PageServiceRequestKey,
    error: unknown,
    fallbackMessage: string
  ): boolean => {
    const status = getErrorStatus(error);
    if (status === null || isServerErrorStatus(status)) {
      setPageServiceErrors((current) =>
        setPageServiceError(current, source, {
          status,
          message:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : fallbackMessage,
        })
      );
      return true;
    }

    return false;
  }, []);

  const clearUnavailableError = useCallback((source: PageServiceRequestKey) => {
    setPageServiceErrors((current) => clearPageServiceError(current, source));
  }, []);

  async function retryUnavailableState() {
    clearClientServiceOutage();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
  
  const loadGenerationStatus = useCallback(async () => {
    setGenerationStatusLoading(true);
    const errorContextId = 'absence-load-generation-status-error';
    try {
      const response = await fetch('/api/absence/generation/status', { cache: 'no-store' });
      const rawPayload = await response.text();
      let payload: (GenerationStatus & { error?: string }) | null = null;

      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload) as GenerationStatus & { error?: string };
        } catch (error) {
          throw createStatusError('Invalid booking window response payload', response.status, error);
        }
      }

      if (!response.ok) {
        throw createStatusError(payload?.error || 'Failed to load booking window', response.status);
      }
      if (!payload) {
        throw createStatusError('Booking window response is empty', response.status);
      }

      clearUnavailableError('generationStatus');
      setGenerationStatus(payload);
    } catch (error) {
      if (handleUnavailableError('generationStatus', error, 'Booking window is temporarily unavailable.')) {
        setGenerationStatus(null);
        return;
      }

      console.error('Error loading absence generation status:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to load booking window', { id: errorContextId });
    } finally {
      setGenerationStatusLoading(false);
    }
  }, [clearUnavailableError, handleUnavailableError]);

  useEffect(() => {
    if (permissionLoading || !canLoadAbsencePageData) {
      return;
    }
    void loadGenerationStatus();
  }, [canLoadAbsencePageData, loadGenerationStatus, permissionLoading]);

  const availableRequestReasons = useMemo(() => {
    const allActive = reasons || [];
    if (isManager || isAdmin) {
      return allActive;
    }
    return allActive.filter((reason) => isAnnualLeaveReason(reason.name) || isUnpaidLeaveReason(reason.name));
  }, [reasons, isManager, isAdmin]);
  
  useEffect(() => {
    if (!selectedReasonId && availableRequestReasons.length > 0) {
      const defaultReason =
        availableRequestReasons.find((reason) => isAnnualLeaveReason(reason.name)) || availableRequestReasons[0];
      if (defaultReason) {
        setSelectedReasonId(defaultReason.id);
      }
    }
  }, [availableRequestReasons, selectedReasonId]);

  useEffect(() => {
    if (selectedReasonId && !availableRequestReasons.some((reason) => reason.id === selectedReasonId)) {
      setSelectedReasonId('');
    }
  }, [availableRequestReasons, selectedReasonId]);

  useEffect(() => {
    async function loadAbsenceAnnouncement() {
      try {
        const payload = await fetchAbsenceMessage();
        clearUnavailableError('absenceAnnouncement');
        setAbsenceAnnouncement(payload.message);
      } catch (error) {
        if (handleUnavailableError('absenceAnnouncement', error, 'Absence announcement is temporarily unavailable.')) {
          setAbsenceAnnouncement(null);
          return;
        }

        console.error('Error loading absence announcement:', error);
      }
    }

    if (canLoadAbsencePageData) {
      void loadAbsenceAnnouncement();
    }
  }, [canLoadAbsencePageData, clearUnavailableError, handleUnavailableError]);

  useEffect(() => {
    async function loadCurrentWorkShift() {
      try {
        const payload = await fetchCurrentWorkShift();
        clearUnavailableError('currentWorkShift');
        setCurrentWorkShiftPattern(payload.pattern);
      } catch (error) {
        if (handleUnavailableError('currentWorkShift', error, 'Work shift data is temporarily unavailable.')) {
          setCurrentWorkShiftPattern(null);
          return;
        }

        const status = getErrorStatus(error);
        if (isExpectedAccessStatus(status)) {
          setCurrentWorkShiftPattern(null);
          console.warn('Skipping current work shift load due to access state:', error);
          return;
        }

        console.error('Error loading current work shift:', error);
      }
    }

    if (canLoadAbsencePageData) {
      void loadCurrentWorkShift();
    }
  }, [canLoadAbsencePageData, clearUnavailableError, handleUnavailableError]);

  useEffect(() => {
    if (!canLoadAbsencePageData || !canViewMoreThanOwnBookings) {
      setCalendarWorkShiftPatterns({});
      return;
    }

    let cancelled = false;

    async function loadCalendarWorkShifts() {
      try {
        const payload = await fetchWorkShiftMatrix();
        if (cancelled) {
          return;
        }

        const nextPatterns: Record<string, WorkShiftPattern> = {};
        payload.employees.forEach((employee) => {
          nextPatterns[employee.profile_id] = employee.pattern;
        });
        setCalendarWorkShiftPatterns(nextPatterns);
      } catch (error) {
        if (!cancelled) {
          setCalendarWorkShiftPatterns({});
        }
        console.warn(
          'Unable to load scoped work shifts for absence calendar display:',
          error instanceof Error ? error.message : error
        );
      }
    }

    void loadCalendarWorkShifts();

    return () => {
      cancelled = true;
    };
  }, [canLoadAbsencePageData, canViewMoreThanOwnBookings]);

  useEffect(() => {
    if (isSecondaryContextLoading) return;
    const requestedTab = searchParams.get('tab') || 'calendar';
    if (requestedTab === 'calendar' || requestedTab === 'bookings') {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('calendar');
    router.replace('/absence?tab=calendar', { scroll: false });
  }, [searchParams, router, isSecondaryContextLoading]);

  function handleTabChange(value: 'calendar' | 'bookings') {
    setActiveTab(value);
    router.replace(`/absence?tab=${value}`, { scroll: false });
  }

  const selectedReason = availableRequestReasons.find((reason) => reason.id === selectedReasonId);
  const deductsAllowance = selectedReason ? isAnnualLeaveReason(selectedReason.name) : false;
  const displayAllowance = useMemo(() => {
    return summary?.allowance ?? 0;
  }, [summary]);
  const displayApprovedTaken = summary?.approved_taken ?? 0;
  const displayPendingTotal = summary?.pending_total ?? 0;
  const calculatedRemaining = useMemo(() => {
    return displayAllowance - displayApprovedTaken - displayPendingTotal;
  }, [displayAllowance, displayApprovedTaken, displayPendingTotal]);
  
  // Calculate requested days
  const requestedDays = useMemo(() => {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    return calculateDurationDays(start, end, isHalfDay, {
      pattern: currentWorkShiftPattern,
      halfDaySession,
    });
  }, [startDate, endDate, isHalfDay, currentWorkShiftPattern, halfDaySession]);
  
  // Projected remaining after this request (annual leave only)
  const projectedRemaining = deductsAllowance
    ? calculatedRemaining - requestedDays
    : calculatedRemaining;

  function isClosedFinancialYearRequest(isoDate: string): boolean {
    const year = getFinancialYear(new Date(`${isoDate}T00:00:00`)).start.getFullYear();
    return closedFinancialYearStartYears.has(year);
  }
  
  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!canRequestLeave) {
      toast.error('You do not have permission to create or edit your own bookings.', {
        id: 'absence-submit-validation-permission-denied',
      });
      return;
    }
    
    if (!selectedReasonId || !selectedReason) {
      toast.error('Please select an absence reason', { id: 'absence-submit-validation-reason-required' });
      return;
    }
    
    if (!startDate) {
      toast.error('Please select a start date', { id: 'absence-submit-validation-start-date-required' });
      return;
    }

    if (startDate > bookingMaxDate || (endDate && endDate > bookingMaxDate)) {
      toast.error(`Leave can only be booked up to ${formatDate(bookingMaxDate)}.`, {
        id: 'absence-submit-validation-max-booking-window',
      });
      return;
    }

    if (isClosedFinancialYearRequest(startDate) || (endDate && isClosedFinancialYearRequest(endDate))) {
      toast.error('This financial year is closed for bookings.', {
        id: 'absence-submit-validation-financial-year-closed',
      });
      return;
    }

    if (!isAdminTier && !isManager && !canEmployeeSelfBookAbsenceRange(startDate, endDate || null)) {
      const deadline = getEmployeeAbsenceSelfServiceDeadlineForRange(startDate, endDate || null);
      toast.error(`Absences can only be booked until the Monday after that week (${formatDate(deadline)}). Please contact your manager.`, {
        id: 'absence-submit-validation-self-service-deadline',
      });
      return;
    }
    
    if (requestedDays <= 0) {
      toast.error('Selected dates do not include a working day', {
        id: 'absence-submit-validation-no-working-days',
      });
      return;
    }

    if (deductsAllowance && projectedRemaining < ANNUAL_LEAVE_MIN_REMAINING_DAYS) {
      toast.error('Insufficient annual leave allowance', { id: 'absence-submit-validation-insufficient-allowance' });
      return;
    }
    
    setSubmitting(true);
    const errorContextId = 'absence-submit-request-error';
    
    try {
      await createAbsence.mutateAsync({
        profile_id: profile!.id,
        date: startDate,
        end_date: endDate || null,
        reason_id: selectedReasonId,
        duration_days: requestedDays,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: 'pending',
        created_by: profile!.id,
      });
      
      toast.success(`${selectedReason.name} request submitted`);
      
      resetRequestForm();
      setShowRequestDialog(false);
      setShowDayModal(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to submit request');
      if (!isExpectedAbsenceSubmissionError(message)) {
        console.error('Error submitting request:', error, { errorContextId });
      }
      toast.error(message, { id: errorContextId });
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle day click
  function handleDayClick(day: Date) {
    setSelectedDate(day);
    setShowDayModal(true);
  }
  
  // Handle request from day modal
  function handleRequestFromDay() {
    if (!canRequestLeave) {
      toast.error('You do not have permission to create or edit your own bookings.', {
        id: 'absence-day-request-validation-permission-denied',
      });
      return;
    }
    if (selectedDate) {
      if (formatDateISO(selectedDate) > bookingMaxDate) {
        toast.error(`Leave can only be booked up to ${formatDate(bookingMaxDate)}.`, {
          id: 'absence-day-request-validation-max-booking-window',
        });
        return;
      }
      if (isClosedFinancialYearRequest(formatDateISO(selectedDate))) {
        toast.error('This financial year is closed for bookings.', {
          id: 'absence-day-request-validation-financial-year-closed',
        });
        return;
      }
      if (!isAdminTier && !isManager && !canEmployeeSelfBookAbsenceRange(formatDateISO(selectedDate))) {
        const deadline = getEmployeeAbsenceSelfServiceDeadlineForRange(formatDateISO(selectedDate));
        toast.error(`Absences can only be booked until the Monday after that week (${formatDate(deadline)}). Please contact your manager.`, {
          id: 'absence-day-request-validation-self-service-deadline',
        });
        return;
      }
      setShowDayModal(false);
      openRequestDialog(formatDateISO(selectedDate));
    }
  }
  
  function handleContactLineManager(
    id: string,
    status: string,
    date: string,
    endDate: string | null,
    reasonName: string
  ) {
    setContactLineManagerTarget({ id, status, date, endDate, reasonName });
  }

  async function confirmContactLineManager() {
    if (!contactLineManagerTarget) return;
    const contactErrorContextId = 'absence-contact-line-manager-error';
    setContactLineManagerSubmitting(true);
    try {
      const response = await fetch(`/api/absence/${contactLineManagerTarget.id}/contact-line-manager`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to contact line manager');
      }

      toast.success(payload?.message || 'Your line manager has been notified');
      setContactLineManagerTarget(null);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to contact line manager');
      console.error('Error contacting line manager:', error, { errorContextId: contactErrorContextId });
      toast.error(message, { id: contactErrorContextId });
    } finally {
      setContactLineManagerSubmitting(false);
    }
  }
  
  const activeBookings = useMemo(() => {
    const fyStart = displayFinancialYear.start;
    const fyEnd = displayFinancialYear.end;
    return (userAbsences || []).filter((absence) => {
      if (absence.status === 'cancelled') return false;
      const absenceStart = parseIsoDateAsLocalMidnight(absence.date);
      const absenceEnd = absence.end_date ? parseIsoDateAsLocalMidnight(absence.end_date) : absenceStart;
      return absenceStart <= fyEnd && absenceEnd >= fyStart;
    });
  }, [userAbsences, displayFinancialYear]);
  const bookingsTotalPages = Math.max(1, Math.ceil(activeBookings.length / BOOKINGS_PAGE_SIZE));
  const paginatedBookings = useMemo(
    () => activeBookings.slice((bookingsPage - 1) * BOOKINGS_PAGE_SIZE, bookingsPage * BOOKINGS_PAGE_SIZE),
    [activeBookings, bookingsPage]
  );

  const reasonLegend = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    (reasons || [])
      .filter((reason) => reason.is_active)
      .forEach((reason) => {
        map.set(reason.id, { name: reason.name, color: getReasonColor(reason.name, reason.color) });
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [reasons]);

  // Render calendar
  function renderCalendar() {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // Add padding for first week
    const startDay = getDay(monthStart);
    const paddingDays = startDay === 0 ? 6 : startDay - 1; // Monday = 0 padding
    
    return (
      <div className="grid grid-cols-7 gap-2">
        {/* Day headers */}
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
          <div key={day} className="text-center text-sm font-medium text-muted-foreground pb-2">
            {day}
          </div>
        ))}
        
        {/* Padding cells */}
        {Array.from({ length: paddingDays }).map((_, i) => (
          <div key={`padding-${i}`} />
        ))}
        
        {/* Day cells */}
        {days.map(day => {
          const dayAbsences = calendarAbsencesByDate.get(formatDateISO(day)) || [];
          const hasBankHoliday = dayAbsences.some((absence) => Boolean(absence.is_bank_holiday));
          
          return (
            <div
              key={day.toISOString()}
              onClick={() => handleDayClick(day)}
              className={`
                relative min-h-[80px] p-2 rounded-lg border cursor-pointer
                ${dayAbsences.length > 0
                  ? 'border-border bg-slate-800/40'
                  : 'border-slate-700 bg-slate-800/30'
                }
                ${hasBankHoliday ? 'ring-1 ring-amber-400/70 border-amber-500/40' : ''}
                hover:bg-slate-700/30 hover:border-purple-500/50 transition-colors
              `}
            >
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>{format(day, 'd')}</span>
                {hasBankHoliday && <span className="text-[9px] font-semibold text-amber-300">BH</span>}
              </div>
              
              {/* Employee list with bullet points */}
              {(isManager || isAdmin) && dayAbsences.length > 0 && (
                <div className="space-y-0.5 text-[10px]">
                  {dayAbsences.map(absence => (
                    <div key={absence.id} className="flex items-start gap-1">
                      {(() => {
                        const reasonColor = getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color);
                        const isHalfDay = Boolean(absence.is_half_day && absence.half_day_session);
                        const splitFill =
                          absence.half_day_session === 'AM'
                            ? `linear-gradient(to right, ${reasonColor} 0 50%, transparent 50% 100%)`
                            : `linear-gradient(to right, transparent 0 50%, ${reasonColor} 50% 100%)`;

                        return (
                          <div
                            className="h-2 w-2 rounded-full mt-1 flex-shrink-0 border"
                            style={{
                              background: isHalfDay ? splitFill : reasonColor,
                              borderColor: reasonColor,
                            }}
                            title={`${absence.absence_reasons.name}${isHalfDay ? ` (${absence.half_day_session})` : ''}`}
                          />
                        );
                      })()}
                      <span
                        className={`leading-tight truncate ${
                          absence.status === 'pending'
                            ? 'text-amber-300'
                            : absence.status === 'rejected'
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {absence.profiles?.full_name || 'Unknown'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Regular user - filled colour blocks */}
              {!(isManager || isAdmin) && dayAbsences.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[60%] overflow-hidden rounded-b-lg">
                  {(() => {
                    const unique = Array.from(
                      dayAbsences.reduce(
                        (map, absence) => {
                          const key = absence.reason_id;
                          if (!map.has(key)) map.set(key, absence);
                          return map;
                        },
                        new Map<string, typeof dayAbsences[number]>()
                      ).values()
                    );

                    const isHalf = dayAbsences.length === 1 && dayAbsences[0].is_half_day;
                    const halfSession = isHalf ? dayAbsences[0].half_day_session : null;

                    return unique.map((absence) => {
                      const color = getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color);
                      const isPending = absence.status === 'pending';
                      const isRejected = absence.status === 'rejected';

                      return (
                        <div
                          key={absence.reason_id}
                          className="absolute inset-0"
                          style={{
                            backgroundColor: color,
                            opacity: isPending ? 0.45 : isRejected ? 0.25 : 0.7,
                            clipPath: isHalf
                              ? halfSession === 'AM'
                                ? 'inset(0 50% 0 0)'
                                : 'inset(0 0 0 50%)'
                              : undefined,
                          }}
                          title={`${absence.absence_reasons.name}${isHalf ? ` (${halfSession})` : ''}${isPending ? ' – pending' : isRejected ? ' – rejected' : ''}`}
                        />
                      );
                    });
                  })()}

                  {dayAbsences.some(a => a.status === 'pending') && (
                    <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                      <span className="text-[8px] font-semibold text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                        PENDING
                      </span>
                    </div>
                  )}
                  {dayAbsences.every(a => a.status === 'rejected') && (
                    <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                      <span className="text-[8px] font-semibold text-red-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                        REJECTED
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  
  // Show loading while checking permissions
  const isBookingWindowLoading = canLoadAbsencePageData && generationStatusLoading && !generationStatus;
  const serviceUnavailableDescription =
    clientServiceOutage?.message ||
    pageServiceErrorMessage ||
    'Absence data loading has been paused to avoid repeated requests while the backend recovers.';

  if (!shouldPauseDataLoading && (permissionLoading || isSecondaryContextLoading || loadingAbsences || loadingSummary || isBookingWindowLoading)) {
    return (
      <PageLoader
        message={
          permissionLoading || isSecondaryContextLoading
            ? 'Checking access...'
            : isBookingWindowLoading
            ? 'Loading booking window...'
            : 'Loading absences...'
        }
      />
    );
  }

  if (shouldPauseDataLoading) {
    return (
      <ServiceUnavailableState
        title="Absence data temporarily unavailable"
        description={serviceUnavailableDescription}
        retryLabel="Retry absence page"
        onRetry={retryUnavailableState}
      />
    );
  }

  // If permission check failed, the hook will redirect to dashboard
  // This is just a safety check in case redirect fails
  if (!hasPermission) {
    return null;
  }
  
  return (
    <AppPageShell>
      <AppPageHeader
        title="Absence & Leave"
        description={canOpenManageLink
          ? 'Manage annual leave and view absence records'
          : 'Request annual leave and view your absence records'
        }
        contentClassName="sm:flex-row sm:items-start sm:justify-between"
        headingClassName="space-y-0"
        titleClassName="mb-2"
        descriptionClassName="text-base"
        actionsClassName="flex-col sm:w-auto sm:flex-row sm:items-center"
        actions={(
          <>
            {canOpenManageLink && (
              <Link href="/absence/manage" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full justify-center border-border text-muted-foreground sm:w-auto">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Absence
                </Button>
              </Link>
            )}
            <Button
              className="w-full justify-center bg-absence hover:bg-absence-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg sm:w-auto"
              onClick={() => openRequestDialog()}
              disabled={isSelectedFinancialYearClosed || !canRequestLeave}
            >
              <Plus className="h-4 w-4 mr-2" />
              Request Leave
            </Button>
          </>
        )}
      />
      
      {/* Summary Card */}
      <Card className="bg-gradient-to-br from-[hsl(var(--absence-primary))] to-[hsl(var(--absence-dark))] border-0 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <CalendarIcon className="h-5 w-5" />
            Annual Leave Summary ({displayFinancialYear.label})
          </CardTitle>
          <CardDescription className="text-purple-100">
            Financial Year: {formatDate(displayFinancialYear.start)} - {formatDate(displayFinancialYear.end)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-purple-100 mb-1">Total Allowance</p>
              <p className="text-3xl font-bold">{displayAllowance}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Approved Taken</p>
              <p className="text-3xl font-bold">{displayApprovedTaken}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Pending</p>
              <p className="text-3xl font-bold">{displayPendingTotal}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Remaining</p>
              <p className="text-3xl font-bold">{calculatedRemaining}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
          </div>
          <AbsenceScrollingMessage message={absenceAnnouncement} />
        </CardContent>
      </Card>
      
      <Dialog open={showRequestDialog} onOpenChange={handleRequestDialogOpenChange}>
        <DialogContent
          ref={requestDialogContentRef}
          className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden border-border p-0 sm:max-h-[90vh] sm:w-full sm:gap-6 sm:p-6"
          onInteractOutside={handleRequestDialogInteractOutside}
          onEscapeKeyDown={handleRequestDialogEscapeKeyDown}
        >
          <DialogHeader className="px-4 pt-4 text-left sm:px-0 sm:pt-0">
            <DialogTitle className="text-foreground">Request Leave</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Submit leave dates for approval in the current booking window.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-0 sm:py-0">
              <AllowanceDetailsPanel summary={summary} loading={loadingSummary} />
              <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reason" className="text-foreground font-medium">Absence reason</Label>
                    <p className="text-xs text-slate-400/90">Choose the leave type for this request.</p>
                    <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                      <SelectTrigger id="reason" className="bg-slate-950 border-border text-foreground">
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRequestReasons.map((reason) => (
                          <SelectItem key={reason.id} value={reason.id}>
                            {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-foreground font-medium">Duration options</Label>
                    <p className="text-xs text-slate-400/90">Tick for a half-day request.</p>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isHalfDay}
                        onChange={(e) => {
                          setIsHalfDay(e.target.checked);
                          if (e.target.checked) {
                            setEndDate('');
                          }
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
                            className="text-purple-500"
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
                            className="text-purple-500"
                          />
                          <span className="text-sm text-slate-400/90">PM</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="startDate" className="text-foreground font-medium">First day off</Label>
                    <p className="text-xs text-slate-400/90">
                      Select the first day you will be away from work.
                    </p>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        if (endDate && endDate < e.target.value) {
                          setEndDate('');
                        }
                      }}
                      min={formatDateISO(new Date())}
                      max={bookingMaxDate}
                      required
                      className="bg-slate-950 border-border text-foreground"
                    />
                    <p className="text-xs text-slate-400/90 mt-1">
                      Booking window currently ends on {formatDate(bookingMaxDate)}.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="endDate" className="text-foreground font-medium">Last day off</Label>
                    <p className="text-xs text-slate-400/90">
                      Leave blank for a single day. Disabled for half-day requests.
                    </p>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || formatDateISO(new Date())}
                      max={bookingMaxDate}
                      disabled={!startDate || isHalfDay}
                      className="bg-slate-950 border-border text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes" className="text-foreground font-medium">Notes (optional)</Label>
                  <p className="text-xs text-slate-400/90">Add any context your manager should see.</p>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any additional information..."
                    className="bg-slate-950 border-border text-foreground"
                  />
                </div>
              </div>

              {startDate && (
                <div className="bg-slate-800/30 p-4 rounded-lg space-y-2">
                  <h4 className="font-semibold text-foreground">Request Summary</h4>
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Requested Days:</span>
                      <span className="ml-2 text-foreground font-medium">{requestedDays}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Approved Taken:</span>
                      <span className="ml-2 text-foreground font-medium">{displayApprovedTaken}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pending:</span>
                      <span className="ml-2 text-foreground font-medium">{displayPendingTotal}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Projected Remaining:</span>
                      <span className={`ml-2 font-medium ${projectedRemaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {projectedRemaining}
                      </span>
                    </div>
                  </div>
                  {deductsAllowance && projectedRemaining < ANNUAL_LEAVE_MIN_REMAINING_DAYS && (
                    <div className="flex items-start gap-2 bg-red-500/20 p-3 rounded border border-red-500/30">
                      <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-300">
                        This request exceeds the allowed 2-day annual leave buffer. Please adjust the dates or contact your manager.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border bg-card px-4 py-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Button type="button" variant="outline" onClick={discardRequestDialog} className="border-border text-muted-foreground">
                {isRequestDialogDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setIsHalfDay(false);
                  setHalfDaySession('AM');
                  setNotes('');
                }}
                className="border-border text-muted-foreground"
              >
                Clear
              </Button>
              <Button
                type="submit"
                disabled={submitting || (deductsAllowance && projectedRemaining < ANNUAL_LEAVE_MIN_REMAINING_DAYS) || !startDate || !selectedReasonId}
                className="bg-absence hover:bg-absence-dark text-white"
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as 'calendar' | 'bookings')} className="w-full">
        <TabsList className="inline-flex w-auto bg-slate-800/50">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="bookings">My Bookings</TabsTrigger>
        </TabsList>
        
        {/* Calendar Tab */}
        <TabsContent value="calendar" className="space-y-6">
          {/* Calendar */}
          <Card className="">
            <CardHeader>
              <div className="flex items-center justify-between mb-4">
                <CardTitle className="text-foreground">
                  {format(currentMonth, 'MMMM yyyy')}
                </CardTitle>
                <div className="flex gap-2">
                  <Select
                    value={String(selectedFinancialYearStartYear)}
                    onValueChange={(value) => setSelectedFinancialYearStartYear(Number(value))}
                  >
                    <SelectTrigger className="w-[190px] border-border text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>{displayFinancialYear.label}</span>
                        {isSelectedFinancialYearClosed ? (
                          <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase">
                            Closed
                          </Badge>
                        ) : null}
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {availableFinancialYearStartYears.map((startYear) => {
                        const label = `${startYear}/${(startYear + 1).toString().slice(-2)}`;
                        const isClosedYearOption = closedFinancialYearStartYears.has(startYear);
                        return (
                          <SelectItem key={startYear} value={String(startYear)}>
                            <div className="flex items-center gap-2">
                              <span>{label}</span>
                              {isClosedYearOption ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase"
                                >
                                  Closed
                                </Badge>
                              ) : null}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonthIndex(Math.max(0, currentMonthIndex - 1))}
                    disabled={currentMonthIndex === 0}
                    className="border-border text-muted-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonthIndex(Math.min(months.length - 1, currentMonthIndex + 1))}
                    disabled={currentMonthIndex === months.length - 1}
                    className="border-border text-muted-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Legend */}
              <div className="flex flex-wrap gap-4 pt-4 text-sm border-t border-border">
                {reasonLegend.map((reason) => (
                  <div className="flex items-center gap-2" key={reason.name}>
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: reason.color }} />
                    <span className="text-muted-foreground">{reason.name}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="text-amber-300">Amber name</span>
                  <span className="text-muted-foreground">= pending request</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-400">Red name</span>
                  <span className="text-muted-foreground">= rejected request</span>
                </div>
              </div>
              {canViewMoreThanOwnBookings ? (
                <div className="mt-4 flex justify-center">
                  <p className="inline-flex items-center rounded-full border border-border/70 bg-slate-100/80 px-4 py-1.5 text-center text-sm text-muted-foreground shadow-sm dark:bg-slate-800/60 dark:text-slate-300">
                    This calendar shows absence and leave bookings only. It does not include days where the user is off
                    shift.
                  </p>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {renderCalendar()}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Bookings List Tab */}
        <TabsContent value="bookings">
          <Card className="">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-foreground">
                  My Absence Records ({displayFinancialYear.label})
                </CardTitle>
                <Select
                  value={String(selectedFinancialYearStartYear)}
                  onValueChange={(value) => setSelectedFinancialYearStartYear(Number(value))}
                >
                  <SelectTrigger className="w-full sm:w-[190px] border-border text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>{displayFinancialYear.label}</span>
                      {isSelectedFinancialYearClosed ? (
                        <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase">
                          Closed
                        </Badge>
                      ) : null}
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {availableFinancialYearStartYears.map((startYear) => {
                      const label = `${startYear}/${(startYear + 1).toString().slice(-2)}`;
                      const isClosedYearOption = closedFinancialYearStartYears.has(startYear);
                      return (
                        <SelectItem key={startYear} value={String(startYear)}>
                          <div className="flex items-center gap-2">
                            <span>{label}</span>
                            {isClosedYearOption ? (
                              <Badge
                                variant="outline"
                                className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase"
                              >
                                Closed
                              </Badge>
                            ) : null}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <CardDescription className="text-muted-foreground">
                All absences in the selected financial year
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeBookings.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarIcon className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No absences recorded</h3>
                  <p className="text-muted-foreground">Your absence records will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paginatedBookings.map(absence => {
                    const canCancel = 
                      (absence.status === 'pending' && new Date(absence.date) >= new Date()) ||
                      ((absence.status === 'approved' || absence.status === 'processed') && new Date(absence.date) >= new Date());
                    const canContactLineManager = canCancel;
                    
                    return (
                      <div
                        key={absence.id}
                        className="p-4 rounded-lg bg-slate-800/30 border border-border/50 hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-white">
                                {absence.absence_reasons.name}
                              </h3>
                              <Badge
                                variant="outline"
                                className={
                                  absence.status === 'approved'
                                    ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                    : absence.status === 'processed'
                                    ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                                    : absence.status === 'pending'
                                    ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                    : absence.status === 'rejected'
                                    ? 'border-red-500/30 text-red-400 bg-red-500/10'
                                    : 'border-slate-600 text-muted-foreground'
                                }
                              >
                                {absence.status}
                              </Badge>
                              {absence.absence_reasons.is_paid ? (
                                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                                  Paid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-slate-600 text-muted-foreground">
                                  Unpaid
                                </Badge>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-muted-foreground">
                              <div>
                                <span className="text-muted-foreground">Date:</span>{' '}
                                {absence.end_date && absence.date !== absence.end_date
                                  ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                  : formatDate(absence.date)
                                }
                                {absence.is_half_day && ` (${absence.half_day_session})`}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Duration:</span> {absence.duration_days} {absence.duration_days === 1 ? 'day' : 'days'}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Submitted:</span> {formatDate(absence.created_at)}
                              </div>
                            </div>
                            
                            {absence.notes && (
                              <p className="text-sm text-muted-foreground mt-2">
                                <span className="text-muted-foreground">Notes:</span> {absence.notes}
                              </p>
                            )}
                          </div>
                          
                          {canContactLineManager && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleContactLineManager(
                                  absence.id,
                                  absence.status,
                                  absence.date,
                                  absence.end_date,
                                  absence.absence_reasons.name
                                )
                              }
                              className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {bookingsTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(bookingsPage - 1) * BOOKINGS_PAGE_SIZE + 1}–{Math.min(bookingsPage * BOOKINGS_PAGE_SIZE, activeBookings.length)} of {activeBookings.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bookingsPage <= 1}
                          onClick={() => setBookingsPage((p) => p - 1)}
                          className="border-slate-600"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {bookingsPage} of {bookingsTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bookingsPage >= bookingsTotalPages}
                          onClick={() => setBookingsPage((p) => p + 1)}
                          className="border-slate-600"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Day Click Modal */}
      <Dialog open={showDayModal} onOpenChange={setShowDayModal}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl overflow-hidden border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogTitle>
            <DialogDescription className="text-slate-400/90">
              What would you like to do?
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {selectedDate && (() => {
              const dayAbsences = calendarAbsencesByDate.get(formatDateISO(selectedDate)) || [];
              
              if (dayAbsences.length > 0) {
                return (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">Absences on this day:</h4>
                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                      {dayAbsences.map(absence => {
                        const reasonColor = getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color);
                        return (
                          <div
                            key={absence.id}
                            className="rounded bg-slate-800/50 border border-border p-2.5"
                            style={{ borderLeftWidth: '3px', borderLeftColor: reasonColor }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium text-foreground flex items-center gap-2 text-sm leading-tight">
                                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: reasonColor }} />
                                {absence.absence_reasons.name}
                              </p>
                              <Badge
                                variant="outline"
                                className={
                                  absence.status === 'approved'
                                    ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                    : absence.status === 'processed'
                                    ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                                    : absence.status === 'pending'
                                    ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                    : 'border-slate-600 text-muted-foreground'
                                }
                              >
                                {absence.status}
                              </Badge>
                            </div>
                            <div className="mt-1.5 space-y-1">
                              {absence.is_bank_holiday && (
                                <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">
                                  Bank Holiday
                                </Badge>
                              )}
                              {(isManager || isAdmin) && absence.profiles && (
                                <p className="text-xs text-muted-foreground">{absence.profiles.full_name}</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Status: <span className="capitalize">{absence.status}</span>
                              </p>
                              {absence.notes && (
                                <p className="text-xs text-muted-foreground leading-snug">{absence.notes}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div className="py-6 text-center">
                    <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground mb-4">No absences on this day</p>
                    {selectedDate && formatDateISO(selectedDate) > bookingMaxDate && (
                      <p className="text-xs text-amber-400 mb-3">
                        This date is outside the current booking window ({formatDate(bookingMaxDate)}).
                      </p>
                    )}
                    {selectedDate && isClosedFinancialYearRequest(formatDateISO(selectedDate)) && (
                      <p className="text-xs text-amber-400 mb-3">
                        This financial year is closed for bookings.
                      </p>
                    )}
                    <Button
                      onClick={handleRequestFromDay}
                      disabled={Boolean(
                        selectedDate &&
                        (
                          formatDateISO(selectedDate) > bookingMaxDate ||
                          isClosedFinancialYearRequest(formatDateISO(selectedDate))
                        )
                      )}
                      className="bg-absence hover:bg-absence-dark text-white"
                    >
                      Request Leave
                    </Button>
                  </div>
                );
              }
            })()}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDayModal(false)}
              className="border-border text-muted-foreground"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(contactLineManagerTarget)}
        onOpenChange={(open) => {
          if (!open && !contactLineManagerSubmitting) {
            setContactLineManagerTarget(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Contact line manager</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Leave bookings cannot be cancelled in the app. We can send your line manager a notification now.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">
              Contact line manager
            </p>
            {contactLineManagerTarget && (
              <p className="mt-2 text-sm text-red-200/90">
                Type: {contactLineManagerTarget.reasonName}
                <br />
                Booking: {formatAbsenceRangeLabel(contactLineManagerTarget.date, contactLineManagerTarget.endDate)}
                {' '}({contactLineManagerTarget.status})
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContactLineManagerTarget(null)}
              className="border-border text-muted-foreground"
              disabled={contactLineManagerSubmitting}
            >
              Close
            </Button>
            <Button
              onClick={confirmContactLineManager}
              disabled={contactLineManagerSubmitting || !contactLineManagerTarget}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {contactLineManagerSubmitting ? 'Notifying...' : 'Notify line manager'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}

