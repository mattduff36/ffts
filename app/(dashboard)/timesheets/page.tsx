'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useTimesheetRealtime } from '@/lib/hooks/useRealtime';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Clock, CheckCircle2, XCircle, Download, Trash2, Filter, Package, AlertTriangle, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { TimesheetStatusFilter } from '@/types/common';
import {
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import { filterEmployeesBySelectedTeam } from '@/lib/utils/absence-admin';
import { canShowTimesheetInList, hasAccountsTimesheetFullVisibilityOverride } from '@/lib/utils/timesheet-visibility';
import { toast } from 'sonner';
import { ColumnVisibilityMenu, DataViewToggle } from '@/components/ui/data-view-controls';
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
import {
  DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY,
  TIMESHEETS_LIST_COLUMN_VISIBILITY_STORAGE_KEY,
  TimesheetsListColumnVisibility,
  TimesheetsListTable,
} from './components/TimesheetsListTable';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';

interface TimesheetWithProfile extends Timesheet {
  profile?: {
    full_name: string;
    employee_id?: string | null;
    team_id?: string | null;
  };
}

interface TimesheetFilterEmployee {
  id: string;
  full_name: string;
  employee_id: string | null;
  has_module_access?: boolean;
  team_id: string | null;
  team_name: string | null;
}

interface AssociatedLeaveBookingSummary {
  id: string;
  date: string;
  endDate: string | null;
  reasonName: string;
  status: 'pending' | 'approved' | 'processed';
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM' | null;
  durationDays: number;
}

export default function TimesheetsPage() {
  const { user, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('timesheets');
  const {
    data: absenceSecondarySnapshot,
    isLoading: absenceSecondaryLoading,
    isFetchedAfterMount: absenceSecondaryFetchedAfterMount,
  } = useAbsenceSecondaryPermissions(hasPermission);
  const hasAccountsVisibilityOverride = hasAccountsTimesheetFullVisibilityOverride(
    absenceSecondarySnapshot?.role_name,
    absenceSecondarySnapshot?.team_name
  );
  const isElevatedUser = isManager || isAdmin || isSuperAdmin || hasAccountsVisibilityOverride;
  const isAdminTier = Boolean(isAdmin || isSuperAdmin || hasAccountsVisibilityOverride);
  const hasAbsenceSecondarySnapshot = Boolean(absenceSecondarySnapshot?.permissions && absenceSecondarySnapshot?.flags);
  const isAbsenceSecondaryContextLoading =
    hasPermission && (absenceSecondaryLoading || (!absenceSecondaryFetchedAfterMount && !hasAbsenceSecondarySnapshot));
  const pageSize = isElevatedUser ? 20 : 10;
  const router = useRouter();
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<TimesheetFilterEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<TimesheetStatusFilter>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [timesheetToDelete, setTimesheetToDelete] = useState<{ id: string; weekEnding: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedAssociatedLeaveBookingIds, setSelectedAssociatedLeaveBookingIds] = useState<string[]>([]);
  const [associatedLeaveBookings, setAssociatedLeaveBookings] = useState<AssociatedLeaveBookingSummary[]>([]);
  const [associatedLeaveBookingsLoading, setAssociatedLeaveBookingsLoading] = useState(false);
  const [associatedLeaveBookingsError, setAssociatedLeaveBookingsError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('timesheets-view-mode') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });
  const [columnVisibility, setColumnVisibility] = useState<TimesheetsListColumnVisibility>(
    DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY
  );
  const supabase = useBrowserSupabaseClient();
  const actorProfileId = user?.id || '';
  const canAuthoriseBookings = Boolean(absenceSecondarySnapshot?.flags.can_authorise_bookings || isAdminTier);
  const actorTeamId = absenceSecondarySnapshot?.team_id || null;
  const actorTeamName = absenceSecondarySnapshot?.team_name || null;
  const scopeTeamOnly = Boolean(
    isElevatedUser &&
      !isAdminTier &&
      canAuthoriseBookings &&
      absenceSecondarySnapshot &&
      !absenceSecondarySnapshot.permissions.authorise_bookings_all &&
      absenceSecondarySnapshot.permissions.authorise_bookings_team
  );
  const isTeamFilterLocked = scopeTeamOnly;
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }
    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  useEffect(() => {
    if (!user || !isElevatedUser) return;

    const fetchEmployees = async () => {
      setEmployeesLoading(true);
      try {
        const data = await fetchUserDirectory({ module: 'timesheets', limit: 200 });
        setEmployees(
          data.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            employee_id: employee.employee_id || null,
            has_module_access: employee.has_module_access,
            team_id: employee.team?.id || null,
            team_name: employee.team?.name || null,
          }))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const normalizedMessage = message.toLowerCase();
        const isNetworkFailure =
          message.includes('Failed to fetch') || message.includes('NetworkError') || normalizedMessage.includes('network');
        const isUnauthorized =
          normalizedMessage.includes('unauthorized') ||
          (normalizedMessage.includes('jwt') && normalizedMessage.includes('expired'));

        if (isNetworkFailure || isUnauthorized) {
          // Keep this non-fatal: employee filters are optional and auth/session races can briefly return 401.
          setEmployees([]);
          console.warn('Unable to load employees (non-fatal):', err);
        } else {
          console.error('Error fetching employees:', err);
        }
      } finally {
        setEmployeesLoading(false);
      }
    };

    void fetchEmployees();
  }, [user, isElevatedUser]);

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

  useEffect(() => {
    if (selectedEmployeeId === 'all') return;
    const employeeStillVisible = filteredEmployeeOptions.some((employee) => employee.id === selectedEmployeeId);
    if (!employeeStillVisible) {
      setSelectedEmployeeId('all');
    }
  }, [filteredEmployeeOptions, selectedEmployeeId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TIMESHEETS_LIST_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<TimesheetsListColumnVisibility>;
        setColumnVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore invalid persisted state
    }
  }, []);

  const lockedTeamLabel =
    actorTeamName ||
    teamOptions.find((team) => team.value === actorTeamId)?.label ||
    (actorTeamId ? 'My Team' : 'No team assigned');

  function toggleColumn(column: keyof TimesheetsListColumnVisibility) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(TIMESHEETS_LIST_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const applyClientScopeFilters = useCallback(
    (rows: TimesheetWithProfile[]) => {
      return rows.filter((timesheet) =>
        canShowTimesheetInList({
          actor: {
            isElevatedUser,
            isAdminTier,
            actorProfileId,
            actorTeamId: absenceSecondarySnapshot?.team_id || null,
            canAuthoriseBookings,
            permissions: absenceSecondarySnapshot?.permissions || null,
          },
          target: {
            profileId: timesheet.user_id,
            teamId: timesheet.profile?.team_id || null,
          },
          effectiveTeamFilter,
        })
      );
    },
    [
      isElevatedUser,
      isAdminTier,
      canAuthoriseBookings,
      actorProfileId,
      absenceSecondarySnapshot,
      effectiveTeamFilter,
    ]
  );

  const fetchTimesheets = useCallback(async () => {
    if (!supabase || !user || authLoading) return;
    setLoading(true);
    setFetchError(null);
    
    try {
      const targetCount = displayCount + 1;
      const requiresChunkedClientFiltering = isElevatedUser && (!isAdminTier || effectiveTeamFilter !== 'all');

      const buildQuery = (rangeStart: number, rangeEnd: number) => {
        let query = supabase
          .from('timesheets')
          .select(`
            *,
            profile:profiles!timesheets_user_id_fkey(full_name, employee_id, team_id)
          `)
          .order('week_ending', { ascending: false })
          .range(rangeStart, rangeEnd);

        // Filter based on user role and selection
        if (!isElevatedUser) {
          query = query.eq('user_id', user.id);
        } else if (selectedEmployeeId && selectedEmployeeId !== 'all') {
          query = query.eq('user_id', selectedEmployeeId);
        }

        // Apply status filter
        if (statusFilter === 'pending') {
          query = query.eq('status', 'submitted');
        } else if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }

        return query;
      };

      if (!requiresChunkedClientFiltering) {
        const { data, error } = await buildQuery(0, displayCount);
        if (error) throw error;

        const rows = (data || []) as TimesheetWithProfile[];
        setHasMore(rows.length > displayCount);
        setTimesheets(rows.slice(0, displayCount));
        return;
      }

      const chunkSize = Math.max(displayCount + 1, pageSize * 2);
      let offset = 0;
      let reachedEnd = false;
      const collectedRows: TimesheetWithProfile[] = [];

      while (!reachedEnd && collectedRows.length < targetCount) {
        const { data, error } = await buildQuery(offset, offset + chunkSize - 1);
        if (error) throw error;

        const dbRows = (data || []) as TimesheetWithProfile[];
        const filteredRows = applyClientScopeFilters(dbRows);
        const remainingSlots = targetCount - collectedRows.length;

        if (filteredRows.length > 0 && remainingSlots > 0) {
          collectedRows.push(...filteredRows.slice(0, remainingSlots));
        }

        if (dbRows.length < chunkSize) {
          reachedEnd = true;
        } else {
          offset += chunkSize;
        }
      }

      setHasMore(collectedRows.length > displayCount);
      setTimesheets(collectedRows.slice(0, displayCount));
    } catch (error) {
      const errorContextId = 'timesheets-fetch-list-error';
      const isNetworkFailure = isNetworkFetchError(error);
      const isAuthFailure = isAuthErrorStatus(getErrorStatus(error));

      // Avoid escalating common mobile/offline and auth refresh races into centralized error logs.
      if (isNetworkFailure) {
        console.warn('Unable to load timesheets (network):', error, { errorContextId, network: true });
      } else if (isAuthFailure) {
        console.warn('Unable to load timesheets (auth):', error, { errorContextId, auth: true });
      } else {
        console.error('Error fetching timesheets:', error, { errorContextId });
      }

      // Always set inline error state so the UI shows feedback even if toast fails
      if (isAuthFailure) {
        setFetchError('Unable to load timesheets while your session refreshes. Please try again.');
      } else if (!navigator.onLine || isNetworkFailure) {
        setFetchError('Unable to load timesheets. Please check your internet connection.');
        toast.error('Unable to load timesheets', {
          id: errorContextId,
          description: 'Please check your internet connection.',
        });
      } else {
        setFetchError('Unable to load timesheets. Please try again.');
        toast.error('Unable to load timesheets', {
          id: errorContextId,
          description: 'Something went wrong. Please try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [
    user,
    authLoading,
    isElevatedUser,
    isAdminTier,
    selectedEmployeeId,
    statusFilter,
    supabase,
    displayCount,
    effectiveTeamFilter,
    pageSize,
    applyClientScopeFilters,
  ]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, selectedEmployeeId, statusFilter, effectiveTeamFilter]);

  useEffect(() => {
    fetchTimesheets();
  }, [fetchTimesheets]);

  // Listen for realtime updates to timesheets
  useTimesheetRealtime((payload) => {
    console.log('Realtime timesheet update:', payload);
    
    // Refetch timesheets when changes occur
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      fetchTimesheets();
      
      // Show toast notification for significant changes
      if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
        const status = (payload.new as { status?: string }).status;
        if (status === 'approved') {
          toast.success('Timesheet approved!', {
            description: 'A timesheet has been approved by your manager.',
          });
        } else if (status === 'rejected') {
          toast.error('Timesheet rejected', {
            id: 'timesheets-realtime-rejected-status',
            description: 'A timesheet has been rejected. Please review the comments.',
          });
        } else if (status === 'processed') {
          toast.success('Timesheet processed!', {
            description: 'A timesheet has been processed for payroll.',
          });
        }
      }
    }
  });

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending' },
      approved: { variant: 'success' as const, label: 'Payroll Received' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
      processed: { variant: 'default' as const, label: 'Manager Approved' },
      adjusted: { variant: 'default' as const, label: 'Adjusted' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;
    
    // Apply blue styling for final states (processed and adjusted)
    const isFinalState = status === 'processed' || status === 'adjusted';
    const blueClasses = isFinalState ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : '';

    return <Badge variant={config.variant} className={blueClasses}>{config.label}</Badge>;
  };

  const getFilterLabel = (filter: TimesheetStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'pending': return 'Pending';
      case 'approved': return 'Payroll Received';
      case 'rejected': return 'Rejected';
      case 'processed': return 'Manager Approved';
      case 'adjusted': return 'Adjusted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'processed':
        return <Package className="h-5 w-5 text-blue-600" />;
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const handleDownloadPDF = async (e: React.MouseEvent, timesheetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(timesheetId);
    const errorContextId = `timesheets-download-pdf-${timesheetId}`;
    try {
      const response = await fetch(`/api/timesheets/${timesheetId}/pdf`);
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        const serverMessage = (() => {
          if (!raw) return '';
          try {
            const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
            const msg = parsed?.error ?? parsed?.message;
            return typeof msg === 'string' ? msg : raw;
          } catch {
            return raw;
          }
        })();

        console.warn('Timesheet PDF download failed:', {
          timesheetId,
          status: response.status,
          statusText: response.statusText,
          serverMessage,
        });

        toast.error('Failed to download PDF', {
          id: errorContextId,
          description: serverMessage || 'Please try again or contact support if the problem persists.',
        });
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${timesheetId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isNetworkFailure =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('AuthRetryableFetchError') ||
        msg.toLowerCase().includes('network');

      if (isNetworkFailure) {
        console.error('Timesheet PDF download failed (network):', error, { errorContextId, network: true });
      } else {
        console.error('Timesheet PDF download failed:', error, { errorContextId });
      }

      toast.error('Failed to download PDF', {
        id: errorContextId,
        description: isNetworkFailure
          ? 'Please check your internet connection and try again.'
          : 'Please try again or contact support if the problem persists.',
      });
    } finally {
      setDownloading(null);
    }
  };

  function resetDeleteDialogState() {
    setDeleteDialogOpen(false);
    setTimesheetToDelete(null);
    setSelectedAssociatedLeaveBookingIds([]);
    setAssociatedLeaveBookings([]);
    setAssociatedLeaveBookingsLoading(false);
    setAssociatedLeaveBookingsError(null);
  }

  function handleDeleteDialogOpenChange(open: boolean) {
    if (deleting) return;
    if (!open) {
      resetDeleteDialogState();
      return;
    }
    setDeleteDialogOpen(true);
  }

  function formatAssociatedLeaveBooking(booking: AssociatedLeaveBookingSummary): string {
    const halfDaySuffix = booking.isHalfDay && booking.halfDaySession
      ? ` (${booking.halfDaySession})`
      : '';
    const dateRange = booking.endDate && booking.endDate !== booking.date
      ? `${formatDate(booking.date)} to ${formatDate(booking.endDate)}`
      : formatDate(booking.date);
    return `${booking.reasonName}${halfDaySuffix} on ${dateRange}`;
  }

  function toggleAssociatedLeaveBooking(bookingId: string, checked: boolean) {
    setSelectedAssociatedLeaveBookingIds((current) => {
      if (!checked) return current.filter((id) => id !== bookingId);
      if (current.includes(bookingId)) return current;
      return [...current, bookingId];
    });
  }

  function toggleAllAssociatedLeaveBookings() {
    setSelectedAssociatedLeaveBookingIds((current) => (
      current.length === associatedLeaveBookings.length
        ? []
        : associatedLeaveBookings.map((booking) => booking.id)
    ));
  }

  async function fetchAssociatedLeaveBookings(timesheetId: string) {
    setAssociatedLeaveBookingsLoading(true);
    setAssociatedLeaveBookingsError(null);

    try {
      const response = await fetch(`/api/timesheets/${timesheetId}/delete`, {
        method: 'GET',
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to check associated leave bookings.');
      }

      setAssociatedLeaveBookings(
        Array.isArray(payload.associatedLeaveBookings) ? payload.associatedLeaveBookings : []
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to check associated leave bookings.';
      setAssociatedLeaveBookingsError(message);
      toast.error(message);
    } finally {
      setAssociatedLeaveBookingsLoading(false);
    }
  }

  const openDeleteDialog = (e: React.MouseEvent, timesheet: Timesheet) => {
    e.stopPropagation(); // Prevent card click
    setTimesheetToDelete({
      id: timesheet.id,
      weekEnding: formatDate(timesheet.week_ending),
    });
    setSelectedAssociatedLeaveBookingIds([]);
    setAssociatedLeaveBookings([]);
    setAssociatedLeaveBookingsError(null);
    setDeleteDialogOpen(true);
    void fetchAssociatedLeaveBookings(timesheet.id);
  };

  const handleDelete = async () => {
    if (!timesheetToDelete) return;

    setDeleting(true);
    const errorContextId = `timesheets-delete-${timesheetToDelete.id}`;
    try {
      const response = await fetch(`/api/timesheets/${timesheetToDelete.id}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          associatedLeaveBookingIdsToDelete: selectedAssociatedLeaveBookingIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete timesheet');
      }

      const data = await response.json().catch(() => ({}));
      const deletedBookingCount = typeof data.deletedAssociatedLeaveBookingCount === 'number'
        ? data.deletedAssociatedLeaveBookingCount
        : 0;

      toast.success('Timesheet deleted successfully', {
        description: deletedBookingCount > 0
          ? `${deletedBookingCount} associated leave booking${deletedBookingCount === 1 ? '' : 's'} deleted.`
          : undefined,
      });
      resetDeleteDialogState();
      fetchTimesheets(); // Refresh list
    } catch (err) {
      console.error('Error deleting timesheet:', err, { errorContextId });
      toast.error(err instanceof Error ? err.message : 'Failed to delete timesheet', {
        id: errorContextId,
      });
    } finally {
      setDeleting(false);
    }
  };

  if (!supabase || permissionLoading || isAbsenceSecondaryContextLoading) {
    return <PageLoader message="Loading timesheets..." />;
  }

  // Don't render if no permission (hook will redirect)
  if (!hasPermission) {
    return null;
  }

  const hasAssociatedLeaveBookings = associatedLeaveBookings.length > 0;
  const allAssociatedLeaveBookingsSelected = hasAssociatedLeaveBookings &&
    selectedAssociatedLeaveBookingIds.length === associatedLeaveBookings.length;

  return (
    <AppPageShell>
      <AppPageHeader
        title="Timesheets"
        description="Manage your weekly timesheets"
        className="bg-slate-900"
        contentClassName="mb-4 sm:flex-row sm:items-center sm:justify-between"
        headingClassName="space-y-0"
        titleClassName="mb-2 text-white"
        descriptionClassName="text-base"
        actionsClassName="sm:w-auto"
        actions={(
          <Link href="/timesheets/new" className="w-full sm:w-auto">
            <Button className="w-full bg-timesheet hover:bg-timesheet-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              New Timesheet
            </Button>
          </Link>
        )}
      />

      {isElevatedUser && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {employeesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading filters...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Employee</p>
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger className="bg-background border-border text-foreground">
                      <SelectValue placeholder="All employees" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {filteredEmployeeOptions.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                          {employee.full_name}
                          {employee.employee_id ? ` (${employee.employee_id})` : ''}
                          {employee.has_module_access === false ? ' - No Timesheets access' : ''}
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
                  <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TimesheetStatusFilter)}>
                    <SelectTrigger className="bg-background border-border text-foreground">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      {(['all', 'draft', 'pending', 'approved', 'rejected', 'processed', 'adjusted'] as TimesheetStatusFilter[]).map((filter) => (
                        <SelectItem key={filter} value={filter}>
                          {getFilterLabel(filter)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {fetchError && !loading && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{fetchError}</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() => fetchTimesheets()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <PanelLoader message="Loading timesheets..." accent="timesheet" className="py-20" />
      ) : timesheets.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">
              {isElevatedUser ? 'No timesheets found' : 'No timesheets yet'}
            </h3>
            <p className="text-slate-400 mb-4">
              {isElevatedUser
                ? canAuthoriseBookings
                  ? 'No timesheets match the selected filters.'
                  : 'Your Authorise Bookings permissions do not allow viewing additional timesheets.'
                : 'Create your first timesheet to get started'}
            </p>
            {!isElevatedUser && (
              <Link href="/timesheets/new">
                <Button className="bg-timesheet hover:bg-timesheet-dark text-white transition-all duration-200 active:scale-95">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Timesheet
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {isElevatedUser && (
            <div className="hidden md:flex items-center justify-end gap-2">
              {viewMode === 'table' ? (
                <ColumnVisibilityMenu
                  options={[
                    { id: 'employeeId', label: 'Employee ID', checked: columnVisibility.employeeId },
                    { id: 'regNumber', label: 'Reg Number', checked: columnVisibility.regNumber },
                    { id: 'status', label: 'Status', checked: columnVisibility.status },
                    { id: 'submittedAt', label: 'Submitted', checked: columnVisibility.submittedAt },
                  ]}
                  onToggle={toggleColumn}
                />
              ) : null}

              <DataViewToggle
                value={viewMode}
                onValueChange={(nextViewMode) => {
                  setViewMode(nextViewMode);
                  localStorage.setItem('timesheets-view-mode', nextViewMode);
                }}
              />
            </div>
          )}

          {isElevatedUser && viewMode === 'table' && (
            <div className="hidden md:block">
              <TimesheetsListTable
                timesheets={timesheets}
                columnVisibility={columnVisibility}
                downloadingId={downloading}
                showDeleteActions={isElevatedUser}
                onDownloadPDF={handleDownloadPDF}
                onOpenDeleteDialog={openDeleteDialog}
              />
            </div>
          )}

          <div className={isElevatedUser && viewMode === 'table' ? 'md:hidden grid gap-4' : 'grid gap-4'}>
            {timesheets.map((timesheet) => (
            <Card 
              key={timesheet.id} 
              className="border-border hover:shadow-lg hover:border-timesheet/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                // Redirect draft timesheets to /timesheets/new for editing with validation
                if (timesheet.status === 'draft' || timesheet.status === 'rejected') {
                  router.push(`/timesheets/new?id=${timesheet.id}`);
                } else {
                  router.push(`/timesheets/${timesheet.id}`);
                }
              }}
            >
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center space-x-3">
                    {getStatusIcon(timesheet.status)}
                    <div className="min-w-0">
                      <CardTitle className="text-lg text-white">
                        Week Ending {formatDate(timesheet.week_ending)}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {isElevatedUser && timesheet.profile?.full_name && (
                          <span className="font-medium text-white">
                            {timesheet.profile.full_name}
                            {timesheet.reg_number && ' • '}
                          </span>
                        )}
                        {timesheet.reg_number && `Reg: ${timesheet.reg_number}`}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {getStatusBadge(timesheet.status)}
                    {isElevatedUser && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, timesheet)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete timesheet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-muted-foreground">
                    {timesheet.submitted_at
                      ? `Submitted ${formatDate(timesheet.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {timesheet.status === 'rejected' && timesheet.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {/* Download PDF Button for submitted, approved, processed, and adjusted statuses */}
                  {(timesheet.status === 'submitted' || timesheet.status === 'approved' || timesheet.status === 'processed' || timesheet.status === 'adjusted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, timesheet.id)}
                      disabled={downloading === timesheet.id}
                      variant="outline"
                      size="sm"
                      className="bg-slate-900 border-timesheet text-timesheet hover:bg-timesheet hover:text-white transition-all duration-200"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === timesheet.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            ))}
          </div>

          {/* Show More Button */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount((prev) => prev + pageSize)}
                variant="outline"
                className="w-full max-w-xs border-border text-white hover:bg-slate-800"
              >
                Show More
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timesheet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the timesheet for week ending{' '}
              <span className="font-semibold">{timesheetToDelete?.weekEnding}</span>?
              <br />
              <br />
              This action cannot be undone. All timesheet entries will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {associatedLeaveBookingsLoading && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-muted-foreground">
              Checking for associated leave bookings...
            </div>
          )}
          {!associatedLeaveBookingsLoading && hasAssociatedLeaveBookings && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Select associated leave bookings to delete
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Leave all unticked to delete only the timesheet and keep every leave booking.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleAllAssociatedLeaveBookings}
                    disabled={deleting}
                    className="shrink-0 border-amber-400/60 text-amber-200 hover:bg-amber-500/10"
                  >
                    {allAssociatedLeaveBookingsSelected ? 'Clear all' : 'Select all'}
                  </Button>
                </div>

                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {associatedLeaveBookings.map((booking) => {
                    const checkboxId = `delete-associated-leave-booking-${booking.id}`;
                    const isSelected = selectedAssociatedLeaveBookingIds.includes(booking.id);

                    return (
                      <label
                        key={booking.id}
                        htmlFor={checkboxId}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-500/20 bg-slate-950/30 p-3"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleAssociatedLeaveBooking(booking.id, checked === true)}
                          disabled={deleting}
                          className="mt-0.5 border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:text-slate-950"
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-amber-100">
                            {formatAssociatedLeaveBooking(booking)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {booking.status} · {booking.durationDays} day{booking.durationDays === 1 ? '' : 's'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {!associatedLeaveBookingsLoading && associatedLeaveBookingsError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {associatedLeaveBookingsError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={deleting || associatedLeaveBookingsLoading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}

