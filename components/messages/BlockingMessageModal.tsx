'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Loader2, AlertCircle, Maximize2, Timer } from 'lucide-react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import { isNetworkFetchError } from '@/lib/utils/http-error';
import { ToolboxTalkPdfDialog } from '@/components/messages/ToolboxTalkPdfDialog';

// Dynamically import PDF viewer component (client-side only)
const PDFViewer = dynamic(
  () => import('./PDFViewer').then((mod) => ({ default: mod.PDFViewer })),
  { 
    ssr: false,
    loading: () => <PanelLoader message="Preparing PDF viewer..." className="py-12" />
  }
);

const SignaturePad = dynamic(
  () => import('@/components/forms/SignaturePad').then((mod) => ({ default: mod.SignaturePad })),
  {
    ssr: false,
    loading: () => <PanelLoader message="Loading signature pad..." className="rounded-md border border-border py-8" />,
  }
);

interface BlockingMessageModalProps {
  open: boolean;
  message: {
    id: string;
    recipient_id: string;
    subject: string;
    body: string;
    priority?: 'LOW' | 'HIGH' | 'URGENT';
    acceptance_delay_minutes?: number;
    first_shown_at?: string | null;
    sender_name: string;
    created_at: string;
    pdf_file_path?: string | null;
  };
  onSigned: () => void;
  onDeferred?: () => void;
  totalPending: number;
  currentIndex: number;
}

