'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  Wrench,
  FileText,
  Pause,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { WorkshopTaskTimeline } from '@/components/workshop-tasks/WorkshopTaskTimeline';
import {
  AdjustTaskTimestampDialog,
  type AdjustTimestampTarget,
} from '@/components/workshop-tasks/AdjustTaskTimestampDialog';
import { TaskAttachmentsSection } from '@/components/workshop-tasks/TaskAttachmentsSection';
import { useWorkshopTaskComments } from '@/lib/hooks/useWorkshopTaskComments';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import type { InspectionPhoto } from '@/types/inspection';
import type { Database } from '@/types/database';
import {
  formatReferenceId,
  getInspectionHref,
  getReferenceIdSuffix,
  type InspectionReferenceType,
} from '@/lib/utils/reference-ids';

type Task = Database['public']['Tables']['actions']['Row'] & {
  status_history?: unknown[] | null;
  workshop_task_categories?: {
    name: string;
  } | null;
  workshop_task_subcategories?: {
    name: string;
    workshop_task_categories?: {
      name: string;
    } | null;
  } | null;
  vans?: {
    reg_number: string | null;
    nickname: string | null;
  } | null;
  hgvs?: {
    reg_number: string | null;
    nickname: string | null;
  } | null;
  plant?: {
    plant_id: string;
    nickname: string | null;
  } | null;
};

function getTaskStatus(task: Pick<Task, 'status'>): string {
  return task.status || 'pending';
}

interface WorkshopTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onMarkInProgress: (task: Task) => void;
  onMarkComplete: (task: Task) => void;
  onMarkOnHold: (task: Task) => void;
  onResume: (task: Task) => void;
  isUpdating: boolean;
  onTaskUpdated?: () => Promise<void>;
  inspectionPhotos?: InspectionPhoto[];
}

