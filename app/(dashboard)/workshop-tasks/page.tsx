'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Settings, Plus, CheckCircle2, Clock, AlertTriangle, Wrench, Pause } from 'lucide-react';
import { ErrorDetailsResponse } from '@/types/error-details';
import { WorkshopTasksOverviewTab } from './components/WorkshopTasksOverviewTab';
import { WorkshopTaskStatusDialogs } from './components/WorkshopTaskStatusDialogs';
import { WorkshopTaskFormDialogs } from './components/WorkshopTaskFormDialogs';
import { WorkshopTaskAdminDialogs } from './components/WorkshopTaskAdminDialogs';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useWorkshopTasksFetchers } from './hooks/useWorkshopTasksFetchers';
import { useWorkshopTaskLifecycleActions } from './hooks/useWorkshopTaskLifecycleActions';
import { useWorkshopTaskCrudActions } from './hooks/useWorkshopTaskCrudActions';
import type { Action, Category, Subcategory, Vehicle, WorkshopTaskTileFilter } from './types';
import { useTaskInspectionPhotos } from '@/lib/hooks/useTaskInspectionPhotos';
import { useWorkshopActiveWakeLock } from '@/lib/hooks/useWorkshopActiveWakeLock';

function ModalChunkLoader({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 backdrop-blur-[1px]">
      <PanelLoader
        message={message}
        accent="workshop"
        className="!min-h-0 rounded-lg border border-border bg-background px-5 py-4 shadow-xl"
      />
    </div>
  );
}

