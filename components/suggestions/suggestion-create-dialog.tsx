'use client';

import { Lightbulb } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { SuggestionSubmissionForm } from '@/components/suggestions/suggestion-submission-form';
import type { SubmitterSuggestion } from '@/types/faq';

interface SuggestionCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (suggestion: SubmitterSuggestion) => Promise<void> | void;
}

export function SuggestionCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: SuggestionCreateDialogProps) {
  async function handleSubmitted(suggestion: SubmitterSuggestion) {
    await onCreated(suggestion);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogContentViewportClassName({ size: 'lg' })}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Lightbulb className="h-5 w-5 text-brand-yellow" />
            Add suggestion
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            Submit an improvement idea using your account. It will appear in the management list after creation.
          </DialogDescription>
        </DialogHeader>

        <SuggestionSubmissionForm
          idPrefix="manage-suggestion"
          variant="dialog"
          onSubmitted={handleSubmitted}
        />
      </DialogContent>
    </Dialog>
  );
}
