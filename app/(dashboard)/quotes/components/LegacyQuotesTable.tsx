'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Loader2, Pencil, Search } from 'lucide-react';
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
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { Textarea } from '@/components/ui/textarea';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { cn } from '@/lib/utils';
import type { LegacyQuote } from '../types';

interface LegacyQuotesTableProps {
  legacyQuotes: LegacyQuote[];
  managerFilter?: string;
  canEditLegacyQuotes?: boolean;
  onLegacyQuoteUpdate?: (quoteId: string, updates: LegacyQuoteEditForm) => Promise<LegacyQuote | void>;
}

export interface LegacyQuoteEditForm {
  quote_reference: string;
  customer_name: string;
  title: string;
  quote_date: string;
  quote_manager_name: string;
  quote_value_text: string;
  comments: string;
}

type LegacyQuoteSortField = 'quote_reference' | 'customer' | 'details' | 'quote_date' | 'manager' | 'total';
type SortDir = 'asc' | 'desc';

interface DateRangeFilterProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
}

interface LegacyQuoteEditDialogProps {
  quote: LegacyQuote | null;
  form: LegacyQuoteEditForm;
  isSaving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onFormChange: (field: keyof LegacyQuoteEditForm, value: string) => void;
  onSubmit: () => Promise<void>;
}

