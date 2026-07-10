'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Plus, Check, Clock, ChevronRight, Download, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskAttachments, TaskAttachmentWithDetails } from '@/lib/hooks/useTaskAttachments';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';
import { AttachmentHybridFormModal } from './AttachmentHybridFormModal';
import { formatDate } from '@/lib/utils/date';
import type { AttachmentSchemaResponse } from '@/types/workshop-attachments-v2';
import {
  canUndoAttachmentCompletion,
  formatAttachmentUndoRemaining,
} from '@/lib/workshop-attachments/completion-window';

interface TaskAttachmentsSectionProps {
  taskId: string;
  taskStatus: string;
  onUpdate?: () => void;
}

export function TaskAttachmentsSection({ taskId, taskStatus, onUpdate }: TaskAttachmentsSectionProps) {
  const { attachments, loading, addAttachment, saveSchemaResponses, undoCompleteAttachment } = useTaskAttachments({ taskId });
  const { templates } = useAttachmentTemplates();
  
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const [undoingAttachmentId, setUndoingAttachmentId] = useState<string | null>(null);
  const [activeSectionKeyByAttachmentId, setActiveSectionKeyByAttachmentId] = useState<Record<string, string>>({});
  const [scrollTopByAttachmentId, setScrollTopByAttachmentId] = useState<Record<string, number>>({});

  const isTaskCompleted = taskStatus === 'completed';
  const activeAttachment = useMemo(
    () => attachments.find((attachment) => attachment.id === activeAttachmentId) || null,
    [activeAttachmentId, attachments],
  );

  useEffect(() => {
    if (activeAttachmentId && !activeAttachment) {
      setShowForm(false);
      setActiveAttachmentId(null);
    }
  }, [activeAttachment, activeAttachmentId]);

  // Filter out templates that are already attached
  const attachedTemplateIds = attachments.map(a => a.template_id);
  const availableTemplates = templates.filter(t => !attachedTemplateIds.includes(t.id));

  const handleAddAttachment = async () => {
    if (!selectedTemplateId) {
      toast.error('Please select a template');
      return;
    }

    setAdding(true);
    try {
      await addAttachment(selectedTemplateId);
      setSelectedTemplateId('');
      toast.success('Attachment added');
      onUpdate?.();
    } catch {
      toast.error('Failed to add attachment');
    } finally {
      setAdding(false);
    }
  };

  const handleOpenForm = (attachment: TaskAttachmentWithDetails) => {
    if (!attachment.schema_snapshot?.snapshot_json?.sections?.length) {
      toast.error('This attachment is missing a V2 schema snapshot.');
      return;
    }
    setActiveAttachmentId(attachment.id);
    setShowForm(true);
  };

  const handleFormOpenChange = (open: boolean) => {
    setShowForm(open);
    if (!open) {
      setActiveAttachmentId(null);
    }
  };

  const handleActiveSectionChange = useCallback((sectionKey: string) => {
    if (!activeAttachmentId) return;
    setActiveSectionKeyByAttachmentId((prev) => {
      if (prev[activeAttachmentId] === sectionKey) return prev;
      return {
        ...prev,
        [activeAttachmentId]: sectionKey,
      };
    });
  }, [activeAttachmentId]);

  const handleScrollPositionChange = useCallback((scrollTop: number) => {
    if (!activeAttachmentId) return;
    setScrollTopByAttachmentId((prev) => {
      if (prev[activeAttachmentId] === scrollTop) return prev;
      return {
        ...prev,
        [activeAttachmentId]: scrollTop,
      };
    });
  }, [activeAttachmentId]);

  const handleSaveSchemaResponses = async (
    responses: AttachmentSchemaResponse[],
    markComplete: boolean,
  ) => {
    if (!activeAttachment) return;
    await saveSchemaResponses(activeAttachment.id, responses, markComplete);
    onUpdate?.();
  };

  const handleUndoComplete = async (attachment: TaskAttachmentWithDetails) => {
    setUndoingAttachmentId(attachment.id);
    try {
      await undoCompleteAttachment(attachment.id);
      toast.success('Attachment moved back to draft');
      onUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to undo attachment completion');
    } finally {
      setUndoingAttachmentId(null);
    }
  };

  const handleDownloadPdf = async (attachment: TaskAttachmentWithDetails) => {
    if (!attachment.schema_snapshot?.snapshot_json?.sections?.length) {
      toast.error('This attachment is missing a V2 schema snapshot.');
      return;
    }

    setDownloadingAttachmentId(attachment.id);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachment.id}/pdf`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const templateName = attachment.workshop_attachment_templates?.name || 'attachment';
      a.href = url;
      a.download = `${templateName.replace(/[^a-z0-9]/gi, '_')}_attachment.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (error) {
      console.error('Error downloading attachment PDF:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to download PDF');
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const getSchemaCompletionProgress = (attachment: TaskAttachmentWithDetails) => {
    const snapshot = attachment.schema_snapshot?.snapshot_json;
    const fieldResponses = attachment.field_responses || [];

    if (!snapshot?.sections || snapshot.sections.length === 0) {
      return null;
    }

    const fields = snapshot.sections.flatMap((section) => section.fields.map((field) => ({
      section_key: section.section_key,
      field,
    })));
    const total = fields.length;
    if (total === 0) return { completed: 0, total: 0, percentage: 100 };

    const map = new Map(
      fieldResponses.map((response) => [
        `${response.section_key}::${response.field_key}`,
        response,
      ]),
    );

    const completed = fields.filter(({ section_key, field }) => {
      const response = map.get(`${section_key}::${field.field_key}`);
      if (!response) return false;
      if (field.field_type === 'signature') {
        const responseJson = response.response_json || {};
        const signedAt = typeof responseJson.signed_at === 'string' ? responseJson.signed_at.trim() : '';
        return Boolean(responseJson.data_url) && Boolean(responseJson.signed_by_name) && signedAt.length > 0;
      }
      const responseValue = (response.response_value || '').trim();
      return responseValue.length > 0;
    }).length;

    return {
      completed,
      total,
      percentage: Math.round((completed / total) * 100),
    };
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-workshop/20 bg-workshop/5 p-3">
      {/* Existing Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => {
            const schemaProgress = getSchemaCompletionProgress(attachment);
            const progress = schemaProgress || { completed: 0, total: 0, percentage: 0 };
            const templateName = attachment.workshop_attachment_templates?.name || 'Unknown Template';
            const hasSchemaSnapshot = Boolean(attachment.schema_snapshot?.snapshot_json?.sections?.length);
            const canUndoComplete = !isTaskCompleted && attachment.status === 'completed'
              && canUndoAttachmentCompletion(attachment.completed_at);
            const undoLabel = formatAttachmentUndoRemaining(attachment.completed_at);

            return (
              <Card
                key={attachment.id}
                className={`cursor-pointer hover:border-workshop/50 transition-colors ${
                  attachment.status === 'completed'
                    ? 'bg-green-50/70 dark:bg-green-950/20 border-green-300 dark:border-green-800 shadow-sm'
                    : 'bg-background/90 border-workshop/20 shadow-sm hover:shadow-md'
                }`}
                onClick={() => handleOpenForm(attachment)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className={`h-5 w-5 ${
                        attachment.status === 'completed'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-workshop'
                      }`} />
                      <div>
                        <p className="font-medium text-foreground">{templateName}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{progress.completed}/{progress.total} items</span>
                          {attachment.status === 'completed' && attachment.completed_at && (
                            <>
                              <span>•</span>
                              <span>Completed {formatDate(attachment.completed_at)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canUndoComplete && (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleUndoComplete(attachment);
                          }}
                          disabled={undoingAttachmentId === attachment.id}
                          className="h-8 px-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
                          title={undoLabel ? `Undo available for ${undoLabel}` : 'Undo attachment completion'}
                        >
                          {undoingAttachmentId === attachment.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownloadPdf(attachment);
                        }}
                        disabled={downloadingAttachmentId === attachment.id || !hasSchemaSnapshot}
                        className="h-8 px-2"
                        title={hasSchemaSnapshot ? 'Download attachment PDF' : 'This attachment is missing a V2 schema snapshot'}
                      >
                        {downloadingAttachmentId === attachment.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {attachment.status === 'completed' ? (
                        <Badge className="bg-green-600 text-white">
                          <Check className="h-3 w-3 mr-1" />
                          Complete
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                          <Clock className="h-3 w-3 mr-1" />
                          {progress.percentage}%
                        </Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Attachment */}
      {!isTaskCompleted && availableTemplates.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-workshop/25 bg-background/90 p-2 shadow-sm">
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select an attachment template" />
            </SelectTrigger>
            <SelectContent>
              {availableTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleAddAttachment}
            disabled={adding || !selectedTemplateId}
            size="sm"
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            {adding ? 'Adding...' : 'Add'}
          </Button>
        </div>
      )}

      {/* Empty State */}
      {attachments.length === 0 && availableTemplates.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No attachment templates available
        </p>
      )}

      {attachments.length === 0 && availableTemplates.length > 0 && !isTaskCompleted && (
        <p className="text-sm text-muted-foreground text-center py-2">
          Add service checklists or documentation to this task
        </p>
      )}

      {/* Attachment Form Modal */}
      {activeAttachment && activeAttachment.schema_snapshot?.snapshot_json?.sections?.length && (
            <AttachmentHybridFormModal
              open={showForm}
              onOpenChange={handleFormOpenChange}
              templateName={activeAttachment.workshop_attachment_templates?.name || 'Attachment'}
              snapshot={activeAttachment.schema_snapshot}
              existingResponses={activeAttachment.field_responses || []}
              onSave={handleSaveSchemaResponses}
              readOnly={isTaskCompleted || activeAttachment.status === 'completed'}
              isCompleted={activeAttachment.status === 'completed'}
              attachmentId={activeAttachment.id}
              initialActiveSectionKey={activeSectionKeyByAttachmentId[activeAttachment.id]}
              initialScrollTop={scrollTopByAttachmentId[activeAttachment.id] || 0}
              onActiveSectionChange={handleActiveSectionChange}
              onScrollPositionChange={handleScrollPositionChange}
              canUndoComplete={!isTaskCompleted && activeAttachment.status === 'completed' && canUndoAttachmentCompletion(activeAttachment.completed_at)}
              undoCompleteLabel={formatAttachmentUndoRemaining(activeAttachment.completed_at)}
              onUndoComplete={() => handleUndoComplete(activeAttachment)}
              undoingComplete={undoingAttachmentId === activeAttachment.id}
            />
      )}
    </div>
  );
}
