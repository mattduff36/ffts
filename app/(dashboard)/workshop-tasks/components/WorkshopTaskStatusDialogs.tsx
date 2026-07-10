import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Clock, Pause } from 'lucide-react';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useWorkshopDraftPersistence } from '@/lib/hooks/useWorkshopDraftPersistence';
import type { Action } from '../types';

interface WorkshopTaskStatusDialogsProps {
  userId?: string | null;
  statusTask: Action | null;
  showStatusModal: boolean;
  onShowStatusModalChange: (open: boolean) => void;
  loggedComment: string;
  onLoggedCommentChange: (comment: string) => void;
  onCancelStatusModal: () => void;
  onConfirmMarkInProgress: () => void;
  showOnHoldModal: boolean;
  onShowOnHoldModalChange: (open: boolean) => void;
  onHoldComment: string;
  onOnHoldCommentChange: (comment: string) => void;
  onCancelOnHoldModal: () => void;
  onConfirmMarkOnHold: () => void;
  onHoldingTask: Action | null;
  showResumeModal: boolean;
  onShowResumeModalChange: (open: boolean) => void;
  resumeComment: string;
  onResumeCommentChange: (comment: string) => void;
  onCancelResumeModal: () => void;
  onConfirmResumeTask: () => void;
  resumingTask: Action | null;
  updatingStatus: Set<string>;
}

