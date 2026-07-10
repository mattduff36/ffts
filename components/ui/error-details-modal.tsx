'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { PanelLoader } from '@/components/ui/panel-loader';
import { AlertTriangle, ExternalLink, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { ErrorDetailsResponse, SubcategoryTaskItem, PendingTaskItem } from '@/types/error-details';
import Link from 'next/link';

interface ErrorDetailsModalProps {
  open: boolean;
  onClose: () => void;
  data: ErrorDetailsResponse | null;
  loading?: boolean;
  onAction?: (actionId: string) => void;
}

export function ErrorDetailsModal({
  open,
  onClose,
  data,
  loading = false,
  onAction
}: ErrorDetailsModalProps) {
  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto">
          <PanelLoader message="Loading details..." className="py-8" />
        </DialogContent>
      </Dialog>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-950 rounded">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg text-foreground">
                {data.summary.title}
              </DialogTitle>
              {data.summary.description && (
                <DialogDescription className="text-muted-foreground">
                  {data.summary.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-4">
          <div className="space-y-4">
            {/* Render items based on type */}
            {data.detailsType === 'subcategory-tasks' && (
              <SubcategoryTasksList items={data.items as SubcategoryTaskItem[]} />
            )}
            
            {data.detailsType === 'pending-tasks' && (
              <PendingTasksList items={data.items as PendingTaskItem[]} />
            )}

            {/* Resolution guide */}
            {data.resolutionGuide && data.resolutionGuide.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100 mb-2">
                  💡 How to Resolve
                </h4>
                <ul className="space-y-1.5">
                  {data.resolutionGuide.map((guide, idx) => (
                    <li key={idx} className="text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">•</span>
                      <span>{guide}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-border"
          >
            Close
          </Button>
          
          {data.actions?.map((action) => (
            <Button
              key={action.id}
              variant={action.type === 'destructive' ? 'destructive' : action.type === 'primary' ? 'default' : 'outline'}
              onClick={() => {
                if (action.requiresConfirmation) {
                  const confirmed = window.confirm(`Are you sure you want to ${action.label.toLowerCase()}?`);
                  if (!confirmed) return;
                }
                onAction?.(action.id);
              }}
            >
              {action.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Subcategory Tasks List
function SubcategoryTasksList({ items }: { items: SubcategoryTaskItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm text-foreground">
        Tasks Using This Subcategory ({items.length})
      </h4>
      <div className="space-y-2">
        {items.map((task) => (
          <div
            key={task.id}
            className="p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <StatusIcon status={task.status} />
                  <h5 className="font-medium text-sm text-foreground">{task.title}</h5>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {task.vehicle.reg_number}
                    {task.vehicle.nickname && ` (${task.vehicle.nickname})`}
                  </span>
                  <span>•</span>
                  <span>{new Date(task.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <Link
                href={task.url}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Pending Tasks List
function PendingTasksList({ items }: { items: PendingTaskItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No pending tasks found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm text-foreground">
        Pending Tasks ({items.length})
      </h4>
      <div className="space-y-2">
        {items.map((task) => (
          <div
            key={task.id}
            className="p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <StatusIcon status={task.status} />
                  <h5 className="font-medium text-sm text-foreground">{task.title}</h5>
                  {task.priority && (
                    <Badge variant={task.priority === 'high' ? 'destructive' : 'secondary'}>
                      {task.priority}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {task.assigned_to && (
                    <>
                      <span>Assigned to: {task.assigned_to.name}</span>
                      <span>•</span>
                    </>
                  )}
                  {task.due_date && (
                    <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Status Icon Component
function StatusIcon({ status }: { status: string }) {
  switch (status.toLowerCase()) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case 'pending':
    case 'logged':
      return <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
    case 'cancelled':
    case 'deleted':
      return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}