export function WorkshopTaskModal({
  open,
  onOpenChange,
  task,
  onEdit,
  onDelete,
  onMarkInProgress,
  onMarkComplete,
  onMarkOnHold,
  onResume,
  isUpdating,
  onTaskUpdated,
  inspectionPhotos = [],
}: WorkshopTaskModalProps) {
  const { tabletModeEnabled } = useTabletMode();
  const taskActionButtonClass = tabletModeEnabled ? 'min-h-11 text-base px-4' : '';
  const { comments: taskComments, loading, refetch } = useWorkshopTaskComments({
    taskIds: task ? [task.id] : [],
    enabled: open && !!task,
  });
  const [timestampTarget, setTimestampTarget] = useState<AdjustTimestampTarget | null>(null);
  const [adjustTimestampOpen, setAdjustTimestampOpen] = useState(false);
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);

  if (!task) return null;

  const categoryName =
    task.workshop_task_subcategories?.workshop_task_categories?.name ||
    task.workshop_task_categories?.name ||
    null;
  const subcategoryName = task.workshop_task_subcategories?.name || null;
  const inspectionDetails = task.action_type === 'inspection_defect'
    ? task.description?.trim() || null
    : null;
  const workshopNotes = task.workshop_comments?.trim() || null;
  const taskReference = formatReferenceId(task.id);
  const linkedInspectionType: InspectionReferenceType | null = task.hgv_id
    ? 'hgv'
    : task.plant_id
      ? 'plant'
      : task.van_id
        ? 'van'
        : null;
  const resolvedInspectionId = task.inspection_id;
  const linkedInspectionHref = linkedInspectionType && resolvedInspectionId
    ? getInspectionHref(linkedInspectionType, resolvedInspectionId)
    : null;
  const linkedInspectionReference = getReferenceIdSuffix(resolvedInspectionId);
  const taskForTimeline = {
    ...task,
    created_at: task.created_at || task.logged_at || task.actioned_at || new Date(0).toISOString(),
  };

  const openAdjustTimestampDialog = (target: AdjustTimestampTarget) => {
    setTimestampTarget(target);
    setAdjustTimestampOpen(true);
  };

  const handleAdjustTimestamp = async (nextTimestampIso: string) => {
    if (!task || !timestampTarget) {
      return;
    }

    const response = await fetch(
      `/api/workshop-tasks/tasks/${task.id}/timeline/${encodeURIComponent(timestampTarget.timelineItemId)}/timestamp`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemType: timestampTarget.itemType,
          timestamp: nextTimestampIso,
        }),
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to adjust timestamp.');
    }

    await Promise.all([
      onTaskUpdated?.(),
      refetch(),
    ]);

    setAttachmentsRefreshKey((currentKey) => currentKey + 1);
    toast.success(`${timestampTarget.label} timestamp updated`);
    setTimestampTarget(null);
  };

  const renderEditableTimestamp = (
    label: string,
    value: string | null,
    colorClass: string,
    timelineItemId: AdjustTimestampTarget['timelineItemId'],
    itemType: AdjustTimestampTarget['itemType']
  ) => {
    if (!value) {
      return <span className="ml-2 text-muted-foreground">Unknown</span>;
    }

    return (
      <button
        type="button"
        onClick={() => openAdjustTimestampDialog({
          itemType,
          timelineItemId,
          label,
          currentTimestamp: value,
        })}
        className={`ml-2 ${colorClass} underline underline-offset-2 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
      >
        {formatDate(value)}
      </button>
    );
  };

  const getVehicleDisplay = () => {
    const getAssetIdLabel = (asset?: { reg_number?: string | null; plant_id?: string | null }) => {
      if (!asset) return 'Unknown';
      if (asset.plant_id) {
        return asset.plant_id;
      }
      if (asset.reg_number) {
        return asset.reg_number;
      }
      return 'Unknown';
    };

    const getAssetDisplay = (asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null }) => {
      if (!asset) return 'Unknown';
      const idLabel = getAssetIdLabel(asset);
      if (asset.nickname) {
        return `${idLabel} (${asset.nickname})`;
      }
      return idLabel;
    };

    if (task.vans) {
      return getAssetDisplay(task.vans);
    } else if (task.hgvs) {
      return getAssetDisplay(task.hgvs);
    } else if (task.plant) {
      return getAssetDisplay(task.plant);
    }
    return 'Unknown Asset';
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: {
        label: 'Pending',
        className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      },
      logged: {
        label: 'In Progress',
        className: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      },
      on_hold: {
        label: 'On Hold',
        className: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      },
      completed: {
        label: 'Completed',
        className: 'bg-green-500/10 text-green-400 border-green-500/30',
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getTaskTypeIcon = () => {
    if (task.action_type === 'inspection_defect') {
      return <FileText className="h-5 w-5 text-blue-400" />;
    }
    return <Wrench className="h-5 w-5 text-workshop" />;
  };

  const getTaskTypeBadge = () => {
    if (task.action_type === 'inspection_defect') {
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
          Inspection Defect
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-workshop/10 text-workshop border-workshop/30">
        Workshop Task
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-3xl max-h-[90vh] overflow-y-auto border-border ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}>
        <DialogHeader>
          <div className="space-y-4">
            {/* Header with asset */}
            <div className="flex items-center gap-3">
              {getTaskTypeIcon()}
              <div>
                <DialogTitle className="text-2xl font-bold text-foreground">
                  {getVehicleDisplay()}
                </DialogTitle>
                {taskReference && (
                  <div className="mt-1 text-xs md:text-sm text-slate-500 dark:text-slate-400/80">
                    <span>{taskReference}</span>
                    {linkedInspectionHref && linkedInspectionReference && (
                      <>
                        <span>{' '}[linked inspection ID </span>
                        <Link
                          href={linkedInspectionHref}
                          className="text-blue-400/80 hover:text-blue-300/90 underline underline-offset-2"
                        >
                          {linkedInspectionReference}
                        </Link>
                        <span>]</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Badges row with status on the right */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {getTaskTypeBadge()}
                {categoryName && (
                  <Badge variant="outline" className="bg-workshop/10 text-workshop border-workshop/30">
                    {categoryName}
                  </Badge>
                )}
                {subcategoryName && (
                  <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                    {subcategoryName}
                  </Badge>
                )}
              </div>
              <div className="flex-shrink-0">
                {getStatusBadge(getTaskStatus(task))}
              </div>
            </div>

            {/* Task Description */}
            {inspectionDetails && (
              <Card className="bg-background/70 border-border">
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-foreground mb-2">Reported Defect</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {inspectionDetails}
                  </p>
                </CardContent>
              </Card>
            )}
            {workshopNotes && (
              <Card className="bg-background/70 border-border">
                <CardContent className="pt-4">
                  {inspectionDetails && (
                    <p className="text-sm font-medium text-foreground mb-2">Workshop Notes</p>
                  )}
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {workshopNotes}
                  </p>
                </CardContent>
              </Card>
            )}
            {task.action_type === 'inspection_defect' && inspectionPhotos.length > 0 && (
              <Card className="bg-background/70 border-border">
                <CardContent className="pt-4">
                  <InspectionPhotoGallery
                    photos={inspectionPhotos}
                    title="Defect Photos"
                    description="Uploaded photos linked to this inspection defect."
                  />
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className={`flex flex-wrap items-center ${tabletModeEnabled ? 'gap-3' : 'gap-2'}`}>
              {task.status === 'pending' && (
                <>
                  <Button
                    onClick={() => onMarkInProgress(task)}
                    disabled={isUpdating}
                    size="sm"
                    className={`bg-blue-600/80 hover:bg-blue-600 text-white border-0 ${taskActionButtonClass}`}
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Mark In Progress
                  </Button>
                  <Button
                    onClick={() => onMarkOnHold(task)}
                    disabled={isUpdating}
                    size="sm"
                    className={`bg-purple-600/80 hover:bg-purple-600 text-white border-0 ${taskActionButtonClass}`}
                  >
                    <Pause className="h-4 w-4 mr-2" />
                    Put On Hold
                  </Button>
                  <Button
                    onClick={() => onMarkComplete(task)}
                    disabled={isUpdating}
                    size="sm"
                    className={`bg-green-600 hover:bg-green-700 text-white border-0 ${taskActionButtonClass}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </>
              )}
              {(task.status === 'logged' || task.status === 'on_hold') && (
                <>
                  {task.status === 'logged' && (
                    <Button
                      onClick={() => onMarkOnHold(task)}
                      disabled={isUpdating}
                      size="sm"
                      className={`bg-purple-600/80 hover:bg-purple-600 text-white border-0 ${taskActionButtonClass}`}
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      Put On Hold
                    </Button>
                  )}
                  {task.status === 'on_hold' && (
                    <Button
                      onClick={() => onResume(task)}
                      disabled={isUpdating}
                      size="sm"
                      className={`bg-blue-600/80 hover:bg-blue-600 text-white border-0 ${taskActionButtonClass}`}
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      Resume
                    </Button>
                  )}
                  <Button
                    onClick={() => onMarkComplete(task)}
                    disabled={isUpdating}
                    size="sm"
                    className={`bg-green-600 hover:bg-green-700 text-white border-0 ${taskActionButtonClass}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </>
              )}
              {task.action_type === 'workshop_vehicle_task' && task.status !== 'completed' && (
                <>
                  <Button
                    onClick={() => onEdit(task)}
                    disabled={isUpdating}
                    size="sm"
                    variant="outline"
                    className={`border-foreground/40 text-foreground hover:text-foreground hover:bg-accent ${taskActionButtonClass}`}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    onClick={() => onDelete(task)}
                    disabled={isUpdating}
                    size="sm"
                    variant="outline"
                    className={`border-red-400/60 text-red-400 hover:text-red-300 hover:bg-red-500/10 ${taskActionButtonClass}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Attachments Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Attachments</h3>
          <TaskAttachmentsSection
            key={`${task.id}-${attachmentsRefreshKey}`}
            taskId={task.id}
            taskStatus={getTaskStatus(task)}
          />
        </div>

        {/* Timeline Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Activity Timeline</h3>
          
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full bg-muted" />
              ))}
            </div>
          ) : (
            <WorkshopTaskTimeline
              task={taskForTimeline}
              comments={taskComments[task.id] || []}
              onAdjustTimestamp={openAdjustTimestampDialog}
            />
          )}
        </div>

        {/* Task Metadata */}
        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created:</span>
              {renderEditableTimestamp('Created', task.created_at, 'text-muted-foreground', 'created', 'created')}
            </div>
            {task.logged_at && (
              <div>
                <span className="text-muted-foreground">Started:</span>
                {renderEditableTimestamp('Started', task.logged_at, 'text-blue-400', 'started', 'status_event')}
              </div>
            )}
            {task.actioned_at && (
              <div>
                <span className="text-muted-foreground">Completed:</span>
                {renderEditableTimestamp('Completed', task.actioned_at, 'text-green-400', 'completed', 'status_event')}
              </div>
            )}
          </div>
        </div>
        <AdjustTaskTimestampDialog
          open={adjustTimestampOpen}
          target={timestampTarget}
          onOpenChange={(nextOpen) => {
            setAdjustTimestampOpen(nextOpen);
            if (!nextOpen) {
              setTimestampTarget(null);
            }
          }}
          onConfirm={handleAdjustTimestamp}
        />
      </DialogContent>
    </Dialog>
  );
}