const TaskCommentsDrawer = dynamic(
  () => import('@/components/workshop-tasks/TaskCommentsDrawer').then(m => ({ default: m.TaskCommentsDrawer })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading comments..." /> },
);
const WorkshopTaskModal = dynamic(
  () => import('@/components/workshop-tasks/WorkshopTaskModal').then(m => ({ default: m.WorkshopTaskModal })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading task details..." /> },
);
const SubcategoryDialog = dynamic(
  () => import('@/components/workshop-tasks/SubcategoryDialog').then(m => ({ default: m.SubcategoryDialog })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading subcategory dialog..." /> },
);
const CategoryManagementPanel = dynamic(
  () => import('@/components/workshop-tasks/CategoryManagementPanel').then(m => ({ default: m.CategoryManagementPanel })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading category settings..." /> },
);
const AttachmentManagementPanel = dynamic(
  () => import('@/components/workshop-tasks/AttachmentManagementPanel').then(m => ({ default: m.AttachmentManagementPanel })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading attachment settings..." /> },
);
const MarkTaskCompleteDialog = dynamic(
  () => import('@/components/workshop-tasks/MarkTaskCompleteDialog').then(m => ({ default: m.MarkTaskCompleteDialog })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading completion dialog..." /> },
);
const ErrorDetailsModal = dynamic(
  () => import('@/components/ui/error-details-modal').then(m => ({ default: m.ErrorDetailsModal })),
  { ssr: false, loading: () => <ModalChunkLoader message="Loading details..." /> },
);

export default function WorkshopTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('workshop-tasks');
  const { user, profile, isManager, isAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const showSettings = isAdmin || isManager;
  const supabase = useBrowserSupabaseClient();
  const { templates: attachmentTemplates } = useAttachmentTemplates();

  const [tasks, setTasks] = useState<Action[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [plantCategories, setPlantCategories] = useState<Category[]>([]);
  const [plantSubcategories, setPlantSubcategories] = useState<Subcategory[]>([]);
  const [hgvCategories, setHgvCategories] = useState<Category[]>([]);
  const [hgvSubcategories, setHgvSubcategories] = useState<Subcategory[]>([]);
  const [categoryTaxonomyMode, setCategoryTaxonomyMode] = useState<'van' | 'plant' | 'hgv'>('van');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<WorkshopTaskTileFilter>('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [taskAttachmentCounts, setTaskAttachmentCounts] = useState<Map<string, number>>(new Map());
  const lastAssetTabRef = useRef<'all' | 'van' | 'plant' | 'hgv'>('all');
  const [showPending, setShowPending] = useState(false);
  const [showInProgress, setShowInProgress] = useState(false);
  const [showOnHold, setShowOnHold] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [workshopComments, setWorkshopComments] = useState('');
  const [newMeterReading, setNewMeterReading] = useState('');
  const [currentMeterReading, setCurrentMeterReading] = useState<number | null>(null);
  const [meterReadingType, setMeterReadingType] = useState<'mileage' | 'hours'>('mileage');
  const [submitting, setSubmitting] = useState(false);
  const [selectedAttachmentTemplateIds, setSelectedAttachmentTemplateIds] = useState<string[]>([]);

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Action | null>(null);
  const [loggedComment, setLoggedComment] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<Action | null>(null);
  const [showOnHoldModal, setShowOnHoldModal] = useState(false);
  const [onHoldingTask, setOnHoldingTask] = useState<Action | null>(null);
  const [onHoldComment, setOnHoldComment] = useState('');
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumingTask, setResumingTask] = useState<Action | null>(null);
  const [resumeComment, setResumeComment] = useState('');

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Action | null>(null);
  const [editVehicleId, setEditVehicleId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editSubcategoryId, setEditSubcategoryId] = useState('');
  const [editComments, setEditComments] = useState('');
  const [editMileage, setEditMileage] = useState('');
  const [editCurrentMileage, setEditCurrentMileage] = useState<number | null>(null);
  const [initialEditCategoryId, setInitialEditCategoryId] = useState('');
  const [initialEditHadSubcategory, setInitialEditHadSubcategory] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Action | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [submittingCategory, setSubmittingCategory] = useState(false);
  const [showSubcategoryModal, setShowSubcategoryModal] = useState(false);
  const [subcategoryMode, setSubcategoryMode] = useState<'create' | 'edit'>('create');
  const [selectedCategoryForSubcategory, setSelectedCategoryForSubcategory] = useState<Category | null>(null);
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null);
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsTask, setCommentsTask] = useState<Action | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [modalTask, setModalTask] = useState<Action | null>(null);
  const [showErrorDetailsModal, setShowErrorDetailsModal] = useState(false);
  const [errorDetails, setErrorDetails] = useState<ErrorDetailsResponse | null>(null);
  const [errorDetailsLoading, setErrorDetailsLoading] = useState(false);
  const requestedTaskId = searchParams.get('taskId');

  const getAssetIdLabel = (asset?: { reg_number?: string | null; plant_id?: string | null }) => !asset ? 'Unknown' : asset.plant_id || asset.reg_number || 'Unknown';
  const getAssetDisplay = (asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null }) => !asset ? 'Unknown' : asset.nickname ? `${getAssetIdLabel(asset)} (${asset.nickname})` : getAssetIdLabel(asset);
  const getVehicleReg = (task: Action) => task.vans ? getAssetDisplay(task.vans) : task.hgvs ? getAssetDisplay(task.hgvs) : task.plant ? getAssetDisplay(task.plant) : 'Unknown';
  const getSourceLabel = (task: Action) => task.action_type === 'inspection_defect' ? 'Daily Check Defect Fix' : 'Workshop Task';
  const isHighPriorityHgvDefectTask = (task?: Action) => Boolean(task && task.action_type === 'inspection_defect' && task.hgv_id);
  const getStatusIcon = (status: string, task?: Action) =>
    status === 'completed'
      ? <CheckCircle2 className="h-5 w-5 text-green-400" />
      : status === 'logged'
        ? <Clock className="h-5 w-5 text-blue-400" />
        : status === 'on_hold'
          ? <Pause className="h-5 w-5 text-purple-400" />
          : isHighPriorityHgvDefectTask(task)
            ? <AlertTriangle className="h-5 w-5 text-red-500" />
            : <AlertTriangle className="h-5 w-5 text-amber-400" />;

  const validAssetTabs: ReadonlyArray<'all' | 'van' | 'plant' | 'hgv'> = ['all', 'van', 'plant', 'hgv'];

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('workshop-module-buttons');
    return () => {
      document.body.classList.remove('workshop-module-buttons');
    };
  }, []);

  const { activeTab, assetTab } = useMemo(() => {
    const requestedTab = searchParams.get('tab') || 'all';

    if (requestedTab === 'settings' && showSettings) {
      return { activeTab: 'settings' as const, assetTab: lastAssetTabRef.current };
    }

    if (validAssetTabs.includes(requestedTab as (typeof validAssetTabs)[number])) {
      lastAssetTabRef.current = requestedTab as 'all' | 'van' | 'plant' | 'hgv';
      return { activeTab: 'overview' as const, assetTab: requestedTab as 'all' | 'van' | 'plant' | 'hgv' };
    }

    return { activeTab: 'overview' as const, assetTab: lastAssetTabRef.current };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, showSettings]);

  const fetcher = useWorkshopTasksFetchers({ supabase, userId: user?.id, vehicleFilter, setLoading, setTasks, setVehicles, setRecentVehicleIds, setTaskAttachmentCounts, setCategories, setPlantCategories, setHgvCategories, setSubcategories, setPlantSubcategories, setHgvSubcategories, setCurrentMeterReading, setMeterReadingType });
  const filteredSubcategories = selectedCategoryId ? (assetTab === 'plant' ? plantSubcategories : assetTab === 'hgv' ? hgvSubcategories : subcategories).filter(sub => sub.category_id === selectedCategoryId) : [];
  const activeCategories = assetTab === 'plant' ? plantCategories : assetTab === 'hgv' ? hgvCategories : categories;
  const categoryHasSubcategories = filteredSubcategories.length > 0;
  const tabFilteredTasks = useMemo(() => {
    if (assetTab === 'all') return tasks;
    if (assetTab === 'plant') return tasks.filter((task) => task.plant_id !== null);
    if (assetTab === 'hgv') return tasks.filter((task) => task.hgv_id !== null);
    return tasks.filter((task) => task.van_id !== null);
  }, [assetTab, tasks]);
  const {
    pendingTasks,
    highPriorityPendingTasks,
    inProgressTasks,
    onHoldTasks,
    completedTasks,
  } = useMemo(() => {
    const nextPendingTasks: Action[] = [];
    const nextHighPriorityPendingTasks: Action[] = [];
    const nextInProgressTasks: Action[] = [];
    const nextOnHoldTasks: Action[] = [];
    const nextCompletedTasks: Action[] = [];

    tabFilteredTasks.forEach((task) => {
      if (task.status === 'pending') {
        nextPendingTasks.push(task);
        if (isHighPriorityHgvDefectTask(task)) nextHighPriorityPendingTasks.push(task);
      } else if (task.status === 'logged') {
        nextInProgressTasks.push(task);
      } else if (task.status === 'on_hold') {
        nextOnHoldTasks.push(task);
      } else if (task.status === 'completed') {
        nextCompletedTasks.push(task);
      }
    });

    nextCompletedTasks.sort((a, b) => (
      (b.actioned_at ? new Date(b.actioned_at).getTime() : 0) -
      (a.actioned_at ? new Date(a.actioned_at).getTime() : 0)
    ));

    return {
      pendingTasks: nextPendingTasks,
      highPriorityPendingTasks: nextHighPriorityPendingTasks,
      inProgressTasks: nextInProgressTasks,
      onHoldTasks: nextOnHoldTasks,
      completedTasks: nextCompletedTasks,
    };
  }, [tabFilteredTasks]);
  const visiblePendingTasks = useMemo(() => {
    if (statusFilter === 'all' || statusFilter === 'pending') return pendingTasks;
    if (statusFilter === 'high_priority') return highPriorityPendingTasks;
    return [];
  }, [highPriorityPendingTasks, pendingTasks, statusFilter]);
  const visibleInProgressTasks = statusFilter === 'all' || statusFilter === 'logged' ? inProgressTasks : [];
  const visibleOnHoldTasks = statusFilter === 'all' || statusFilter === 'on_hold' ? onHoldTasks : [];
  const visibleCompletedTasks = statusFilter === 'all' || statusFilter === 'completed' ? completedTasks : [];
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const { photosByTask: taskInspectionPhotos } = useTaskInspectionPhotos(
    taskIds,
    { enabled: tasks.length > 0 }
  );

  const crud = useWorkshopTaskCrudActions({ supabase, userId: user?.id, categoryTaxonomyMode, vehicles, subcategories, plantSubcategories, hgvSubcategories, selectedVehicleId, selectedCategoryId, selectedSubcategoryId, workshopComments, newMeterReading, currentMeterReading, meterReadingType, selectedAttachmentTemplateIds, categoryHasSubcategories, editingTask, editVehicleId, editCategoryId, editSubcategoryId, editComments, editMileage, editCurrentMileage, initialEditCategoryId, initialEditHadSubcategory, taskToDelete, categoryName, editingCategory, submitting, setSubmitting, setShowAddModal, setSelectedVehicleId, setSelectedCategoryId, setSelectedSubcategoryId, setWorkshopComments, setNewMeterReading, setCurrentMeterReading, setMeterReadingType, setSelectedAttachmentTemplateIds, setEditingTask, setShowEditModal, setEditVehicleId, setEditCategoryId, setEditSubcategoryId, setEditComments, setEditMileage, setEditCurrentMileage, setInitialEditCategoryId, setInitialEditHadSubcategory, setShowDeleteConfirm, setTaskToDelete, setTasks, setDeleting, setShowCategoryModal, setCategoryName, setSubmittingCategory, setEditingCategory, setShowSubcategoryModal, setSubcategoryMode, setSelectedCategoryForSubcategory, setEditingSubcategory, setShowErrorDetailsModal, setErrorDetailsLoading, setErrorDetails, setRecentVehicleIds, fetchTasks: fetcher.fetchTasks, fetchCategories: fetcher.fetchCategories, fetchPlantCategories: fetcher.fetchPlantCategories, fetchHgvCategories: fetcher.fetchHgvCategories, fetchSubcategories: fetcher.fetchSubcategories, getAssetIdLabel });
  const lifecycle = useWorkshopTaskLifecycleActions({ supabase, userId: user?.id, profileName: profile?.full_name, tasks, fetchTasks: fetcher.fetchTasks, selectedTask, loggedComment, onHoldingTask, onHoldComment, resumingTask, resumeComment, completingTask, setUpdatingStatus, setShowStatusModal, setSelectedTask, setLoggedComment, setShowOnHoldModal, setShowResumeModal, setShowCompleteModal, setCompletingTask });

  function handlePageTabChange(nextTab: 'overview' | 'settings') {
    if (nextTab === 'settings') {
      router.replace('/workshop-tasks?tab=settings', { scroll: false });
    } else {
      router.replace(`/workshop-tasks?tab=${assetTab}`, { scroll: false });
    }
  }

  function handleStatusFilterChange(nextFilter: WorkshopTaskTileFilter) {
    setStatusFilter(nextFilter);
    setShowPending(nextFilter === 'pending' || nextFilter === 'high_priority');
    setShowInProgress(nextFilter === 'logged');
    setShowOnHold(nextFilter === 'on_hold');
    setShowCompleted(nextFilter === 'completed');
  }

  function handleAssetTabChange(nextTab: 'all' | 'van' | 'plant' | 'hgv') {
    const prev = assetTab;
    router.replace(`/workshop-tasks?tab=${nextTab}`, { scroll: false });
    if (prev !== nextTab) {
      setVehicleFilter('all');
      handleStatusFilterChange('all');
    }
  }

  function clearTaskIdFromUrl() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('taskId');
    const query = params.toString();
    router.replace(query ? `/workshop-tasks?${query}` : '/workshop-tasks', { scroll: false });
  }

  function handleTaskModalOpen(task: Action) {
    setModalTask(task);
    setShowTaskModal(true);
  }

  function handleTaskModalOpenChange(nextOpen: boolean) {
    setShowTaskModal(nextOpen);
    if (!nextOpen) {
      setModalTask(null);
      if (requestedTaskId) {
        clearTaskIdFromUrl();
      }
    }
  }

  useEffect(() => {
    if (!requestedTaskId || tasks.length === 0) {
      return;
    }

    const requestedTask = tasks.find((task) => task.id === requestedTaskId);
    if (!requestedTask) {
      return;
    }

    if (!showTaskModal || modalTask?.id !== requestedTask.id) {
      setModalTask(requestedTask);
      setShowTaskModal(true);
    }
  }, [requestedTaskId, tasks, showTaskModal, modalTask?.id]);

  useEffect(() => {
    if (!modalTask) {
      return;
    }

    const refreshedTask = tasks.find((task) => task.id === modalTask.id);
    if (refreshedTask && refreshedTask !== modalTask) {
      setModalTask(refreshedTask);
    }
  }, [tasks, modalTask]);

  const isWorkshopWorkflowActive =
    showAddModal ||
    showEditModal ||
    showStatusModal ||
    showCompleteModal ||
    showOnHoldModal ||
    showResumeModal ||
    showCommentsDrawer ||
    showTaskModal;
  const wakeLock = useWorkshopActiveWakeLock('workshop-tasks-page', isWorkshopWorkflowActive);
  const wakeLockStatusMessage = (() => {
    if (!isWorkshopWorkflowActive) return null;
    if (wakeLock.status === 'active') return 'Device sleep prevention is active while this workshop task is open.';
    if (wakeLock.status === 'requesting') return 'Requesting device sleep prevention...';
    if (wakeLock.status === 'unsupported') return 'This browser does not support device sleep prevention. Draft recovery will still protect in-progress work.';
    if (wakeLock.status === 'interrupted') return 'Device sleep prevention was interrupted and will be requested again when the page is visible.';
    if (wakeLock.status === 'error') return `Device sleep prevention could not start${wakeLock.error ? `: ${wakeLock.error}` : '.'}`;
    return null;
  })();

  if (!supabase || permissionLoading) return <PageLoader message="Checking permissions..." />;
  if (!hasPermission) return null;

  return (
    <div className="space-y-6">
      <div className={`bg-white dark:bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-2">Workshop Tasks</h1>
            <p className="text-muted-foreground">Track van, HGV, and plant repairs and workshop work</p>
          </div>
          <Button onClick={() => setShowAddModal(true)} className={`w-full bg-workshop hover:bg-workshop-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg sm:w-auto ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}><Plus className="h-4 w-4 mr-2" />New Task</Button>
        </div>
      </div>

      {wakeLockStatusMessage ? (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          wakeLock.status === 'active'
            ? 'border-green-500/30 bg-green-500/10 text-green-200'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
        }`}>
          {wakeLockStatusMessage}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(v) => handlePageTabChange(v as 'overview' | 'settings')}>
        {showSettings && (
          <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5' : undefined}>
            <TabsTrigger value="overview" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Wrench className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="settings" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        )}
        <WorkshopTasksOverviewTab
          assetTab={assetTab}
          onAssetTabChange={(newTab) => handleAssetTabChange(newTab as 'all' | 'van' | 'plant' | 'hgv')}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          vehicleFilter={vehicleFilter}
          onVehicleFilterChange={setVehicleFilter}
          vehicles={vehicles}
          loading={loading}
          tabFilteredTasks={tabFilteredTasks}
          taskCount={tabFilteredTasks.length}
          pendingTaskCount={pendingTasks.length}
          highPriorityPendingCount={highPriorityPendingTasks.length}
          inProgressTaskCount={inProgressTasks.length}
          onHoldTaskCount={onHoldTasks.length}
          completedTaskCount={completedTasks.length}
          pendingTasks={visiblePendingTasks}
          inProgressTasks={visibleInProgressTasks}
          onHoldTasks={visibleOnHoldTasks}
          completedTasks={visibleCompletedTasks}
          showPending={showPending}
          onShowPendingChange={setShowPending}
          showInProgress={showInProgress}
          onShowInProgressChange={setShowInProgress}
          showOnHold={showOnHold}
          onShowOnHoldChange={setShowOnHold}
          showCompleted={showCompleted}
          onShowCompletedChange={setShowCompleted}
          updatingStatus={updatingStatus}
          taskAttachmentCounts={taskAttachmentCounts}
          taskInspectionPhotos={taskInspectionPhotos}
          getStatusIcon={getStatusIcon}
          getVehicleReg={getVehicleReg}
          getSourceLabel={getSourceLabel}
          getAssetDisplay={getAssetDisplay}
          onCreateTask={() => setShowAddModal(true)}
          onOpenTaskModal={handleTaskModalOpen}
          onOpenComments={(task) => { setCommentsTask(task); setShowCommentsDrawer(true); }}
          onMarkInProgress={(task) => { setSelectedTask(task); setLoggedComment(''); setShowStatusModal(true); }}
          onMarkComplete={(task) => { setCompletingTask(task); setShowCompleteModal(true); }}
          onMarkOnHold={(task) => { setOnHoldingTask(task); setOnHoldComment(''); setShowOnHoldModal(true); }}
          onResumeTask={(task) => { setResumingTask(task); setResumeComment(''); setShowResumeModal(true); }}
          onUndoLogged={lifecycle.handleUndoLogged}
          onUndoComplete={lifecycle.handleUndoComplete}
          onEditTask={crud.handleEditTask}
          onDeleteTask={crud.handleDeleteTask}
        />
        {showSettings && (
          <TabsContent value="settings" className="space-y-6 mt-0">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-white">Category Taxonomy</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Manage categories for vans, HGVs, or plant machinery
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={categoryTaxonomyMode} onValueChange={(v) => setCategoryTaxonomyMode(v as 'van' | 'plant' | 'hgv')}>
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                    <TabsTrigger value="van">Van Categories</TabsTrigger>
                    <TabsTrigger value="plant">Plant Categories</TabsTrigger>
                    <TabsTrigger value="hgv">HGV Categories</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardContent>
            </Card>
            <CategoryManagementPanel
              categories={categoryTaxonomyMode === 'plant' ? plantCategories : categoryTaxonomyMode === 'hgv' ? hgvCategories : categories}
              subcategories={categoryTaxonomyMode === 'plant' ? plantSubcategories : categoryTaxonomyMode === 'hgv' ? hgvSubcategories : subcategories}
              onAddCategory={crud.openAddCategoryModal}
              onEditCategory={crud.openEditCategoryModal}
              onDeleteCategory={crud.handleDeleteCategory}
              onAddSubcategory={crud.openAddSubcategoryModal}
              onEditSubcategory={crud.openEditSubcategoryModal}
              onDeleteSubcategory={crud.handleDeleteSubcategory}
            />
            <AttachmentManagementPanel taxonomyMode={categoryTaxonomyMode} />
          </TabsContent>
        )}
      </Tabs>

      <WorkshopTaskFormDialogs userId={user?.id || null} showAddModal={showAddModal} onShowAddModalChange={setShowAddModal} assetTab={assetTab} selectedVehicleId={selectedVehicleId} onSelectedVehicleIdChange={setSelectedVehicleId} vehicles={vehicles} getAssetDisplay={getAssetDisplay} selectedCategoryId={selectedCategoryId} onSelectedCategoryIdChange={crud.handleCategoryChange} activeCategories={activeCategories} categoryHasSubcategories={categoryHasSubcategories} selectedSubcategoryId={selectedSubcategoryId} onSelectedSubcategoryIdChange={setSelectedSubcategoryId} filteredSubcategories={filteredSubcategories} meterReadingType={meterReadingType} newMeterReading={newMeterReading} onNewMeterReadingChange={setNewMeterReading} currentMeterReading={currentMeterReading} workshopComments={workshopComments} onWorkshopCommentsChange={setWorkshopComments} attachmentTemplates={attachmentTemplates} selectedAttachmentTemplateIds={selectedAttachmentTemplateIds} onSelectedAttachmentTemplateIdsChange={setSelectedAttachmentTemplateIds} submitting={submitting} onResetAddForm={crud.resetAddForm} onFetchCurrentMeterReading={fetcher.fetchCurrentMeterReading} onCreateTask={crud.handleAddTask} showEditModal={showEditModal} onShowEditModalChange={setShowEditModal} editingTask={editingTask} editVehicleId={editVehicleId} onEditVehicleIdChange={crud.handleEditVehicleChange} recentVehicleIds={recentVehicleIds} editCategoryId={editCategoryId} onEditCategoryIdChange={(value) => { setEditCategoryId(value); setEditSubcategoryId(''); }} categories={categories} plantCategories={plantCategories} hgvCategories={hgvCategories} editSubcategoryId={editSubcategoryId} onEditSubcategoryIdChange={setEditSubcategoryId} subcategories={subcategories} plantSubcategories={plantSubcategories} hgvSubcategories={hgvSubcategories} initialEditCategoryId={initialEditCategoryId} initialEditHadSubcategory={initialEditHadSubcategory} editMileage={editMileage} onEditMileageChange={setEditMileage} editCurrentMileage={editCurrentMileage} editComments={editComments} onEditCommentsChange={setEditComments} isSaveEditDisabled={crud.isSaveEditDisabled} onSaveEdit={crud.handleSaveEdit} onResetEditForm={crud.resetEditForm} />
      {(showCompleteModal || !!completingTask) && (
        <MarkTaskCompleteDialog open={showCompleteModal} onOpenChange={setShowCompleteModal} task={completingTask} onConfirm={lifecycle.confirmMarkComplete} isSubmitting={completingTask ? updatingStatus.has(completingTask.id) : false} userId={user?.id || null} />
      )}
      <WorkshopTaskStatusDialogs userId={user?.id || null} statusTask={selectedTask} showStatusModal={showStatusModal} onShowStatusModalChange={setShowStatusModal} loggedComment={loggedComment} onLoggedCommentChange={setLoggedComment} onCancelStatusModal={() => { setShowStatusModal(false); setSelectedTask(null); setLoggedComment(''); }} onConfirmMarkInProgress={lifecycle.confirmMarkInProgress} showOnHoldModal={showOnHoldModal} onShowOnHoldModalChange={setShowOnHoldModal} onHoldComment={onHoldComment} onOnHoldCommentChange={setOnHoldComment} onCancelOnHoldModal={() => { setShowOnHoldModal(false); setOnHoldingTask(null); setOnHoldComment(''); }} onConfirmMarkOnHold={lifecycle.confirmMarkOnHold} onHoldingTask={onHoldingTask} showResumeModal={showResumeModal} onShowResumeModalChange={setShowResumeModal} resumeComment={resumeComment} onResumeCommentChange={setResumeComment} onCancelResumeModal={() => { setShowResumeModal(false); setResumingTask(null); setResumeComment(''); }} onConfirmResumeTask={lifecycle.confirmResumeTask} resumingTask={resumingTask} updatingStatus={updatingStatus} />
      <WorkshopTaskAdminDialogs showSettings={showSettings} showCategoryModal={showCategoryModal} onShowCategoryModalChange={setShowCategoryModal} editingCategory={editingCategory} categoryName={categoryName} onCategoryNameChange={setCategoryName} submittingCategory={submittingCategory} onSaveCategory={crud.handleSaveCategory} onResetCategoryForm={() => { setShowCategoryModal(false); setEditingCategory(null); setCategoryName(''); }} showDeleteConfirm={showDeleteConfirm} onShowDeleteConfirmChange={setShowDeleteConfirm} taskToDelete={taskToDelete} getVehicleReg={getVehicleReg} deleting={deleting} onConfirmDeleteTask={crud.confirmDeleteTask} onResetDeleteTask={() => { setShowDeleteConfirm(false); setTaskToDelete(null); }} />
      {commentsTask && <TaskCommentsDrawer open={showCommentsDrawer} onOpenChange={setShowCommentsDrawer} taskId={commentsTask.id} taskTitle={getVehicleReg(commentsTask)} userId={user?.id || null} />}
      {(showTaskModal || !!modalTask) && (
        <WorkshopTaskModal open={showTaskModal} onOpenChange={handleTaskModalOpenChange} task={modalTask} inspectionPhotos={modalTask ? taskInspectionPhotos[modalTask.id] || [] : []} onEdit={(task) => { handleTaskModalOpenChange(false); crud.handleEditTask(task as Action); }} onDelete={(task) => { handleTaskModalOpenChange(false); crud.handleDeleteTask(task as Action); }} onMarkInProgress={(task) => { handleTaskModalOpenChange(false); setSelectedTask(task as Action); setLoggedComment(''); setShowStatusModal(true); }} onMarkComplete={(task) => { handleTaskModalOpenChange(false); setCompletingTask(task as Action); setShowCompleteModal(true); }} onMarkOnHold={(task) => { handleTaskModalOpenChange(false); setOnHoldingTask(task as Action); setOnHoldComment(''); setShowOnHoldModal(true); }} onResume={(task) => { handleTaskModalOpenChange(false); setResumingTask(task as Action); setResumeComment(''); setShowResumeModal(true); }} isUpdating={modalTask ? updatingStatus.has(modalTask.id) : false} onTaskUpdated={fetcher.fetchTasks} />
      )}
      {selectedCategoryForSubcategory && <SubcategoryDialog open={showSubcategoryModal} onOpenChange={setShowSubcategoryModal} mode={subcategoryMode} categoryId={selectedCategoryForSubcategory.id} categoryName={selectedCategoryForSubcategory.name} subcategory={editingSubcategory} onSuccess={fetcher.fetchSubcategories} />}
      {showErrorDetailsModal && (
        <ErrorDetailsModal open={showErrorDetailsModal} onClose={() => { setShowErrorDetailsModal(false); setErrorDetails(null); }} data={errorDetails} loading={errorDetailsLoading} />
      )}
    </div>
  );
}
