import { useState, useEffect, useCallback } from 'react';
import { Database } from '@/types/database';
import type {
  AttachmentSchemaResponse,
  AttachmentSchemaSnapshot,
} from '@/types/workshop-attachments-v2';
import { createStatusError, getErrorStatus } from '@/lib/utils/http-error';

type TaskAttachment = Database['public']['Tables']['workshop_task_attachments']['Row'];
type AttachmentTemplate = Database['public']['Tables']['workshop_attachment_templates']['Row'];

interface ApiErrorResponse {
  error?: string;
}

export type TaskAttachmentWithDetails = TaskAttachment & {
  workshop_attachment_templates: AttachmentTemplate | null;
  schema_snapshot?: AttachmentSchemaSnapshot | null;
  field_responses?: AttachmentSchemaResponse[];
};

interface UseTaskAttachmentsOptions {
  taskId: string | null;
  enabled?: boolean;
}

interface UseTaskAttachmentsReturn {
  attachments: TaskAttachmentWithDetails[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  addAttachment: (templateId: string) => Promise<TaskAttachmentWithDetails | null>;
  saveSchemaResponses: (attachmentId: string, responses: AttachmentSchemaResponse[], markComplete?: boolean) => Promise<boolean>;
  undoCompleteAttachment: (attachmentId: string) => Promise<boolean>;
}

async function readJsonResponse<T extends object>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ApiErrorResponse;
  if (!response.ok) {
    throw createStatusError(data.error || fallbackMessage, response.status);
  }

  return data as T;
}

export function useTaskAttachments({ 
  taskId, 
  enabled = true 
}: UseTaskAttachmentsOptions): UseTaskAttachmentsReturn {
  const [attachments, setAttachments] = useState<TaskAttachmentWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mergeAttachment = useCallback((attachment: TaskAttachmentWithDetails) => {
    setAttachments((prev) => prev.map((entry) => (
      entry.id === attachment.id ? attachment : entry
    )));
  }, []);

  const fetchAttachments = useCallback(async () => {
    if (!enabled || !taskId) {
      setAttachments([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/workshop-tasks/attachments/task/${taskId}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const data = await readJsonResponse<{ attachments?: TaskAttachmentWithDetails[] }>(
        response,
        'Failed to fetch task attachments'
      );

      setAttachments((data.attachments || []) as TaskAttachmentWithDetails[]);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch attachments');
      setError(errorObj);
      console.error('Error fetching task attachments:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId, enabled]);

  const refreshAttachment = useCallback(async (attachmentId: string): Promise<TaskAttachmentWithDetails> => {
    const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}`, {
      method: 'GET',
      cache: 'no-store',
    });

    const data = await readJsonResponse<{ attachment: TaskAttachmentWithDetails }>(
      response,
      'Failed to refresh attachment'
    );

    const attachment = data.attachment as TaskAttachmentWithDetails;
    mergeAttachment(attachment);
    return attachment;
  }, [mergeAttachment]);

  const addAttachment = useCallback(async (templateId: string): Promise<TaskAttachmentWithDetails | null> => {
    if (!taskId) {
      return null;
    }

    try {
      const response = await fetch(`/api/workshop-tasks/attachments/task/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      });

      const data = await readJsonResponse<{ attachment: TaskAttachmentWithDetails }>(
        response,
        'Failed to add attachment'
      );

      // Refetch to get updated list
      await fetchAttachments();
      
      return data.attachment;
    } catch (err) {
      console.error('Error adding attachment:', err);
      throw err;
    }
  }, [taskId, fetchAttachments]);

  const saveSchemaResponses = useCallback(async (
    attachmentId: string,
    responses: AttachmentSchemaResponse[],
    markComplete: boolean = false,
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, mark_complete: markComplete }),
      });

      await readJsonResponse<ApiErrorResponse>(
        response,
        'Failed to save schema responses'
      );

      await refreshAttachment(attachmentId);
      return true;
    } catch (err) {
      const status = getErrorStatus(err);
      if (status === 404) {
        await fetchAttachments();
        console.warn('Attachment no longer exists while saving schema responses:', err);
        throw err;
      }
      if (status === 409) {
        console.warn('Attachment cannot be edited in its current state:', err);
        throw err;
      }

      console.error('Error saving schema responses:', err);
      throw err;
    }
  }, [fetchAttachments, refreshAttachment]);

  const undoCompleteAttachment = useCallback(async (attachmentId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/undo-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      await readJsonResponse<ApiErrorResponse>(
        response,
        'Failed to undo attachment completion'
      );

      await refreshAttachment(attachmentId);
      return true;
    } catch (err) {
      console.error('Error undoing attachment completion:', err);
      throw err;
    }
  }, [refreshAttachment]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  return {
    attachments,
    loading,
    error,
    refetch: fetchAttachments,
    addAttachment,
    saveSchemaResponses,
    undoCompleteAttachment,
  };
}
