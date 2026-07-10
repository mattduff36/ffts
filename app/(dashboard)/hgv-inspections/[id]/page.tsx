'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { fetchInspectionLinks, type LinkedInspectionTaskSummary } from '@/lib/client/inspection-links';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { canAccessScopedInspection, getInspectionVisibilityFlags } from '@/lib/utils/inspection-access';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Download, XCircle } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import type { InspectionItem, InspectionStatus } from '@/types/inspection';
import { enrichDefectsWithWorkshopCompletion, type EnrichedDefectItem } from '@/lib/utils/hgvDefectWorkshopDetails';
import PhotoUpload from '@/components/forms/PhotoUpload';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { InformWorkshopSummary } from '@/components/inspections/InformWorkshopSummary';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';
import { formatReferenceId, getReferenceIdSuffix, getWorkshopTaskHref } from '@/lib/utils/reference-ids';
import {
  getInspectionEnteredComment,
  type InspectionCommentTask,
} from '@/lib/utils/inspection-item-comments';

interface InspectionItemWithDay extends InspectionItem {
  day_of_week: number | null;
}

interface HgvInspectionDetails {
  id: string;
  user_id: string;
  hgv_id: string | null;
  inspection_date: string;
  inspection_end_date: string | null;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  inspector_comments: string | null;
  hgv: {
    reg_number: string;
    nickname: string | null;
    hgv_categories: { name: string } | null;
  } | null;
  profiles: { full_name: string } | null;
}

