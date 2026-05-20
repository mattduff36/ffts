'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { createClient } from '@/lib/supabase/client';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Clock, CheckCircle2, XCircle, User, Filter, Calendar, Package, LayoutGrid, Table2, Settings2, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { AbsenceWithRelations } from '@/types/absence';
import { AbsenceStatusFilter, TimesheetStatusFilter, StatusFilter } from '@/types/common';
import {
  useAllAbsences,
  useApproveAbsence,
  useProcessAbsence,
  useRejectAbsence,
  useAbsenceSummaryForEmployee,
  useAbsenceRealtimeQueryInvalidation,
} from '@/lib/hooks/useAbsence';
import {
  canUseScopedAbsencePermission,
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { filterEmployeesBySelectedTeam } from '@/lib/utils/absence-admin';
import { hasAccountsTimesheetFullVisibilityOverride } from '@/lib/utils/timesheet-visibility';
import { toast } from 'sonner';
import { TimesheetsApprovalTable, COLUMN_VISIBILITY_STORAGE_KEY, DEFAULT_COLUMN_VISIBILITY } from './components/TimesheetsApprovalTable';
import type { ColumnVisibility } from './components/TimesheetsApprovalTable';
import { AbsencesApprovalTable, ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY, DEFAULT_ABSENCE_COLUMN_VISIBILITY } from './components/AbsencesApprovalTable';
import type { AbsenceColumnVisibility } from './components/AbsencesApprovalTable';
import { ProcessTimesheetModal } from './components/ProcessTimesheetModal';
import { PageLoader } from '@/components/ui/page-loader';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import {
  type ApprovedAbsenceForTimesheet,
  getTimesheetWeekIsoBounds,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import {
  getErrorMessage,
  shouldLogAbsenceManageError,
} from '@/lib/utils/absence-error-handling';
import { isClientSessionPausedError } from '@/lib/app-auth/session-error';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import {
  getApprovalsTimesheetStatuses,
  getApprovalsDefaultStatusFilters,
  shouldIncludeTimesheetInAllSubmittedFilter,
} from '@/lib/utils/approvals-filters';

const APPROVALS_PAGE_SIZE = 50;

function isAnnualLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'annual leave';
}

interface TimesheetEntry {
  day_of_week: number;
  daily_total: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }>;
  working_in_yard: boolean;
  did_not_work: boolean;
}

interface TimesheetEntryWithTimesheetId extends TimesheetEntry {
  timesheet_id: string;
}

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
  timesheet_entries?: TimesheetEntry[];
  leave_total_display?: string;
  leave_worked_hours?: number;
  leave_days?: number;
}

interface ApprovedAbsenceForApprovals extends ApprovedAbsenceForTimesheet {
  profile_id: string;
}

interface FilterEmployee {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
}

type ApprovalsTab = 'timesheets' | 'absences';

