'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  QuoteRamsEligibleManagerDto,
  QuoteRamsErrorBody,
  QuoteRamsMutationResponse,
} from '@/types/quote-rams';

export interface QuoteMarkAsAcceptedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId?: string | null;
  actionLoading?: boolean;
  onAcceptWithoutRams: () => void | Promise<void>;
  onAcceptWithRams?: (managerProfileId: string | null) => Promise<void>;
  onRamsAccepted?: (result: QuoteRamsMutationResponse) => void;
}

function managerLabel(manager: QuoteRamsEligibleManagerDto) {
  const name = manager.full_name?.trim();
  return name || manager.initials;
}

export function QuoteMarkAsAcceptedDialog({
  open,
  onOpenChange,
  quoteId = null,
  actionLoading = false,
  onAcceptWithoutRams,
  onAcceptWithRams,
  onRamsAccepted,
}: QuoteMarkAsAcceptedDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [needsManager, setNeedsManager] = useState(false);
  const [managers, setManagers] = useState<QuoteRamsEligibleManagerDto[]>([]);
  const [managerId, setManagerId] = useState('');
  const busyRef = useRef(false);
  const requestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current += 1;
    return () => { requestGeneration.current += 1; };
  }, [open, quoteId]);

  useEffect(() => {
    if (open) return;
    busyRef.current = false;
    setBusy(false);
    setError(null);
    setWarning(null);
    setNeedsManager(false);
    setManagers([]);
    setManagerId('');
  }, [open]);

  useEffect(() => {
    setError(null);
    setWarning(null);
    setNeedsManager(false);
    setManagers([]);
    setManagerId('');
  }, [quoteId]);

  function closeQuestion() {
    if (actionLoading || busyRef.current) return;
    onOpenChange(false);
  }

  async function handleYes() {
    if (!open || actionLoading || busyRef.current) return;
    if (needsManager && !managerId) {
      setError('Select an active quote manager.');
      return;
    }

    const generation = requestGeneration.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setWarning(null);
    const selectedManagerId = needsManager ? managerId : null;

    try {
      if (onAcceptWithRams) {
        await onAcceptWithRams(selectedManagerId);
        return;
      }

      if (!quoteId) {
        setError('Choose a quote before accepting with RAMS.');
        return;
      }

      const response = await fetch(`/api/quotes/${quoteId}/rams-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          action: 'accept',
          ...(selectedManagerId ? { manager_profile_id: selectedManagerId } : {}),
        }),
      });
      const body = await response.json().catch(() => null) as QuoteRamsMutationResponse | QuoteRamsErrorBody | null;

      if (generation !== requestGeneration.current) return;
      if (response.status === 400 && body && 'code' in body && body.code === 'manager_required') {
        setNeedsManager(true);
        setManagers(Array.isArray(body.eligible_managers) ? body.eligible_managers : []);
        setError(body.error || 'Select an active quote manager.');
        return;
      }

      if (!response.ok || !body || !('action' in body)) {
        setError(body && 'error' in body && body.error ? body.error : 'Unable to accept this quote right now.');
        return;
      }

      if (body.email_warning) setWarning(body.email_warning);
      onRamsAccepted?.(body);
    } catch {
      if (generation !== requestGeneration.current) return;
      setError('Unable to accept this quote right now.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleNo() {
    if (actionLoading || busyRef.current) return;
    await onAcceptWithoutRams();
  }

  const locked = actionLoading || busy;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeQuestion(); }}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>Are RAMS required for this job?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Yes accepts the quote now and leaves an outstanding RAMS action. The quote manager is assigned when they are active; otherwise choose a manager. No marks the quote accepted without RAMS.
          </DialogDescription>
        </DialogHeader>

        {needsManager ? (
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Quote manager</span>
            <select
              aria-label="Quote manager"
              value={managerId}
              disabled={locked}
              onChange={(event) => setManagerId(event.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white"
            >
              <option value="">Select a manager</option>
              {managers.map((manager) => (
                <option key={manager.profile_id} value={manager.profile_id}>
                  {managerLabel(manager)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        ) : null}
        {warning ? (
          <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Quote accepted. {warning}
          </p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={closeQuestion}
            disabled={locked}
            className="border-slate-600 text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleYes()}
            disabled={locked}
            className="border-slate-600 text-slate-100"
          >
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Accepting...</> : needsManager ? 'Assign and accept' : 'Yes'}
          </Button>
          <Button
            type="button"
            onClick={() => void handleNo()}
            disabled={locked}
            className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
          >
            {actionLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'No'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
