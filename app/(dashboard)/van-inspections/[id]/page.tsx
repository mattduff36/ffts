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
import { Badge } from '@/components/ui/badge';
import { Save, Send, Edit2, CheckCircle2, XCircle, AlertCircle, Camera, Download, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { BackButton } from '@/components/ui/back-button';
import { formatDate } from '@/lib/utils/date';
import { InspectionStatus, VanInspection, InspectionItem } from '@/types/inspection';
import PhotoUpload from '@/components/forms/PhotoUpload';
import { Database } from '@/types/database';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { InformWorkshopSummary } from '@/components/inspections/InformWorkshopSummary';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import { formatReferenceId, getReferenceIdSuffix, getWorkshopTaskHref } from '@/lib/utils/reference-ids';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { toast } from 'sonner';

interface InspectionWithDetails extends VanInspection {
  vans: {
    reg_number: string;
    vehicle_type: string;
  };
}

interface InspectionItemWithDay extends Omit<InspectionItem, 'item_description' | 'created_at'> {
  item_description: string | null;
  created_at: string | null;
  day_of_week: number | null;
}

function getInspectionItemDescription(item: Pick<InspectionItemWithDay, 'item_number' | 'item_description'>): string {
  return item.item_description || `Item ${item.item_number}`;
}

export default function ViewInspectionPage() {
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
  } = usePermissionCheck('inspections');
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
  
  const [inspection, setInspection] = useState<InspectionWithDetails | null>(null);
  const [items, setItems] = useState<InspectionItemWithDay[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedInspectionTaskSummary[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [originalDefectItems, setOriginalDefectItems] = useState<InspectionItemWithDay[]>([]); // Track original defects for auto-completion
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number | null } | null>(null);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(inspection?.id, {
    enabled: Boolean(inspection?.id),
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
        const employees = await fetchUserDirectory({ module: 'inspections', limit: 200 });
        setScopedEmployeeIds(Array.from(new Set([user.id, ...employees.map((employee) => employee.id)])));
      } catch (error) {
        console.error('Error fetching scoped inspection employees:', error);
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
      setError(''); // Clear any previous errors
      
      // Fetch inspection
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('van_inspections')
        .select(`
          *,
          vans (
            reg_number,
            vehicle_type
          )
        `)
        .eq('id', id)
        .maybeSingle() as { data: InspectionWithDetails | null; error: unknown };

      if (inspectionError) throw inspectionError;
      if (!inspectionData) {
        setError('Inspection not found');
        return;
      }
      
      // Check if user has access
      if (
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

      setInspection(inspectionData!);

      const [{ data: itemsData, error: itemsError }, linkedTasksData] = await Promise.all([
        supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', id)
          .order('item_number'),
        fetchInspectionLinks(id, 'van').catch((linkedTasksError) => {
          console.warn('Unable to load linked van inspection tasks:', linkedTasksError);
          return [];
        }),
      ]);

      if (itemsError) throw itemsError;

      const typedItems = (itemsData || []) as InspectionItemWithDay[];
      setItems(typedItems);
      setLinkedTasks(linkedTasksData);
      
      // Track original defect items for auto-completion when resolved
      const defectItems = typedItems.filter((item: InspectionItemWithDay) => item.status === 'attention');
      setOriginalDefectItems(defectItems);
      
      // Drafts are editable by owners and manager/admin roles.
      if (
        inspectionData &&
        inspectionData.status === 'draft' &&
        (
          inspectionData.user_id === user?.id ||
          isManager ||
          isAdmin ||
          isSuperAdmin
        )
      ) {
        setEditing(true);
      }
    } catch (err) {
      const errorContextId = 'van-inspection-details-fetch-error';
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
    user?.id,
    canViewCrossUserInspections,
    hasOrgWideInspectionVisibility,
    scopedEmployeeIds,
    isManager,
    isAdmin,
    isSuperAdmin,
  ]);

  useEffect(() => {
    if (params.id && !authLoading && !permissionLoading && canAccessInspectionModule) {
      fetchInspection(params.id as string);
    }
  }, [params.id, authLoading, permissionLoading, canAccessInspectionModule, fetchInspection]);

  const updateItem = (itemNumber: number, field: string, value: string | InspectionStatus) => {
    const newItems = items.map(item => 
      item.item_number === itemNumber 
        ? { ...item, [field]: value }
        : item
    );
    setItems(newItems);
  };

  const handleSave = async () => {
    if (!inspection || !user) return;

    setSaving(true);
    setError('');

    try {
      console.log('[Mobile Debug] Starting save...', {
        inspectionId: inspection.id,
        totalItems: items.length,
        itemsWithStatus: items.filter(item => item.status).length,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      });

      // Update inspection
      type InspectionUpdate = Database['public']['Tables']['van_inspections']['Update'];
      const inspectionUpdate: InspectionUpdate = {
        updated_at: new Date().toISOString(),
      };

      const { error: inspectionError } = await supabase
        .from('van_inspections')
        .update(inspectionUpdate)
        .eq('id', inspection.id);

      if (inspectionError) {
        console.error('[Mobile Debug] Inspection update error:', inspectionError);
        throw inspectionError;
      }
      console.log('[Mobile Debug] Inspection updated successfully');

      // Delete all existing items and re-insert them
      // This handles both updating existing items and adding new items
      console.log('[Mobile Debug] Deleting existing items...');
      const { error: deleteError } = await supabase
        .from('inspection_items')
        .delete()
        .eq('inspection_id', inspection.id);

      if (deleteError) {
        console.error('[Mobile Debug] Delete error:', deleteError);
        throw deleteError;
      }
      console.log('[Mobile Debug] Existing items deleted successfully');

      // Re-insert all items (both existing and new)
      // Only insert items that have been explicitly set (non-null status)
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

      console.log('[Mobile Debug] Items to insert:', {
        count: itemsToInsert.length,
        sample: itemsToInsert.length > 0 ? itemsToInsert[0] : null,
      });

      if (itemsToInsert.length > 0) {
        const { error: insertError, data: insertedData } = await supabase
          .from('inspection_items')
          .insert(itemsToInsert)
          .select();

        if (insertError) {
          console.error('[Mobile Debug] Insert error:', insertError);
          throw insertError;
        }
        console.log('[Mobile Debug] Items inserted successfully:', insertedData?.length);
      }

      console.log('[Mobile Debug] Save completed, creating/updating workshop tasks...');
      
      // Auto-create/update actions for failed items via server endpoint
      if (itemsToInsert.length > 0) {
        const failedItems = itemsToInsert.filter(item => item.status === 'attention');
        
        if (failedItems.length > 0) {
          try {
            // Get the inserted items with IDs
            const { data: insertedItems } = await supabase
              .from('inspection_items')
              .select('*')
              .eq('inspection_id', inspection.id)
              .eq('status', 'attention');

            if (insertedItems && insertedItems.length > 0) {
              // Group defects by item_number and description
              const groupedDefects = new Map<string, { 
                item_number: number; 
                item_description: string; 
                days: number[]; 
                comments: string[];
                item_ids: string[];
              }>();

              insertedItems.forEach((item) => {
                const itemDescription = item.item_description || `Item ${item.item_number}`;
                const key = `${item.item_number}-${itemDescription}`;
                if (!groupedDefects.has(key)) {
                  groupedDefects.set(key, {
                    item_number: item.item_number,
                    item_description: itemDescription,
                    days: [] as number[],
                    comments: [],
                    item_ids: []
                  });
                }
                const group = groupedDefects.get(key)!;
                if (item.day_of_week != null) group.days.push(item.day_of_week);
                group.item_ids.push(item.id);
                if (item.comments) {
                  group.comments.push(item.comments);
                }
              });

              // Prepare defects for sync endpoint
              const defects = Array.from(groupedDefects.values()).map(group => ({
                item_number: group.item_number,
                item_description: group.item_description,
                days: group.days,
                comment: group.comments.length > 0 ? group.comments[0] : '',
                primaryInspectionItemId: group.item_ids[0]
              }));

              // Call server endpoint to sync tasks
              const syncResponse = await fetch('/api/van-inspections/sync-defect-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  inspectionId: inspection.id,
                  vehicleId: inspection.van_id,
                  createdBy: user!.id,
                  defects
                })
              });

              if (syncResponse.ok) {
                const syncResult = await syncResponse.json();
                console.log(`✅ Sync complete: ${syncResult.message}`);
              } else {
                console.error('Error syncing defect tasks:', await syncResponse.text());
              }
            }
          } catch (actionError) {
            console.error('[Mobile Debug] Error syncing defect tasks:', actionError);
            // Don't throw - we don't want to fail the save if sync fails
          }
        }
      }

      // Auto-complete actions for resolved items (items that were 'attention' but are now 'ok')
      if (originalDefectItems.length > 0 && inspection.van_id) {
        try {
          // Find items that were defects but are now OK
          const resolvedItems = originalDefectItems.filter((originalItem: InspectionItemWithDay) => {
            const currentItem = itemsToInsert.find(
              (item: InspectionItemInsert) => item.item_number === originalItem.item_number && 
                      item.day_of_week === originalItem.day_of_week
            );
            // Item is resolved if it's now 'ok' or 'na', or if it's been removed
            return !currentItem || currentItem.status === 'ok' || currentItem.status === 'na';
          });

          if (resolvedItems.length > 0) {
            console.log(`[Mobile Debug] Found ${resolvedItems.length} resolved items`);

            // Find pending or logged actions for this inspection
            const { data: pendingActions } = await supabase
              .from('actions')
              .select('id, inspection_item_id, description, status')
              .eq('inspection_id', inspection.id)
              .eq('action_type', 'inspection_defect')
              .in('status', ['pending', 'logged']);

            if (pendingActions && pendingActions.length > 0) {
              // Match resolved items with their actions and complete them
              for (const resolvedItem of resolvedItems) {
                const matchingAction = pendingActions.find(
                  (action: { inspection_item_id: string | null }) => action.inspection_item_id === resolvedItem.id
                );

                if (matchingAction) {
                  const { error: completeError } = await supabase
                    .from('actions')
                    .update({
                      status: 'completed',
                      actioned: true,
                      actioned_at: new Date().toISOString(),
                      actioned_by: user.id,
                      description: `${matchingAction.description || ''}\n\nResolution: Item marked as OK/NA during inspection edit`
                    })
                    .eq('id', matchingAction.id);

                  if (completeError) {
                    console.error(`Error auto-completing action ${matchingAction.id}:`, completeError);
                  } else {
                    console.log(`✅ Auto-completed action ${matchingAction.id} for resolved item ${resolvedItem.item_number}`);
                  }
                }
              }
            }
          }
        } catch (resolveError) {
          console.error('[Mobile Debug] Error completing resolved actions:', resolveError);
          // Don't throw - we don't want to fail the save if this fails
        }
      }

      console.log('[Mobile Debug] Refreshing data...');
      // Refresh data
      await fetchInspection(inspection.id);
      setEditing(false);
      console.log('[Mobile Debug] Save process complete!');
    } catch (err) {
      const errorContextId = 'van-inspection-details-save-error';
      console.error('[Mobile Debug] Error saving inspection:', err, { errorContextId });
      const errorMessage = err instanceof Error ? err.message : 'Failed to save inspection';
      setError(errorMessage);
      toast.error(errorMessage, { id: errorContextId });
      
      // Log to error logger if available
      if (typeof window !== 'undefined' && (window as Window & { errorLogger?: { logError: (opts: unknown) => void } }).errorLogger) {
        (window as unknown as Window & { errorLogger: { logError: (opts: unknown) => void } }).errorLogger.logError({
          error: err,
          componentName: 'InspectionEditPage - handleSave',
          additionalData: {
            inspectionId: inspection.id,
            itemCount: items.length,
            itemsWithStatus: items.filter(item => item.status).length,
            isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
          },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!inspection || !user) return;

    // Validate: all defects must have comments
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
      // Save items first
      await handleSave();

      // Get the latest saved items to create/update actions
      const { data: savedItems } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', inspection.id);

      // Auto-create/update actions for defects via server endpoint
      const typedSavedItems = (savedItems || []) as InspectionItemWithDay[];
      if (typedSavedItems.length > 0) {
        const failedItems = typedSavedItems.filter((item: InspectionItemWithDay) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          try {
            // Group defects by item_number and description
            const groupedDefects = new Map<string, { 
              item_number: number; 
              item_description: string; 
              days: number[]; 
              comments: string[];
              item_ids: string[];
            }>();

            failedItems.forEach((item: InspectionItemWithDay) => {
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

            // Prepare defects for sync endpoint
            const defects = Array.from(groupedDefects.values()).map(group => ({
              item_number: group.item_number,
              item_description: group.item_description,
              days: group.days,
              comment: group.comments.length > 0 ? group.comments[0] : '',
              primaryInspectionItemId: group.item_ids[0]
            }));

            // Call server endpoint to sync tasks
            const syncResponse = await fetch('/api/van-inspections/sync-defect-tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inspectionId: inspection.id,
                vehicleId: inspection.van_id,
                createdBy: user!.id,
                defects
              })
            });

            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log(`✅ Sync complete: ${syncResult.message}`);
            } else {
              console.error('Error syncing defect tasks:', await syncResponse.text());
            }
          } catch (actionError) {
            console.error('Error syncing defect tasks:', actionError);
            // Don't throw - we don't want to fail the submit if sync fails
          }
        }
      }

      // Auto-complete actions for resolved items
      try {
        const { data: originalDefectItems } = await supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', inspection.id)
          .eq('status', 'attention');

        if (originalDefectItems && originalDefectItems.length > 0) {
          const resolvedItems = originalDefectItems.filter((originalItem: InspectionItemWithDay) => {
            const currentItem = typedSavedItems.find(
              (item: InspectionItemWithDay) => item.item_number === originalItem.item_number && 
                      item.day_of_week === originalItem.day_of_week
            );
            // Item is resolved if it's now 'ok' or 'na', or if it's been removed
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
                  (action: { inspection_item_id: string | null }) => action.inspection_item_id === resolvedItem.id
                );

                if (matchingAction) {
                  const { error: completeError } = await supabase
                    .from('actions')
                    .update({
                      status: 'completed',
                      actioned: true,
                      actioned_at: new Date().toISOString(),
                      actioned_by: user.id,
                      description: `${matchingAction.description || ''}\n\nResolution: Item marked as OK/NA during inspection submission`
                    })
                    .eq('id', matchingAction.id);

                  if (completeError) {
                    console.error(`Error auto-completing action ${matchingAction.id}:`, completeError);
                  } else {
                    console.log(`✅ Auto-completed action ${matchingAction.id} for resolved item ${resolvedItem.item_number}`);
                  }
                }
              }
            }
          }
        }
      } catch (resolveError) {
        console.error('Error completing resolved actions:', resolveError);
        // Don't throw - we don't want to fail the submit if this fails
      }

      // Update inspection status
      const { error: updateError } = await supabase
        .from('van_inspections')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', inspection.id);

      if (updateError) throw updateError;

      router.push('/van-inspections');
    } catch (err) {
      const errorContextId = 'van-inspection-details-submit-error';
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

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-gray-100 text-gray-400 border-gray-200';
    
    switch (status) {
      case 'ok':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'attention':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'na':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-400 border-gray-200';
    }
  };

  if (authLoading || permissionLoading || loading) {
    return <PageLoader message="Loading inspection..." />;
  }

  if (error && !inspection) {
    return (
      <div className="space-y-6">
        <Link href="/van-inspections">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Van Daily Checks
          </Button>
        </Link>
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
      href: getWorkshopTaskHref(task.id, 'van'),
    }))
    .filter(
      (task): task is { id: string; suffix: string; href: string } =>
        Boolean(task.suffix && task.href)
    );
  const hasInformWorkshopTask = linkedTasks.some((task) => task.action_type === 'workshop_vehicle_task');
  const getPhotosForItem = (itemNumber: number, dayOfWeek: number | null) =>
    photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">Van Daily Check</h1>
              <p className="text-sm md:text-base text-muted-foreground">
                {inspection.vans?.reg_number} • {formatDate(inspection.inspection_date)}
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
                const pdfUrl = `/api/van-inspections/${inspection.id}/pdf`;
                const vehicleReg = inspection.vans?.reg_number || 'Unknown';
                
                if (isStandalone || isMobile) {
                  router.push(`/pdf-viewer?url=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(`Inspection-${vehicleReg}`)}&return=${encodeURIComponent(`/van-inspections/${inspection.id}`)}`);
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
              <InformWorkshopSummary linkedTasks={linkedTasks} inspectionType="van" />
            </div>
          </CardContent>
        </Card>
      )}

      {inspection.manager_comments && (
        <Card className="bg-white dark:bg-slate-900 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-400">Manager Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800 dark:text-amber-300 whitespace-pre-wrap">{inspection.manager_comments}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="">
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-green-600">{okCount}</div>
            <div className="text-sm text-muted-foreground">OK</div>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-red-600">{defectCount}</div>
            <div className="text-sm text-muted-foreground">Defects</div>
          </CardContent>
        </Card>
      </div>

      <Card className="">
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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 w-12 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-center p-2 w-48 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Comments</th>
                  <th className="text-center p-2 w-24 font-medium">Photo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-secondary/20">
                    <td className="p-2 text-sm text-muted-foreground">{item.item_number}</td>
                    <td className="p-2 text-sm">{getInspectionItemDescription(item)}</td>
                    <td className="p-2">
                      {canEdit ? (
                        <div className="flex items-center justify-center gap-2">
                          {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => updateItem(item.item_number, 'status', status)}
                              className={`flex items-center justify-center w-10 h-10 rounded border-2 transition-all ${
                                getStatusColor(status, item.status === status)
                              }`}
                              title={status.toUpperCase()}
                            >
                              {getStatusIcon(status)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          {getStatusIcon(item.status)}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          value={item.comments || ''}
                          onChange={(e) => updateItem(item.item_number, 'comments', e.target.value)}
                          placeholder={item.status === 'attention' ? 'Required for defects' : 'Optional notes'}
                          className={item.status === 'attention' && !item.comments ? 'border-red-300' : ''}
                        />
                      ) : (
                        <span className="text-sm">{item.comments || '-'}</span>
                      )}
                    </td>
                    <td className="p-2 text-center align-middle">
                      {item.status === 'attention' ? (() => {
                        const photos = getPhotosForItem(item.item_number, item.day_of_week);
                        return (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPhotoUploadItem({ itemNumber: item.item_number, dayOfWeek: item.day_of_week })}
                            disabled={!canEdit}
                            title={photos.length > 0 ? `${photos.length} photo(s) saved` : 'Add photo'}
                            className={`h-10 min-w-24 gap-1.5 text-xs ${
                              photos.length > 0
                                ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                                : 'border-border text-muted-foreground hover:text-white'
                            }`}
                          >
                            <Camera className="h-3.5 w-3.5" />
                            {photos.length > 0 ? `${photos.length} saved` : 'Add photo'}
                          </Button>
                        );
                      })() : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {items.map((item) => (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    {item.item_number}. {getInspectionItemDescription(item)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {canEdit ? (
                    <div className="flex items-center justify-center gap-3">
                      {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => updateItem(item.item_number, 'status', status)}
                          className={`flex flex-col items-center justify-center w-20 h-20 rounded border-2 transition-all ${
                            getStatusColor(status, item.status === status)
                          }`}
                        >
                          {getStatusIcon(status)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-4">
                      {getStatusIcon(item.status)}
                    </div>
                  )}
                  {canEdit ? (
                    <Input
                      value={item.comments || ''}
                      onChange={(e) => updateItem(item.item_number, 'comments', e.target.value)}
                      placeholder={item.status === 'attention' ? 'Required for defects' : 'Optional notes'}
                      className={item.status === 'attention' && !item.comments ? 'border-red-300' : ''}
                    />
                  ) : (
                    item.comments && (
                      <p className="text-sm text-muted-foreground">{item.comments}</p>
                    )
                  )}
                  {/* Only show photo upload for defective items */}
                  {item.status === 'attention' && (
                    <InspectionPhotoTiles
                      photos={getPhotosForItem(item.item_number, item.day_of_week)}
                      onManage={
                        canEdit
                          ? () => setPhotoUploadItem({ itemNumber: item.item_number, dayOfWeek: item.day_of_week })
                          : undefined
                      }
                      title={`Item #${item.item_number} photos`}
                      description={`Uploaded photos for ${getInspectionItemDescription(item)}.`}
                      emptyLabel="Add / View Photos"
                      emptyHint="No photos saved yet"
                      manageLabel="Add / View"
                    />
                  )}
                </CardContent>
              </Card>
            ))}
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
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit Daily Check'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Defects & Comments Section */}
      {items.some(item => item.status === 'attention' || item.comments) && (
        <Card className="">
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
                  // Sort by day_of_week first, then item_number
                  if (a.day_of_week !== b.day_of_week) {
                    return (a.day_of_week || 0) - (b.day_of_week || 0);
                  }
                  return a.item_number - b.item_number;
                })
                .map((item) => {
                  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                  const dayName = item.day_of_week ? dayNames[item.day_of_week - 1] : '';
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