export function BlockingMessageModal({
  open,
  message,
  onSigned,
  onDeferred,
  totalPending,
  currentIndex
}: BlockingMessageModalProps) {
  const [signing, setSigning] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
  const [shownAt, setShownAt] = useState<string | null>(message.first_shown_at ?? null);
  const [nowMs, setNowMs] = useState(Date.now());
  const priority = message.priority || 'HIGH';
  const isLowPriority = priority === 'LOW';
  const isUrgent = priority === 'URGENT';
  const acceptanceDelayMinutes = Math.max(0, message.acceptance_delay_minutes || 0);
  const signatureResetKey = `${message.id}:${message.recipient_id}`;

  // Set PDF URL if pdf_file_path exists
  useEffect(() => {
    setShownAt(message.first_shown_at ?? null);
    if (message.pdf_file_path) {
      // Use API route to serve PDF with authentication
      const url = `/api/toolbox-talk-pdf/${message.pdf_file_path}`;
      setPdfUrl(url);
    } else {
      setPdfUrl(null);
    }

    return () => {
      setPdfUrl(null);
    };
  }, [message.first_shown_at, message.pdf_file_path]);

  useEffect(() => {
    if (!open || !message.recipient_id) return;

    let cancelled = false;
    fetch(`/api/messages/${message.recipient_id}/shown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (response) => {
        const data = await response.json();
        if (!cancelled && response.ok && data.recipient?.first_shown_at) {
          setShownAt(data.recipient.first_shown_at);
        }
      })
      .catch(() => {
        if (!shownAt) {
          setShownAt(new Date().toISOString());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [message.recipient_id, open, shownAt]);

  useEffect(() => {
    if (!isUrgent || acceptanceDelayMinutes === 0) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [acceptanceDelayMinutes, isUrgent]);

  const elapsedSeconds = shownAt
    ? Math.max(0, Math.floor((nowMs - new Date(shownAt).getTime()) / 1000))
    : 0;
  const remainingSeconds = isUrgent
    ? Math.max(0, acceptanceDelayMinutes * 60 - elapsedSeconds)
    : 0;
  const isSignatureDelayed = isUrgent && remainingSeconds > 0;
  const countdownLabel = (() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  })();

  async function handleSign(signatureData: string) {
    if (isSignatureDelayed) {
      toast.error(`Signature can be submitted in ${countdownLabel}`);
      return;
    }

    setSigning(true);

    try {
      const response = await fetch(`/api/messages/${message.recipient_id}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          signature_data: signatureData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        // Treat "already signed" as success — modal should close gracefully
        if (data.error === 'This message has already been signed') {
          toast.info('This message has already been signed');
          onSigned();
          return;
        }
        throw new Error(data.error || 'Failed to sign message');
      }

      toast.success('Toolbox Talk signed successfully');
      onSigned();

    } catch (error) {
      if (isNetworkFetchError(error)) {
        const message = error instanceof Error ? error.message : 'network request failed';
        console.warn('Message signing skipped due transient network error:', message);
        toast.error('Network error - please check your connection and try again');
        return;
      }

      console.error('Error signing message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sign message');
    } finally {
      setSigning(false);
    }
  }

  async function handleReadLater() {
    if (!isLowPriority) return;

    setDeferring(true);
    try {
      const response = await fetch(`/api/messages/${message.recipient_id}/defer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to defer Toolbox Talk');
      }

      toast.success('Toolbox Talk moved to Notifications');
      onDeferred?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to defer Toolbox Talk');
    } finally {
      setDeferring(false);
    }
  }

  // This modal cannot be closed by user - they must sign
  return (
    <>
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border-red-600 dark:border-red-600 flex flex-col"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="space-y-1">
            <DialogTitle className={isUrgent ? 'text-lg text-red-600' : 'text-lg text-foreground'}>
              {isUrgent ? 'URGENT Toolbox Talk' : 'Toolbox Talk'} - {message.subject}
            </DialogTitle>
            {totalPending > 1 && (
              <DialogDescription className="text-xs text-muted-foreground">
                Message {currentIndex + 1} of {totalPending}
              </DialogDescription>
            )}
          </DialogHeader>

          {isUrgent && (
            <div className="mx-6 rounded-lg border border-red-600 bg-red-600 px-4 py-3 text-center font-black uppercase tracking-widest text-white">
              Urgent
            </div>
          )}

          {/* Warning - compact */}
          <div className="flex items-center gap-2 px-6 -mt-2 mb-2">
            {isUrgent ? (
              <Timer className="h-4 w-4 flex-shrink-0 text-red-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
            )}
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
              {isLowPriority
                ? 'Read now and sign, or move this to Notifications for later'
                : isSignatureDelayed
                  ? `Read time required before signing: ${countdownLabel}`
                  : 'Read and sign to continue'}
            </p>
          </div>

          <ScrollArea className="flex-1 px-6">
            <div className="pb-6 space-y-4">
              {/* Message Body - No border, no padding */}
              {message.body && (
                <div className="text-sm text-foreground whitespace-pre-wrap">
                  {message.body}
                </div>
              )}

              {/* PDF Viewer - Render each page separately */}
              {pdfUrl && <PDFViewer url={pdfUrl} />}

              {pdfUrl && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsPdfDialogOpen(true)}
                    className="gap-2"
                  >
                    <Maximize2 className="h-4 w-4" />
                    View PDF Full Screen
                  </Button>
                </div>
              )}

              {/* Signature Section - At the BOTTOM so users must scroll */}
              <div className="space-y-3 pt-4 border-t border-border">
                {isUrgent && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                    {isSignatureDelayed ? (
                      <>
                        <strong>URGENT:</strong> You must keep this message open for {acceptanceDelayMinutes} minute(s) before signing.
                        {` Signature can be submitted in ${countdownLabel}.`}
                      </>
                    ) : (
                      <>
                        <strong>URGENT:</strong> You can now sign and submit a signature.
                      </>
                    )}
                  </div>
                )}
                <label className="text-sm font-medium text-foreground">
                  Your Signature <span className="text-destructive">*</span>
                </label>

                <SignaturePad
                  onSave={handleSign}
                  onCancel={() => {}}
                  disabled={signing || isSignatureDelayed}
                  resetKey={signatureResetKey}
                  variant="toolbox-talk"
                />

                {isLowPriority && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleReadLater}
                      disabled={signing || deferring}
                    >
                      {deferring ? 'Moving...' : 'Read later from Notifications'}
                    </Button>
                  </div>
                )}

                {signing && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recording signature...
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <ToolboxTalkPdfDialog
        open={isPdfDialogOpen}
        onOpenChange={setIsPdfDialogOpen}
        url={pdfUrl}
        title={message.subject}
      />
    </>
  );
}

