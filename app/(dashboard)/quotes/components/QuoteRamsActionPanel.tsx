'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/hooks/useAuth';
import type {
  QuoteRamsActionStatus,
  QuoteRamsContextResponse,
  QuoteRamsEligibleManagerDto,
  QuoteRamsEmailStatus,
  QuoteRamsErrorBody,
  QuoteRamsMutationResponse,
} from '@/types/quote-rams';

const STATUS_LABEL: Record<QuoteRamsActionStatus, string> = {
  open: 'Outstanding',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const EMAIL_LABEL: Record<QuoteRamsEmailStatus, string> = {
  pending: 'Email pending',
  sending: 'Email sending',
  sent: 'Email sent',
  failed: 'Email failed',
  uncertain: 'Email outcome uncertain',
};

function managerLabel(manager: QuoteRamsEligibleManagerDto) {
  return manager.full_name?.trim() || manager.initials;
}

export function QuoteRamsActionPanel({
  quoteId,
  active = true,
  onChanged,
}: {
  quoteId: string;
  active?: boolean;
  onChanged?: () => void;
}) {
  const { profile, isAdmin, isManager } = useAuth();
  const [context, setContext] = useState<QuoteRamsContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [note, setNote] = useState('');
  const [reassignId, setReassignId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<'complete' | 'reassign' | 'retry' | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => { setWarning(null); }, [quoteId]);

  useEffect(() => {
    if (!active || !quoteId) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setContext(null);
    setAccessMessage(null);
    setError(null);
    setDocumentId('');
    setNote('');
    setReassignId('');
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/quotes/${quoteId}/rams-action`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as QuoteRamsContextResponse | { error?: string } | null;
        if (requestId !== requestRef.current) return;
        if (response.status === 401 || response.status === 403 || response.status === 428) {
          setAccessMessage(body && 'error' in body && body.error ? body.error : 'You do not have access to quote RAMS actions.');
          return;
        }
        if (!response.ok || !body || !('eligible_managers' in body)) {
          setError(body && 'error' in body && body.error ? body.error : 'Unable to load the RAMS action right now.');
          return;
        }
        setContext(body);
      } catch (loadError) {
        if (requestId !== requestRef.current || (loadError instanceof Error && loadError.name === 'AbortError')) return;
        setError('Unable to load the RAMS action right now.');
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    })();

    return () => {
      requestRef.current += 1;
      controller.abort();
    };
  }, [active, quoteId, refreshKey]);

  async function mutate(action: 'complete' | 'reassign' | 'retry-email', payload: Record<string, string>) {
    if (!active || pendingRef.current) return;
    const requestId = requestRef.current;
    pendingRef.current = true;
    setPending(action === 'retry-email' ? 'retry' : action);
    setError(null);
    setWarning(null);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/rams-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => null) as QuoteRamsMutationResponse | QuoteRamsErrorBody | null;
      if (requestId !== requestRef.current) return;
      if (!response.ok || !body || !('action' in body)) {
        const fieldMessage = body && 'field_errors' in body ? body.field_errors?.rams_document_id || body.field_errors?.manager_profile_id : null;
        setError(fieldMessage || (body && 'error' in body && body.error ? body.error : 'Unable to update the RAMS action right now.'));
        return;
      }
      if (body.email_warning) setWarning(body.email_warning);
      setRefreshKey((current) => current + 1);
      onChanged?.();
    } catch {
      if (requestId !== requestRef.current) return;
      setError('Unable to update the RAMS action right now.');
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  function confirmComplete() {
    if (!documentId) {
      setError('Choose an active RAMS document linked to this quote.');
      return;
    }
    void mutate('complete', {
      rams_document_id: documentId,
      ...(note.trim() ? { confirmation_note: note.trim() } : {}),
    });
  }

  const action = context?.action ?? null;
  const canComplete = Boolean(
    action
    && action.status === 'open'
    && (isAdmin || (profile?.id && profile.id === action.assignee_profile_id))
  );
  const canReassign = Boolean(action && action.status === 'open' && (isManager || isAdmin));
  const emailBlocked = action?.email_status === 'sending' || action?.email_status === 'uncertain';
  const canRetry = Boolean(action && action.status === 'open' && (action.email_status === 'pending' || action.email_status === 'failed'));

  return (
    <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-sm" aria-label="RAMS action">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-white">RAMS action</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!active || loading || pending !== null}
          onClick={() => setRefreshKey((current) => current + 1)}
          className="border-slate-600 text-slate-100"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-muted-foreground">Loading RAMS action...</p> : null}
      {accessMessage ? (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
          {accessMessage}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-100">
          {error}
        </p>
      ) : null}
      {warning ? (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
          Saved. {warning}
        </p>
      ) : null}

      {!loading && !accessMessage && !error && context && !action ? (
        <p className="text-muted-foreground">No RAMS action is recorded for this quote.</p>
      ) : null}

      {action ? (
        <div className="space-y-1 text-slate-200">
          <p>{action.quote_reference} · {STATUS_LABEL[action.status]}</p>
          <p>Owner: {action.assignee_name?.trim() || 'Name not recorded'}</p>
          <p>{EMAIL_LABEL[action.email_status]}{action.email_error ? ` — ${action.email_error}` : ''}</p>
          {action.confirmation_note ? <p className="whitespace-pre-wrap text-slate-300">Note: {action.confirmation_note}</p> : null}
        </div>
      ) : null}

      {action && action.status !== 'open' ? (
        <p className="text-xs text-muted-foreground">This RAMS action is {STATUS_LABEL[action.status].toLowerCase()} and stays closed.</p>
      ) : null}

      {canComplete ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Linked RAMS document</span>
            <select
              aria-label="Linked RAMS document"
              value={documentId}
              disabled={pending !== null}
              onChange={(event) => setDocumentId(event.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white"
            >
              <option value="">Select a linked document</option>
              {(context?.linked_documents ?? []).map((document) => (
                <option key={document.id} value={document.id}>{document.title}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Confirmation note</span>
            <textarea
              aria-label="Confirmation note"
              value={note}
              maxLength={4000}
              disabled={pending !== null}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-16 w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending !== null}
              onClick={confirmComplete}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              {pending === 'complete' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm complete
            </Button>
            <Link href="/projects/manage" className="text-xs text-slate-300 underline">
              Upload in Projects
            </Link>
          </div>
        </div>
      ) : null}

      {action?.status === 'open' && !canComplete && !accessMessage ? (
        <p className="text-xs text-muted-foreground">Only the assigned manager or an admin can confirm completion.</p>
      ) : null}

      {canReassign ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 space-y-1">
            <span className="text-muted-foreground">Reassign to</span>
            <select
              aria-label="Reassign manager"
              value={reassignId}
              disabled={pending !== null || emailBlocked}
              onChange={(event) => setReassignId(event.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white"
            >
              <option value="">Select a manager</option>
              {(context?.eligible_managers ?? [])
                .filter((manager) => manager.profile_id !== action?.assignee_profile_id)
                .map((manager) => (
                  <option key={manager.profile_id} value={manager.profile_id}>{managerLabel(manager)}</option>
                ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null || emailBlocked || !reassignId}
            onClick={() => void mutate('reassign', { manager_profile_id: reassignId })}
            className="border-slate-600 text-slate-100"
          >
            {pending === 'reassign' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Reassign
          </Button>
          {emailBlocked ? <p className="w-full text-xs text-muted-foreground">Resolve the current email delivery before reassigning.</p> : null}
        </div>
      ) : null}

      {canRetry ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void mutate('retry-email', {})}
          className="border-slate-600 text-slate-100"
        >
          {pending === 'retry' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Retry email
        </Button>
      ) : null}
    </section>
  );
}