export function WorkshopTaskStatusDialogs({
  userId,
  statusTask,
  showStatusModal,
  onShowStatusModalChange,
  loggedComment,
  onLoggedCommentChange,
  onCancelStatusModal,
  onConfirmMarkInProgress,
  showOnHoldModal,
  onShowOnHoldModalChange,
  onHoldComment,
  onOnHoldCommentChange,
  onCancelOnHoldModal,
  onConfirmMarkOnHold,
  onHoldingTask,
  showResumeModal,
  onShowResumeModalChange,
  resumeComment,
  onResumeCommentChange,
  onCancelResumeModal,
  onConfirmResumeTask,
  resumingTask,
  updatingStatus,
}: WorkshopTaskStatusDialogsProps) {
  const { tabletModeEnabled } = useTabletMode();
  const statusDialogRef = useRef<HTMLDivElement>(null);
  const onHoldDialogRef = useRef<HTMLDivElement>(null);
  const resumeDialogRef = useRef<HTMLDivElement>(null);
  const isStatusDirty = loggedComment.trim().length > 0;
  const isOnHoldDirty = onHoldComment.trim().length > 0;
  const isResumeDirty = resumeComment.trim().length > 0;
  const { clearDraft: clearStatusDraft } = useWorkshopDraftPersistence({
    enabled: showStatusModal && Boolean(statusTask),
    draftId: `workshop-task-status:${userId || 'anonymous'}:${statusTask?.id || 'none'}`,
    kind: 'workshop-task-status',
    ownerId: userId,
    value: { loggedComment },
    isDirty: isStatusDirty,
    onRestore: (draft) => onLoggedCommentChange(draft.loggedComment || ''),
  });
  const { clearDraft: clearOnHoldDraft } = useWorkshopDraftPersistence({
    enabled: showOnHoldModal && Boolean(onHoldingTask),
    draftId: `workshop-task-on-hold:${userId || 'anonymous'}:${onHoldingTask?.id || 'none'}`,
    kind: 'workshop-task-on-hold',
    ownerId: userId,
    value: { onHoldComment },
    isDirty: isOnHoldDirty,
    onRestore: (draft) => onOnHoldCommentChange(draft.onHoldComment || ''),
  });
  const { clearDraft: clearResumeDraft } = useWorkshopDraftPersistence({
    enabled: showResumeModal && Boolean(resumingTask),
    draftId: `workshop-task-resume:${userId || 'anonymous'}:${resumingTask?.id || 'none'}`,
    kind: 'workshop-task-resume',
    ownerId: userId,
    value: { resumeComment },
    isDirty: isResumeDirty,
    onRestore: (draft) => onResumeCommentChange(draft.resumeComment || ''),
  });

  useEffect(() => {
    if (!showStatusModal && !isStatusDirty) void clearStatusDraft();
  }, [clearStatusDraft, isStatusDirty, showStatusModal]);

  useEffect(() => {
    if (!showOnHoldModal && !isOnHoldDirty) void clearOnHoldDraft();
  }, [clearOnHoldDraft, isOnHoldDirty, showOnHoldModal]);

  useEffect(() => {
    if (!showResumeModal && !isResumeDirty) void clearResumeDraft();
  }, [clearResumeDraft, isResumeDirty, showResumeModal]);

  return (
    <>
      <Dialog
        open={showStatusModal}
        onOpenChange={(open) => {
          if (!open && isStatusDirty) {
            triggerShakeAnimation(statusDialogRef.current);
            return;
          }
          onShowStatusModalChange(open);
        }}
      >
        <DialogContent
          ref={statusDialogRef}
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
          onInteractOutside={(event) => {
            if (isStatusDirty) {
              event.preventDefault();
              triggerShakeAnimation(statusDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isStatusDirty) {
              event.preventDefault();
              triggerShakeAnimation(statusDialogRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Mark Task In Progress</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a short note about starting this work
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                This task will be marked as &quot;In Progress&quot; and visible in the workshop queue.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logged-comment" className="text-foreground">
                Progress Note <span className="text-muted-foreground">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="logged-comment"
                value={loggedComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    onLoggedCommentChange(e.target.value);
                  }
                }}
                placeholder="e.g., Started work on brakes"
              className={`bg-white dark:bg-slate-800 border-border text-foreground ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {loggedComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void clearStatusDraft();
                onCancelStatusModal();
              }}
              className={`border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {isStatusDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={onConfirmMarkInProgress}
              disabled={!loggedComment.trim() || loggedComment.length > 300}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Clock className="h-4 w-4 mr-2" />
              Mark In Progress
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showOnHoldModal}
        onOpenChange={(open) => {
          if (!open && isOnHoldDirty) {
            triggerShakeAnimation(onHoldDialogRef.current);
            return;
          }
          onShowOnHoldModalChange(open);
        }}
      >
        <DialogContent
          ref={onHoldDialogRef}
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
          onInteractOutside={(event) => {
            if (isOnHoldDirty) {
              event.preventDefault();
              triggerShakeAnimation(onHoldDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isOnHoldDirty) {
              event.preventDefault();
              triggerShakeAnimation(onHoldDialogRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Put Task On Hold</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a note about why this task is being paused
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <p className="text-sm text-purple-300">
                This task will be marked as &quot;On Hold&quot; and can be resumed later. On hold tasks will still appear in driver inspections.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onhold-comment" className="text-foreground">
                On Hold Reason <span className="text-muted-foreground">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="onhold-comment"
                value={onHoldComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    onOnHoldCommentChange(e.target.value);
                  }
                }}
                placeholder="e.g., Awaiting parts delivery, Waiting for customer approval"
                className={`bg-white dark:bg-slate-800 border-border text-foreground min-h-[80px] ${tabletModeEnabled ? 'text-base' : ''}`}
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {onHoldComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void clearOnHoldDraft();
                onCancelOnHoldModal();
              }}
              disabled={onHoldingTask ? updatingStatus.has(onHoldingTask.id) : false}
              className={`border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {isOnHoldDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={onConfirmMarkOnHold}
              disabled={
                !onHoldComment.trim() ||
                onHoldComment.length > 300 ||
                (onHoldingTask ? updatingStatus.has(onHoldingTask.id) : false)
              }
              className={`bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Pause className="h-4 w-4 mr-2" />
              Put On Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showResumeModal}
        onOpenChange={(open) => {
          if (!open && isResumeDirty) {
            triggerShakeAnimation(resumeDialogRef.current);
            return;
          }
          onShowResumeModalChange(open);
        }}
      >
        <DialogContent
          ref={resumeDialogRef}
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
          onInteractOutside={(event) => {
            if (isResumeDirty) {
              event.preventDefault();
              triggerShakeAnimation(resumeDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isResumeDirty) {
              event.preventDefault();
              triggerShakeAnimation(resumeDialogRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Resume Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a note about resuming work on this task
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                This task will be moved back to &quot;In Progress&quot; and work can continue.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resume-comment" className="text-foreground">
                Resume Note <span className="text-muted-foreground">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="resume-comment"
                value={resumeComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    onResumeCommentChange(e.target.value);
                  }
                }}
                placeholder="e.g., Parts arrived, ready to continue work"
                className={`bg-white dark:bg-slate-800 border-border text-foreground min-h-[80px] ${tabletModeEnabled ? 'text-base' : ''}`}
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {resumeComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void clearResumeDraft();
                onCancelResumeModal();
              }}
              disabled={resumingTask ? updatingStatus.has(resumingTask.id) : false}
              className={`border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {isResumeDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={onConfirmResumeTask}
              disabled={
                !resumeComment.trim() ||
                resumeComment.length > 300 ||
                (resumingTask ? updatingStatus.has(resumingTask.id) : false)
              }
              className={`bg-workshop hover:bg-workshop-dark text-white disabled:opacity-50 disabled:cursor-not-allowed ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Clock className="h-4 w-4 mr-2" />
              Resume Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
