'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import { 
  Camera,
  FileText, 
  Wrench, 
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { WorkshopTaskTimeline } from '@/components/workshop-tasks/WorkshopTaskTimeline';
import type { InspectionPhoto } from '@/types/inspection';

type WorkshopTaskComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: {
    id: string;
    full_name: string;
  } | null;
};

type WorkshopTaskData = {
  id: string;
  action_type: string;
  title: string;
  status: string;
  workshop_comments: string | null;
  created_at: string;
  logged_at: string | null;
  logged_comment: string | null;
  actioned_at: string | null;
  actioned_comment: string | null;
  status_history?: unknown[] | null;
  workshop_task_categories?: {
    id: string;
    name: string;
    slug: string | null;
    ui_color: string | null;
  } | null;
  workshop_task_subcategories?: {
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

interface WorkshopTaskHistoryCardProps {
  task: WorkshopTaskData;
  comments?: WorkshopTaskComment[];
  inspectionPhotos?: InspectionPhoto[];
  defaultExpanded?: boolean;
  onToggle?: (taskId: string, isExpanded: boolean) => void;
  actionButtons?: React.ReactNode;
}

const getStatusBadge = (status: string) => {
  const statusMap: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
    in_progress: { label: 'In Progress', className: 'bg-green-500/10 text-blue-300 border-blue-500/30' },
    logged: { label: 'In Progress', className: 'bg-green-500/10 text-blue-300 border-blue-500/30' },
    on_hold: { label: 'On Hold', className: 'bg-purple-500/10 text-purple-300 border-purple-500/30' },
    completed: { label: 'Completed', className: 'bg-green-500/10 text-green-300 border-green-500/30' },
  };
  const config = statusMap[status] || statusMap.pending;
  return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
};

export function WorkshopTaskHistoryCard({ 
  task, 
  comments = [], 
  inspectionPhotos = [],
  defaultExpanded = false,
  onToggle,
  actionButtons 
}: WorkshopTaskHistoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onToggle?.(task.id, newExpanded);
  };

  return (
    <Card 
      className="bg-muted/50 border-border border-l-4 border-l-orange-500 cursor-pointer hover:bg-slate-800/70 transition-colors"
      onClick={handleToggle}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Task type icon */}
              {task.action_type === 'inspection_defect' ? (
                <FileText className="h-5 w-5 text-blue-400" />
              ) : (
                <Wrench className="h-5 w-5 text-workshop" />
              )}
              {/* Category + Subcategory badges */}
              {(task.workshop_task_subcategories?.workshop_task_categories || task.workshop_task_categories) && (
                <Badge variant="outline" className="bg-workshop/10 text-workshop border-workshop/30">
                  {task.workshop_task_subcategories?.workshop_task_categories?.name || task.workshop_task_categories?.name}
                </Badge>
              )}
              {task.workshop_task_subcategories && (
                <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/30">
                  {task.workshop_task_subcategories.name}
                </Badge>
              )}
              {inspectionPhotos.length > 0 && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                  <Camera className="mr-1 h-3 w-3" />
                  {inspectionPhotos.length}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">{task.title}</p>
            {task.workshop_comments && (
              <p className="text-sm text-muted-foreground">{task.workshop_comments}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {getStatusBadge(task.status)}
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-4 pt-0" onClick={(e) => e.stopPropagation()}>
          {/* Action buttons if provided */}
          {actionButtons && (
            <div className="pb-4 border-b border-border">
              {actionButtons}
            </div>
          )}

          {task.action_type === 'inspection_defect' && inspectionPhotos.length > 0 && (
            <InspectionPhotoGallery
              photos={inspectionPhotos}
              title="Defect Photos"
              description="Uploaded photos linked to this inspection defect."
            />
          )}
          
          {/* Timeline */}
          <WorkshopTaskTimeline task={task} comments={comments} />
        </CardContent>
      )}
    </Card>
  );
}
