'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PanelLoader } from '@/components/ui/panel-loader';
import { 
  Wrench, 
  ClipboardCheck, 
  FileText, 
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Gauge,
  MapPin,
  Loader2,
  Edit
} from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/lib/hooks/useAuth';
import { formatMileage, formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useWorkshopTaskComments } from '@/lib/hooks/useWorkshopTaskComments';
import { useTaskInspectionPhotos } from '@/lib/hooks/useTaskInspectionPhotos';
import type { TrackerLocationData } from '@/types/fleet-tracker';
import { fetchDailyChecks, type DailyCheckHistoryItem } from '@/components/fleet/DailyChecksHistoryTab';
import { AssetHistoryTable } from '@/components/fleet/AssetHistoryTable';
import { buildAssetHistoryRows } from '@/lib/fleet/asset-history-events';
import { getAssetHistoryFieldLabel } from '@/lib/fleet/asset-history-field-labels';

// Dynamic imports for dialog components
const EditMaintenanceDialog = dynamic(() => import('@/app/(dashboard)/maintenance/components/EditMaintenanceDialog').then(m => ({ default: m.EditMaintenanceDialog })), { ssr: false });
const DeleteVehicleDialog = dynamic(() => import('@/app/(dashboard)/maintenance/components/DeleteVehicleDialog').then(m => ({ default: m.DeleteVehicleDialog })), { ssr: false });
import { Paperclip } from 'lucide-react';
import { AttachmentHistoryViewer } from '@/components/workshop-tasks/AttachmentHistoryViewer';

// Dynamic imports for map components
const AssetLocationMap = dynamic(() => import('@/components/fleet/AssetLocationMap').then(m => ({ default: m.AssetLocationMap })), { ssr: false });
const AssetLocationMapModal = dynamic(() => import('@/components/fleet/AssetLocationMapModal').then(m => ({ default: m.AssetLocationMapModal })), { ssr: false });

type Vehicle = {
  id: string;
  reg_number: string | null;
  nickname: string | null;
  status: string;
  category_id: string | null;
};

type VehicleData = {
  ves_make: string | null;
  ves_colour: string | null;
  ves_fuel_type: string | null;
  ves_year_of_manufacture: string | number | null;
  ves_engine_capacity: number | null;
  ves_tax_status: string | null;
  ves_mot_status: string | null;
  ves_co2_emissions: number | null;
  ves_euro_status: string | null;
  ves_wheelplan: string | null;
  mot_make: string | null;
  mot_model: string | null;
  mot_primary_colour: string | null;
  mot_year_of_manufacture: number | null;
  mot_fuel_type: string | null;
  mot_first_used_date: string | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  current_mileage: number | null;
};

type MaintenanceHistoryEntry = {
  id: string;
  created_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
};

type WorkshopTask = {
  id: string;
  action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action' | string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed' | string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | string;
  workshop_comments: string | null;
  logged_at: string | null;
  logged_by: string | null;
  logged_comment: string | null;
  actioned_at: string | null;
  actioned_by: string | null;
  actioned_comment: string | null;
  status_history?: Array<{
    status: string;
    timestamp: string;
    userId: string;
    userName: string;
    comment?: string;
  }> | null;
  created_at: string;
  created_by: string | null;
  workshop_task_categories: {
    id: string;
    name: string;
    slug: string | null;
    ui_color: string | null;
  } | null;
  workshop_task_subcategories: {
    id: string;
    name: string;
    slug: string;
    ui_color: string | null;
    workshop_task_categories: {
      id: string;
      name: string;
      slug: string | null;
      ui_color: string | null;
    };
  } | null;
  profiles_created?: {
    full_name: string | null;
  } | null;
  profiles_logged?: {
    full_name: string | null;
  } | null;
  profiles_actioned?: {
    full_name: string | null;
  } | null;
};

type TaskAttachment = {
  id: string;
  task_id: string;
  status: 'pending' | 'completed';
  created_at: string;
  workshop_attachment_templates: {
    name: string;
    description: string | null;
  } | null;
};