export default function ViewHgvInspectionPage() {
  const params = useParams();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current as ReturnType<typeof createClient>;
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
    canViewCrossUserInspections,
  } = getInspectionVisibilityFlags({
    teamName: effectiveRole?.team_name ?? profile?.team?.name,
    isManager,
    isAdmin,
    isSuperAdmin,
    isSupervisor,
  });

  const [inspection, setInspection] = useState<HgvInspectionDetails | null>(null);
  const [items, setItems] = useState<InspectionItemWithDay[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedInspectionTaskSummary[]>([]);
  const [scopedEmployeeIds, setScopedEmployeeIds] = useState<string[]>([]);
  const [defectsWithWorkshop, setDefectsWithWorkshop] = useState<EnrichedDefectItem[]>([]);
  const [loading, setLoading] = useState(true);
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
        const employees = await fetchUserDirectory({ module: 'hgv-inspections', limit: 200 });
        setScopedEmployeeIds(Array.from(new Set([user.id, ...employees.map((employee) => employee.id)])));
      } catch (error) {
        console.error('Error fetching scoped HGV inspection employees:', error);
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
    setLoading(true);
    setError('');
    try {
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('hgv_inspections')
        .select(`
          *,
          hgv:hgvs!hgv_inspections_hgv_id_fkey(
            reg_number,
            nickname,
            hgv_categories(name)
          ),
          profiles!hgv_inspections_user_id_fkey(full_name)
        `)
        .eq('id', id)
        .single();

      if (inspectionError || !inspectionData) throw inspectionError || new Error('Daily check not found');

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

      const [{ data: itemsData, error: itemsError }, linkedTasksData] = await Promise.all([
        supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', id)
          .order('item_number'),
        fetchInspectionLinks(id, 'hgv').catch((linkedTasksError) => {
          console.warn('Unable to load linked HGV inspection tasks:', linkedTasksError);
          return [];
        }),
      ]);

      if (itemsError) throw itemsError;

      setInspection(inspectionData as HgvInspectionDetails);
      const typedItems = (itemsData || []) as InspectionItemWithDay[];
      const linkedDefectTasks = linkedTasksData.filter(
        (task): task is LinkedInspectionTaskSummary & InspectionCommentTask =>
          task.action_type === 'inspection_defect'
      );

      const displayItems = typedItems.map((item) => ({
        ...item,
        comments: getInspectionEnteredComment(item, linkedDefectTasks),
      }));

      setItems(displayItems);
      setLinkedTasks(linkedTasksData);
      const attentionItems = displayItems
        .filter((item) => item.status === 'attention')
        .map((item) => ({
          id: item.id,
          item_number: item.item_number,
          item_description: item.item_description,
          comments: item.comments,
        }));
      const enriched = await enrichDefectsWithWorkshopCompletion(
        supabase,
        (inspectionData as HgvInspectionDetails).hgv_id,
        attentionItems
      );
      setDefectsWithWorkshop(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inspection');
    } finally {
      setLoading(false);
    }
  }, [
    supabase,
    user?.id,
    canViewCrossUserInspections,
    hasOrgWideInspectionVisibility,
    scopedEmployeeIds,
  ]);

  useEffect(() => {
    if (!params.id || authLoading || permissionLoading || !canAccessInspectionModule) return;
    fetchInspection(params.id as string);
  }, [authLoading, permissionLoading, canAccessInspectionModule, fetchInspection, params.id]);

  const getStatusIcon = (status: InspectionStatus) => {
    if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-green-400" />;
    if (status === 'attention') return <XCircle className="h-5 w-5 text-red-400" />;
    return <span className="text-xs font-extrabold tracking-wide text-slate-300">N/A</span>;
  };

  if (authLoading || permissionLoading || loading) {
    return <PageLoader message="Loading inspection..." />;
  }

  if (error && !inspection) {
    return (
      <div className="space-y-6">
        <BackButton fallbackHref="/hgv-inspections" />
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="pt-6">
            <p className="text-red-300">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inspection) return null;

  const defectCount = items.filter(item => item.status === 'attention').length;
  const okCount = items.filter(item => item.status === 'ok').length;
  const canUploadPhotos = inspection.user_id === user?.id;
  const isSubmittedInspection = inspection.status === 'submitted';
  const inspectionReference = formatReferenceId(inspection.id);
  const linkedTaskReferences = linkedTasks
    .map((task) => ({
      id: task.id,
      suffix: getReferenceIdSuffix(task.id),
      href: getWorkshopTaskHref(task.id, 'hgv'),
    }))
    .filter(
      (task): task is { id: string; suffix: string; href: string } =>
        Boolean(task.suffix && task.href)
    );
  const hasInformWorkshopTask = linkedTasks.some((task) => task.action_type === 'workshop_vehicle_task');
  const statusLabel = (status: string) =>
    status === 'logged' ? 'In Progress' : status === 'on_hold' ? 'On Hold' : status === 'resumed' ? 'Resumed' : status === 'completed' ? 'Completed' : status;
  const getPhotosForItem = (itemNumber: number, dayOfWeek: number | null) =>
    photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton fallbackHref="/hgv-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">HGV Daily Check</h1>
              <p className="text-sm md:text-base text-muted-foreground">
                {inspection.hgv?.reg_number || 'Unknown HGV'}
                {inspection.hgv?.nickname ? ` (${inspection.hgv.nickname})` : ''}
                {' • '}
                {formatDate(inspection.inspection_date)}
                {inspection.profiles?.full_name ? ` • ${inspection.profiles.full_name}` : ''}
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
            {isSubmittedInspection && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/hgv-inspections/${inspection.id}/pdf`, '_blank')}
                className="border-border text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Download PDF</span>
                <span className="sm:hidden">PDF</span>
              </Button>
            )}
            <Badge
              variant={isSubmittedInspection ? 'default' : 'secondary'}
              className={
                isSubmittedInspection
                  ? 'border-inspection/40 bg-inspection/10 text-inspection'
                  : undefined
              }
            >
              {isSubmittedInspection ? 'Submitted' : 'Draft'}
            </Badge>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-green-600">{okCount}</div>
            <div className="text-sm text-muted-foreground">Pass</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-red-600">{defectCount}</div>
            <div className="text-sm text-muted-foreground">Defects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-foreground">{inspection.current_mileage?.toLocaleString() || '-'}</div>
            <div className="text-sm text-muted-foreground">KM</div>
          </CardContent>
        </Card>
      </div>

      <Card className="">
        <CardHeader>
          <CardTitle>Checklist Items</CardTitle>
          <CardDescription>HGV checklist results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 w-12 font-medium text-white">#</th>
                  <th className="text-left p-3 font-medium text-white">Item</th>
                  <th className="text-center p-3 w-40 font-medium text-white">Status</th>
                  <th className="text-left p-3 font-medium text-white">Comments</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 hover:bg-slate-800/30">
                    <td className="p-3 text-sm text-muted-foreground">{item.item_number}</td>
                    <td className="p-3 text-sm text-white">{item.item_description}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-2">
                        {getStatusIcon(item.status)}
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      <div className="space-y-3">
                        <div className="text-muted-foreground">{item.comments || '-'}</div>
                        {item.status === 'attention' && (
                          <>
                            <InspectionPhotoTiles
                              photos={getPhotosForItem(item.item_number, item.day_of_week)}
                              onManage={
                                canUploadPhotos
                                  ? () => setPhotoUploadItem({ itemNumber: item.item_number, dayOfWeek: item.day_of_week })
                                  : undefined
                              }
                              title={`Item #${item.item_number} photos`}
                              description={`Uploaded photos for ${item.item_description}.`}
                              emptyLabel="Add / View Photos"
                              emptyHint="No photos saved yet"
                              manageLabel="Add / View"
                              className="max-w-[272px] border-border/50"
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3">
            {items.map((item) => (
              <div key={item.id} className="bg-slate-900/30 border border-border/50 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                    <span className="text-sm font-bold text-muted-foreground">{item.item_number}</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-base font-medium text-white leading-tight">{item.item_description}</h4>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-border/60 bg-slate-900/40 px-3 py-2 flex items-center gap-2">
                    {getStatusIcon(item.status)}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">{item.comments || 'No comments'}</div>
                {item.status === 'attention' && (
                  <InspectionPhotoTiles
                    photos={getPhotosForItem(item.item_number, item.day_of_week)}
                    onManage={
                      canUploadPhotos
                        ? () => setPhotoUploadItem({ itemNumber: item.item_number, dayOfWeek: item.day_of_week })
                        : undefined
                    }
                    title={`Item #${item.item_number} photos`}
                    description={`Uploaded photos for ${item.item_description}.`}
                    emptyLabel="Add / View Photos"
                    emptyHint="No photos saved yet"
                    manageLabel="Add / View"
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {(inspection.inspector_comments || defectsWithWorkshop.length > 0 || hasInformWorkshopTask) && (
        <Card>
          <CardContent className="space-y-4 p-6">
            {!(inspection.inspector_comments || hasInformWorkshopTask) && (
              <h2 className="text-xl font-semibold tracking-tight">Defects / Comments</h2>
            )}
            {(inspection.inspector_comments || hasInformWorkshopTask) && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
                <div className="min-w-0 space-y-3">
                  <h2 className="text-xl font-semibold tracking-tight">Defects / Comments</h2>
                  <div className="rounded-lg border border-white/10 p-4">
                    {inspection.inspector_comments ? (
                      <p className="text-sm whitespace-pre-wrap">{inspection.inspector_comments}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No inspector comment recorded.</p>
                    )}
                  </div>
                </div>
                <InformWorkshopSummary linkedTasks={linkedTasks} inspectionType="hgv" />
              </div>
            )}
            {defectsWithWorkshop.length > 0 && (
              <div className="space-y-4">
                {defectsWithWorkshop.map((defect) => (
                  <div key={defect.id} className="rounded-md border border-border p-3 space-y-2">
                    <div className="text-sm font-medium">
                      {defect.item_number}. {defect.item_description}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Defect note: {defect.comments || 'No defect note recorded'}
                    </p>
                    {defect.workshop_tasks.length > 0 ? (
                      <div className="space-y-3">
                        {defect.workshop_tasks.map((task) => (
                          <div key={task.task_id} className="rounded border border-green-700/40 bg-green-900/10 p-2 space-y-2">
                            <p className="text-xs text-green-300">
                              Completed: {task.completed_at ? formatDate(task.completed_at) : '-'} by {task.completed_by}
                            </p>
                            {task.completed_comment && (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                Completion note: {task.completed_comment}
                              </p>
                            )}
                            {task.completion_signature_data && (
                              <div className="space-y-1">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={task.completion_signature_data} alt="Workshop completion signature" className="border rounded p-1 bg-white max-w-xs" />
                              </div>
                            )}
                            <div className="space-y-1">
                              {task.timeline.map((event) => (
                                <p key={event.id} className="text-xs text-muted-foreground">
                                  {formatDate(event.created_at)} - {statusLabel(event.status)} - {event.author_name}: {event.body}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No completed workshop task linked yet.</p>
                    )}
                    <InspectionPhotoGallery
                      photos={getPhotosForItem(defect.item_number, items.find((item) => item.id === defect.id)?.day_of_week ?? null)}
                      title={`Item #${defect.item_number} photos`}
                      description={`Uploaded photos for ${defect.item_description}.`}
                      compact
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