function cleanLegacyQuoteManagerName(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function getLegacyQuoteDetailsTitle(quote: LegacyQuote): string {
  const title = cleanLegacyQuoteManagerName(quote.title);
  if (!title) return 'Untitled quote';

  const duplicateSegments = new Set([
    cleanLegacyQuoteManagerName(quote.quote_reference).toLowerCase(),
    cleanLegacyQuoteManagerName(quote.customer_name).toLowerCase(),
  ].filter(Boolean));
  const titleSegments = title
    .split(/\s+(?:[-–—|])\s+/)
    .map(cleanLegacyQuoteManagerName)
    .filter(Boolean);

  if (titleSegments.length <= 1) {
    return duplicateSegments.has(title.toLowerCase()) ? '—' : title;
  }

  const details = titleSegments
    .filter((segment) => !duplicateSegments.has(segment.toLowerCase()))
    .join(' - ');

  return details || '—';
}

export function normalizeLegacyQuoteManagerName(value: string | null | undefined): string {
  const cleaned = cleanLegacyQuoteManagerName(value);
  if (/^geroge\s+healey$/i.test(cleaned)) return 'George Healey';
  return cleaned;
}

export function getLegacyQuoteManagerFilterValue(value: string | null | undefined): string {
  const normalized = normalizeLegacyQuoteManagerName(value);
  return normalized ? `legacy-manager:${normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : 'unknown';
}

function formatLegacyQuoteDate(quote: LegacyQuote): string {
  if (!quote.quote_date) return quote.quote_date_raw || '-';

  const date = new Date(`${quote.quote_date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return quote.quote_date_raw || '-';

  return format(date, 'dd MMM yyyy');
}

function formatLegacyQuoteValue(quote: LegacyQuote): string {
  if (quote.quote_value_text) return quote.quote_value_text;
  if (quote.quote_value_amount !== null) {
    return `£${Number(quote.quote_value_amount).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  return '';
}

function getQuoteSearchText(quote: LegacyQuote): string {
  return [
    quote.quote_reference,
    quote.customer_name,
    quote.title,
    quote.quote_manager_name,
    quote.quote_manager_initials,
    quote.quote_value_text,
  ].filter(Boolean).join(' ').toLowerCase();
}

function getLegacyQuoteDateTime(quote: LegacyQuote): number {
  if (!quote.quote_date) return 0;
  const date = new Date(`${quote.quote_date}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function buildLegacyQuoteEditForm(quote: LegacyQuote): LegacyQuoteEditForm {
  return {
    quote_reference: quote.quote_reference || '',
    customer_name: quote.customer_name || '',
    title: quote.title || '',
    quote_date: quote.quote_date || '',
    quote_manager_name: quote.quote_manager_name || '',
    quote_value_text: quote.quote_value_text || '',
    comments: quote.comments || '',
  };
}

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
}

function getDateRangeTriggerLabel(fromDate: string, toDate: string) {
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `From ${fromDate}`;
  if (toDate) return `To ${toDate}`;
  return 'All dates';
}

function DateRangeFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = 'legacy-quote-date-range-filter-menu';

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full sm:w-[210px]">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-between border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
      >
        <span className="truncate">{getDateRangeTriggerLabel(fromDate, toDate)}</span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          id={panelId}
          className="absolute left-0 top-full z-40 mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 shadow-xl"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Date Range</p>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">From</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => onFromDateChange(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">To</span>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => onToDateChange(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </label>
            {(fromDate || toDate) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFromDateChange('');
                  onToDateChange('');
                }}
                className="w-full text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Clear dates
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LegacyQuoteEditDialog({
  quote,
  form,
  isSaving,
  error,
  onOpenChange,
  onFormChange,
  onSubmit,
}: LegacyQuoteEditDialogProps) {
  return (
    <Dialog open={Boolean(quote)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border border-slate-700 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Edit Legacy Quote</DialogTitle>
          <DialogDescription>
            Admin-only changes update the legacy quote archive used by quotes and timesheets.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-300">Job Number</span>
            <Input
              value={form.quote_reference}
              onChange={(event) => onFormChange('quote_reference', event.target.value.toUpperCase())}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-300">Date</span>
            <Input
              type="date"
              value={form.quote_date}
              onChange={(event) => onFormChange('quote_date', event.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-300">Customer</span>
            <Input
              value={form.customer_name}
              onChange={(event) => onFormChange('customer_name', event.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-300">Manager</span>
            <Input
              value={form.quote_manager_name}
              onChange={(event) => onFormChange('quote_manager_name', event.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-slate-300">Details</span>
            <Textarea
              value={form.title}
              onChange={(event) => onFormChange('title', event.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-slate-300">Total</span>
            <Input
              value={form.quote_value_text}
              onChange={(event) => onFormChange('quote_value_text', event.target.value)}
              placeholder="£1,250.00, Rates, Various..."
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          <label className="space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-slate-300">Comments</span>
            <Textarea
              value={form.comments}
              onChange={(event) => onFormChange('comments', event.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </label>

          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 sm:col-span-2">
              {error}
            </p>
          ) : null}

          <DialogFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="border-slate-700 text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LegacyQuotesTable({
  legacyQuotes,
  managerFilter = 'all',
  canEditLegacyQuotes = false,
  onLegacyQuoteUpdate,
}: LegacyQuotesTableProps) {
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortField, setSortField] = useState<LegacyQuoteSortField>('quote_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editingQuote, setEditingQuote] = useState<LegacyQuote | null>(null);
  const [editForm, setEditForm] = useState<LegacyQuoteEditForm>({
    quote_reference: '',
    customer_name: '',
    title: '',
    quote_date: '',
    quote_manager_name: '',
    quote_value_text: '',
    comments: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const filteredQuotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = legacyQuotes.filter((quote) => {
      if (managerFilter !== 'all') {
        if (getLegacyQuoteManagerFilterValue(quote.quote_manager_name) !== managerFilter) return false;
      }

      if (!query) return true;
      return getQuoteSearchText(quote).includes(query);
    }).filter((quote) => {
      if (fromDate && (!quote.quote_date || quote.quote_date < fromDate)) return false;
      if (toDate && (!quote.quote_date || quote.quote_date > toDate)) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'quote_reference':
          cmp = compareStrings(a.quote_reference, b.quote_reference);
          break;
        case 'customer':
          cmp = compareStrings(a.customer_name, b.customer_name);
          break;
        case 'details':
          cmp = compareStrings(a.title, b.title);
          break;
        case 'quote_date':
          cmp = getLegacyQuoteDateTime(a) - getLegacyQuoteDateTime(b);
          break;
        case 'manager':
          cmp = compareStrings(normalizeLegacyQuoteManagerName(a.quote_manager_name), normalizeLegacyQuoteManagerName(b.quote_manager_name));
          break;
        case 'total':
          cmp = Number(a.quote_value_amount ?? -1) - Number(b.quote_value_amount ?? -1);
          break;
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [legacyQuotes, managerFilter, search, fromDate, toDate, sortDir, sortField]);

  const paginationResetKey = [
    managerFilter,
    search.trim(),
    fromDate,
    toDate,
    sortField,
    sortDir,
    filteredQuotes.length,
  ].join(':');
  const { visibleItems: visibleQuotes, showMore } = useLoadMorePagination(filteredQuotes, { resetKey: paginationResetKey });

  function toggleSort(field: LegacyQuoteSortField) {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function renderSortIcon(field: LegacyQuoteSortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="ml-1 inline h-3 w-3" />
      : <ChevronDown className="ml-1 inline h-3 w-3" />;
  }

  function renderSortableHeader(label: string, field: LegacyQuoteSortField, className = 'text-left') {
    return (
      <th className={`px-4 py-3 font-semibold text-muted-foreground ${className}`}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className="inline-flex items-center gap-1 hover:text-white"
        >
          {label}
          {renderSortIcon(field)}
        </button>
      </th>
    );
  }

  function openEditDialog(quote: LegacyQuote) {
    setEditingQuote(quote);
    setEditForm(buildLegacyQuoteEditForm(quote));
    setEditError(null);
  }

  function closeEditDialog() {
    if (isSavingEdit) return;
    setEditingQuote(null);
    setEditError(null);
  }

  function updateEditForm(field: keyof LegacyQuoteEditForm, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  async function submitEditForm() {
    if (!editingQuote || !onLegacyQuoteUpdate) return;

    setIsSavingEdit(true);
    setEditError(null);
    try {
      await onLegacyQuoteUpdate(editingQuote.id, editForm);
      setEditingQuote(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to update this legacy quote.');
    } finally {
      setIsSavingEdit(false);
    }
  }

  const hasDateFilter = Boolean(fromDate || toDate);
  const canEdit = canEditLegacyQuotes && Boolean(onLegacyQuoteUpdate);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search quotes..."
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:items-end">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Filters</p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          {hasDateFilter ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFromDate('');
                setToDate('');
              }}
              className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
            >
              Reset Filters
            </Button>
          ) : null}

          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
          />
        </div>
      </div>

      {filteredQuotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No legacy quotes match the current filters.
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {visibleQuotes.map((quote) => {
              const managerName = normalizeLegacyQuoteManagerName(quote.quote_manager_name);
              const totalLabel = formatLegacyQuoteValue(quote);
              const detailsTitle = getLegacyQuoteDetailsTitle(quote);

              return (
                <div
                  key={quote.id}
                  className="w-full rounded-lg border border-border bg-card p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-base font-semibold text-amber-200/80">
                        {quote.quote_reference || `Row ${quote.source_row}`}
                      </p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {quote.customer_name || '-'}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-white">{totalLabel}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Details</p>
                      <p className="line-clamp-2 text-white">{detailsTitle}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p>{formatLegacyQuoteDate(quote)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Manager</p>
                      <p>{managerName || '-'}</p>
                    </div>
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(quote)}
                      className="mt-4 w-full border-slate-600 text-slate-200 hover:bg-slate-800"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Legacy Quote
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-700 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/80">
                  {renderSortableHeader('Job Number', 'quote_reference')}
                  {renderSortableHeader('Customer', 'customer')}
                  {renderSortableHeader('Details', 'details')}
                  {renderSortableHeader('Date', 'quote_date')}
                  {renderSortableHeader('Manager', 'manager')}
                  {renderSortableHeader('Total', 'total', 'text-right')}
                  {canEdit ? (
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {visibleQuotes.map((quote) => {
                  const managerName = normalizeLegacyQuoteManagerName(quote.quote_manager_name);
                  const totalLabel = formatLegacyQuoteValue(quote);
                  const detailsTitle = getLegacyQuoteDetailsTitle(quote);

                  return (
                    <tr key={quote.id} className="align-top transition-colors hover:bg-slate-800/30">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-amber-200/80">
                        {quote.quote_reference || `Row ${quote.source_row}`}
                      </td>
                      <td className="px-4 py-3 text-white">
                        {quote.customer_name || '-'}
                      </td>
                      <td className="max-w-[280px] px-4 py-3 text-xs text-slate-300">
                        <span className="line-clamp-2 leading-snug text-white">{detailsTitle}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-300">{formatLegacyQuoteDate(quote)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-300">{managerName || '-'}</td>
                      <td className={cn('whitespace-nowrap px-4 py-3 text-right font-semibold', totalLabel ? 'text-white' : 'text-slate-600')}>
                        {totalLabel}
                      </td>
                      {canEdit ? (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(quote)}
                            className="border-slate-600 text-slate-200 hover:bg-slate-800"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <LoadMorePagination
            visibleCount={visibleQuotes.length}
            totalCount={filteredQuotes.length}
            itemLabel="legacy quotes"
            onShowMore={showMore}
          />
        </>
      )}

      <LegacyQuoteEditDialog
        quote={editingQuote}
        form={editForm}
        isSaving={isSavingEdit}
        error={editError}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
        onFormChange={updateEditForm}
        onSubmit={submitEditForm}
      />
    </div>
  );
}
