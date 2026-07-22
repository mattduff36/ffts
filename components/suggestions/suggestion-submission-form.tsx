'use client';

import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SubmitterSuggestion } from '@/types/faq';

interface SuggestionSubmissionFormProps {
  idPrefix: string;
  onSubmitted?: (suggestion: SubmitterSuggestion) => Promise<void> | void;
  variant?: 'card' | 'dialog';
}

interface SuggestionSubmissionResponse {
  success?: boolean;
  suggestion?: SubmitterSuggestion;
  error?: string;
}

export function SuggestionSubmissionForm({
  idPrefix,
  onSubmitted,
  variant = 'card',
}: SuggestionSubmissionFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pageHint, setPageHint] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const isDialog = variant === 'dialog';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      setServerError('Please fill in both title and description.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setServerError(null);

    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          body: trimmedBody,
          page_hint: pageHint.trim() || undefined,
        }),
      });

      let data: SuggestionSubmissionResponse;
      try {
        data = await response.json() as SuggestionSubmissionResponse;
      } catch {
        throw new Error(`The server returned an invalid response (${response.status}).`);
      }

      if (!response.ok || !data.success || !data.suggestion) {
        throw new Error(data.error || `Failed to submit suggestion (${response.status}).`);
      }

      setTitle('');
      setBody('');
      setPageHint('');
      toast.success('Suggestion submitted successfully!');
      try {
        await onSubmitted?.(data.suggestion);
      } catch (refreshError) {
        const errorContextId = `${idPrefix}-refresh-error`;
        console.error('Suggestion submitted but list refresh failed:', refreshError, { errorContextId });
        toast.error('Suggestion submitted, but the list could not be refreshed.', {
          id: errorContextId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit suggestion.';
      const errorContextId = `${idPrefix}-submit-error`;
      console.error('Error submitting suggestion:', error, { errorContextId });
      setServerError(message);
      toast.error(message, { id: errorContextId });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {serverError ? (
        <Alert variant="destructive" data-testid={`${idPrefix}-server-error`}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Suggestion not submitted</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label
          htmlFor={`${idPrefix}-title`}
          className={isDialog ? 'text-slate-200' : undefined}
        >
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          id={`${idPrefix}-title`}
          placeholder="Brief title for your suggestion"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={isSubmitting}
          className={isDialog ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500' : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor={`${idPrefix}-body`}
          className={isDialog ? 'text-slate-200' : undefined}
        >
          Description <span className="text-red-500">*</span>
        </Label>
        <Textarea
          id={`${idPrefix}-body`}
          placeholder="Describe your suggestion in detail..."
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={isSubmitting}
          rows={5}
          className={isDialog ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500' : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor={`${idPrefix}-page`}
          className={isDialog ? 'text-slate-200' : undefined}
        >
          Related Page/Feature (optional)
        </Label>
        <Input
          id={`${idPrefix}-page`}
          placeholder="e.g., Timesheets, Inspections, Dashboard"
          value={pageHint}
          onChange={(event) => setPageHint(event.target.value)}
          disabled={isSubmitting}
          className={isDialog ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500' : undefined}
        />
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || !title.trim() || !body.trim()}
        className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            Submit Suggestion
          </>
        )}
      </Button>
    </form>
  );
}
