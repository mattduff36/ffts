import type React from 'react';
import { toast } from 'sonner';
import {
  appendStatusHistory,
  buildStatusHistoryEvent,
  updateLatestInProgressStatusHistoryTimestamp,
} from '@/lib/utils/workshopTaskStatusHistory';
import { inferMaintenanceLink } from '@/lib/utils/workshopMaintenanceSync';
import type { CompletionData } from '@/components/workshop-tasks/MarkTaskCompleteDialog';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action } from '../types';

interface UseWorkshopTaskLifecycleActionsParams {
  supabase: SupabaseClient;
  userId: string | null | undefined;
  profileName: string | null | undefined;
  tasks: Action[];
  fetchTasks: () => Promise<void>;
  selectedTask: Action | null;
  loggedComment: string;
  onHoldingTask: Action | null;
  onHoldComment: string;
  resumingTask: Action | null;
  resumeComment: string;
  completingTask: Action | null;
  setUpdatingStatus: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowStatusModal: (open: boolean) => void;
  setSelectedTask: (task: Action | null) => void;
  setLoggedComment: (comment: string) => void;
  setShowOnHoldModal: (open: boolean) => void;
  setShowResumeModal: (open: boolean) => void;
  setShowCompleteModal: (open: boolean) => void;
  setCompletingTask: (task: Action | null) => void;
}

