'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useInspectionRealtime } from '@/lib/hooks/useRealtime';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { getRecentVehicleIds, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { isUuid } from '@/lib/utils/uuid';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Clipboard, Clock, User, Download, Trash2, Filter, FileText, Truck, Loader2, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { VanInspection } from '@/types/inspection';
import { Employee, InspectionStatusFilter } from '@/types/common';
import { useQueryState } from 'nuqs';
import { canEditDraftInspection, getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
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
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import {
  DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY,
  VAN_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY,
  VanInspectionsColumnVisibility,
  VanInspectionsListTable,
} from './components/VanInspectionsListTable';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import {
  isVanInspectionsMaintenancePaused,
  VAN_INSPECTIONS_MAINTENANCE_MESSAGE,
  VAN_INSPECTIONS_MAINTENANCE_TITLE,
} from '@/lib/config/van-inspections-maintenance';

interface InspectionWithVehicle extends VanInspection {
  vans: {
    reg_number: string;
    van_categories: { name: string } | null;
  } | null;
  profile: { full_name: string } | null;
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
}

interface DeleteDialogInspectionInput {
  id: string;
  inspection_date: string;
  vans?: { reg_number?: string | null } | null;
}

interface Vehicle {
  id: string;
  reg_number: string;
  van_categories: { name: string } | null;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
  status: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

function InspectionsContent() {
  const {
    user,
    profile,
    effectiveRole,
    isManager,
    isAdmin,
    isSuperAdmin,
    isSupervisor,
    loading: authLoading,
  } = useAuth();
  const {
    hasPermission: canAccessInspectionModule,
    loading: permissionLoading,
  } = usePermissionCheck('inspections');
  const {
    hasOrgWideInspectionVisibility,
    hasTeamInspectionVisibility,
    canViewCrossUserInspections,
    canManageInspections,
    canDeleteInspections,
  } = getInspectionVisibilityFlags({
    teamName: effectiveRole?.team_name ?? profile?.team?.name,
    isManager,
    isAdmin,
    isSuperAdmin,
    isSupervisor,
  });
  const pageSize = canViewCrossUserInspections ? 20 : 10;
  const router = useRouter();
  const { tabletModeEnabled } = useTabletMode();
  const [inspections, setInspections] = useState<InspectionWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  // Use URL search params to persist filter selection across navigations
  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', { 
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState('status', {
    defaultValue: 'all' as InspectionStatusFilter,
    shallow: false,
  });
  const [vehicleFilter, setVehicleFilter] = useQueryState('van', {
    defaultValue: 'all',
    shallow: false,
  });
  const normalizedEmployeeFilter =
    selectedEmployeeId !== 'all' && !isUuid(selectedEmployeeId) ? 'all' : selectedEmployeeId;
  const normalizedVehicleFilter =
    vehicleFilter !== 'all' && !isUuid(vehicleFilter) ? 'all' : vehicleFilter;
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<{ id: string; vehicleReg: string; date: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('van-inspections-view-mode') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });
  const [columnVisibility, setColumnVisibility] = useState<VanInspectionsColumnVisibility>(
    DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY
  );
  const inspectionsPaused = isVanInspectionsMaintenancePaused();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;

  // Fetch employees and vehicles
  useEffect(() => {
    if (selectedEmployeeId !== normalizedEmployeeFilter) {
      setSelectedEmployeeId(normalizedEmployeeFilter);
    }
  }, [normalizedEmployeeFilter, selectedEmployeeId, setSelectedEmployeeId]);

  useEffect(() => {
    if (vehicleFilter !== normalizedVehicleFilter) {
      setVehicleFilter(normalizedVehicleFilter);
    }
  }, [normalizedVehicleFilter, setVehicleFilter, vehicleFilter]);

  useEffect(() => {
    if (
      user &&
      canAccessInspectionModule &&
      !permissionLoading &&
      canViewCrossUserInspections
    ) {
      const fetchEmployees = async () => {
        try {
          const data = await fetchUserDirectory({ module: 'inspections', limit: 200 });
          setScopedEmployeeIds(Array.from(new Set([user.id, ...data.map((employee) => employee.id)])));
          setEmployees(
            data.map((employee) => ({
              id: employee.id,
              full_name: employee.full_name || 'Unknown User',
              employee_id: employee.employee_id,
              has_module_access: employee.has_module_access,
            }))
          );
        } catch (err) {
          if (isNetworkFetchError(err)) {
            console.warn('Unable to load employees (network):', err);
          } else {
            const status = getErrorStatus(err);
            if (isAuthErrorStatus(status) || status === 403) return;
            console.error('Error fetching employees:', err);
          }
        }
      };
      fetchEmployees();
    } else if (user) {
      setEmployees([]);
      setScopedEmployeeIds([user.id]);
    }

    if (!user || authLoading || permissionLoading || !canAccessInspectionModule) {
      return;
    }

    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase
          .from('vans')
          .select(`
            id, 
            reg_number, 
            van_categories (
              name
            )
          `)
          .order('reg_number');
        
        if (error) throw error;
        setVehicles((data || []).map((vehicle) => ({
          ...vehicle,
          reg_number: vehicle.reg_number || 'Unknown',
        })));
      } catch (err) {
        if (isNetworkFetchError(err)) {
          console.warn('Unable to load vans (network):', err);
        } else if (!isAuthErrorStatus(getErrorStatus(err))) {
          console.error('Error fetching vehicles:', err);
        }
      }
    };
    fetchVehicles();
    // Load recent vehicle IDs
    if (user?.id) {
      setRecentVehicleIds(getRecentVehicleIds(user.id));
    }
  }, [user, authLoading, canAccessInspectionModule, permissionLoading, canViewCrossUserInspections, supabase]);

  const fetchInspections = useCallback(async () => {
    if (!user || authLoading || permissionLoading || !canAccessInspectionModule) return;
    setLoading(true);

    try {
      let query = supabase
        .from('van_inspections')
        .select('*')
        .order('inspection_date', { ascending: false })
        .range(0, displayCount);

      // Filter based on user role and selection
      if (!canViewCrossUserInspections) {
        // Regular employees only see their own
        query = query.eq('user_id', user.id);
      } else {
        const employeeFilter = normalizedEmployeeFilter || 'all';
        if (employeeFilter !== 'all') {
          if (!hasOrgWideInspectionVisibility && !scopedEmployeeIds.includes(employeeFilter)) {
            query = query.eq('user_id', user.id);
          } else {
            query = query.eq('user_id', employeeFilter);
          }
        } else if (hasTeamInspectionVisibility) {
          query = query.in('user_id', scopedEmployeeIds.length > 0 ? scopedEmployeeIds : [user.id]);
        }
      }

      // Apply status filter
      const currentStatusFilter = statusFilter || 'all';
      if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter as 'draft' | 'submitted');
      }
      // 'all' doesn't filter by status

      // Apply van filter
      const currentVehicleFilter = normalizedVehicleFilter || 'all';
      if (currentVehicleFilter !== 'all') {
        query = query.eq('van_id', currentVehicleFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      const rows = ((data || []) as Array<Omit<InspectionWithVehicle, 'vans' | 'profile'>>).map((row) => ({
        ...row,
        vans: null,
        profile: null,
      }));
      const validVanIds = Array.from(new Set(rows.map((row) => row.van_id).filter(isUuid)));
      const validUserIds = Array.from(new Set(rows.map((row) => row.user_id).filter(isUuid)));
      let vehicleMap = new Map<string, { reg_number: string; van_categories: { name: string } | null }>();
      let profileMap = new Map<string, { full_name: string }>();

      if (validVanIds.length > 0) {
        const { data: vans, error: vansError } = await supabase
          .from('vans')
          .select(`
            id,
            reg_number,
            van_categories (
              name
            )
          `)
          .in('id', validVanIds);

        if (vansError) {
          console.warn('Unable to load inspection vehicle details:', vansError);
        } else {
          vehicleMap = new Map(
            ((vans || []) as Array<{ id: string; reg_number: string; van_categories: { name: string } | null }>)
              .filter((van) => Boolean(van.id))
              .map((van) => [
                van.id,
                {
                  reg_number: van.reg_number,
                  van_categories: van.van_categories ?? null,
                },
              ])
          );
        }
      }

      if (validUserIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', validUserIds);

        if (profilesError) {
          console.warn('Unable to load inspection owner names:', profilesError);
        } else {
          profileMap = new Map(
            ((profiles || []) as Array<{ id: string; full_name: string | null }>)
              .filter((profile): profile is { id: string; full_name: string } =>
                Boolean(profile.id && profile.full_name)
              )
              .map((profile) => [profile.id, { full_name: profile.full_name }])
          );
        }
      }

      const inspectionIds = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
      let defectInspectionIds = new Set<string>();
      let workshopTaskInspectionIds = new Set<string>();

      if (inspectionIds.length > 0) {
        const { data: defectData, error: defectError } = await supabase
          .from('inspection_items')
          .select('inspection_id, status')
          .in('inspection_id', inspectionIds)
          .in('status', ['attention', 'defect']);

        if (defectError) {
          console.warn('Unable to determine defect status for inspection icons:', defectError);
        } else {
          defectInspectionIds = new Set(
            ((defectData || []) as InspectionItemSummaryRow[])
              .map((row) => row.inspection_id)
              .filter((id): id is string => Boolean(id))
          );
        }

        const { data: workshopTaskData, error: workshopTaskError } = await supabase
          .from('actions')
          .select('inspection_id')
          .in('inspection_id', inspectionIds)
          .eq('action_type', 'workshop_vehicle_task');

        if (workshopTaskError) {
          console.warn('Unable to determine workshop-task status for inspection icons:', workshopTaskError);
        } else {
          workshopTaskInspectionIds = new Set(
            ((workshopTaskData || []) as WorkshopTaskSummaryRow[])
              .map((row) => row.inspection_id)
              .filter((id): id is string => Boolean(id))
          );
        }
      }

      const enrichedRows = rows.map((row) => ({
        ...row,
        vans: row.van_id && isUuid(row.van_id) ? vehicleMap.get(row.van_id) ?? null : null,
        profile: profileMap.get(row.user_id) ?? null,
        has_reported_defect: defectInspectionIds.has(row.id),
        has_inform_workshop_task: workshopTaskInspectionIds.has(row.id),
      }));
      setHasMore(rows.length > displayCount);
      setInspections(enrichedRows.slice(0, displayCount));
    } catch (error) {
      const errorContextId = 'van-inspections-fetch-list-error';
      const isNetworkFailure = isNetworkFetchError(error);
      const isAuthFailure = isAuthErrorStatus(getErrorStatus(error));

      // Avoid escalating common mobile/offline network failures into centralized error logs
      if (isNetworkFailure) {
        console.warn('Unable to load inspections (network):', error, { errorContextId, network: true });
      } else if (!isAuthFailure) {
        console.error('Error fetching inspections:', error, { errorContextId });
      }

      // Show friendly message if offline or network failure
      if (!navigator.onLine || isNetworkFailure) {
        try {
          toast.error('Unable to load inspections', {
            id: errorContextId,
            description: 'Please check your internet connection.',
          });
        } catch {
          console.warn('Unable to load inspections (toast unavailable)');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [
    user,
    authLoading,
    permissionLoading,
    canAccessInspectionModule,
    canViewCrossUserInspections,
    hasOrgWideInspectionVisibility,
    hasTeamInspectionVisibility,
    scopedEmployeeIds,
    normalizedEmployeeFilter,
    statusFilter,
    normalizedVehicleFilter,
    supabase,
    displayCount,
  ]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, normalizedEmployeeFilter, statusFilter, normalizedVehicleFilter]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VAN_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<VanInspectionsColumnVisibility>;
        setColumnVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  // Listen for realtime updates to inspections
  useInspectionRealtime((payload) => {
    console.log('Realtime inspection update:', payload);
    
      // Refetch inspections when changes occur
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
        fetchInspections();
        
        // Show toast notification when inspection is submitted
        if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
          const status = (payload.new as { status?: string }).status;
          if (status === 'submitted') {
            toast.success('Daily check submitted', {
              description: 'A van inspection has been submitted.',
            });
          }
        }
      }
  });

  const getFilterLabel = (filter: InspectionStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'submitted': return 'Submitted';
      default: return filter; // Fallback for any unexpected values
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'default' as const, label: 'Submitted' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (inspection: InspectionWithVehicle) => {
    const iconColorClass = inspection.has_inform_workshop_task
      ? 'text-inspection'
      : inspection.has_reported_defect
        ? 'text-red-500'
        : 'text-green-500';

    if (inspection.status === 'submitted') {
      return <Clock className={`h-5 w-5 ${iconColorClass}`} />;
    }

    return <Clipboard className={`h-5 w-5 ${iconColorClass}`} />;
  };

  function toggleColumn(column: keyof VanInspectionsColumnVisibility) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(VAN_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(inspectionId);
    const errorContextId = `van-inspections-download-pdf-${inspectionId}`;
    try {
      const response = await fetch(`/api/van-inspections/${inspectionId}/pdf`);
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

        console.warn('Inspection PDF download failed:', {
          inspectionId,
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
      a.download = `inspection-${inspectionId}.pdf`;
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
        console.error('Inspection PDF download failed (network):', error, { errorContextId, network: true });
      } else {
        console.error('Inspection PDF download failed:', error, { errorContextId });
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

  const openDeleteDialog = (e: React.MouseEvent, inspection: DeleteDialogInspectionInput) => {
    e.stopPropagation(); // Prevent card click
    setInspectionToDelete({
      id: inspection.id,
      vehicleReg: inspection.vans?.reg_number || 'Unknown',
      date: formatDate(inspection.inspection_date),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    const errorContextId = `van-inspections-delete-${inspectionToDelete.id}`;
    try {
      const response = await fetch(`/api/van-inspections/${inspectionToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete inspection');
      }

      toast.success('Daily check deleted successfully');
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      fetchInspections(); // Refresh list
    } catch (err: unknown) {
      console.error('Error deleting inspection:', err, { errorContextId });
      toast.error(err instanceof Error ? err.message : 'Failed to delete inspection', {
        id: errorContextId,
      });
    } finally {
      setDeleting(false);
    }
  };

  const showInitialLoading = (permissionLoading || loading) && inspections.length === 0;

  const canEditInspection = (inspection: Pick<InspectionWithVehicle, 'status' | 'user_id'>) =>
    canEditDraftInspection({
      status: inspection.status,
      ownerUserId: inspection.user_id,
      currentUserId: user?.id,
      canManageInspections,
    });

  const canDeleteInspection = (inspection: Pick<InspectionWithVehicle, 'status' | 'user_id'>) =>
    canDeleteInspections && canEditInspection(inspection);

  const getInspectionHref = (inspection: Pick<InspectionWithVehicle, 'id' | 'status' | 'user_id'>) =>
    canEditInspection(inspection)
      ? `/van-inspections/new?id=${inspection.id}`
      : `/van-inspections/${inspection.id}`;

  return (
    <AppPageShell>
      
      {/* Header */}
      <div className={`bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">Van Daily Checks</h1>
            <p className="text-muted-foreground">
              Daily safety check sheets
            </p>
          </div>
          <Link
            href={inspectionsPaused ? '#' : '/van-inspections/new'}
            aria-disabled={inspectionsPaused}
            className={`w-full md:w-auto ${inspectionsPaused ? 'pointer-events-none' : ''}`}
          >
            <Button
              disabled={inspectionsPaused}
              className={`w-full bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg md:w-auto ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Daily Check
            </Button>
          </Link>
        </div>
        {inspectionsPaused && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/10 text-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            <AlertTitle>{VAN_INSPECTIONS_MAINTENANCE_TITLE}</AlertTitle>
            <AlertDescription>{VAN_INSPECTIONS_MAINTENANCE_MESSAGE}</AlertDescription>
          </Alert>
        )}
        {inspectionsPaused && (
          <Card className="mb-4 border-amber-500/30 bg-slate-950/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-white">Van checks are in read-only mode</CardTitle>
              <CardDescription>
                You can review existing van checks below, but new drafts, edits, submissions, deletes, defect sync, and workshop notifications are paused until the update is complete.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        
        {/* Manager: Employee Filter */}
        {canViewCrossUserInspections && employees.length > 0 && (
          <div className="pt-4 border-t border-border">
            <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${tabletModeEnabled ? 'max-w-none flex-wrap' : 'max-w-md'}`}>
              <Label htmlFor="employee-filter" className="text-white text-sm flex items-center gap-2">
                <User className="h-4 w-4" />
                View daily checks for:
              </Label>
              <Select value={normalizedEmployeeFilter} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger id="employee-filter" className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-10'} border-border text-white bg-slate-900/50`}>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.has_module_access === false && ' - No Van Checks access'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Filters - Only show for managers */}
      {canViewCrossUserInspections && (
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className={`grid grid-cols-1 gap-6 ${tabletModeEnabled ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
              {/* Status Filter */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 sm:mr-2">Filter by status:</span>
                <div className="flex gap-2 flex-wrap">
                  {(['all', 'draft', 'submitted'] as InspectionStatusFilter[]).map((filter) => (
                    <Button
                      key={filter}
                      variant="outline"
                      size="sm"
                      onClick={() => setStatusFilter(filter)}
                      className={`${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''} ${statusFilter === filter ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}`}
                    >
                      {filter === 'submitted' && <Clock className="h-3 w-3 mr-1" />}
                      {filter === 'draft' && <FileText className="h-3 w-3 mr-1" />}
                      {getFilterLabel(filter)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Van Filter */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 sm:mr-2">Filter by van:</span>
                <Select value={normalizedVehicleFilter} onValueChange={setVehicleFilter}>
                <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-9'} border-border text-white bg-slate-900/50`}>
                    <SelectValue placeholder="All vans" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vans</SelectItem>
                    {(() => {
                      const { recentVehicles, otherVehicles } = splitVehiclesByRecent(vehicles as Array<Vehicle & Record<string, unknown>>, recentVehicleIds);
                      return (
                        <>
                          {recentVehicles.length > 0 && (
                            <>
                              <SelectSeparator className="bg-slate-700" />
                              <SelectGroup>
                                <SelectLabel className="">Recent</SelectLabel>
                                {recentVehicles.map((vehicle: Vehicle) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id}>
                                    {vehicle.reg_number}
                                    {vehicle.van_categories?.name && ` (${vehicle.van_categories.name})`}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </>
                          )}
                          {otherVehicles.length > 0 && (
                            <>
                              <SelectSeparator className="bg-slate-700" />
                              <SelectGroup>
                                {recentVehicles.length > 0 && (
                                  <SelectLabel className="">All Vans</SelectLabel>
                                )}
                                {otherVehicles.map((vehicle: Vehicle) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id}>
                                    {vehicle.reg_number}
                                    {vehicle.van_categories?.name && ` (${vehicle.van_categories.name})`}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showInitialLoading ? (
        <PanelLoader message="Loading daily checks..." accent="inspection" className="py-20" />
      ) : inspections.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No daily checks yet</h3>
            <p className="text-slate-400 mb-4">
              Create your first van daily check
            </p>
            <Link
              href={inspectionsPaused ? '#' : '/van-inspections/new'}
              aria-disabled={inspectionsPaused}
              className={inspectionsPaused ? 'pointer-events-none' : undefined}
            >
              <Button
                disabled={inspectionsPaused}
                className="bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Daily Check
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing daily checks...
            </div>
          )}

          {canViewCrossUserInspections && (
            <div className="hidden md:flex items-center justify-end gap-2">
              {viewMode === 'table' ? (
                <ColumnVisibilityMenu
                  options={[
                    { id: 'employeeId', label: 'Employee ID', checked: columnVisibility.employeeId },
                    { id: 'vehicleCategory', label: 'Vehicle Category', checked: columnVisibility.vehicleCategory },
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
                  localStorage.setItem('van-inspections-view-mode', nextViewMode);
                }}
              />
            </div>
          )}

          {canViewCrossUserInspections && viewMode === 'table' && (
            <div className="hidden md:block">
              <VanInspectionsListTable
                inspections={inspections}
                columnVisibility={columnVisibility}
                downloadingId={downloading}
                deleting={deleting}
                getInspectionHref={getInspectionHref}
                canDeleteInspection={canDeleteInspection}
                onDownloadPDF={handleDownloadPDF}
                onOpenDeleteDialog={openDeleteDialog}
              />
            </div>
          )}

          <div className={canViewCrossUserInspections && viewMode === 'table' ? 'md:hidden grid gap-4' : 'grid gap-4'}>
            {inspections.map((inspection) => {
              return (
            <Card 
              key={inspection.id} 
              className="border-border hover:shadow-lg hover:border-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                router.push(getInspectionHref(inspection));
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(inspection)}
                    <div>
                      <CardTitle className="text-lg text-white">
                        {inspection.vans?.reg_number || 'Unknown Van'}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {canViewCrossUserInspections && (inspection as { profile?: { full_name?: string } | null }).profile?.full_name && (
                          <span className="font-medium text-white">
                            {(inspection as { profile?: { full_name?: string } | null }).profile?.full_name}
                            {' • '}
                          </span>
                        )}
                        {inspection.vans?.van_categories?.name && `${inspection.vans.van_categories.name} • `}
                        {formatDate(inspection.inspection_date)}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(inspection.status)}
                    {canDeleteInspection(inspection) && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, inspection)}
                        variant="ghost"
                        size="sm"
                        className={`${tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-8 w-8 p-0'} text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950`}
                        title="Delete inspection"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    {inspection.status === 'submitted'
                      ? inspection.submitted_at
                        ? `Submitted ${formatDate(inspection.submitted_at)}`
                        : 'Submitted'
                      : 'Draft'}
                  </div>
                  {inspection.status === 'submitted' && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, inspection.id)}
                      disabled={downloading === inspection.id}
                      variant="outline"
                      size="sm"
                      className={`bg-slate-900 border-inspection text-inspection hover:bg-inspection hover:text-white transition-all duration-200 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
              );
            })}
          </div>

          {/* Show More Button */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount((prev) => prev + pageSize)}
                variant="outline"
                className={`w-full max-w-xs border-border text-white hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
              >
                Show More
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Daily Check</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the inspection for{' '}
              <span className="font-semibold">{inspectionToDelete?.vehicleReg}</span> on{' '}
              <span className="font-semibold">{inspectionToDelete?.date}</span>?
              <br />
              <br />
              This action cannot be undone. All inspection items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
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

export default function InspectionsPage() {
  return (
    <NuqsClientAdapter>
      <Suspense fallback={<PageLoader message="Loading van inspections..." />}>
        <InspectionsContent />
      </Suspense>
    </NuqsClientAdapter>
  );
}