function DocumentsTabContent({ hgvId, workshopTasks }: { hgvId: string; workshopTasks: WorkshopTask[] }) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttachments = async () => {
      try {
        if (!hgvId) {
          setAttachments([]);
          setLoading(false);
          return;
        }
        setLoading(true);
        const taskIds = workshopTasks.map(t => t.id);
        
        if (taskIds.length === 0) {
          setAttachments([]);
          return;
        }

        const supabase = createClient();
        const { data, error } = await supabase
          .from('workshop_task_attachments')
          .select(`
            id,
            task_id,
            status,
            created_at,
            workshop_attachment_templates (
              name,
              description
            )
          `)
          .in('task_id', taskIds)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setAttachments(data || []);
      } catch (error) {
        console.error('Error fetching attachments:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAttachments();
  }, [hgvId, workshopTasks]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-white mb-2">No Documents Yet</h3>
        <p className="text-slate-400 mb-4">
          No workshop task attachments found for this HGV
        </p>
        <p className="text-sm text-muted-foreground">
          Attachments will appear here when added to workshop tasks
        </p>
      </div>
    );
  }

  // Group attachments by task
  const attachmentsByTask = attachments.reduce((acc, att) => {
    if (!acc[att.task_id]) {
      acc[att.task_id] = [];
    }
    acc[att.task_id].push(att);
    return acc;
  }, {} as Record<string, TaskAttachment[]>);

  return (
    <AttachmentHistoryViewer>
      {({ openAttachment, loadingAttachmentId }) => (
        <div className="space-y-4">
          {Object.entries(attachmentsByTask).map(([taskId, taskAttachments]) => {
            const task = workshopTasks.find(t => t.id === taskId);
            if (!task) return null;

            return (
              <Card key={taskId} className="bg-slate-800/30 border-slate-700">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {/* Task Header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Wrench className="h-4 w-4 text-workshop" />
                          <h4 className="font-medium text-white">
                            {task.workshop_task_categories?.name || 'Workshop Task'}
                          </h4>
                          <Badge 
                            variant="outline" 
                            className={
                              task.status === 'completed' 
                                ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                            }
                          >
                            {task.status === 'completed' ? 'Completed' : 'In Progress'}
                          </Badge>
                        </div>
                        {task.workshop_comments && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {task.workshop_comments}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                        <Paperclip className="h-3 w-3 mr-1" />
                        {taskAttachments.length}
                      </Badge>
                    </div>

                    {/* Attachments List */}
                    <div className="space-y-2 pl-6 border-l-2 border-slate-700">
                      {taskAttachments.map(attachment => {
                        const isLoading = loadingAttachmentId === attachment.id;
                        return (
                          <button
                            type="button"
                            key={attachment.id}
                            onClick={() => openAttachment(attachment.id)}
                            disabled={isLoading}
                            className="relative w-full text-left flex items-center justify-between p-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          >
                            {isLoading && (
                              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 rounded-lg z-10">
                                <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5 text-blue-400" />
                              <div>
                                <p className="text-sm font-medium text-white">
                                  {attachment.workshop_attachment_templates?.name || 'Attachment'}
                                </p>
                                {attachment.workshop_attachment_templates?.description && (
                                  <p className="text-xs text-muted-foreground">
                                    {attachment.workshop_attachment_templates.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {attachment.status === 'completed' && (
                                <Badge variant="outline" className="bg-green-500/10 text-green-300 border-green-500/30 text-xs">
                                  Completed
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(attachment.created_at).toLocaleDateString()}
                              </span>
                              <ChevronDown className="h-4 w-4 text-muted-foreground rotate-[-90deg]" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AttachmentHistoryViewer>
  );
}

export default function HgvHistoryPage({
  params,
}: {
  params: Promise<{ hgvId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();
  
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleData, setVehicleData] = useState<VehicleData | null>(null);
  const [maintenanceRecord, setMaintenanceRecord] = useState<VehicleMaintenanceWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceHistoryEntry[]>([]);
  const [workshopTasks, setWorkshopTasks] = useState<WorkshopTask[]>([]);
  const [dailyChecks, setDailyChecks] = useState<DailyCheckHistoryItem[]>([]);
  const [dailyChecksLoading, setDailyChecksLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('maintenance');
  const [motData, setMotData] = useState<{
    currentStatus?: {
      expiryDate?: string | null;
      status?: string | null;
      daysRemaining?: number | null;
      lastTestDate?: string | null;
    } | null;
    tests: Array<{
      motTestNumber?: string;
      testResult?: string;
      completedDate?: string;
      expiryDate?: string;
      odometerValue?: number;
      odometerUnit?: string;
      testStationName?: string;
      testStationPcode?: string;
      defects?: Array<{ type: string; text: string; locationLateral?: string }>;
    }>;
  } | null>(null);
  const [motLoading, setMotLoading] = useState(false);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasMapMatch, setHasMapMatch] = useState(false);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [mapLocationData, setMapLocationData] = useState<TrackerLocationData | null>(null);

  // Fetch comments for all workshop tasks
  const { comments: taskComments } = useWorkshopTaskComments({
    taskIds: workshopTasks.map(t => t.id),
    enabled: workshopTasks.length > 0
  });
  const { photosByTask: taskInspectionPhotos } = useTaskInspectionPhotos(
    workshopTasks.map((task) => task.id),
    { enabled: workshopTasks.length > 0 }
  );

  const fetchVehicleData = useCallback(async () => {
    try {
      const { data: vehicleInfo, error: vehicleError } = await supabase
        .from('hgvs')
        .select('id, reg_number, nickname, status, category_id')
        .eq('id', resolvedParams.hgvId)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle((vehicleInfo as Vehicle) ?? null);

      // Fetch vehicle maintenance data (VES/MOT data)
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select(`
          ves_make,
          ves_colour,
          ves_fuel_type,
          ves_year_of_manufacture,
          ves_engine_capacity,
          ves_tax_status,
          ves_mot_status,
          ves_co2_emissions,
          ves_euro_status,
          ves_wheelplan,
          mot_make,
          mot_model,
          mot_primary_colour,
          mot_year_of_manufacture,
          mot_fuel_type,
          mot_first_used_date,
          tax_due_date,
          mot_due_date,
          current_mileage
        `)
        .eq('hgv_id', resolvedParams.hgvId)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(2);

      if (maintenanceError) {
        throw maintenanceError;
      }

      if ((maintenanceData?.length ?? 0) > 1) {
        console.warn('Multiple vehicle_maintenance rows found for HGV; using the latest row.', {
          hgvId: resolvedParams.hgvId,
        });
      }

      setVehicleData(((maintenanceData || [])[0] as VehicleData | undefined) ?? null);
    } catch (error) {
      console.error('Error fetching vehicle:', error);
    }
  }, [supabase, resolvedParams.hgvId]);

  const fetchMaintenanceRecord = useCallback(async () => {
    try {
      const { data: maintenance, error } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .eq('hgv_id', resolvedParams.hgvId)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(2);

      if (error) {
        throw error;
      }

      if ((maintenance?.length ?? 0) > 1) {
        console.warn('Multiple vehicle_maintenance rows found for HGV maintenance record; using the latest row.', {
          hgvId: resolvedParams.hgvId,
        });
      }

      const latestMaintenance = maintenance?.[0] ?? null;
      if (!latestMaintenance) {
        setMaintenanceRecord(null);
        return;
      }

      setMaintenanceRecord({
        ...(latestMaintenance as Record<string, unknown>),
        hgv_id: (latestMaintenance as { hgv_id?: string | null }).hgv_id ?? resolvedParams.hgvId,
        overdue_count: 0,
        due_soon_count: 0,
      } as VehicleMaintenanceWithStatus);
    } catch (error) {
      console.error('Error fetching maintenance record:', error);
    }
  }, [supabase, resolvedParams.hgvId]);

  const fetchMaintenanceHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('maintenance_history')
        .select(`
          id,
          created_at,
          field_name,
          old_value,
          new_value,
          comment,
          updated_by,
          updated_by_name
        `)
        .eq('hgv_id', resolvedParams.hgvId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Supabase error fetching maintenance history:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }
      setMaintenanceHistory(((data || []) as MaintenanceHistoryEntry[]));
    } catch (error) {
      console.error('Error fetching maintenance history:', error instanceof Error ? error.message : error);
    }
  }, [supabase, resolvedParams.hgvId]);

  const fetchWorkshopTasks = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          action_type,
          title,
          description,
          status,
          priority,
          workshop_comments,
          logged_at,
          logged_by,
          logged_comment,
          actioned_at,
          actioned_by,
          actioned_comment,
          status_history,
          created_at,
          created_by,
          workshop_task_categories (
            id,
            name,
            slug,
            ui_color
          ),
          workshop_task_subcategories!workshop_subcategory_id (
            id,
            name,
            slug,
            ui_color,
            workshop_task_categories (
              id,
              name,
              slug,
              ui_color
            )
          )
        `)
        .eq('hgv_id', resolvedParams.hgvId)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error fetching workshop tasks:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }
      
      // Manually fetch profile names for created_by, logged_by, actioned_by
      const baseTasks = ((data || []) as unknown as WorkshopTask[]);
      let tasksWithProfiles = baseTasks;
      if (baseTasks.length > 0) {
        const userIds = new Set<string>();
        baseTasks.forEach((task) => {
          if (task.created_by) userIds.add(task.created_by);
          if (task.logged_by) userIds.add(task.logged_by);
          if (task.actioned_by) userIds.add(task.actioned_by);
        });
        
        if (userIds.size > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', Array.from(userIds));
          
          const profileMap = new Map((profiles || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
          
          tasksWithProfiles = baseTasks.map((task) => ({
            ...task,
            profiles_created: task.created_by ? { full_name: profileMap.get(task.created_by) || null } : null,
            profiles_logged: task.logged_by ? { full_name: profileMap.get(task.logged_by) || null } : null,
            profiles_actioned: task.actioned_by ? { full_name: profileMap.get(task.actioned_by) || null } : null,
          }));
        }
      }
      
      setWorkshopTasks(tasksWithProfiles);
    } catch (error) {
      console.error('Error fetching workshop tasks:', error instanceof Error ? error.message : error);
    } finally {
      setLoading(false);
    }
  }, [supabase, resolvedParams.hgvId]);

  const fetchDailyCheckHistory = useCallback(async () => {
    if (!resolvedParams.hgvId) {
      setDailyChecks([]);
      setDailyChecksLoading(false);
      return;
    }

    try {
      setDailyChecksLoading(true);
      const rows = await fetchDailyChecks('hgv', resolvedParams.hgvId);
      setDailyChecks(rows);
    } catch (error) {
      console.error('Error fetching HGV daily checks:', error);
      setDailyChecks([]);
    } finally {
      setDailyChecksLoading(false);
    }
  }, [resolvedParams.hgvId]);

  useEffect(() => {
    if (user && resolvedParams.hgvId) {
      fetchVehicleData();
      fetchMaintenanceRecord();
      fetchMaintenanceHistory();
      fetchWorkshopTasks();
      fetchDailyCheckHistory();
    }
  }, [user, resolvedParams.hgvId, fetchVehicleData, fetchMaintenanceRecord, fetchMaintenanceHistory, fetchWorkshopTasks, fetchDailyCheckHistory]);

  useEffect(() => {
    if (activeTab === 'mot' && !motData && vehicle?.reg_number) {
      const fetchMotHistory = async () => {
        setMotLoading(true);
        try {
          const response = await fetch(`/api/maintenance/mot-history/${resolvedParams.hgvId}`);
          const result = await response.json();
          
          if (result.success && result.data) {
            setMotData(result.data);
          }
        } catch (error) {
          console.error('Error fetching MOT history:', error);
        } finally {
          setMotLoading(false);
        }
      };
      fetchMotHistory();
    }
  }, [activeTab, motData, vehicle?.reg_number, resolvedParams.hgvId]);

  const handleEditSuccess = useCallback(() => {
    setEditDialogOpen(false);
    setMotData(null);
    setExpandedTestId(null);

    void Promise.all([
      fetchVehicleData(),
      fetchMaintenanceRecord(),
      fetchMaintenanceHistory(),
    ]).then(() => {
      router.refresh();
    });
  }, [fetchMaintenanceHistory, fetchMaintenanceRecord, fetchVehicleData, router]);

  const getDefectColor = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'MAJOR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'MINOR': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'ADVISORY': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'FAIL': return 'text-red-600 bg-red-600/10 border-red-600/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getDefectIcon = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return '🔴';
      case 'MAJOR': return '🟠';
      case 'MINOR': return '🟡';
      case 'ADVISORY': return '🔵';
      case 'FAIL': return '⚫';
      default: return '⚪';
    }
  };

  const countDefectsByType = (defects: Array<{ type: string }>) => {
    const counts: Record<string, number> = {};
    defects.forEach(defect => {
      counts[defect.type] = (counts[defect.type] || 0) + 1;
    });
    return counts;
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Not Set';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const assetHistoryRows = useMemo(
    () => buildAssetHistoryRows({
      assetType: 'hgv',
      records: maintenanceHistory,
      workshopTasks,
      dailyTasks: dailyChecks,
      getFieldLabel: (fieldName) => getAssetHistoryFieldLabel('hgv', fieldName),
    }),
    [maintenanceHistory, workshopTasks, dailyChecks]
  );

  if (!vehicle && !loading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-16 w-16 text-red-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">HGV Not Found</h2>
            <p className="text-gray-600 text-center max-w-md mb-4">
              The requested HGV could not be found.
            </p>
            <BackButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {vehicle?.reg_number || <Skeleton className="h-8 w-32" />}
              {vehicle?.nickname && <span className="text-muted-foreground ml-2">({vehicle.nickname})</span>}
            </h1>
            <p className="text-muted-foreground mt-1">
              HGV History & Records
            </p>
          </div>
        </div>
        {vehicle && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
            className="border-fleet text-fleet hover:bg-fleet hover:text-white"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit HGV Record
          </Button>
        )}
      </div>

      {/* HGV Data Section (VES/MOT) */}
      {vehicleData && (vehicleData.ves_make || vehicleData.mot_make) ? (
          <Card className="bg-gradient-to-r from-blue-900/20 to-blue-800/10 border-blue-700/30">
            <CardContent className="pt-6">
              <div className={`grid gap-6 ${hasMapMatch ? 'grid-cols-1 md:grid-cols-[fit-content(calc(50%_-_0.75rem))_minmax(calc(50%_-_0.75rem),_1fr)]' : 'grid-cols-1'}`}>
                <div className={hasMapMatch ? 'min-w-0 space-y-2.5 text-sm' : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm'}>
                  {(vehicleData.ves_make || vehicleData.mot_make) && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Make</span>
                      <span className="text-white font-medium">{vehicleData.ves_make || vehicleData.mot_make}</span>
                    </div>
                  )}
                  {vehicleData.mot_model && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Model</span>
                      <span className="text-white font-medium">{vehicleData.mot_model}</span>
                    </div>
                  )}
                  {(vehicleData.ves_colour || vehicleData.mot_primary_colour) && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Colour</span>
                      <span className="text-white font-medium">{vehicleData.ves_colour || vehicleData.mot_primary_colour}</span>
                    </div>
                  )}
                  {(vehicleData.ves_year_of_manufacture || vehicleData.mot_year_of_manufacture) && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Year</span>
                      <span className="text-white font-medium">{vehicleData.ves_year_of_manufacture || vehicleData.mot_year_of_manufacture}</span>
                    </div>
                  )}
                  {(vehicleData.ves_fuel_type || vehicleData.mot_fuel_type) && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Fuel</span>
                      <span className="text-white font-medium">{vehicleData.ves_fuel_type || vehicleData.mot_fuel_type}</span>
                    </div>
                  )}
                  {vehicleData.mot_first_used_date && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">First Reg</span>
                      <span className="text-white font-medium">
                        {new Date(vehicleData.mot_first_used_date).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                  )}
                  {vehicleData.ves_engine_capacity && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Engine</span>
                      <span className="text-white font-medium">{vehicleData.ves_engine_capacity}cc</span>
                    </div>
                  )}
                  {vehicleData.ves_tax_status && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Tax Status</span>
                      <span className="text-white font-medium">{vehicleData.ves_tax_status}</span>
                    </div>
                  )}
                  {(() => {
                    const vesStatus = vehicleData.ves_mot_status;
                    const dvlaHasNoData = vesStatus === 'No details held by DVLA';

                    if (dvlaHasNoData && vehicleData.mot_due_date) {
                      const dueDate = new Date(vehicleData.mot_due_date);
                      const now = new Date();
                      const isValid = dueDate > now;
                      return (
                        <div className="flex items-baseline gap-2">
                          <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Annual Test</span>
                          <span className={`font-medium ${isValid ? 'text-green-400' : 'text-red-400'}`}>
                            {isValid ? 'Valid' : 'Expired'}
                          </span>
                        </div>
                      );
                    }

                    if (vesStatus && !dvlaHasNoData) {
                      return (
                        <div className="flex items-baseline gap-2">
                          <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">MOT Status</span>
                          <span className="text-white font-medium">{vesStatus}</span>
                        </div>
                      );
                    }

                    return null;
                  })()}
                  {vehicleData.ves_co2_emissions && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">CO2</span>
                      <span className="text-white font-medium">{vehicleData.ves_co2_emissions}g/km</span>
                    </div>
                  )}
                  {vehicleData.ves_euro_status && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Euro Status</span>
                      <span className="text-white font-medium">{vehicleData.ves_euro_status}</span>
                    </div>
                  )}
                  {vehicleData.ves_wheelplan && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide min-w-[100px]">Wheelplan</span>
                      <span className="text-white font-medium">{vehicleData.ves_wheelplan}</span>
                    </div>
                  )}
                </div>
                {/* Map */}
                <AssetLocationMap
                  regNumber={vehicle?.reg_number ?? undefined}
                  assetLabel={vehicle?.reg_number || 'Unknown'}
                  locationProvider="fleetsmart"
                  loadingVariant="compact"
                  className="min-w-0 h-full min-h-[265px]"
                  onMatchResult={setHasMapMatch}
                  onLocationData={setMapLocationData}
                  onClick={() => setMapModalOpen(true)}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          vehicle && (
            <AssetLocationMap
              regNumber={vehicle.reg_number ?? undefined}
              assetLabel={vehicle.reg_number || 'Unknown'}
              locationProvider="fleetsmart"
              loadingVariant="compact"
              className="h-[180px] rounded-lg"
              onMatchResult={setHasMapMatch}
              onLocationData={setMapLocationData}
              onClick={() => setMapModalOpen(true)}
            />
          )
        )
      }

      {/* Map Modal */}
      <AssetLocationMapModal
        open={mapModalOpen}
        onOpenChange={setMapModalOpen}
        assetLabel={vehicle?.reg_number || 'Unknown'}
        locationProvider="fleetsmart"
        location={mapLocationData}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className={`grid w-full ${vehicle?.reg_number ? 'grid-cols-4' : 'grid-cols-3'} lg:w-auto lg:inline-grid`}>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            History
          </TabsTrigger>
          {/* Only show MOT tab if vehicle has reg_number */}
          {vehicle?.reg_number && (
            <TabsTrigger value="mot" className="gap-2">
              <ClipboardCheck className="h-4 w-4" />
              MOT
            </TabsTrigger>
          )}
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
          {/* Vehicle/Plant Service Information Summary */}
          {maintenanceRecord && (
            <Card className="bg-slate-800/50 border-border">
              <CardHeader>
                <CardTitle>Service Information</CardTitle>
                <CardDescription>Current maintenance status and schedules</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Current KM</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMileage(maintenanceRecord.current_mileage)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Tax Due</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.tax_due_date)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">MOT Due</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.mot_due_date)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Service Due</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord.next_service_mileage 
                        ? `${formatMileage(maintenanceRecord.next_service_mileage)} km` 
                        : 'Not Set'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">First Aid Kit</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.first_aid_kit_expiry)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Last Service</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord.last_service_mileage 
                        ? `${formatMileage(maintenanceRecord.last_service_mileage)} km` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {maintenanceRecord.tracker_id && (
                    <div className="space-y-1">
                      <span className="text-xs text-slate-400 uppercase tracking-wide">GPS Tracker</span>
                      <p className="text-lg font-semibold text-white">
                        {maintenanceRecord.tracker_id}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <AssetHistoryTable
            assetType="hgv"
            rows={assetHistoryRows}
            loading={loading || dailyChecksLoading}
            taskComments={taskComments}
            taskInspectionPhotos={taskInspectionPhotos}
          />
        </TabsContent>

        {/* MOT Tab */}
        <TabsContent value="mot" className="space-y-6">
          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <CardTitle>MOT History</CardTitle>
              <CardDescription>Complete annual test (MOT) history from GOV.UK database</CardDescription>
            </CardHeader>
            <CardContent>
              {motLoading ? (
                <PanelLoader message="Loading annual test history..." accent="fleet" className="py-12" />
              ) : !motData || motData.tests?.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardCheck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Annual Test History</h3>
                  <p className="text-muted-foreground mb-4">
                    This HGV may not yet have had its first annual test
                  </p>
                  {vehicleData?.mot_due_date && (
                    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-md mx-auto">
                      <p className="text-sm text-blue-300">
                        First annual test due: <span className="text-white font-medium">{formatDate(vehicleData.mot_due_date)}</span>
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Current MOT Status Card */}
                  {motData.currentStatus && motData.currentStatus.status !== 'No MOT History' && motData.currentStatus.status !== 'Not Yet Due' && (
                    <Card className="bg-gradient-to-r from-blue-900/30 to-blue-800/20 border-blue-700/50">
                      <CardHeader>
                        <CardTitle className="text-lg text-blue-300 flex items-center gap-2">
                          <CheckCircle className="h-5 w-5" />
                          Current MOT Status
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Expiry Date:</span>
                            <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus.expiryDate)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Status:</span>
                            <p className={`font-semibold text-lg ${motData.currentStatus.status === 'Valid' ? 'text-green-400' : 'text-red-400'}`}>
                              {motData.currentStatus.status}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Days Remaining:</span>
                            <p className="text-white font-semibold text-lg">{motData.currentStatus.daysRemaining}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Last Test:</span>
                            <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus.lastTestDate)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Test History */}
                  {motData.tests && motData.tests.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Test History</h3>
                      
                      {motData.tests.map((test: { motTestNumber?: string; testResult?: string; completedDate?: string; expiryDate?: string; odometerValue?: number; odometerUnit?: string; testStationName?: string; testStationPcode?: string; defects?: Array<{ type: string; text: string; locationLateral?: string }> }, idx: number) => {
                        const defects = Array.isArray(test.defects) ? test.defects : [];
                        const defectCounts = countDefectsByType(defects);
                        const isExpanded = expandedTestId === (test.motTestNumber ?? '');
                        const testResultUpper = (test.testResult ?? '').toUpperCase();
                        const isPassed = testResultUpper === 'PASSED' || testResultUpper === 'PASS' || testResultUpper === 'PRS';
                        
                        return (
                          <Card 
                            key={test.motTestNumber ?? `test-${idx}`}
                            className={`${
                              isPassed 
                                ? 'bg-gradient-to-r from-green-900/20 to-green-800/10 border-green-700/30' 
                                : 'bg-gradient-to-r from-red-900/20 to-red-800/10 border-red-700/30'
                            }`}
                          >
                            <CardContent className="p-4">
                              {/* Test Header */}
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3 flex-1">
                                  {isPassed ? (
                                    <CheckCircle className="h-6 w-6 text-green-400 flex-shrink-0" />
                                  ) : (
                                    <XCircle className="h-6 w-6 text-red-400 flex-shrink-0" />
                                  )}
                                  <div>
                                    <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                      {test.testResult ?? 'Unknown'}
                                      <span className="text-sm text-slate-400 font-normal">
                                        {formatDate(test.completedDate)}
                                      </span>
                                    </h4>
                                    {test.expiryDate && (
                                      <p className="text-sm text-muted-foreground">
                                        Expiry: <span className="text-white font-medium">{formatDate(test.expiryDate)}</span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Defect Summary Badges */}
                                {defects.length > 0 && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {Object.entries(defectCounts).map(([type, count]) => (
                                      <Badge key={type} className={`${getDefectColor(type)} border text-xs`}>
                                        {count} {type}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Test Details */}
                              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 text-sm mb-3">
                                <div className="flex items-center gap-2">
                                  <Gauge className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">Mileage:</span>
                                  <span className="text-white font-medium">
                                    {test.odometerValue ? `${formatMileage(test.odometerValue)} ${test.odometerUnit || ''}`.trim() : 'Not Set'}
                                  </span>
                                </div>
                                {(test.testStationName || test.testStationPcode) && (
                                  <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Station:</span>
                                    <span className="text-white font-medium">
                                      {[test.testStationName, test.testStationPcode].filter(Boolean).join(', ')}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">Test Number:</span>
                                  <span className="text-white font-medium text-xs">{test.motTestNumber ?? 'N/A'}</span>
                                </div>
                              </div>

                              {/* Expandable Defects */}
                              {defects.length > 0 && (
                                <div className="space-y-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpandedTestId(isExpanded ? null : (test.motTestNumber ?? null))}
                                    className="w-full text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                  >
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="h-4 w-4 mr-2" />
                                        Hide Defects
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="h-4 w-4 mr-2" />
                                        View {defects.length} Defect{defects.length !== 1 ? 's' : ''}
                                      </>
                                    )}
                                  </Button>

                                  {isExpanded && (
                                    <div className="space-y-2 border-t border-slate-700 pt-3">
                                      {defects.map((defect, idx: number) => (
                                        <div 
                                          key={idx}
                                          className={`p-3 rounded border ${getDefectColor(defect.type)}`}
                                        >
                                          <div className="flex items-start gap-2">
                                            <span className="text-lg">{getDefectIcon(defect.type)}</span>
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 mb-1">
                                                <Badge className={`${getDefectColor(defect.type)} border text-xs`}>
                                                  {defect.type}
                                                </Badge>
                                                {defect.locationLateral && (
                                                  <span className="text-xs text-muted-foreground">
                                                    {defect.locationLateral}
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-sm text-white">{defect.text}</p>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {defects.length === 0 && (
                                <div className="flex items-center gap-2 text-sm text-green-400">
                                  <CheckCircle className="h-4 w-4" />
                                  No defects or advisories recorded
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents">
          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <CardTitle>Workshop Task Attachments</CardTitle>
              <CardDescription>Documents and forms attached to workshop tasks for this HGV</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : workshopTasks.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-semibold text-white mb-2">No Documents Yet</h3>
                  <p className="text-slate-400 mb-4">
                    No workshop tasks with attachments found for this HGV
                  </p>
                </div>
              ) : (
                <DocumentsTabContent hgvId={resolvedParams.hgvId} workshopTasks={workshopTasks} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <CardTitle>HGV Notes</CardTitle>
              <CardDescription>General notes and comments about this HGV</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <MessageSquare className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold text-white mb-2">Coming Soon</h3>
                <p className="text-slate-400 mb-4">
                  HGV notes feature will be implemented in a future update
                </p>
                <p className="text-sm text-muted-foreground">
                  This will allow you to add and view general notes about this HGV
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Vehicle Record Dialog */}
      {vehicle && (
        <EditMaintenanceDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          vehicle={{
            ...(maintenanceRecord || {
              // No vehicle_maintenance row exists yet. Keep id null so
              // EditMaintenanceDialog creates one instead of PUT-ing to the HGV id.
              id: null,
              van_id: null,
              hgv_id: resolvedParams.hgvId,
              plant_id: null,
              current_mileage: null,
              tax_due_date: null,
              mot_due_date: null,
              first_aid_kit_expiry: null,
              next_service_mileage: null,
              last_service_mileage: null,
              cambelt_due_mileage: null,
              current_hours: null,
              last_service_hours: null,
              next_service_hours: null,
              tracker_id: null,
              last_mileage_update: null,
              last_updated_at: '',
              last_updated_by: null,
              last_dvla_sync: null,
              dvla_sync_status: null,
              dvla_sync_error: null,
              dvla_raw_data: null,
              ves_make: null,
              ves_colour: null,
              ves_fuel_type: null,
              ves_year_of_manufacture: null,
              ves_engine_capacity: null,
              ves_tax_status: null,
              ves_mot_status: null,
              ves_co2_emissions: null,
              ves_euro_status: null,
              ves_real_driving_emissions: null,
              ves_type_approval: null,
              ves_wheelplan: null,
              ves_revenue_weight: null,
              ves_marked_for_export: null,
              ves_month_of_first_registration: null,
              ves_date_of_last_v5c_issued: null,
              mot_expiry_date: null,
              mot_api_sync_status: null,
              mot_api_sync_error: null,
              last_mot_api_sync: null,
              mot_raw_data: null,
              mot_make: null,
              mot_model: null,
              mot_first_used_date: null,
              mot_registration_date: null,
              mot_manufacture_date: null,
              mot_engine_size: null,
              mot_fuel_type: null,
              mot_primary_colour: null,
              mot_secondary_colour: null,
              mot_vehicle_id: null,
              mot_registration: null,
              mot_vin: null,
              mot_v5c_reference: null,
              mot_dvla_id: null,
              created_at: '',
              updated_at: '',
              notes: null,
              overdue_count: 0,
              due_soon_count: 0,
            }),
            vehicle: {
              id: vehicle?.id || resolvedParams.hgvId,
              reg_number: vehicle?.reg_number || null,
              category_id: vehicle?.category_id || null,
              status: vehicle?.status || 'active',
              nickname: vehicle?.nickname || null,
              asset_type: 'hgv' as const,
            },
          }}
          onSuccess={handleEditSuccess}
          onRetire={() => {
            setDeleteDialogOpen(true);
          }}
        />
      )}

      {/* Delete Vehicle Dialog */}
      {vehicle && (
        <DeleteVehicleDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          endpoint="hgvs"
          entityLabel="HGV"
          vehicle={{
            id: vehicle.id,
            reg_number: vehicle.reg_number ?? '',
            category: null
          }}
          onSuccess={() => {
            router.push('/fleet?tab=hgvs');
          }}
        />
      )}
    </div>
  );
}
