'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/hooks/useAuth';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { extractSuggestionTitleFromNotificationBody, parseSuggestionIdFromCreatedVia } from '@/lib/utils/suggestion-notifications';
import { SUGGESTION_STATUS_COLORS, SUGGESTION_STATUS_LABELS, type SubmitterSuggestion, type SuggestionUpdateWithUser } from '@/types/faq';
import { Bell, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { templateConfig } from '@/lib/config/template-config';

interface ReminderModalProps {
  open: boolean;
  onClose: () => void;
  message: {
    id: string;
    recipient_id: string;
    created_via?: string | null;
    subject: string;
    body: string;
    sender_name: string;
    created_at: string;
  };
  onDismissed: () => void;
}

interface SuggestionThreadResponse {
  success?: boolean;
  suggestion?: SubmitterSuggestion & {
    user?: {
      full_name: string | null;
    } | null;
  };
  updates?: SuggestionUpdateWithUser[];
  error?: string;
}

interface SuggestionListResponse {
  success?: boolean;
  suggestions?: Array<Pick<SubmitterSuggestion, 'id' | 'title'>>;
}

export function ReminderModal({
  open,
  onClose,
  message,
  onDismissed
}: ReminderModalProps) {
  const { user } = useAuth();
  const hasDismissed = useRef(false);
  const [resolvedSuggestionId, setResolvedSuggestionId] = useState<string | null>(null);
  const [suggestionThread, setSuggestionThread] = useState<SuggestionThreadResponse['suggestion'] | null>(null);
  const [suggestionUpdates, setSuggestionUpdates] = useState<SuggestionUpdateWithUser[]>([]);
  const [loadingSuggestionThread, setLoadingSuggestionThread] = useState(false);
  const [suggestionThreadError, setSuggestionThreadError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const directSuggestionId = useMemo(
    () => parseSuggestionIdFromCreatedVia(message.created_via),
    [message.created_via]
  );
  const fallbackSuggestionTitle = useMemo(
    () => extractSuggestionTitleFromNotificationBody(message.body),
    [message.body]
  );
  const isSuggestionNotification = Boolean(
    directSuggestionId
    || fallbackSuggestionTitle
    || message.subject.toLowerCase().startsWith('suggestion')
  );
  const canReplyToSuggestion = Boolean(
    resolvedSuggestionId
    && suggestionThread
    && user?.id
    && suggestionThread.created_by === user.id
  );

  useEffect(() => {
    hasDismissed.current = false;
  }, [message.recipient_id]);

  const fetchSuggestionThread = useCallback(async (suggestionId: string) => {
    const response = await fetch(`/api/suggestions/${suggestionId}`, { cache: 'no-store' });
    const data = await response.json() as SuggestionThreadResponse;
    if (!response.ok || !data.success || !data.suggestion) {
      throw new Error(data.error || 'Failed to load suggestion thread');
    }

    setResolvedSuggestionId(suggestionId);
    setSuggestionThread(data.suggestion);
    setSuggestionUpdates(data.updates || []);
    setSuggestionThreadError(null);
  }, []);

  const resolveSuggestionIdFromFallbackTitle = useCallback(async (title: string) => {
    const normalizedTitle = title.trim().toLowerCase();

    for (const endpoint of ['/api/suggestions?limit=200', '/api/management/suggestions?limit=200']) {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }

      const data = await response.json() as SuggestionListResponse;
      if (!data.success) {
        continue;
      }

      const match = (data.suggestions || []).find((suggestion) => suggestion.title.trim().toLowerCase() === normalizedTitle);
      if (match) {
        return match.id;
      }
    }

    return null;
  }, []);

  useEffect(() => {
    if (!open || !isSuggestionNotification) {
      if (!open) {
        setResolvedSuggestionId(null);
        setSuggestionThread(null);
        setSuggestionUpdates([]);
        setSuggestionThreadError(null);
        setReplyText('');
      }
      return;
    }

    let cancelled = false;

    async function loadSuggestionThread() {
      try {
        setLoadingSuggestionThread(true);
        setSuggestionThreadError(null);

        const suggestionId = directSuggestionId
          || (fallbackSuggestionTitle ? await resolveSuggestionIdFromFallbackTitle(fallbackSuggestionTitle) : null);

        if (!suggestionId) {
          if (!cancelled) {
            setResolvedSuggestionId(null);
            setSuggestionThread(null);
            setSuggestionUpdates([]);
            setSuggestionThreadError('This older notification could not be linked back to its original suggestion automatically.');
          }
          return;
        }

        if (!cancelled) {
          await fetchSuggestionThread(suggestionId);
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedSuggestionId(null);
          setSuggestionThread(null);
          setSuggestionUpdates([]);
          setSuggestionThreadError(error instanceof Error ? error.message : 'Failed to load suggestion thread');
        }
      } finally {
        if (!cancelled) {
          setLoadingSuggestionThread(false);
        }
      }
    }

    void loadSuggestionThread();

    return () => {
      cancelled = true;
    };
  }, [directSuggestionId, fallbackSuggestionTitle, fetchSuggestionThread, isSuggestionNotification, open, resolveSuggestionIdFromFallbackTitle]);

  // Auto-dismiss (mark as read) when the modal opens.
  // On success, dispatch event so Navbar badge updates immediately.
  useEffect(() => {
    if (!open || hasDismissed.current) return;
    hasDismissed.current = true;

    fetch(`/api/messages/${message.recipient_id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (res.ok) {
          window.dispatchEvent(new CustomEvent('notification-dismissed'));
        }
      })
      .catch(() => {
        // Silently fail — the notification stays unread and can be retried next time
      });
  }, [open, message.recipient_id]);

  // When the user closes the modal, notify the parent so it can refresh/advance
  function handleClose() {
    if (hasDismissed.current) {
      onDismissed();
    }
    onClose();
  }

  async function handleReplySubmit() {
    if (!resolvedSuggestionId || !replyText.trim()) {
      return;
    }

    try {
      setSubmittingReply(true);
      const response = await fetch(`/api/suggestions/${resolvedSuggestionId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: replyText.trim() }),
      });
      const data = await response.json() as { success?: boolean; error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send reply');
      }

      await fetchSuggestionThread(resolvedSuggestionId);
      setReplyText('');
      toast.success('Reply added to your suggestion');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded">
              <Bell className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg text-foreground">
                {message.subject}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                From: {message.sender_name} &middot; {new Date(message.created_at).toLocaleDateString()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Message Body */}
        <ScrollArea className="max-h-[30vh] w-full rounded-md border border-border p-4">
          <div className="text-sm text-foreground whitespace-pre-wrap">
            {message.body}
          </div>
        </ScrollArea>

        {isSuggestionNotification && (
          <div className="space-y-4">
            <div className="rounded-md border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Suggestion thread</p>
                  <p className="text-xs text-muted-foreground">
                    {canReplyToSuggestion
                      ? 'Add a reply here and it will be attached to the original suggestion.'
                      : 'Review the original suggestion and its reply history here.'}
                  </p>
                </div>
                {suggestionThread && (
                  <Badge className={`${SUGGESTION_STATUS_COLORS[suggestionThread.status]} text-white`}>
                    {SUGGESTION_STATUS_LABELS[suggestionThread.status]}
                  </Badge>
                )}
              </div>

              {loadingSuggestionThread ? (
                <PanelLoader message="Loading suggestion thread..." accent="reminders" className="py-6" />
              ) : suggestionThreadError ? (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200">
                  {suggestionThreadError}
                </div>
              ) : suggestionThread ? (
                <ScrollArea className="max-h-[28vh] pr-3">
                  <div className="space-y-3">
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800 border border-border p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        Original suggestion
                      </p>
                      <p className="font-medium text-foreground">{suggestionThread.title}</p>
                      <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                        {suggestionThread.body}
                      </p>
                    </div>

                    {suggestionUpdates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No replies yet.</p>
                    ) : suggestionUpdates.map((update) => {
                      const isUserReply = update.created_by === suggestionThread.created_by;
                      const statusChanged = Boolean(
                        update.old_status
                        && update.new_status
                        && update.old_status !== update.new_status
                      );

                      return (
                        <div
                          key={update.id}
                          className={`rounded-md border p-3 ${
                            isUserReply
                              ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900'
                              : 'bg-slate-50 border-border dark:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {isUserReply ? 'Your reply' : 'Template update'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(update.created_at).toLocaleString()}
                            </p>
                          </div>

                          {statusChanged && update.old_status && update.new_status && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Status: {SUGGESTION_STATUS_LABELS[update.old_status]} to {SUGGESTION_STATUS_LABELS[update.new_status]}
                            </p>
                          )}

                          {update.note && (
                            <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                              {update.note}
                            </p>
                          )}

                          <p className="mt-2 text-xs text-muted-foreground">
                            by {update.user?.full_name || (isUserReply ? 'You' : templateConfig.branding.appName)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : null}
            </div>

            {canReplyToSuggestion ? (
              <div className="space-y-2">
                <Label htmlFor="suggestion-reply">Reply</Label>
                <Textarea
                  id="suggestion-reply"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Add your reply or extra detail here..."
                  rows={4}
                  disabled={!resolvedSuggestionId || loadingSuggestionThread || submittingReply}
                />
              </div>
            ) : suggestionThread ? (
              <p className="text-xs text-muted-foreground">
                Replying is only available when the original suggestion submitter opens this notification.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {isSuggestionNotification && canReplyToSuggestion && (
            <Button
              onClick={() => void handleReplySubmit()}
              disabled={!replyText.trim() || loadingSuggestionThread || submittingReply}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              {submittingReply ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Reply
                </>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleClose}
            className="border-border text-muted-foreground hover:bg-accent"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