export function useWorkshopTaskLifecycleActions({
  supabase,
  userId,
  profileName,
  tasks,
  fetchTasks,
  selectedTask,
  loggedComment,
  onHoldingTask,
  onHoldComment,
  resumingTask,
  resumeComment,
  completingTask,
  setUpdatingStatus,
  setShowStatusModal,
  setSelectedTask,
  setLoggedComment,
  setShowOnHoldModal,
  setShowResumeModal,
  setShowCompleteModal,
  setCompletingTask,
}: UseWorkshopTaskLifecycleActionsParams) {
  const confirmMarkInProgress = async () => {
    if (!selectedTask) return;

    if (!loggedComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (loggedComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(selectedTask.id));

      const statusEvent = buildStatusHistoryEvent({
        status: 'logged',
        body: loggedComment.trim(),
        authorId: userId || null,
        authorName: profileName || null,
      });
      const nextHistory = appendStatusHistory(
        selectedTask.status_history,
        statusEvent
      );

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_comment: loggedComment.trim(),
          logged_at: new Date().toISOString(),
          logged_by: userId || null,
          status_history: nextHistory,
        })
        .eq('id', selectedTask.id);

      if (error) throw error;

      toast.success('Task marked as in progress');
      setShowStatusModal(false);
      setSelectedTask(null);
      setLoggedComment('');

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedTask.id);
        return newSet;
      });
    } catch (err) {
      console.error('Error updating status:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to update status');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedTask.id);
        return newSet;
      });
    }
  };

  const confirmMarkOnHold = async () => {
    if (!onHoldingTask) return;

    if (!onHoldComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (onHoldComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(onHoldingTask.id));

      const statusEvent = buildStatusHistoryEvent({
        status: 'on_hold',
        body: onHoldComment.trim(),
        authorId: userId || null,
        authorName: profileName || null,
      });
      const nextHistory = appendStatusHistory(
        onHoldingTask.status_history,
        statusEvent
      );

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'on_hold',
          logged_at: new Date().toISOString(),
          logged_by: userId || null,
          logged_comment: onHoldComment.trim(),
          status_history: nextHistory,
        })
        .eq('id', onHoldingTask.id);

      if (error) {
        console.error('Supabase error placing task on hold:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      toast.success('Task placed on hold');
      setShowOnHoldModal(false);
      await fetchTasks();
    } catch (error: unknown) {
      console.error('Error updating task:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update task');
    } finally {
      setUpdatingStatus(prev => {
        const next = new Set(prev);
        next.delete(onHoldingTask.id);
        return next;
      });
    }
  };

  const confirmResumeTask = async () => {
    if (!resumingTask) return;

    if (!resumeComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (resumeComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(resumingTask.id));

      const statusEvent = buildStatusHistoryEvent({
        status: 'resumed',
        body: resumeComment.trim(),
        authorId: userId || null,
        authorName: profileName || null,
      });
      const nextHistory = appendStatusHistory(
        resumingTask.status_history,
        statusEvent
      );

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_at: new Date().toISOString(),
          logged_by: userId || null,
          logged_comment: resumeComment.trim(),
          status_history: nextHistory,
        })
        .eq('id', resumingTask.id);

      if (error) {
        console.error('Supabase error resuming task:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      toast.success('Task resumed');
      setShowResumeModal(false);
      await fetchTasks();
    } catch (error: unknown) {
      console.error('Error resuming task:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to resume task');
    } finally {
      setUpdatingStatus(prev => {
        const next = new Set(prev);
        next.delete(resumingTask.id);
        return next;
      });
    }
  };

  const confirmMarkComplete = async (data: CompletionData) => {
    if (!completingTask) return false;

    const taskId = completingTask.id;
    const requiresIntermediateStep = completingTask.status === 'pending' || completingTask.status === 'on_hold';

    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const completedAt = new Date(data.completedAt);
      const completedAtIso = completedAt.toISOString();
      const createdAtIso = data.createdAt ? new Date(data.createdAt).toISOString() : undefined;
      const intermediateAtIso = data.intermediateAt
        ? new Date(data.intermediateAt).toISOString()
        : new Date(completedAt.getTime() - 1).toISOString();

      const { data: latestTask, error: fetchError } = await supabase
        .from('actions')
        .select('status_history')
        .eq('id', taskId)
        .single();

      if (fetchError) {
        console.error('Error fetching latest task state:', fetchError);
        throw fetchError;
      }

      let nextHistory = Array.isArray(latestTask.status_history)
        ? latestTask.status_history
        : [];

      if (requiresIntermediateStep) {
        const intermediateStatus =
          completingTask?.status === 'on_hold' ? 'resumed' : 'logged';
        const intermediateEvent = buildStatusHistoryEvent({
          status: intermediateStatus,
          body: data.intermediateComment,
          authorId: userId || null,
          authorName: profileName || null,
          createdAt: intermediateAtIso,
        });
        nextHistory = appendStatusHistory(nextHistory, intermediateEvent);

        const { error: intermediateError } = await supabase
          .from('actions')
          .update({
            ...(createdAtIso ? { created_at: createdAtIso } : {}),
            status: 'logged',
            logged_at: intermediateAtIso,
            logged_by: userId || null,
            logged_comment: data.intermediateComment,
            status_history: nextHistory,
          })
          .eq('id', taskId);

        if (intermediateError) {
          console.error('Error in intermediate step:', intermediateError);
          throw intermediateError;
        }
      } else if (data.intermediateAt) {
        nextHistory = updateLatestInProgressStatusHistoryTimestamp(
          nextHistory,
          intermediateAtIso
        );
      }

      const completeEvent = buildStatusHistoryEvent({
        status: 'completed',
        body: data.completedComment,
        authorId: userId || null,
        authorName: profileName || null,
        meta: data.completedSignatureData
          ? {
              signature_data: data.completedSignatureData,
              signed_at: completedAtIso,
            }
          : undefined,
        createdAt: completedAtIso,
      });
      nextHistory = appendStatusHistory(nextHistory, completeEvent);

      const { error } = await supabase
        .from('actions')
        .update({
          ...(createdAtIso ? { created_at: createdAtIso } : {}),
          ...(data.intermediateAt ? { logged_at: intermediateAtIso } : {}),
          status: 'completed',
          actioned: true,
          actioned_at: completedAtIso,
          actioned_by: userId || null,
          actioned_comment: data.completedComment,
          actioned_signature_data: data.completedSignatureData || null,
          actioned_signed_at: data.completedSignatureData ? completedAtIso : null,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) {
        console.error('Error completing task:', error);
        throw error;
      }

      const maintenanceAssetId =
        completingTask.van_id || completingTask.hgv_id || completingTask.plant_id;
      const assetType =
        completingTask.plant_id ? 'plant' : completingTask.hgv_id ? 'hgv' : 'van';
      const linkedMaintenance = inferMaintenanceLink({
        title: completingTask.title,
        description: completingTask.description,
        workshopCategoryName: completingTask.workshop_task_categories?.name,
        workshopSubcategoryName: completingTask.workshop_task_subcategories?.name,
      });

      if (maintenanceAssetId && (data.maintenanceUpdates || linkedMaintenance)) {
        try {
          const maintenanceResponse = await fetch(
            `/api/maintenance/by-vehicle/${maintenanceAssetId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...data.maintenanceUpdates,
                assetType,
                task_id: taskId,
                completed_at: completedAtIso,
                task_title: completingTask.title,
                task_description: completingTask.description,
                task_category_name: completingTask.workshop_task_categories?.name,
                task_subcategory_name: completingTask.workshop_task_subcategories?.name,
                comment: `Updated from workshop task completion: ${completingTask.title}`,
              }),
            }
          );

          if (!maintenanceResponse.ok) {
            const error = await maintenanceResponse.json();
            console.error('Failed to update maintenance:', error);
            toast.warning('Task completed but maintenance update failed');
          }
        } catch (maintError) {
          console.error('Error updating maintenance:', maintError);
          toast.warning('Task completed but maintenance update failed');
        }
      }

      toast.success('Task marked as complete');
      setShowCompleteModal(false);
      setCompletingTask(null);

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
      return true;
    } catch (err) {
      console.error('Error marking complete:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to mark complete');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
      return false;
    }
  };

  const handleUndoComplete = async (taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      const returnStatus = task?.logged_at ? 'logged' : 'pending';

      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: `Returned to ${returnStatus === 'logged' ? 'in progress' : 'pending'}`,
        authorId: userId || null,
        authorName: profileName || null,
        meta: { from: 'completed', to: returnStatus },
      });
      const nextHistory = appendStatusHistory(task?.status_history, statusEvent);

      const { error } = await supabase
        .from('actions')
        .update({
          status: returnStatus,
          actioned: false,
          actioned_at: null,
          actioned_by: null,
          actioned_signature_data: null,
          actioned_signed_at: null,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success(`Task returned to ${returnStatus === 'logged' ? 'in progress' : 'pending'}`);

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (err) {
      console.error('Error undoing complete:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to undo');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const handleUndoLogged = async (taskId: string) => {
    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const task = tasks.find(t => t.id === taskId);
      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: 'Returned to pending',
        authorId: userId || null,
        authorName: profileName || null,
        meta: { from: 'logged', to: 'pending' },
      });
      const nextHistory = appendStatusHistory(task?.status_history, statusEvent);

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_comment: null,
          logged_at: null,
          logged_by: null,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Task returned to pending');

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (err) {
      console.error('Error undoing logged:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to undo');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  return {
    confirmMarkInProgress,
    confirmMarkOnHold,
    confirmResumeTask,
    confirmMarkComplete,
    handleUndoComplete,
    handleUndoLogged,
  };
}
