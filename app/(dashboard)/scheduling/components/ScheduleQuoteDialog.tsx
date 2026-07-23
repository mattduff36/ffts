'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  fetchScheduleQuoteCandidates,
  saveQuoteSchedule,
} from '@/lib/client/scheduling';
import { cn } from '@/lib/utils/cn';
import type { ScheduleJob, ScheduleQuoteCandidate } from '@/types/scheduling';

interface ScheduleQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob | null;
  defaultDate: string;
  onSaved: () => void;
}

function formatStatus(status: string | null): string {
  if (!status) return 'No status';
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export function ScheduleQuoteDialog({
  open,
  onOpenChange,
  job,
  defaultDate,
  onSaved,
}: ScheduleQuoteDialogProps) {
  const [quotes, setQuotes] = useState<ScheduleQuoteCandidate[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let isCancelled = false;
    setSelectedQuoteId(job?.quote_id || '');
    setStartDate(job?.start_date || defaultDate);
    setEndDate(job?.end_date || defaultDate);
    setSearch('');
    setIsLoading(true);

    void fetchScheduleQuoteCandidates()
      .then((items) => {
        if (isCancelled) return;
        setQuotes(items);
      })
      .catch((error) => {
        if (!isCancelled) {
          toast.error(error instanceof Error ? error.message : 'Unable to load Quotes');
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [defaultDate, job, open]);

  const filteredQuotes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return quotes;
    return quotes.filter((quote) =>
      [
        quote.quote_reference,
        quote.base_quote_reference,
        quote.title,
        quote.customer_name,
        quote.status,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch))
    );
  }, [quotes, search]);
  const selectedQuote = quotes.find((quote) => quote.id === selectedQuoteId) || null;

  function selectQuote(quote: ScheduleQuoteCandidate) {
    setSelectedQuoteId(quote.id);
    setStartDate(quote.start_date || defaultDate);
    setEndDate(quote.end_date || quote.start_date || defaultDate);
  }

  async function handleSave() {
    if (!selectedQuoteId || !startDate || !endDate || isSaving) return;
    if (endDate < startDate) {
      toast.error('End date must be on or after the start date.');
      return;
    }

    setIsSaving(true);
    try {
      await saveQuoteSchedule({
        quote_id: selectedQuoteId,
        start_date: startDate,
        end_date: endDate,
      });
      toast.success(job ? 'Quote schedule updated' : 'Quote added to the schedule');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to schedule Quote');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
        <DialogHeader>
          <DialogTitle>{job ? 'Reschedule Quote job' : 'Schedule a Quote'}</DialogTitle>
          <DialogDescription>
            Set the planning window here. The Quote remains the source of truth and its
            workflow status will not change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {job ? (
            <div className="rounded-lg border border-scheduling/40 bg-scheduling-soft p-4">
              <p className="text-sm font-semibold text-foreground">{job.job_reference}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {job.customer_name ? `${job.customer_name} · ` : ''}{job.title}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="schedule-quote-search">Open Quote</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="schedule-quote-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search reference, customer, title or status"
                  className="pl-9"
                />
              </div>
              <ScrollArea
                className="h-64 rounded-lg border border-border"
                data-mobile-scroll-lock="true"
              >
                <div className="space-y-2 p-2">
                  {isLoading ? (
                    <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading open Quotes…
                    </div>
                  ) : filteredQuotes.length > 0 ? (
                    filteredQuotes.map((quote) => {
                      const isSelected = quote.id === selectedQuoteId;
                      return (
                        <button
                          key={quote.id}
                          type="button"
                          onClick={() => selectQuote(quote)}
                          aria-pressed={isSelected}
                          className={cn(
                            'flex w-full items-start gap-3 rounded-md border p-3 text-left transition',
                            isSelected
                              ? 'border-scheduling bg-scheduling-soft'
                              : 'border-border bg-card hover:border-muted-foreground'
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {quote.base_quote_reference}
                              </span>
                              <Badge variant="outline">{formatStatus(quote.status)}</Badge>
                            </span>
                            <span className="mt-1 block truncate text-sm text-muted-foreground">
                              {quote.customer_name ? `${quote.customer_name} · ` : ''}
                              {quote.title}
                            </span>
                            {quote.start_date ? (
                              <span className="mt-1 block text-xs text-scheduling">
                                Currently {quote.start_date} to {quote.end_date}
                              </span>
                            ) : null}
                          </span>
                          {isSelected ? <Check className="mt-1 h-4 w-4 text-scheduling" /> : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                      No open Quotes match this search.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {selectedQuote || job ? (
            <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-quote-start">Start date</Label>
                <Input
                  id="schedule-quote-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-quote-end">End date</Label>
                <Input
                  id="schedule-quote-end"
                  type="date"
                  min={startDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!selectedQuoteId || !startDate || !endDate || isSaving}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" />
            )}
            {job ? 'Update schedule' : 'Schedule Quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