function ApprovalsContent() {
  const { profile, isAdmin, isSuperAdmin } = useAuth();
  const { hasPermission: canViewApprovals, loading: permissionLoading } = usePermissionCheck('approvals', false);
  const { data: absenceSecondarySnapshot, isLoading: absenceSecondaryLoading } = useAbsenceSecondaryPermissions(
    canViewApprovals
  );
  const router = useRouter();
  const [tabParam, setTabParam] = useQueryState('tab', {
    shallow: true,
  });
  const supabase = createClient();
  const actorProfileId = profile?.id || '';
  const actorTeamId = absenceSecondarySnapshot?.team_id || null;
  const actorTeamName = absenceSecondarySnapshot?.team_name || null;
  const hasAccountsVisibilityOverride = hasAccountsTimesheetFullVisibilityOverride(
    absenceSecondarySnapshot?.role_name,
    absenceSecondarySnapshot?.team_name
  );
  const isAdminTier = Boolean(isAdmin || isSuperAdmin || hasAccountsVisibilityOverride);
  const activeTab: ApprovalsTab = tabParam === 'absences' ? 'absences' : 'timesheets';
  const defaultStatusFilters = useMemo(
    () => getApprovalsDefaultStatusFilters(actorTeamName),
    [actorTeamName]
  );
  
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedTimesheets, setHasLoadedTimesheets] = useState(false);
  const [timesheetFilter, setTimesheetFilter] = useState<TimesheetStatusFilter>(defaultStatusFilters.timesheets);
  const [absenceStatusFilter, setAbsenceStatusFilter] = useState<AbsenceStatusFilter>(defaultStatusFilters.absences);
  const statusFilter: StatusFilter = activeTab === 'timesheets' ? timesheetFilter : absenceStatusFilter;
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visibleTimesheetCount, setVisibleTimesheetCount] = useState(APPROVALS_PAGE_SIZE);
  const [visibleAbsenceCount, setVisibleAbsenceCount] = useState(APPROVALS_PAGE_SIZE);
  const [employees, setEmployees] = useState<FilterEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  // View mode (cards vs table) - persisted to localStorage per tab
  const [timesheetViewMode, setTimesheetViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('approvals-ts-view-mode') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });
  const [absenceViewMode, setAbsenceViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('approvals-abs-view-mode') as 'cards' | 'table') || 'table';
    }
    return 'table';
  });

  // Column visibility - timesheets
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  // Column visibility - absences
  const [absenceColumnVisibility, setAbsenceColumnVisibility] = useState<AbsenceColumnVisibility>(DEFAULT_ABSENCE_COLUMN_VISIBILITY);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
        setColumnVisibility(prev => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
    try {
      const saved = localStorage.getItem(ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AbsenceColumnVisibility>;
        setAbsenceColumnVisibility(prev => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggleAbsenceColumn = (column: keyof AbsenceColumnVisibility) => {
    setAbsenceColumnVisibility(prev => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Process modal state
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [processingTimesheetId, setProcessingTimesheetId] = useState<string | null>(null);
  const [processingInProgress, setProcessingInProgress] = useState(false);
  
  // Absence hooks
  const allAbsenceFilters = useMemo(() => ({
    includeArchived: false,
    status: absenceStatusFilter === 'all' ? undefined : absenceStatusFilter,
  }), [absenceStatusFilter]);
  const { data: absences, isLoading: absencesLoading } = useAllAbsences(allAbsenceFilters);
  const approveAbsence = useApproveAbsence();
  const processAbsence = useProcessAbsence();
  const rejectAbsence = useRejectAbsence();
  useAbsenceRealtimeQueryInvalidation();
  const canAuthoriseBookings = Boolean(
    absenceSecondarySnapshot?.flags.can_authorise_bookings ||
      isAdmin ||
      isSuperAdmin ||
      hasAccountsVisibilityOverride
  );
  const scopeTeamOnly = Boolean(
    !isAdminTier &&
      canAuthoriseBookings &&
      absenceSecondarySnapshot &&
      !absenceSecondarySnapshot.permissions.authorise_bookings_all &&
      absenceSecondarySnapshot.permissions.authorise_bookings_team
  );
  const isTeamFilterLocked = scopeTeamOnly;
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;

  useEffect(() => {
    if (tabParam === 'timesheets' || tabParam === 'absences') return;
    void setTabParam('timesheets');
  }, [tabParam, setTabParam]);

  useEffect(() => {
    if (activeTab === 'timesheets') {
      setTimesheetFilter(defaultStatusFilters.timesheets);
      return;
    }

    setAbsenceStatusFilter(defaultStatusFilters.absences);
  }, [activeTab, defaultStatusFilters.absences, defaultStatusFilters.timesheets]);

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }
    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  const employeeById = useMemo(() => {
    const map = new Map<string, FilterEmployee>();
    employees.forEach((employee) => {
      map.set(employee.id, employee);
    });
    return map;
  }, [employees]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((employee) => {
      if (!employee.team_id) return;
      if (!map.has(employee.team_id)) {
        map.set(employee.team_id, employee.team_name || employee.team_id);
      }
    });

    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const filteredEmployeeOptions = useMemo(
    () => filterEmployeesBySelectedTeam(employees, effectiveTeamFilter),
    [employees, effectiveTeamFilter]
  );

  const lockedTeamLabel =
    actorTeamName ||
    teamOptions.find((team) => team.value === actorTeamId)?.label ||
    (actorTeamId ? 'My Team' : 'No team assigned');

  const reportAbsenceActionError = useCallback((
    actionLabel: string,
    error: unknown,
    errorContextId: string,
    fallbackMessage: string
  ) => {
    const message = getErrorMessage(error, fallbackMessage);
    if (shouldLogAbsenceManageError(error)) {
      console.error(`${actionLabel}:`, error, { errorContextId });
    } else {
      console.warn(`${actionLabel}:`, message);
    }
    toast.error(message, { id: errorContextId });
  }, []);

  useEffect(() => {
    if (selectedEmployeeId === 'all') return;
    const employeeStillVisible = filteredEmployeeOptions.some((employee) => employee.id === selectedEmployeeId);
    if (!employeeStillVisible) {
      setSelectedEmployeeId('all');
    }
  }, [filteredEmployeeOptions, selectedEmployeeId]);

  useEffect(() => {
    if (!canViewApprovals) return;
    let isMounted = true;

    async function loadEmployees() {
      setEmployeesLoading(true);
      try {
        const directory = await fetchUserDirectory({ includeRole: true, limit: 500 });
        if (!isMounted) return;

        setEmployees(
          directory.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            employee_id: employee.employee_id || null,
            team_id: employee.team?.id || null,
            team_name: employee.team?.name || null,
          }))
        );
      } catch (error) {
        const errorContextId = 'approvals-load-filters-error';
        console.error('Error loading approvals filters:', error, { errorContextId });
        if (isMounted) {
          toast.error('Failed to load approvals filters', { id: errorContextId });
        }
      } finally {
        if (isMounted) {
          setEmployeesLoading(false);
        }
      }
    }

    void loadEmployees();

    return () => {
      isMounted = false;
    };
  }, [canViewApprovals]);

  const scopedAbsences = useMemo(() => {
    if (!canAuthoriseBookings) return [] as AbsenceWithRelations[];
    if (!absences || absences.length === 0) return [] as AbsenceWithRelations[];
    if (isAdminTier) return absences;
    if (!actorProfileId || !absenceSecondarySnapshot) return [] as AbsenceWithRelations[];

    return absences.filter((absence) =>
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
          all: 'authorise_bookings_all',
          team: 'authorise_bookings_team',
          own: 'authorise_bookings_own',
        }
      )
    );
  }, [absences, canAuthoriseBookings, isAdminTier, actorProfileId, absenceSecondarySnapshot]);

  const filteredAbsences = useMemo(() => {
    return scopedAbsences.filter((absence) => {
      if (absence.status === 'cancelled') return false;
      if (selectedEmployeeId !== 'all' && absence.profile_id !== selectedEmployeeId) return false;

      if (effectiveTeamFilter !== 'all') {
        const targetTeamId = absence.profiles.team_id || null;
        if (effectiveTeamFilter === 'unassigned') {
          if (targetTeamId) return false;
        } else if (targetTeamId !== effectiveTeamFilter) {
          return false;
        }
      }

      if (absenceStatusFilter !== 'all' && absence.status !== absenceStatusFilter) return false;
      const absenceEnd = absence.end_date || absence.date;
      if (dateFrom && absenceEnd < dateFrom) return false;
      if (dateTo && absence.date > dateTo) return false;
      return true;
    });
  }, [scopedAbsences, selectedEmployeeId, effectiveTeamFilter, absenceStatusFilter, dateFrom, dateTo]);

  const getScopedTimesheetsForCurrentActor = useCallback((rows: TimesheetWithProfile[]) => {
    if (rows.length === 0) return [] as TimesheetWithProfile[];
    if (isAdminTier) return rows;
    if (!canAuthoriseBookings || !actorProfileId || !absenceSecondarySnapshot) return [] as TimesheetWithProfile[];

    return rows.filter((timesheet) =>
      canUseScopedAbsencePermission(
        {
          permissions: absenceSecondarySnapshot.permissions,
          team_id: absenceSecondarySnapshot.team_id,
        },
        actorProfileId,
        {
          profile_id: timesheet.user_id,
          team_id: employeeById.get(timesheet.user_id)?.team_id || null,
        },
        {
          all: 'authorise_bookings_all',
          team: 'authorise_bookings_team',
          own: 'authorise_bookings_own',
        }
      )
    );
  }, [isAdminTier, canAuthoriseBookings, actorProfileId, absenceSecondarySnapshot, employeeById]);

  const getCurrentFilteredTimesheets = useCallback((rows: TimesheetWithProfile[]) => {
    return getScopedTimesheetsForCurrentActor(rows).filter((timesheet) => {
      if (selectedEmployeeId !== 'all' && timesheet.user_id !== selectedEmployeeId) return false;

      const targetTeamId = employeeById.get(timesheet.user_id)?.team_id || null;
      if (effectiveTeamFilter !== 'all') {
        if (effectiveTeamFilter === 'unassigned') {
          if (targetTeamId) return false;
        } else if (targetTeamId !== effectiveTeamFilter) {
          return false;
        }
      }

      if (timesheetFilter === 'all') {
        if (!shouldIncludeTimesheetInAllSubmittedFilter(timesheet.status)) return false;
      } else if (timesheetFilter === 'pending') {
        if (timesheet.status !== 'submitted') return false;
      } else if (timesheet.status !== timesheetFilter) {
        return false;
      }
      if (dateFrom && timesheet.week_ending < dateFrom) return false;
      if (dateTo && timesheet.week_ending > dateTo) return false;
      return true;
    });
  }, [
    getScopedTimesheetsForCurrentActor,
    selectedEmployeeId,
    employeeById,
    effectiveTeamFilter,
    timesheetFilter,
    dateFrom,
    dateTo,
  ]);

  const filteredTimesheets = useMemo(
    () => getCurrentFilteredTimesheets(timesheets),
    [timesheets, getCurrentFilteredTimesheets]
  );

  const visibleTimesheetCards = useMemo(
    () => filteredTimesheets.slice(0, visibleTimesheetCount),
    [filteredTimesheets, visibleTimesheetCount]
  );
  const visibleAbsenceCards = useMemo(
    () => filteredAbsences.slice(0, visibleAbsenceCount),
    [filteredAbsences, visibleAbsenceCount]
  );

  useEffect(() => {
    setVisibleTimesheetCount(APPROVALS_PAGE_SIZE);
  }, [selectedEmployeeId, effectiveTeamFilter, timesheetFilter, dateFrom, dateTo]);

  useEffect(() => {
    setVisibleAbsenceCount(APPROVALS_PAGE_SIZE);
  }, [selectedEmployeeId, effectiveTeamFilter, absenceStatusFilter, dateFrom, dateTo]);

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const timesheetStatuses = getApprovalsTimesheetStatuses(timesheetFilter);
      
      // Build a lightweight list first; entry details are fetched for all filtered rows (table pagination is UI-only).
      let timesheetQuery = supabase
        .from('timesheets')
        .select(`
          id,
          user_id,
          reg_number,
          week_ending,
          status,
          submitted_at,
          user:profiles!timesheets_user_id_fkey (
            full_name,
            employee_id
          )
        `);

      if (timesheetStatuses.length === 1) {
        timesheetQuery = timesheetQuery.eq('status', timesheetStatuses[0]);
      } else {
        timesheetQuery = timesheetQuery.in('status', [...timesheetStatuses]);
      }

      if (selectedEmployeeId !== 'all') {
        timesheetQuery = timesheetQuery.eq('user_id', selectedEmployeeId);
      }

      if (dateFrom) {
        timesheetQuery = timesheetQuery.gte('week_ending', dateFrom);
      }

      if (dateTo) {
        timesheetQuery = timesheetQuery.lte('week_ending', dateTo);
      }

      const { data: timesheetData, error: timesheetError } = await timesheetQuery
        .order('submitted_at', { ascending: false });

      if (timesheetError) throw timesheetError;
      const typedTimesheets = (timesheetData || []) as TimesheetWithProfile[];
      const timesheetsWithLeaveTotals = typedTimesheets.map((timesheet) => ({
        ...timesheet,
        timesheet_entries: undefined,
        leave_total_display: undefined,
        leave_worked_hours: undefined,
        leave_days: undefined,
      }));

      const timesheetsToEnrich = getCurrentFilteredTimesheets(timesheetsWithLeaveTotals);
      const timesheetIdsToEnrich = timesheetsToEnrich.map((timesheet) => timesheet.id);
      const userIds = [...new Set(timesheetsToEnrich.map((timesheet) => timesheet.user_id).filter(Boolean))];
      if (timesheetIdsToEnrich.length === 0 || userIds.length === 0) {
        setTimesheets(timesheetsWithLeaveTotals);
        return;
      }

      const weekBounds = timesheetsToEnrich.map((timesheet) => {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
        return {
          timesheetId: timesheet.id,
          profileId: timesheet.user_id,
          weekEnding: timesheet.week_ending,
          startIso,
          endIso,
        };
      });

      const minStartIso = weekBounds.reduce((min, row) => (row.startIso < min ? row.startIso : min), weekBounds[0].startIso);
      const maxEndIso = weekBounds.reduce((max, row) => (row.endIso > max ? row.endIso : max), weekBounds[0].endIso);

      const ENTRY_FETCH_CHUNK_SIZE = 150;
      const entryRows: TimesheetEntryWithTimesheetId[] = [];
      for (let offset = 0; offset < timesheetIdsToEnrich.length; offset += ENTRY_FETCH_CHUNK_SIZE) {
        const chunkIds = timesheetIdsToEnrich.slice(offset, offset + ENTRY_FETCH_CHUNK_SIZE);
        const { data: chunkEntries, error: chunkEntriesError } = await supabase
          .from('timesheet_entries')
          .select(`
            timesheet_id,
            day_of_week,
            daily_total,
            job_number,
            timesheet_entry_job_codes (
              job_number,
              display_order
            ),
            working_in_yard,
            did_not_work
          `)
          .in('timesheet_id', chunkIds);

        if (chunkEntriesError) throw chunkEntriesError;
        entryRows.push(...((chunkEntries || []) as TimesheetEntryWithTimesheetId[]));
      }

      const absencesResult = await supabase
        .from('absences')
        .select('profile_id, date, end_date, status, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
        .in('profile_id', userIds)
        .in('status', ['pending', 'approved', 'processed'])
        .lte('date', maxEndIso)
        .or(`end_date.gte.${minStartIso},and(end_date.is.null,date.gte.${minStartIso})`);

      if (absencesResult.error) throw absencesResult.error;

      const entriesByTimesheet = new Map<string, TimesheetEntry[]>();
      entryRows.forEach(({ timesheet_id, ...entry }) => {
        const existing = entriesByTimesheet.get(timesheet_id) || [];
        existing.push(entry);
        entriesByTimesheet.set(timesheet_id, existing);
      });

      const { data: absencesData, error: absencesError } = absencesResult;
      if (absencesError) throw absencesError;

      const approvedAbsences = (absencesData || []) as ApprovedAbsenceForApprovals[];
      const absencesByProfile = new Map<string, ApprovedAbsenceForApprovals[]>();
      approvedAbsences.forEach((absence) => {
        const existing = absencesByProfile.get(absence.profile_id) || [];
        existing.push(absence);
        absencesByProfile.set(absence.profile_id, existing);
      });

      const enrichedTimesheets = timesheetsToEnrich.map((timesheet) => {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
        const employeeAbsences = absencesByProfile.get(timesheet.user_id) || [];
        const weekAbsences = employeeAbsences.filter((absence) => {
          const absenceEnd = absence.end_date || absence.date;
          return absence.date <= endIso && absenceEnd >= startIso && absenceEnd >= minStartIso;
        });
        const offDayStates = resolveTimesheetOffDayStates(timesheet.week_ending, weekAbsences, null);
        const entries = entriesByTimesheet.get(timesheet.id) || [];
        const leaveAwareTotals = buildLeaveAwareTotals(entries, offDayStates);

        return {
          ...timesheet,
          timesheet_entries: entries,
          leave_total_display: leaveAwareTotals.weekly.display,
          leave_worked_hours: leaveAwareTotals.weekly.workedHours,
          leave_days: leaveAwareTotals.weekly.leaveDays,
        };
      });

      const enrichedById = new Map(enrichedTimesheets.map((timesheet) => [timesheet.id, timesheet]));
      setTimesheets(timesheetsWithLeaveTotals.map((timesheet) => enrichedById.get(timesheet.id) || timesheet));
    } catch (error) {
      const errorContextId = 'approvals-fetch-list-error';
      const shouldLogError =
        !isAuthErrorStatus(getErrorStatus(error)) &&
        !isClientSessionPausedError(error) &&
        !isNetworkFetchError(error);

      if (shouldLogError) {
        console.error('Error fetching approvals:', error, { errorContextId });
      }
      toast.error('Failed to load approvals', { id: errorContextId });
    } finally {
      setLoading(false);
      setHasLoadedTimesheets(true);
    }
  }, [
    dateFrom,
    dateTo,
    getCurrentFilteredTimesheets,
    selectedEmployeeId,
    supabase,
    timesheetFilter,
  ]);

  useEffect(() => {
    if (!permissionLoading) {
      if (!canViewApprovals) {
        router.push('/dashboard');
        return;
      }
      fetchApprovals();
    }
  }, [canViewApprovals, permissionLoading, router, fetchApprovals]);

  const handleQuickApprove = async (_type: 'timesheet', id: string) => {
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      // Refresh data
      await fetchApprovals();
    } catch (error) {
      const errorContextId = 'approvals-quick-approve-error';
      console.error('Error approving:', error, { errorContextId });
      toast.error('Failed to approve timesheet', { id: errorContextId });
    }
  };

  const handleQuickReject = async (_type: 'timesheet', id: string) => {
    const comments = prompt('Enter rejection reason:');
    if (!comments) return;

    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          manager_comments: comments,
        })
        .eq('id', id);
      if (error) throw error;

      // Refresh data
      await fetchApprovals();
    } catch (error) {
      const errorContextId = 'approvals-quick-reject-error';
      console.error('Error rejecting:', error, { errorContextId });
      toast.error('Failed to reject timesheet', { id: errorContextId });
    }
  };

  const handleOpenProcessModal = (id: string) => {
    setProcessingTimesheetId(id);
    setProcessModalOpen(true);
  };

  const handleConfirmProcess = async () => {
    if (!processingTimesheetId) return;

    try {
      setProcessingInProgress(true);
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', processingTimesheetId);

      if (error) throw error;

      toast.success('Timesheet marked as Manager Approved');
      setProcessModalOpen(false);
      setProcessingTimesheetId(null);
      await fetchApprovals();
    } catch (error) {
      const errorContextId = 'approvals-process-timesheet-error';
      console.error('Error processing timesheet:', error, { errorContextId });
      toast.error('Failed to mark timesheet as Manager Approved', { id: errorContextId });
    } finally {
      setProcessingInProgress(false);
    }
  };

  const activeTabLoading =
    activeTab === 'timesheets' ? (!hasLoadedTimesheets && loading) : absencesLoading;

  if (permissionLoading || absenceSecondaryLoading || employeesLoading || activeTabLoading) {
    return <PageLoader message="Loading approvals..." />;
  }

  if (!canViewApprovals) {
    return null;
  }

  const totalCount = activeTab === 'timesheets' ? filteredTimesheets.length : filteredAbsences.length;

  const getFilterLabel = (filter: StatusFilter, tab: ApprovalsTab = activeTab): string => {
    if (tab === 'absences') {
      if (filter === 'approved') return 'Approved';
      if (filter === 'processed') return 'Processed';
      if (filter === 'pending') return 'Pending';
      if (filter === 'rejected') return 'Rejected';
      if (filter === 'all') return 'All';
      return filter;
    }

    switch (filter) {
      case 'pending':
        return 'Pending';
      case 'approved':
        return 'Payroll Received';
      case 'rejected':
        return 'Rejected';
      case 'processed':
        return 'Manager Approved';
      case 'adjusted':
        return 'Adjusted';
      case 'all':
        return 'All Submitted';
      default:
        return filter;
    }
  };

  const getFilterOptions = (): StatusFilter[] =>
    activeTab === 'timesheets'
      ? ['pending', 'approved', 'rejected', 'processed', 'adjusted', 'all']
      : ['pending', 'approved', 'processed', 'rejected', 'all'];

  const handleFilterChange = (filter: StatusFilter) => {
    if (activeTab === 'timesheets') {
      setTimesheetFilter(filter as TimesheetStatusFilter);
      return;
    }
    setAbsenceStatusFilter(filter as AbsenceStatusFilter);
  };

  const hasActiveFilters =
    selectedEmployeeId !== 'all' ||
    (!isTeamFilterLocked && selectedTeamId !== 'all') ||
    (activeTab === 'timesheets'
      ? timesheetFilter !== defaultStatusFilters.timesheets
      : absenceStatusFilter !== defaultStatusFilters.absences) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const clearFilters = () => {
    setSelectedEmployeeId('all');
    setSelectedTeamId(isTeamFilterLocked ? (actorTeamId || '__no_team_scope__') : 'all');
    setTimesheetFilter(defaultStatusFilters.timesheets);
    setAbsenceStatusFilter(defaultStatusFilters.absences);
    setDateFrom('');
    setDateTo('');
  };

  const approvalsStatusHelperText = (() => {
    if (
      (activeTab === 'timesheets' && timesheetFilter === 'pending') ||
      (activeTab === 'absences' && absenceStatusFilter === 'approved')
    ) {
      return 'These approvals are designed to be processed by Payroll';
    }

    if (
      (activeTab === 'timesheets' && timesheetFilter === 'approved') ||
      (activeTab === 'absences' && absenceStatusFilter === 'pending')
    ) {
      return 'These approvals are designed to be processed by Team Managers';
    }

    return null;
  })();

  const handleTabChange = (tab: string) => {
    if (tab !== 'timesheets' && tab !== 'absences') return;
    void setTabParam(tab);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return (
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'approved':
        return (
          <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Payroll Received
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case 'processed':
        return (
          <Badge variant="default" className="bg-blue-500/10 text-blue-300 border-blue-500/20 hover:bg-blue-500/20">
            Manager Approved
          </Badge>
        );
      case 'adjusted':
        return (
          <Badge variant="default" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
            Adjusted
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="secondary">
            <FileText className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status}
          </Badge>
        );
    }
  };

  return (
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Approvals</h1>
            <p className="text-muted-foreground">
              Review and manage submissions
            </p>
          </div>
          <Badge 
            variant={
              statusFilter === 'pending' ? 'warning' :
              statusFilter === 'approved' ? 'success' :
              statusFilter === 'rejected' ? 'destructive' :
              'secondary'
            }
            className={`text-lg px-4 py-2 ${
              statusFilter === 'approved' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
              statusFilter === 'processed' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
              statusFilter === 'adjusted' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
              ''
            }`}
          >
            {totalCount} {getFilterLabel(statusFilter)}
          </Badge>
        </div>
      </div>

      <Card className="bg-white dark:bg-slate-900 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters} className="border-border text-muted-foreground">
                Clear Filters
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Employee</p>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {filteredEmployeeOptions.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Team</p>
              <Select value={effectiveTeamFilter} onValueChange={setSelectedTeamId} disabled={isTeamFilterLocked}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  {isTeamFilterLocked ? (
                    <SelectItem value={effectiveTeamFilter}>{lockedTeamLabel}</SelectItem>
                  ) : (
                    <>
                      <SelectItem value="all">All teams</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {teamOptions.map((team) => (
                        <SelectItem key={team.value} value={team.value}>
                          {team.label}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Status</p>
              <Select value={statusFilter} onValueChange={(value) => handleFilterChange(value as StatusFilter)}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {getFilterOptions().map((filter) => (
                    <SelectItem key={filter} value={filter}>
                      {getFilterLabel(filter)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="approvals-date-from" className="text-sm text-muted-foreground mb-2 block">Date From</Label>
              <Input
                id="approvals-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDateFrom(nextValue);
                  if (dateTo && nextValue && dateTo < nextValue) {
                    setDateTo(nextValue);
                  }
                }}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div>
              <Label htmlFor="approvals-date-to" className="text-sm text-muted-foreground mb-2 block">Date To</Label>
              <Input
                id="approvals-date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => setDateTo(event.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>
          {approvalsStatusHelperText ? (
            <div className="mt-4 flex justify-center">
              <p className="inline-flex items-center rounded-full border border-border/70 bg-slate-100/80 px-4 py-1.5 text-center text-sm text-muted-foreground shadow-sm dark:bg-slate-800/60 dark:text-slate-300">
                {approvalsStatusHelperText}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full max-w-3xl grid-cols-2 h-auto p-0 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <TabsTrigger 
              value="timesheets" 
              className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
              style={activeTab === 'timesheets' ? {
                backgroundColor: 'hsl(210 90% 50%)', // Timesheet Blue
                color: 'white',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              } : {}}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                <span className="text-sm font-medium">Timesheets</span>
                {filteredTimesheets.length > 0 && (
                  <Badge 
                    variant="secondary" 
                    className={activeTab === 'timesheets' ? "bg-white/20 text-white border-white/30" : ""}
                  >
                    {filteredTimesheets.length}
                  </Badge>
                )}
              </div>
            </TabsTrigger>
            <TabsTrigger 
              value="absences" 
              className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
              style={activeTab === 'absences' ? {
                backgroundColor: 'hsl(260 60% 50%)', // Purple for absences
                color: 'white',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              } : {}}
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <span className="text-sm font-medium">Absences</span>
                {filteredAbsences.length > 0 && (
                  <Badge 
                    variant="secondary"
                    className={activeTab === 'absences' ? "bg-white/20 text-white border-white/30" : ""}
                  >
                    {filteredAbsences.length}
                  </Badge>
                )}
              </div>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timesheets" className="mt-6 space-y-4">
            {loading ? (
              <Card className="border-border">
                <CardContent className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : filteredTimesheets.length === 0 ? (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  {statusFilter === 'pending' ? (
                    <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
                  ) : (
                    <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  )}
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {statusFilter === 'pending' ? 'All caught up!' : `No ${getFilterLabel(statusFilter).toLowerCase()} timesheets`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter === 'pending'
                      ? 'There are no pending approvals at the moment'
                      : `There are no ${getFilterLabel(statusFilter).toLowerCase()} timesheets to display`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Toolbar: Columns + View Toggle - Desktop Only */}
                <div className="hidden md:flex items-center justify-end gap-2">
                  {timesheetViewMode === 'table' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="border-slate-600">
                          <Settings2 className="h-4 w-4 mr-2" />
                          Columns
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 bg-slate-900 border border-border">
                        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem checked={columnVisibility.employeeId} onCheckedChange={() => toggleColumn('employeeId')}>
                          Employee ID
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnVisibility.totalHours} onCheckedChange={() => toggleColumn('totalHours')}>
                          Total Hours
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnVisibility.jobNumber} onCheckedChange={() => toggleColumn('jobNumber')}>
                          Job Number
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnVisibility.status} onCheckedChange={() => toggleColumn('status')}>
                          Status
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnVisibility.submittedAt} onCheckedChange={() => toggleColumn('submittedAt')}>
                          Submitted
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setTimesheetViewMode('table'); localStorage.setItem('approvals-ts-view-mode', 'table'); }}
                      className={`h-8 px-3 ${timesheetViewMode === 'table' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
                    >
                      <Table2 className="h-4 w-4 mr-1.5" />
                      Table
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setTimesheetViewMode('cards'); localStorage.setItem('approvals-ts-view-mode', 'cards'); }}
                      className={`h-8 px-3 ${timesheetViewMode === 'cards' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
                    >
                      <LayoutGrid className="h-4 w-4 mr-1.5" />
                      Cards
                    </Button>
                  </div>
                </div>

                {/* Table View - Desktop Only */}
                {timesheetViewMode === 'table' && (
                  <div className="hidden md:block">
                    <TimesheetsApprovalTable
                      timesheets={filteredTimesheets}
                      onApprove={async (id) => { await handleQuickApprove('timesheet', id); }}
                      onReject={async (id) => { await handleQuickReject('timesheet', id); }}
                      onProcess={handleOpenProcessModal}
                      columnVisibility={columnVisibility}
                      visibleCount={visibleTimesheetCount}
                    />
                  </div>
                )}

                {/* Card View - Always on mobile, conditional on desktop */}
                <div className={timesheetViewMode === 'table' ? 'md:hidden space-y-4' : 'space-y-4'}>
                  {visibleTimesheetCards.map((timesheet) => {
                    const cardTotalDisplay = typeof timesheet.leave_worked_hours === 'number' && typeof timesheet.leave_days === 'number'
                      ? formatLeaveAwareWeeklyDisplayMultiline(timesheet.leave_worked_hours, timesheet.leave_days)
                      : timesheet.leave_total_display;
                    return (
                    <Link key={timesheet.id} href={`/timesheets/${timesheet.id}`} className="block">
                      <Card className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-timesheet/50 transition-all duration-200 cursor-pointer">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-3">
                              <FileText className="h-5 w-5 text-amber-600" />
                              <div>
                                <CardTitle className="text-lg">
                                  Week Ending {formatDate(timesheet.week_ending)}
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2 mt-1">
                                  <User className="h-3 w-3" />
                                  {timesheet.user?.full_name || 'Unknown'} 
                                  {timesheet.user?.employee_id && ` (${timesheet.user.employee_id})`}
                                </CardDescription>
                              </div>
                            </div>
                            {getStatusBadge(timesheet.status)}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-muted-foreground">
                              {timesheet.submitted_at ? `Submitted ${formatDate(timesheet.submitted_at)}` : 'Not submitted'}
                              {timesheet.reg_number && ` • Reg: ${timesheet.reg_number}`}
                              {cardTotalDisplay && (
                                <p className="mt-1 whitespace-pre-line">{`Total: ${cardTotalDisplay}`}</p>
                              )}
                            </div>
                            {timesheet.status === 'submitted' && (
                              <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleQuickReject('timesheet', timesheet.id);
                                  }}
                                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  Reject
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleQuickApprove('timesheet', timesheet.id);
                                  }}
                                  className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  Payroll Received
                                </Button>
                              </div>
                            )}
                            {timesheet.status === 'approved' && (
                              <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpenProcessModal(timesheet.id);
                                  }}
                                  className="border-brand-yellow/50 text-brand-yellow hover:bg-brand-yellow/20 hover:text-brand-yellow hover:border-brand-yellow active:bg-brand-yellow/30 active:text-brand-yellow active:scale-95 transition-all"
                                >
                                  <Package className="h-4 w-4 mr-1" />
                                  Manager Approved
                                </Button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                    );
                  })}
                </div>
                {filteredTimesheets.length > visibleTimesheetCount && (
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">
                      Showing {visibleTimesheetCount} of {filteredTimesheets.length} timesheets
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setVisibleTimesheetCount((count) => count + APPROVALS_PAGE_SIZE)}
                      className="border-border text-foreground"
                    >
                      Show More
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Inspections tab removed - inspections no longer require approvals */}

          <TabsContent value="absences" className="mt-6 space-y-4">
            {absencesLoading ? (
              <Card className="border-border">
                <CardContent className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : !canAuthoriseBookings || filteredAbsences.length === 0 ? (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {statusFilter === 'pending' ? 'All caught up!' : `No ${getFilterLabel(statusFilter).toLowerCase()} absences`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter === 'pending'
                      ? 'There are no pending absence approvals at the moment'
                      : `There are no ${getFilterLabel(statusFilter).toLowerCase()} absences to display`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Toolbar: Columns + View Toggle - Desktop Only */}
                <div className="hidden md:flex items-center justify-end gap-2">
                  {absenceViewMode === 'table' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="border-slate-600">
                          <Settings2 className="h-4 w-4 mr-2" />
                          Columns
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 bg-slate-900 border border-border">
                        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.employeeId} onCheckedChange={() => toggleAbsenceColumn('employeeId')}>
                          Employee ID
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.reason} onCheckedChange={() => toggleAbsenceColumn('reason')}>
                          Reason
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.duration} onCheckedChange={() => toggleAbsenceColumn('duration')}>
                          Duration
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.remainingAllowance} onCheckedChange={() => toggleAbsenceColumn('remainingAllowance')}>
                          Remaining Allowance
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.paidStatus} onCheckedChange={() => toggleAbsenceColumn('paidStatus')}>
                          Paid / Unpaid
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={absenceColumnVisibility.submittedAt} onCheckedChange={() => toggleAbsenceColumn('submittedAt')}>
                          Submitted
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setAbsenceViewMode('table'); localStorage.setItem('approvals-abs-view-mode', 'table'); }}
                      className={`h-8 px-3 ${absenceViewMode === 'table' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
                    >
                      <Table2 className="h-4 w-4 mr-1.5" />
                      Table
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setAbsenceViewMode('cards'); localStorage.setItem('approvals-abs-view-mode', 'cards'); }}
                      className={`h-8 px-3 ${absenceViewMode === 'cards' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
                    >
                      <LayoutGrid className="h-4 w-4 mr-1.5" />
                      Cards
                    </Button>
                  </div>
                </div>

                {/* Table View - Desktop Only */}
                {absenceViewMode === 'table' && (
                  <div className="hidden md:block">
                    <AbsencesApprovalTable
                      absences={filteredAbsences}
                      onApprove={async (id) => {
                        try { await approveAbsence.mutateAsync(id); }
                        catch (e) {
                          const errorContextId = 'approvals-table-absence-approve-error';
                          reportAbsenceActionError('Error approving absence', e, errorContextId, 'Failed to approve absence');
                        }
                      }}
                      onReject={async (id) => {
                        const reason = prompt('Enter rejection reason:');
                        if (!reason) return;
                        try { await rejectAbsence.mutateAsync({ id, reason }); }
                        catch (e) {
                          const errorContextId = 'approvals-table-absence-reject-error';
                          reportAbsenceActionError('Error rejecting absence', e, errorContextId, 'Failed to reject absence');
                        }
                      }}
                      onProcess={async (id) => {
                        try { await processAbsence.mutateAsync(id); }
                        catch (e) {
                          const errorContextId = 'approvals-table-absence-process-error';
                          reportAbsenceActionError('Error processing absence', e, errorContextId, 'Failed to process absence');
                        }
                      }}
                      columnVisibility={absenceColumnVisibility}
                      visibleCount={visibleAbsenceCount}
                    />
                  </div>
                )}

                {/* Card View - Always on mobile, conditional on desktop */}
                <div className={absenceViewMode === 'table' ? 'md:hidden space-y-4' : 'space-y-4'}>
                  {visibleAbsenceCards.map((absence) => (
                    <AbsenceApprovalCard
                      key={absence.id}
                      absence={absence}
                      onApprove={approveAbsence}
                      onProcess={processAbsence}
                      onReject={rejectAbsence}
                      reportAbsenceActionError={reportAbsenceActionError}
                    />
                  ))}
                </div>
                {filteredAbsences.length > visibleAbsenceCount && (
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">
                      Showing {visibleAbsenceCount} of {filteredAbsences.length} absences
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setVisibleAbsenceCount((count) => count + APPROVALS_PAGE_SIZE)}
                      className="border-border text-foreground"
                    >
                      Show More
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

      {/* Process Timesheet Modal */}
      <ProcessTimesheetModal
        open={processModalOpen}
        onOpenChange={(open) => {
          setProcessModalOpen(open);
          if (!open) setProcessingTimesheetId(null);
        }}
        onConfirm={handleConfirmProcess}
        processing={processingInProgress}
      />
    </AppPageShell>
  );
}

// Absence Approval Card Component
function AbsenceApprovalCard({ 
  absence, 
  onApprove, 
  onProcess,
  onReject,
  reportAbsenceActionError,
}: { 
  absence: AbsenceWithRelations;
  onApprove: ReturnType<typeof useApproveAbsence>;
  onProcess: ReturnType<typeof useProcessAbsence>;
  onReject: ReturnType<typeof useRejectAbsence>;
  reportAbsenceActionError: (actionLabel: string, error: unknown, errorContextId: string, fallbackMessage: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const { data: summary } = useAbsenceSummaryForEmployee(absence.profile_id);
  const canApproveOrReject = absence.status === 'pending';
  const canProcessAbsence = absence.status === 'approved';
  
  async function handleApprove() {
    if (!canApproveOrReject) return;

    // Check allowance for Annual Leave
    if (isAnnualLeaveReason(absence.absence_reasons.name)) {
      const projectedRemaining = (summary?.remaining || 0) - absence.duration_days;
      if (projectedRemaining < 0) {
        const confirmed = await import('@/lib/services/notification.service').then(m => 
          m.notify.confirm({
            title: 'Insufficient Allowance',
            description: 'Warning: This request exceeds the employee\'s available allowance. Approve anyway?',
            confirmText: 'Approve Anyway',
            destructive: true,
          })
        );
        if (!confirmed) {
          return;
        }
      }
    }
    
    try {
      await onApprove.mutateAsync(absence.id);
    } catch (error) {
      const errorContextId = 'approvals-absence-approve-error';
      reportAbsenceActionError('Error approving absence', error, errorContextId, 'Failed to approve absence');
    }
  }

  async function handleProcess() {
    if (!canProcessAbsence) return;

    try {
      await onProcess.mutateAsync(absence.id);
    } catch (error) {
      const errorContextId = 'approvals-absence-process-error';
      reportAbsenceActionError('Error processing absence', error, errorContextId, 'Failed to process absence');
    }
  }
  
  async function handleReject() {
    if (!canApproveOrReject) return;

    if (!rejectionReason.trim()) {
      toast.error('Rejection reason required', {
        id: 'approvals-rejection-reason-required',
        description: 'Please provide a reason for rejecting this absence request.',
      });
      return;
    }
    
    try {
      await onReject.mutateAsync({ id: absence.id, reason: rejectionReason });
      setRejecting(false);
      setRejectionReason('');
    } catch (error) {
      const errorContextId = 'approvals-absence-reject-error';
      reportAbsenceActionError('Error rejecting absence', error, errorContextId, 'Failed to reject absence');
    }
  }
  
  const projectedRemaining = isAnnualLeaveReason(absence.absence_reasons.name)
    ? (summary?.remaining || 0) - absence.duration_days 
    : null;

  const getAbsenceStatusBadge = () => {
    if (absence.status === 'approved') {
      return (
        <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    }

    if (absence.status === 'rejected') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    }

    if (absence.status === 'processed') {
      return (
        <Badge variant="default" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          <Package className="h-3 w-3 mr-1" />
          Processed
        </Badge>
      );
    }

    return (
      <Badge variant="warning">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };
  
  return (
    <Card className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-purple-500/50 transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <Calendar className="h-5 w-5 text-purple-600" />
            <div>
              <CardTitle className="text-lg">
                {absence.profiles.full_name}
                {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                <span>{absence.absence_reasons.name}</span>
                <span>·</span>
                <span>
                  {absence.end_date && absence.date !== absence.end_date
                    ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                    : formatDate(absence.date)
                  }
                  {absence.is_half_day && ` (${absence.half_day_session})`}
                </span>
                <span>·</span>
                <span>{absence.duration_days} {absence.duration_days === 1 ? 'day' : 'days'}</span>
                {absence.absence_reasons.is_paid ? (
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-[10px] px-1.5 py-0">
                    Paid
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                    Unpaid
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
          {getAbsenceStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {absence.notes && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Notes:</span> {absence.notes}
              </p>
            </div>
          )}

          {isAnnualLeaveReason(absence.absence_reasons.name) && summary && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <h4 className="text-sm font-medium text-white mb-2">Allowance Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Allowance</p>
                  <p className="text-white font-medium">{summary.allowance} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Approved</p>
                  <p className="text-white font-medium">{summary.approved_taken} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pending</p>
                  <p className="text-amber-400 font-medium">{summary.pending_total} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">After Approval</p>
                  <p className={`font-medium ${projectedRemaining !== null && projectedRemaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {projectedRemaining} days
                  </p>
                </div>
              </div>
              {projectedRemaining !== null && projectedRemaining < 0 && (
                <div className="mt-2 p-2 bg-red-500/20 rounded border border-red-500/30">
                  <p className="text-xs text-red-300">
                    ⚠️ Warning: Approving will exceed available allowance
                  </p>
                </div>
              )}
            </div>
          )}

          {canApproveOrReject && rejecting ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="rejectionReason">Rejection Reason *</Label>
                <Input
                  id="rejectionReason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Provide a reason for rejection..."
                  className="bg-background border-border text-foreground"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRejecting(false);
                    setRejectionReason('');
                  }}
                  className="border-border text-muted-foreground"
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReject}
                  disabled={!rejectionReason.trim()}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Confirm Rejection
                </Button>
              </div>
            </div>
          ) : canApproveOrReject ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Submitted {formatDate(absence.created_at)}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRejecting(true)}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApprove}
                  className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </div>
            </div>
          ) : canProcessAbsence ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Submitted {formatDate(absence.created_at)}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleProcess}
                className="border-brand-yellow/50 text-brand-yellow hover:bg-brand-yellow/20 hover:text-brand-yellow hover:border-brand-yellow active:bg-brand-yellow/30 active:text-brand-yellow active:scale-95 transition-all"
              >
                <Package className="h-4 w-4 mr-1" />
                Process
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Submitted {formatDate(absence.created_at)}
              </div>
              <Badge variant="outline" className="border-border text-muted-foreground capitalize">
                {absence.status}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ApprovalsPage() {
  return (
    <NuqsClientAdapter>
      <Suspense fallback={<PageLoader message="Loading approvals..." />}>
        <ApprovalsContent />
      </Suspense>
    </NuqsClientAdapter>
  );
}

