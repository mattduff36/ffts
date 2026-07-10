'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Clipboard, Clock, Download, Filter, Loader2, Plus, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { canEditDraftInspection, getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { formatDate } from '@/lib/utils/date';
import { isUuid } from '@/lib/utils/uuid';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import type { Employee, InspectionStatusFilter } from '@/types/common';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { ColumnVisibilityMenu, DataViewToggle } from '@/components/ui/data-view-controls';
import {
  DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY,
  HgvInspectionsColumnVisibility,
  HgvInspectionsListTable,
  HGV_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY,
} from './components/HgvInspectionsListTable';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';

interface HgvInspectionWithRelations {
  id: string;
  user_id: string;
  hgv_id: string | null;
  inspection_date: string;
  inspection_end_date: string | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  hgv: { reg_number: string; nickname: string | null } | null;
  profile: { full_name: string } | null;
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
}

interface HgvSummary {
  id: string;
  reg_number: string;
  nickname: string | null;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
  status: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

function HgvInspectionsContent() {
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
  } = usePermissionCheck('hgv-inspections');
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
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;

  const [inspections, setInspections] = useState<HgvInspectionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [hgvs, setHgvs] = useState<HgvSummary[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('hgv-inspections-view-mode') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });
  const [columnVisibility, setColumnVisibility] = useState<HgvInspectionsColumnVisibility>(
    DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY
  );

  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', {
    defaultValue: 'all',
    shallow: false,
  });
  const [hgvFilter, setHgvFilter] = useQueryState('hgv', {
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState('status', {
    defaultValue: 'all' as InspectionStatusFilter,
    shallow: false,
  });
  const normalizedEmployeeFilter =
    selectedEmployeeId !== 'all' && !isUuid(selectedEmployeeId) ? 'all' : selectedEmployeeId;
  const normalizedHgvFilter = hgvFilter === 'all' || isUuid(hgvFilter) ? hgvFilter : 'all';

  useEffect(() => {
    if (selectedEmployeeId !== normalizedEmployeeFilter) {
      setSelectedEmployeeId(normalizedEmployeeFilter);
    }
  }, [normalizedEmployeeFilter, selectedEmployeeId, setSelectedEmployeeId]);

  useEffect(() => {
    if (hgvFilter !== normalizedHgvFilter) {
      setHgvFilter(normalizedHgvFilter);
    }
  }, [hgvFilter, normalizedHgvFilter, setHgvFilter]);

  const fetchFilters = useCallback(async () => {
    if (authLoading || !user || permissionLoading || !canAccessInspectionModule) {
      setHgvs([]);
      return;
    }

    try {
      if (canViewCrossUserInspections) {
        const { data: hgvData } = await supabase
          .from('hgvs')
          .select('id, reg_number, nickname')
          .eq('status', 'active')
          .order('reg_number');
        setHgvs(hgvData || []);
      } else {
        setHgvs([]);
      }

      if (canViewCrossUserInspections) {
        const profileData = await fetchUserDirectory({ module: 'hgv-inspections' });
        setScopedEmployeeIds(Array.from(new Set([user.id, ...profileData.map((employee) => employee.id)])));
        setEmployees(
          profileData.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            employee_id: employee.employee_id,
            has_module_access: employee.has_module_access,
          })) as Employee[]
        );
      } else {
        setEmployees([]);
        setScopedEmployeeIds([user.id]);
      }
    } catch (error) {
      if (!isAuthErrorStatus(getErrorStatus(error))) {
        console.error('Error fetching HGV filters:', error);
      }
    }
  }, [authLoading, canAccessInspectionModule, permissionLoading, canViewCrossUserInspections, supabase, user]);

  const fetchInspections = useCallback(async () => {
    if (!user || authLoading || permissionLoading || !canAccessInspectionModule) return;
    setLoading(true);

    try {
      let query = supabase
        .from('hgv_inspections')
        .select('*')
        .order('inspection_date', { ascending: false });

      if (!canViewCrossUserInspections) {
        query = query.eq('user_id', user.id);
      } else if ((normalizedEmployeeFilter || 'all') !== 'all') {
        const employeeFilter = normalizedEmployeeFilter as string;
        if (!hasOrgWideInspectionVisibility && !scopedEmployeeIds.includes(employeeFilter)) {
          query = query.eq('user_id', user.id);
        } else {
          query = query.eq('user_id', employeeFilter);
        }
      } else if (hasTeamInspectionVisibility) {
        query = query.in('user_id', scopedEmployeeIds.length > 0 ? scopedEmployeeIds : [user.id]);
      }

      if ((normalizedHgvFilter || 'all') !== 'all') {
        query = query.eq('hgv_id', normalizedHgvFilter as string);
      }

      const currentStatusFilter = statusFilter || 'all';
      if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter as 'draft' | 'submitted');
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = ((data || []) as Array<Omit<HgvInspectionWithRelations, 'hgv' | 'profile'>>).map((row) => ({
        ...row,
        hgv: null,
        profile: null,
      }));
      const validHgvIds = Array.from(new Set(rows.map((row) => row.hgv_id).filter(isUuid)));
      const validUserIds = Array.from(new Set(rows.map((row) => row.user_id).filter(isUuid)));
      let hgvMap = new Map<string, { reg_number: string; nickname: string | null }>();
      let profileMap = new Map<string, { full_name: string }>();

      if (validHgvIds.length > 0) {
        const { data: hgvs, error: hgvsError } = await supabase
          .from('hgvs')
          .select('id, reg_number, nickname')
          .in('id', validHgvIds);

        if (hgvsError) {
          console.warn('Unable to load HGV inspection vehicle details:', hgvsError);
        } else {
          hgvMap = new Map(
            ((hgvs || []) as Array<{ id: string; reg_number: string; nickname: string | null }>)
              .filter((hgv) => Boolean(hgv.id))
              .map((hgv) => [hgv.id, { reg_number: hgv.reg_number, nickname: hgv.nickname ?? null }])
          );
        }
      }

      if (validUserIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', validUserIds);

        if (profilesError) {
          console.warn('Unable to load HGV inspection owner names:', profilesError);
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
          console.warn('Unable to determine defect status for HGV inspection icons:', defectError);
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
          console.warn('Unable to determine workshop-task status for HGV inspection icons:', workshopTaskError);
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
          hgv: row.hgv_id && isUuid(row.hgv_id) ? hgvMap.get(row.hgv_id) ?? null : null,
          profile: profileMap.get(row.user_id) ?? null,
          has_reported_defect: defectInspectionIds.has(row.id),
          has_inform_workshop_task: workshopTaskInspectionIds.has(row.id),
        }))
      );
    } catch (error) {
      const errorContextId = 'hgv-inspections-fetch-list-error';
      const isNetworkFailure = isNetworkFetchError(error);
      const isAuthFailure = isAuthErrorStatus(getErrorStatus(error));

      if (isNetworkFailure) {
        console.warn('Unable to load HGV inspections (network):', error, { errorContextId, network: true });
      } else if (isAuthFailure) {
        console.warn('Unable to load HGV inspections (auth):', error, { errorContextId, auth: true });
      } else {
        console.error('Error fetching HGV inspections:', error, { errorContextId });
        toast.error('Failed to load HGV inspections', { id: errorContextId });
      }
    } finally {
      setLoading(false);
    }
  }, [
    authLoading,
    permissionLoading,
    canAccessInspectionModule,
    normalizedHgvFilter,
    canViewCrossUserInspections,
    hasOrgWideInspectionVisibility,
    hasTeamInspectionVisibility,
    scopedEmployeeIds,
    normalizedEmployeeFilter,
    statusFilter,
    supabase,
    user,
  ]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, normalizedEmployeeFilter, normalizedHgvFilter, statusFilter]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HGV_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<HgvInspectionsColumnVisibility>;
        setColumnVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(inspectionId);
    const errorContextId = `hgv-inspections-download-pdf-${inspectionId}`;
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hgv-inspection-${inspectionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading HGV inspection PDF:', error, { errorContextId });
      toast.error('Failed to download PDF', { id: errorContextId });
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this inspection? This cannot be undone.')) return;

    setDeleting(inspectionId);
    const errorContextId = `hgv-inspections-delete-${inspectionId}`;
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/delete`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Delete failed');
      }
      toast.success('Daily check deleted');
      fetchInspections();
    } catch (error) {
      console.error('Error deleting HGV inspection:', error, { errorContextId });
      toast.error('Failed to delete inspection', { id: errorContextId });
    } finally {
      setDeleting(null);
    }
  };

  const showInitialLoading = (permissionLoading || loading) && inspections.length === 0;

  const getInspectionIcon = (inspection: HgvInspectionWithRelations) => {
    const iconColorClass = inspection.has_inform_workshop_task
      ? 'text-hgv-inspection'
      : inspection.has_reported_defect
        ? 'text-red-500'
        : 'text-green-500';
    if (inspection.status === 'submitted') {
      return <Clock className={`h-5 w-5 ${iconColorClass}`} />;
    }

    return <Clipboard className={`h-5 w-5 ${iconColorClass}`} />;
  };

  const canEditInspection = (inspection: Pick<HgvInspectionWithRelations, 'status' | 'user_id'>) =>
    canEditDraftInspection({
      status: inspection.status,
      ownerUserId: inspection.user_id,
      currentUserId: user?.id,
      canManageInspections,
    });

  function getFilterLabel(filter: InspectionStatusFilter) {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'submitted': return 'Submitted';
      default: return filter;
    }
  }

  const canDeleteInspection = (inspection: Pick<HgvInspectionWithRelations, 'status' | 'user_id'>) =>
    canDeleteInspections && canEditInspection(inspection);

  const getInspectionHref = (inspection: Pick<HgvInspectionWithRelations, 'id' | 'status' | 'user_id'>) =>
    canEditInspection(inspection)
      ? `/hgv-inspections/new?id=${inspection.id}`
      : `/hgv-inspections/${inspection.id}`;

  function toggleColumn(column: keyof HgvInspectionsColumnVisibility) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(HGV_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <AppPageShell>
      <div className={`bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">HGV Daily Checks</h1>
            <p className="text-muted-foreground">Daily 26-point HGV safety checks</p>
          </div>
          <Link href="/hgv-inspections/new" className="w-full md:w-auto">
            <Button className={`w-full bg-hgv-inspection hover:bg-hgv-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg md:w-auto ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
              <Plus className="h-4 w-4 mr-2" />
              New Daily Check
            </Button>
          </Link>
        </div>

        {canViewCrossUserInspections && employees.length > 0 && (
          <div className="pt-4 border-t border-border">
            <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${tabletModeEnabled ? 'max-w-none flex-wrap' : 'max-w-md'}`}>
            <Label className="text-white text-sm flex items-center gap-2">
              <User className="h-4 w-4" />
              View daily checks for:
            </Label>
            <Select value={normalizedEmployeeFilter || 'all'} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-10'} border-border text-white bg-slate-900/50`}>
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                    {employee.full_name}
                    {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.has_module_access === false && ' - No HGV Checks access'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </div>
        )}
      </div>

      {canViewCrossUserInspections && (
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className={`grid grid-cols-1 gap-6 ${tabletModeEnabled ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
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

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 sm:mr-2">Filter by HGV:</span>
                <Select value={normalizedHgvFilter || 'all'} onValueChange={setHgvFilter}>
                  <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-9'} border-border text-white bg-slate-900/50`}>
                    <SelectValue placeholder="All HGVs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All HGVs</SelectItem>
                    {hgvs.map((hgv) => (
                      <SelectItem key={hgv.id} value={hgv.id}>
                        {hgv.reg_number}
                        {hgv.nickname ? ` - ${hgv.nickname}` : ''}
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
        <PanelLoader message="Loading daily checks..." accent="hgv-inspection" className="py-20" />
      ) : inspections.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No HGV daily checks yet</h3>
            <p className="text-slate-400 mb-4">Create your first HGV daily check</p>
            <Link href="/hgv-inspections/new">
              <Button className={`bg-hgv-inspection hover:bg-hgv-inspection-dark text-white transition-all duration-200 active:scale-95 ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
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
              Refreshing HGV checks...
            </div>
          )}

          {canViewCrossUserInspections && (
            <div className="hidden md:flex items-center justify-end gap-2">
              {viewMode === 'table' ? (
                <ColumnVisibilityMenu
                  options={[
                    { id: 'employeeId', label: 'Employee ID', checked: columnVisibility.employeeId },
                    { id: 'nickname', label: 'Nickname', checked: columnVisibility.nickname },
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
                  localStorage.setItem('hgv-inspections-view-mode', nextViewMode);
                }}
              />
            </div>
          )}

          {canViewCrossUserInspections && viewMode === 'table' && (
            <div className="hidden md:block">
              <HgvInspectionsListTable
                inspections={inspections.slice(0, displayCount)}
                columnVisibility={columnVisibility}
                downloadingId={downloading}
                deletingId={deleting}
                getInspectionHref={getInspectionHref}
                canDeleteInspection={canDeleteInspection}
                onDownloadPDF={handleDownloadPDF}
                onDeleteInspection={handleDelete}
              />
            </div>
          )}

          <div className={canViewCrossUserInspections && viewMode === 'table' ? 'md:hidden grid gap-4' : 'grid gap-4'}>
            {inspections.slice(0, displayCount).map((inspection) => (
            <Card
              key={inspection.id}
              className="border-border hover:shadow-lg hover:border-hgv-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => router.push(getInspectionHref(inspection))}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getInspectionIcon(inspection)}
                    <div>
                      <CardTitle className="text-lg text-white">
                        {inspection.hgv?.reg_number || 'Unknown HGV'}
                        {inspection.hgv?.nickname ? ` - ${inspection.hgv.nickname}` : ''}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {canViewCrossUserInspections && inspection.profile?.full_name ? `${inspection.profile.full_name} • ` : ''}
                        {formatDate(inspection.inspection_date)}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={inspection.status === 'submitted' ? 'default' : 'secondary'}
                      className={
                        inspection.status === 'submitted'
                          ? 'border-hgv-inspection/40 bg-hgv-inspection/10 text-hgv-inspection'
                          : undefined
                      }
                    >
                      {inspection.status === 'submitted' ? 'Submitted' : 'Draft'}
                    </Badge>
                    {canDeleteInspection(inspection) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDelete(e, inspection.id)}
                        disabled={deleting === inspection.id}
                        className={`${tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-8 w-8 p-0'} text-red-600 hover:text-red-700`}
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
                      className={`bg-slate-900 border-hgv-inspection text-hgv-inspection hover:bg-hgv-inspection hover:text-white transition-all duration-200 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
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
    </AppPageShell>
  );
}

export default function HgvInspectionsPage() {
  return (
    <NuqsClientAdapter>
      <Suspense fallback={<PageLoader message="Loading HGV inspections..." />}>
        <HgvInspectionsContent />
      </Suspense>
    </NuqsClientAdapter>
  );
}
