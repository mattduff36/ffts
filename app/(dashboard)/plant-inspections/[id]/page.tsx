'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { fetchInspectionLinks, type LinkedInspectionTaskSummary } from '@/lib/client/inspection-links';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { canAccessScopedInspection, getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Save, Send, Edit2, CheckCircle2, XCircle, AlertCircle, Download } from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { InspectionStatus, InspectionItem } from '@/types/inspection';
import PhotoUpload from '@/components/forms/PhotoUpload';
import { Database } from '@/types/database';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import { InformWorkshopSummary } from '@/components/inspections/InformWorkshopSummary';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import { formatReferenceId, getReferenceIdSuffix, getWorkshopTaskHref } from '@/lib/utils/reference-ids';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { toast } from 'sonner';

interface PlantInspectionWithDetails {
  id: string;
  user_id: string;
  plant_id: string | null;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: string;
  inspector_comments: string | null;
  is_hired_plant?: boolean;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    van_categories: {
      name: string;
    } | null;
  } | null;
  profiles: {
    full_name: string;
  };
}

interface DailyHour {
  day_of_week: number;
  hours: number | null;
}

interface InspectionItemWithDay extends Omit<InspectionItem, 'item_description' | 'created_at'> {
  item_description: string | null;
  created_at: string | null;
  day_of_week: number | null;
}

function getInspectionItemDescription(item: Pick<InspectionItemWithDay, 'item_number' | 'item_description'>): string {
  return item.item_description || `Item ${item.item_number}`;
}

