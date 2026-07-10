'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePlantInspectionRealtime } from '@/lib/hooks/useRealtime';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { isUuid } from '@/lib/utils/uuid';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Clipboard, Clock, User, Download, Trash2, Filter, Wrench, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { PlantInspection } from '@/types/inspection';
import { Employee, InspectionStatusFilter } from '@/types/common';
import { useQueryState } from 'nuqs';
import { canEditDraftInspection, getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
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
  DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY,
  PLANT_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY,
  PlantInspectionsColumnVisibility,
  PlantInspectionsListTable,
} from './components/PlantInspectionsListTable';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';

interface InspectionWithPlant extends PlantInspection {
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    van_categories: { name: string } | null;
  } | null;
  profile: { full_name: string } | null;
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
}

interface DeleteDialogInspectionInput {
  id: string;
  inspection_date: string;
  is_hired_plant: boolean;
  hired_plant_id_serial?: string | null;
  plant?: { plant_id?: string | null } | null;
}

interface Plant {
  id: string;
  plant_id: string;
  nickname: string | null;
  serial_number: string | null;
  van_categories: { name: string } | null;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
  status: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

function PlantInspectionsContent() {
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
  } = usePermissionCheck('plant-inspections');
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
  const [inspections, setInspections] = useState<InspectionWithPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', { 
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState('status', {
    defaultValue: 'all' as InspectionStatusFilter,
    shallow: false,
  });
  const [plantFilter, setPlantFilter] = useQueryState('plant', {
    defaultValue: 'all',
    shallow: false,
  });
  const normalizedEmployeeFilter =
    selectedEmployeeId !== 'all' && !isUuid(selectedEmployeeId) ? 'all' : selectedEmployeeId;
  const normalizedPlantFilter =
    plantFilter === 'all' || plantFilter === 'hired' || isUuid(plantFilter) ? plantFilter : 'all';
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<{ id: string; plantId: string; date: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('plant-inspections-view-mode') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });
  const [columnVisibility, setColumnVisibility] = useState<PlantInspectionsColumnVisibility>(
    DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY
  );
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;

  useEffect(() => {
    if (selectedEmployeeId !== normalizedEmployeeFilter) {
      setSelectedEmployeeId(normalizedEmployeeFilter);
    }
  }, [normalizedEmployeeFilter, selectedEmployeeId, setSelectedEmployeeId]);

  useEffect(() => {
    if (plantFilter !== normalizedPlantFilter) {
      setPlantFilter(normalizedPlantFilter);
    }
  }, [normalizedPlantFilter, plantFilter, setPlantFilter]);

  useEffect(() => {
    const fetchPlants = async () => {
      try {
        const { data, error } = await supabase
          .from('plant')
          .select(`
            id, 
            plant_id,
            nickname,
            serial_number,
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
        }
      }
    };

    if (
      user &&
      canAccessInspectionModule &&
      !permissionLoading &&
      canViewCrossUserInspections
    ) {
      const fetchEmployees = async () => {
        try {
          const data = await fetchUserDirectory({ module: 'plant-inspections' });
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
          const status = getErrorStatus(err);
          if (!isAuthErrorStatus(status) && !isNetworkFetchError(err)) {
            console.error('Error fetching employees:', err);
          }
        }
      };

      void fetchEmployees();
      void fetchPlants();
    } else if (user) {
      setEmployees([]);
      setScopedEmployeeIds([user.id]);
      setPlants([]);
    }

    if (authLoading || permissionLoading || !canAccessInspectionModule || !canViewCrossUserInspections) {
      setPlants([]);
    }
  }, [authLoading, user, canAccessInspectionModule, permissionLoading, canViewCrossUserInspections, supabase]);

  const fetchInspections = useCallback(async () => {
    if (!user || authLoading || permissionLoading || !canAccessInspectionModule) return;
    setLoading(true);

    try {
      let query = supabase
        .from('plant_inspections')
        .select(`
          id,
          plant_id,
          user_id,
          inspection_date,
          inspection_end_date,
          current_mileage,
          status,
          submitted_at,
          is_hired_plant,
          hired_plant_id_serial,
          hired_plant_description,
          hired_plant_hiring_company
        `)
        .order('inspection_date', { ascending: false });

      // Filter based on user role and selection
      if (!canViewCrossUserInspections) {
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

      // Apply plant filter
      const currentPlantFilter = normalizedPlantFilter || 'all';
      if (currentPlantFilter === 'hired') {
        query = query.eq('is_hired_plant', true);
      } else if (currentPlantFilter !== 'all') {
        query = query.eq('plant_id', currentPlantFilter);
      }

      const currentStatusFilter = statusFilter || 'all';
      if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter as 'draft' | 'submitted');
      }

      const { data, error } = await query;

      if (error) throw error;
      const rows = ((data || []) as Array<Omit<InspectionWithPlant, 'plant' | 'profile'>>).map((row) => ({
        ...row,
        plant: null,
        profile: null,
      }));
      const validPlantIds = Array.from(new Set(rows.map((row) => row.plant_id).filter(isUuid)));
      const validUserIds = Array.from(new Set(rows.map((row) => row.user_id).filter(isUuid)));
      let plantMap = new Map<string, {
        plant_id: string;
        nickname: string | null;
        serial_number: string | null;
        van_categories: { name: string } | null;
      }>();
      let profileMap = new Map<string, { full_name: string }>();

      if (validPlantIds.length > 0) {
        const { data: plants, error: plantsError } = await supabase
          .from('plant')
          .select(`
            id,
            plant_id,
            nickname,
            serial_number,
            van_categories (
              name
            )
          `)
          .in('id', validPlantIds);

        if (plantsError) {
          console.warn('Unable to load plant inspection asset details:', plantsError);
        } else {
          plantMap = new Map(
            ((plants || []) as Array<{
              id: string;
              plant_id: string;
              nickname: string | null;
              serial_number: string | null;
              van_categories: { name: string } | null;
            }>)
              .filter((plant) => Boolean(plant.id))
              .map((plant) => [
                plant.id,
                {
                  plant_id: plant.plant_id,
                  nickname: plant.nickname ?? null,
                  serial_number: plant.serial_number ?? null,
                  van_categories: plant.van_categories ?? null,
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
          console.warn('Unable to load plant inspection owner names:', profilesError);
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
          console.warn('Unable to determine defect status for plant inspection icons:', defectError);
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
          console.warn('Unable to determine workshop-task status for plant inspection icons:', workshopTaskError);
        } else {
          workshopTaskInspectionIds = new Set(
            ((workshopTaskData || []) as WorkshopTaskSummaryRow[])
              .map((row) => row.inspection_id)
              .filter((id): id is string => Boolean(id))
          );
        }
      }

      setInspections(
        rows.map((row) => ({
          ...row,
          plant: row.plant_id && isUuid(row.plant_id) ? plantMap.get(row.plant_id) ?? null : null,
          profile: profileMap.get(row.user_id) ?? null,
          has_reported_defect: defectInspectionIds.has(row.id),
          has_inform_workshop_task: workshopTaskInspectionIds.has(row.id),
        }))
      );
    } catch (error) {
      const errorContextId = 'plant-inspections-fetch-list-error';
      const isNetworkFailure = isNetworkFetchError(error);
      const isAuthFailure = isAuthErrorStatus(getErrorStatus(error));

      if (isNetworkFailure) {
        console.warn('Unable to load plant inspections (network):', error, { errorContextId, network: true });
      } else if (isAuthFailure) {
        console.warn('Unable to load plant inspections (auth):', error, { errorContextId, auth: true });
      } else {
        console.error('Error fetching plant inspections:', error, { errorContextId });
      }

      if (!navigator.onLine || isNetworkFailure) {
        try {
          toast.error('Unable to load plant inspections', {
            id: errorContextId,
            description: 'Please check your internet connection.',
          });
        } catch {
          console.warn('Unable to load plant inspections (toast unavailable)');
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
    normalizedPlantFilter,
    statusFilter,
    supabase,
  ]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, normalizedEmployeeFilter, statusFilter, normalizedPlantFilter]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PLANT_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PlantInspectionsColumnVisibility>;
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
  usePlantInspectionRealtime((payload) => {
    console.log('Realtime plant inspection update:', payload);
    
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      fetchInspections();
      
      if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
        const status = (payload.new as { status?: string }).status;
        if (status === 'submitted') {
          toast.success('Plant inspection submitted', {
            description: 'A plant inspection has been submitted.',
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
      default: return filter;
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

  const getStatusIcon = (inspection: InspectionWithPlant) => {
    const iconColorClass = inspection.has_inform_workshop_task
      ? 'text-plant-inspection'
      : inspection.has_reported_defect
        ? 'text-red-500'
        : 'text-green-500';

    if (inspection.status === 'submitted') {
      return <Clock className={`h-5 w-5 ${iconColorClass}`} />;
    }

    return <Clipboard className={`h-5 w-5 ${iconColorClass}`} />;
  };

  const canEditInspection = (inspection: Pick<InspectionWithPlant, 'status' | 'user_id'>) =>
    canEditDraftInspection({
      status: inspection.status,
      ownerUserId: inspection.user_id,
      currentUserId: user?.id,
      canManageInspections,
    });

  const canDeleteInspection = (inspection: Pick<InspectionWithPlant, 'status' | 'user_id'>) =>
    canDeleteInspections && canEditInspection(inspection);

  const getInspectionHref = (inspection: Pick<InspectionWithPlant, 'id' | 'status' | 'user_id'>) =>
    canEditInspection(inspection)
      ? `/plant-inspections/new?id=${inspection.id}`
      : `/plant-inspections/${inspection.id}`;

  function toggleColumn(column: keyof PlantInspectionsColumnVisibility) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(PLANT_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(inspectionId);
    const errorContextId = `plant-inspections-download-pdf-${inspectionId}`;
    try {
      const response = await fetch(`/api/plant-inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plant-inspection-${inspectionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading PDF:', error, { errorContextId });
      toast.error('Failed to download PDF', {
        id: errorContextId,
        description: 'Please try again or contact support if the problem persists.',
      });
    } finally {
      setDownloading(null);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, inspection: DeleteDialogInspectionInput) => {
    e.stopPropagation();
    setInspectionToDelete({
      id: inspection.id,
      plantId: inspection.is_hired_plant
        ? `Hired - ${inspection.hired_plant_id_serial || 'Unknown'}`
        : (inspection.plant?.plant_id || 'Unknown'),
      date: formatDate(inspection.inspection_date),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    const errorContextId = `plant-inspections-delete-${inspectionToDelete.id}`;
    try {
      const response = await fetch(`/api/plant-inspections/${inspectionToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete inspection');
      }

      toast.success('Plant inspection deleted successfully');
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      fetchInspections();
    } catch (err: unknown) {
      console.error('Error deleting plant inspection:', err, { errorContextId });
      toast.error(err instanceof Error ? err.message : 'Failed to delete inspection', {
        id: errorContextId,
      });
    } finally {
      setDeleting(false);
    }
  };

  const showInitialLoading = (permissionLoading || loading) && inspections.length === 0;

  return (
    <AppPageShell>
      
      {/* Header */}
      <div className={`bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">Plant Daily Checks</h1>
            <p className="text-muted-foreground">
              Daily plant machinery safety checks
            </p>
          </div>
          <Link href="/plant-inspections/new" className="w-full md:w-auto">
            <Button className={`w-full bg-plant-inspection hover:bg-plant-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg md:w-auto ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
              <Plus className="h-4 w-4 mr-2" />
              New Daily Check
            </Button>
          </Link>
        </div>
        
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
                      {employee.has_module_access === false && ' - No Plant Checks access'}
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
                      {filter === 'draft' && <Clipboard className="h-3 w-3 mr-1" />}
                      {filter === 'submitted' && <Clock className="h-3 w-3 mr-1" />}
                      {getFilterLabel(filter)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Plant Filter */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 sm:mr-2">Filter by plant:</span>
                <Select value={normalizedPlantFilter} onValueChange={setPlantFilter}>
                <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-9'} border-border text-white bg-slate-900/50`}>
                    <SelectValue placeholder="All plant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Plant</SelectItem>
                    <SelectItem value="hired" className="text-amber-400">Hired Plant</SelectItem>
                    {plants.map((plant) => (
                      <SelectItem key={plant.id} value={plant.id}>
                        {plant.plant_id}
                        {plant.nickname && ` - ${plant.nickname}`}
                        {plant.van_categories?.name && ` (${plant.van_categories.name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showInitialLoading ? (
        <PanelLoader message="Loading daily checks..." accent="plant-inspection" className="py-20" />
      ) : inspections.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No plant daily checks yet</h3>
            <p className="text-slate-400 mb-4">
              Create your first plant daily check
            </p>
            <Link href="/plant-inspections/new">
              <Button className="bg-plant-inspection hover:bg-plant-inspection-dark text-white transition-all duration-200 active:scale-95">
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
              Refreshing plant checks...
            </div>
          )}
          {canViewCrossUserInspections && (
            <div className="hidden md:flex items-center justify-end gap-2">
              {viewMode === 'table' ? (
                <ColumnVisibilityMenu
                  options={[
                    { id: 'employeeId', label: 'Employee ID', checked: columnVisibility.employeeId },
                    { id: 'category', label: 'Category', checked: columnVisibility.category },
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
                  localStorage.setItem('plant-inspections-view-mode', nextViewMode);
                }}
              />
            </div>
          )}

          {canViewCrossUserInspections && viewMode === 'table' && (
            <div className="hidden md:block">
              <PlantInspectionsListTable
                inspections={inspections.slice(0, displayCount)}
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
            {inspections.slice(0, displayCount).map((inspection) => {
              return (
            <Card 
              key={inspection.id} 
              className="border-border hover:shadow-lg hover:border-plant-inspection/50 transition-all duration-200 cursor-pointer"
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
                        {inspection.is_hired_plant ? (
                          <>
                            <span className="text-amber-400">Hired</span>
                            {' - '}
                            {inspection.hired_plant_id_serial || 'Unknown'}
                          </>
                        ) : (
                          <>
                            {inspection.plant?.plant_id || 'Unknown Plant'}
                            {inspection.plant?.nickname && ` - ${inspection.plant.nickname}`}
                            {inspection.plant?.serial_number && ` (SN: ${inspection.plant.serial_number})`}
                          </>
                        )}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {canViewCrossUserInspections && (inspection as { profile?: { full_name?: string } | null }).profile?.full_name && (
                          <span className="font-medium text-white">
                            {(inspection as { profile?: { full_name?: string } | null }).profile?.full_name}
                            {' • '}
                          </span>
                        )}
                        {inspection.is_hired_plant ? (
                          <>
                            {inspection.hired_plant_description && `${inspection.hired_plant_description} • `}
                            {inspection.hired_plant_hiring_company && `${inspection.hired_plant_hiring_company} • `}
                          </>
                        ) : (
                          <>
                            {inspection.plant?.van_categories?.name && `${inspection.plant.van_categories.name} • `}
                          </>
                        )}
                        {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                          ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                          : formatDate(inspection.inspection_date)
                        }
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
                      className={`bg-slate-900 border-plant-inspection text-plant-inspection hover:bg-plant-inspection hover:text-white transition-all duration-200 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
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
          {inspections.length > displayCount && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount((prev) => prev + pageSize)}
                variant="outline"
                className={`w-full max-w-xs border-border text-white hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
              >
                Show More ({inspections.length - displayCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Plant Daily Check</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the inspection for{' '}
              <span className="font-semibold">{inspectionToDelete?.plantId}</span> on{' '}
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

export default function PlantInspectionsPage() {
  return (
    <NuqsClientAdapter>
      <Suspense fallback={<PageLoader message="Loading plant inspections..." />}>
        <PlantInspectionsContent />
      </Suspense>
    </NuqsClientAdapter>
  );
}
