'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { QuoteRamsActionListItemDto, QuoteRamsListResponse } from '@/types/quote-rams';
import { QuoteRamsActionPanel } from '@/app/(dashboard)/quotes/components/QuoteRamsActionPanel';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
] as const;

type RamsListFilter = (typeof FILTERS)[number]['id'];

export function QuoteRamsActionsPanel() {
  const [filter, setFilter] = useState<RamsListFilter>('open');
  const [actions, setActions] = useState<QuoteRamsActionListItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedReference, setSelectedReference] = useState<string | null>(null);

  const load = useCallback(async (status: RamsListFilter, isCurrent: () => boolean) => {
    setLoading(true);
    setAccessMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/quote-rams-actions?status=${status}`, { cache: 'no-store' });
      const body = await response.json().catch(() => null) as QuoteRamsListResponse | { error?: string } | null;
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403 || response.status === 428) {
        setActions([]);
        setAccessMessage(body && 'error' in body && body.error ? body.error : 'You do not have access to RAMS actions.');
        return;
      }
      if (!response.ok || !body || !('actions' in body) || !Array.isArray(body.actions)) {
        setActions([]);
        setError(body && 'error' in body && body.error ? body.error : 'Unable to load RAMS actions right now.');
        return;
      }
      setActions(body.actions);
    } catch {
      if (!isCurrent()) return;
      setActions([]);
      setError('Unable to load RAMS actions right now.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void load(filter, () => current);
    return () => {
      current = false;
    };
  }, [filter, load, refreshKey]);

  function refresh() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <section className="space-y-3" aria-label="Quote RAMS actions">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={filter === item.id ? 'default' : 'outline'}
            onClick={() => setFilter(item.id)}
            className={filter === item.id ? 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90' : 'border-slate-600 text-slate-100'}
          >
            {item.label}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading} className="border-slate-600 text-slate-100">
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">Quote RAMS assignments. These counts are separate from the fleet action totals above.</p>

      {accessMessage ? <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{accessMessage}</p> : null}
      {error ? <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p> : null}

      {!loading && !accessMessage && !error && actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No RAMS actions in this view.</p>
      ) : null}

      <ul className="space-y-2">
        {actions.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedQuoteId(item.quote_id);
                setSelectedReference(item.quote_reference);
              }}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-left text-sm text-slate-100 hover:border-slate-500"
            >
              <span className="font-medium">{item.quote_reference}</span>
              <span>{item.assignee_name?.trim() || 'Name not recorded'}</span>
              <span className="text-muted-foreground">{item.status} · {item.email_status}</span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={Boolean(selectedQuoteId)} onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedQuoteId(null); }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-slate-900 border-slate-700 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedReference || 'RAMS action'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Review the outstanding owner, email delivery, and linked RAMS document.
            </DialogDescription>
          </DialogHeader>
          {selectedQuoteId ? (
            <QuoteRamsActionPanel
              quoteId={selectedQuoteId}
              active
              onChanged={refresh}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