export default function ViewPlantInspectionPage() {
  const router = useRouter();
  const params = useParams();
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
    canViewCrossUserInspections,
  } = getInspectionVisibilityFlags({
    teamName: effectiveRole?.team_name ?? profile?.team?.name,
    isManager,
    isAdmin,
    isSuperAdmin,
    isSupervisor,
  });
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;
  
  const [inspection, setInspection] = useState<PlantInspectionWithDetails | null>(null);
  const [items, setItems] = useState<InspectionItemWithDay[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedInspectionTaskSummary[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [dailyHours, setDailyHours] = useState<DailyHour[]>([]);
  const [originalDefectItems, setOriginalDefectItems] = useState<InspectionItemWithDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number | null } | null>(null);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(inspection?.id, {
    enabled: Boolean(inspection?.id),
  });
  
  // Editable daily hours state (for draft inspections)
  const [editableDailyHours, setEditableDailyHours] = useState<Record<number, number | null>>({
    1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null
  });

  useEffect(() => {
    if (!user || permissionLoading || !canAccessInspectionModule || hasOrgWideInspectionVisibility) {
      setScopedEmployeeIds(user ? [user.id] : []);
      return;
    }

    if (!canViewCrossUserInspections) {
      setScopedEmployeeIds([user.id]);
      return;
    }

    const fetchScopedEmployees = async () => {
      try {
        const employees = await fetchUserDirectory({ module: 'plant-inspections', limit: 200 });
        setScopedEmployeeIds(Array.from(new Set([user.id, ...employees.map((employee) => employee.id)])));
      } catch (error) {
        console.error('Error fetching scoped plant inspection employees:', error);
        setScopedEmployeeIds([user.id]);
      }
    };

    void fetchScopedEmployees();
  }, [
    user,
    permissionLoading,
    canAccessInspectionModule,
    hasOrgWideInspectionVisibility,
    canViewCrossUserInspections,
  ]);

  const fetchInspection = useCallback(async (id: string) => {
    try {
      setError('');
      
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('plant_inspections')
        .select(`
          *,
          plant (
            plant_id,
            nickname,
            serial_number,
            van_categories (name)
          ),
          profiles!plant_inspections_user_id_fkey (full_name)
        `)
        .eq('id', id)
        .maybeSingle();

      if (inspectionError) throw inspectionError;
      if (!inspectionData) {
        setError('Inspection not found');
        return;
      }
      
      if (
        inspectionData &&
        !canAccessScopedInspection({
          ownerUserId: inspectionData.user_id,
          currentUserId: user?.id,
          canViewCrossUserInspections,
          hasOrgWideInspectionVisibility,
          scopedUserIds: scopedEmployeeIds,
        })
      ) {
        setError('You do not have permission to view this inspection');
        setLoading(false);
        return;
      }

      setInspection(inspectionData as PlantInspectionWithDetails);

      const [{ data: itemsData, error: itemsError }, linkedTasksData] = await Promise.all([
        supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', id)
          .order('item_number'),
        fetchInspectionLinks(id, 'plant').catch((linkedTasksError) => {
          console.warn('Unable to load linked plant inspection tasks:', linkedTasksError);
          return [];
        }),
      ]);

      if (itemsError) throw itemsError;

      const typedItems = (itemsData || []) as InspectionItemWithDay[];
      setItems(typedItems);
      setLinkedTasks(linkedTasksData);
      
      const defectItems = typedItems.filter((item: InspectionItemWithDay) => item.status === 'attention');
      setOriginalDefectItems(defectItems);

      // Fetch daily hours
      const { data: hoursData, error: hoursError } = await supabase
        .from('inspection_daily_hours')
        .select('*')
        .eq('inspection_id', id)
        .order('day_of_week');

      if (hoursError) throw hoursError;

      setDailyHours(hoursData || []);
      
      // Populate editable hours for drafts
      const hoursMap: Record<number, number | null> = {
        1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null
      };
      (hoursData || []).forEach((h: DailyHour) => {
        hoursMap[h.day_of_week] = h.hours;
      });
      setEditableDailyHours(hoursMap);
      
      // Draft edits are handled on /plant-inspections/new?id=...
    } catch (err) {
      const errorContextId = 'plant-inspection-details-fetch-error';
      const status = getErrorStatus(err);
      if (!isAuthErrorStatus(status) && !isNetworkFetchError(err)) {
        console.error('Error fetching inspection:', err, { errorContextId });
      }
      const message = err instanceof Error ? err.message : 'Failed to load inspection';
      setError(message);
      toast.error(message, { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [
    supabase,
    user,
    canViewCrossUserInspections,
    hasOrgWideInspectionVisibility,
    scopedEmployeeIds,
  ]);

  useEffect(() => {
    if (params.id && !authLoading && !permissionLoading && canAccessInspectionModule) {
      fetchInspection(params.id as string);
    }
  }, [params.id, authLoading, permissionLoading, canAccessInspectionModule, fetchInspection]);

  const handleHoursChange = (dayOfWeek: number, hours: string) => {
    const hoursNum = hours === '' ? null : parseInt(hours);
    setEditableDailyHours(prev => ({ ...prev, [dayOfWeek]: hoursNum }));
  };

  const handleSave = async () => {
    if (!inspection || !user) return;

    setSaving(true);
    setError('');

    try {
      type InspectionUpdate = Database['public']['Tables']['plant_inspections']['Update'];
      const inspectionUpdate: InspectionUpdate = {
        updated_at: new Date().toISOString(),
      };

      const { error: inspectionError } = await supabase
        .from('plant_inspections')
        .update(inspectionUpdate)
        .eq('id', inspection.id);

      if (inspectionError) throw inspectionError;

      // Delete and re-insert items
      const { error: deleteError } = await supabase
        .from('inspection_items')
        .delete()
        .eq('inspection_id', inspection.id);

      if (deleteError) throw deleteError;

      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const itemsToInsert: InspectionItemInsert[] = items
        .filter((item: InspectionItemWithDay): item is InspectionItemWithDay & { day_of_week: number } =>
          Boolean(item.status) && item.day_of_week !== null
        )
        .map(item => ({
          inspection_id: inspection.id,
          item_number: item.item_number,
          item_description: item.item_description,
          day_of_week: item.day_of_week as number,
          status: item.status,
          comments: item.comments ?? null,
        }));

      if (itemsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('inspection_items')
          .insert(itemsToInsert);

        if (insertError) throw insertError;
      }

      // Update daily hours - delete existing entries first
      const { error: deleteHoursError } = await supabase
        .from('inspection_daily_hours')
        .delete()
        .eq('inspection_id', inspection.id);

      if (deleteHoursError) {
        console.error('Failed to delete existing daily hours:', deleteHoursError);
        throw deleteHoursError;
      }

      const dailyHoursToInsert = Object.entries(editableDailyHours)
        .filter(([, hours]) => hours !== null)
        .map(([day, hours]) => ({
          inspection_id: inspection.id,
          day_of_week: parseInt(day),
          hours: hours!
        }));

      if (dailyHoursToInsert.length > 0) {
        const { error: hoursError } = await supabase
          .from('inspection_daily_hours')
          .insert(dailyHoursToInsert);

        if (hoursError) {
          console.error('Error saving daily hours:', hoursError);
        }
      }

      // Sync defect tasks (skip for hired plant)
      const failedItems = itemsToInsert.filter(item => item.status === 'attention');
      
      if (!inspection.is_hired_plant && failedItems.length > 0) {
        const { data: insertedItems } = await supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', inspection.id)
          .eq('status', 'attention');

        if (insertedItems && insertedItems.length > 0) {
          const groupedDefects = new Map<string, { 
            item_number: number; 
            item_description: string; 
            days: number[]; 
            comments: string[];
            item_ids: string[];
          }>();

          insertedItems.forEach((item: InspectionItemWithDay) => {
            const itemDescription = getInspectionItemDescription(item);
            const key = `${item.item_number}-${itemDescription}`;
            if (!groupedDefects.has(key)) {
              groupedDefects.set(key, {
                item_number: item.item_number,
                item_description: itemDescription,
                days: [],
                comments: [],
                item_ids: []
              });
            }
            const group = groupedDefects.get(key)!;
            if (item.day_of_week !== null) group.days.push(item.day_of_week);
            group.item_ids.push(item.id);
            if (item.comments) {
              group.comments.push(item.comments);
            }
          });

          const defects = Array.from(groupedDefects.values()).map(group => ({
            item_number: group.item_number,
            item_description: group.item_description,
            days: group.days,
            comment: group.comments.length > 0 ? group.comments[0] : '',
            primaryInspectionItemId: group.item_ids[0]
          }));

          const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inspectionId: inspection.id,
              plantId: inspection.plant_id,
              createdBy: user!.id,
              defects
            })
          });

          if (!syncResponse.ok) {
            const errorData = await syncResponse.json();
            throw new Error(errorData.error || 'Failed to sync defect tasks');
          }
        }
      }

      // Auto-complete resolved actions
      if (originalDefectItems.length > 0) {
        const resolvedItems = originalDefectItems.filter(originalItem => {
          const currentItem = itemsToInsert.find(
            item => item.item_number === originalItem.item_number && 
                    item.day_of_week === originalItem.day_of_week
          );
          return !currentItem || currentItem.status === 'ok' || currentItem.status === 'na';
        });

        if (resolvedItems.length > 0) {
          const { data: pendingActions } = await supabase
            .from('actions')
            .select('id, inspection_item_id, description, status')
            .eq('inspection_id', inspection.id)
            .eq('action_type', 'inspection_defect')
            .in('status', ['pending', 'logged']);

          if (pendingActions && pendingActions.length > 0) {
            for (const resolvedItem of resolvedItems) {
              const matchingAction = pendingActions.find(
                (action) => action.inspection_item_id === resolvedItem.id
              );

              if (matchingAction) {
                await supabase
                  .from('actions')
                  .update({
                    status: 'completed',
                    actioned: true,
                    actioned_at: new Date().toISOString(),
                    actioned_by: user.id,
                    description: `${matchingAction.description || ''}\n\nResolution: Item marked as OK/NA during inspection edit`
                  })
                  .eq('id', matchingAction.id);
              }
            }
          }
        }
      }

      await fetchInspection(inspection.id);
      setEditing(false);
    } catch (err) {
      const errorContextId = 'plant-inspection-details-save-error';
      console.error('Error saving inspection:', err, { errorContextId });
      const errorMessage = err instanceof Error ? err.message : 'Failed to save inspection';
      setError(errorMessage);
      toast.error(errorMessage, { id: errorContextId });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!inspection || !user) return;

    const defectsWithoutComments = items.filter(
      item => item.status === 'attention' && !item.comments
    );

    if (defectsWithoutComments.length > 0) {
      setError('Please add comments for all defect items');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await handleSave();

      const { error: updateError } = await supabase
        .from('plant_inspections')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', inspection.id);

      if (updateError) throw updateError;

      router.push('/plant-inspections');
    } catch (err) {
      const errorContextId = 'plant-inspection-details-submit-error';
      console.error('Error submitting inspection:', err, { errorContextId });
      const message = err instanceof Error ? err.message : 'Failed to submit inspection';
      setError(message);
      toast.error(message, { id: errorContextId });
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Submitted' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: InspectionStatus) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'attention':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'na':
        return <span className="text-xs font-extrabold tracking-wide text-gray-400">N/A</span>;
      default:
        return null;
    }
  };

  if (authLoading || permissionLoading || loading) {
    return <PageLoader message="Loading inspection..." />;
  }

  if (error && !inspection) {
    return (
      <div className="space-y-6">
        <BackButton fallbackHref="/plant-inspections" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inspection) return null;

  const canEdit = editing && inspection.status === 'draft';
  const canSubmit = inspection.user_id === user?.id && inspection.status === 'draft';

  const defectCount = items.filter(item => item.status === 'attention').length;
  const okCount = items.filter(item => item.status === 'ok').length;
  const inspectionReference = formatReferenceId(inspection.id);
  const linkedTaskReferences = linkedTasks
    .map((task) => ({
      id: task.id,
      suffix: getReferenceIdSuffix(task.id),
      href: getWorkshopTaskHref(task.id, 'plant'),
    }))
    .filter(
      (task): task is { id: string; suffix: string; href: string } =>
        Boolean(task.suffix && task.href)
    );
  const hasInformWorkshopTask = linkedTasks.some((task) => task.action_type === 'workshop_vehicle_task');

  const isWeeklyInspection = inspection.inspection_end_date && 
    inspection.inspection_end_date !== inspection.inspection_date;
  const getPhotosForItem = (itemNumber: number, dayOfWeek: number | null) =>
    photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [];

  const uniqueItems: Array<{ number: number; description: string }> = [];
  if (isWeeklyInspection) {
    const seenNumbers = new Set<number>();
    items.forEach(item => {
      if (!seenNumbers.has(item.item_number)) {
        seenNumbers.add(item.item_number);
        uniqueItems.push({
          number: item.item_number,
          description: getInspectionItemDescription(item),
        });
      }
    });
    uniqueItems.sort((a, b) => a.number - b.number);
  }

  const getItemStatusForDay = (itemNumber: number, dayOfWeek: number): InspectionStatus | null => {
    const item = items.find(i => i.item_number === itemNumber && i.day_of_week === dayOfWeek);
    return item ? item.status : null;
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton fallbackHref="/plant-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">Plant Daily Check</h1>
              <p className="text-sm md:text-base text-muted-foreground">
                {inspection.is_hired_plant ? (
                  <>
                    <span className="text-amber-400 font-medium">Hired</span>
                    {' - '}
                    {inspection.hired_plant_id_serial || 'Unknown'}
                    {inspection.hired_plant_description && ` (${inspection.hired_plant_description})`}
                    {inspection.hired_plant_hiring_company && ` • ${inspection.hired_plant_hiring_company}`}
                  </>
                ) : (
                  <>
                    {inspection.plant?.plant_id} {inspection.plant?.nickname && `(${inspection.plant.nickname})`} {inspection.plant?.serial_number && `(SN: ${inspection.plant.serial_number})`}
                  </>
                )}
                {' • '}
                {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                  ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                  : formatDate(inspection.inspection_date)
                }
              </p>
              {inspectionReference && (
                <div className="mt-1 text-xs md:text-sm text-slate-500 dark:text-slate-400/80">
                  <span>{inspectionReference}</span>
                  {linkedTaskReferences.length > 0 && (
                    <>
                      <span>{` [linked task ID${linkedTaskReferences.length > 1 ? 's' : ''} `}</span>
                      {linkedTaskReferences.map((task, index) => (
                        <span key={task.id}>
                          {index > 0 && ', '}
                          <Link
                            href={task.href}
                            className="text-blue-400/80 hover:text-blue-300/90 underline underline-offset-2"
                          >
                            {task.suffix}
                          </Link>
                        </span>
                      ))}
                      <span>]</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const pdfUrl = `/api/plant-inspections/${inspection.id}/pdf`;
                const plantId = inspection.is_hired_plant
                  ? (inspection.hired_plant_id_serial || 'Hired')
                  : (inspection.plant?.plant_id || 'Unknown');
                
                if (isStandalone || isMobile) {
                  router.push(`/pdf-viewer?url=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(`PlantInspection-${plantId}`)}&return=${encodeURIComponent(`/plant-inspections/${inspection.id}`)}`);
                } else {
                  window.open(pdfUrl, '_blank');
                }
              }}
              className="border-border text-white hover:bg-slate-800"
            >
              <Download className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Download PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
            {getStatusBadge(inspection.status)}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-green-600">{okCount}</div>
            <div className="text-sm text-muted-foreground">OK</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-red-600">{defectCount}</div>
            <div className="text-sm text-muted-foreground">Defects</div>
          </CardContent>
        </Card>
      </div>

      {/* Current Hours */}
      {inspection.current_mileage != null && (
        <Card>
          <CardHeader>
            <CardTitle>Current Hours</CardTitle>
            <CardDescription>Machine hours at time of daily check</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {inspection.current_mileage.toLocaleString()}h
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Hours (legacy - for older inspections) */}
      {dailyHours.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Hours</CardTitle>
            <CardDescription>Hours worked each day</CardDescription>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <div className="grid grid-cols-7 gap-2">
                {dayNames.map((day, idx) => {
                  const dayOfWeek = idx + 1;
                  return (
                    <div key={dayOfWeek} className="flex flex-col">
                      <Label className="text-xs text-muted-foreground mb-1 text-center">{day}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={editableDailyHours[dayOfWeek] ?? ''}
                        onChange={(e) => handleHoursChange(dayOfWeek, e.target.value)}
                        className="h-10 text-center"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {dayNames.map((day, idx) => {
                  const dayOfWeek = idx + 1;
                  const hours = dailyHours.find(h => h.day_of_week === dayOfWeek);
                  return (
                    <div key={dayOfWeek} className="text-center p-2 border border-border rounded">
                      <div className="text-xs font-semibold text-muted-foreground">{day}</div>
                      <div className="text-lg font-bold">{hours?.hours ?? '-'}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Check Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Daily Check Items</CardTitle>
            {canEdit && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            {isWeeklyInspection ? (
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-border">
                    <th className="text-left p-2 w-12 font-medium border-r border-border">#</th>
                    <th className="text-left p-2 font-medium border-r border-border">Item</th>
                    {dayNames.map((day, index) => (
                      <th key={index} className="text-center p-2 w-16 font-medium border-r border-border last:border-r-0">
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniqueItems.map((item) => (
                    <tr key={item.number} className="border-b border-border hover:bg-secondary/20">
                      <td className="p-2 text-sm text-muted-foreground font-medium border-r border-border">
                        {item.number}
                      </td>
                      <td className="p-2 text-sm border-r border-border">
                        {item.description}
                      </td>
                      {[1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => {
                        const status = getItemStatusForDay(item.number, dayOfWeek);
                        return (
                          <td key={dayOfWeek} className="p-2 text-center border-r border-border last:border-r-0">
                            {status ? (
                              <div className="flex items-center justify-center">
                                {getStatusIcon(status)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 w-12 font-medium">#</th>
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-center p-2 w-48 font-medium">Status</th>
                    <th className="text-left p-2 font-medium">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-secondary/20">
                      <td className="p-2 text-sm text-muted-foreground">{item.item_number}</td>
                      <td className="p-2 text-sm">{getInspectionItemDescription(item)}</td>
                      <td className="p-2">
                        <div className="flex items-center justify-center">
                          {getStatusIcon(item.status)}
                        </div>
                      </td>
                      <td className="p-2">
                        <span className="text-sm">{item.comments || '-'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {isWeeklyInspection ? (
              uniqueItems.map((item) => (
                <Card key={item.number}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {item.number}. {item.description}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-7 gap-1">
                      {dayNames.map((day, index) => {
                        const dayOfWeek = index + 1;
                        const status = getItemStatusForDay(item.number, dayOfWeek);
                        return (
                          <div key={index} className="flex flex-col items-center p-2 border border-border rounded">
                            <span className="text-xs font-medium text-muted-foreground mb-1">
                              {day}
                            </span>
                            {status ? (
                              <div className="flex items-center justify-center">
                                {getStatusIcon(status)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              items.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {item.item_number}. {getInspectionItemDescription(item)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-center py-4">
                      {getStatusIcon(item.status)}
                    </div>
                    {item.comments && (
                      <p className="text-sm text-muted-foreground">{item.comments}</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4">
            {canEdit && (
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
            
            {canSubmit && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
                className="bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900"
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit Daily Check'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Defects & Comments */}
      {items.some(item => item.status === 'attention' || item.comments) && (
        <Card>
          <CardHeader>
            <CardTitle>Defects & Comments</CardTitle>
            <CardDescription>
              Items requiring attention or with additional notes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {items
                .filter(item => item.status === 'attention' || item.comments)
                .sort((a, b) => {
                  if (a.day_of_week !== b.day_of_week) {
                    return (a.day_of_week || 0) - (b.day_of_week || 0);
                  }
                  return a.item_number - b.item_number;
                })
                .map((item) => {
                  const fullDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                  const dayName = isWeeklyInspection && item.day_of_week ? fullDayNames[item.day_of_week - 1] : '';
                  const statusBadge = item.status === 'attention' 
                    ? <Badge variant="destructive" className="ml-2">DEFECT</Badge>
                    : <Badge variant="secondary" className="ml-2">NOTE</Badge>;
                  
                  return (
                    <div 
                      key={`${item.item_number}-${item.day_of_week}`}
                      className="p-3 border rounded-md"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {getStatusIcon(item.status)}
                        <div className="flex-1">
                          <div className="font-medium">
                            {item.item_number}. {getInspectionItemDescription(item)}
                            {dayName && ` (${dayName})`}
                            {statusBadge}
                          </div>
                        </div>
                      </div>
                      {item.comments && (
                        <div className="mt-2 pl-7 text-sm text-muted-foreground">
                          {item.comments}
                        </div>
                      )}
                      <InspectionPhotoGallery
                        photos={getPhotosForItem(item.item_number, item.day_of_week)}
                        title={`Item #${item.item_number} photos`}
                        description={`Uploaded photos for ${getInspectionItemDescription(item)}.`}
                        compact
                        className="mt-3 pl-7"
                      />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inspector Comments */}
      {(inspection.inspector_comments || hasInformWorkshopTask) && (
        <Card>
          <CardContent className="p-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
              <div className="min-w-0 space-y-3">
                <h2 className="text-xl font-semibold tracking-tight">Inspector Comments</h2>
                <div className="rounded-lg border border-white/10 p-4">
                  {inspection.inspector_comments ? (
                    <p className="text-sm whitespace-pre-wrap">{inspection.inspector_comments}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No inspector comment recorded.</p>
                  )}
                </div>
              </div>
              <InformWorkshopSummary linkedTasks={linkedTasks} inspectionType="plant" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photo Upload Modal */}
      {photoUploadItem && (
        <PhotoUpload
          inspectionId={inspection.id}
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
