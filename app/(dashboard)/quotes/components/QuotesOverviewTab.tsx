'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils/cn';
import { ArrowRight, CalendarDays, Clock, Coins, FileSearch, Receipt, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { QuoteOverviewItem, QuoteOverviewPayload, QuoteOverviewSummary } from '../overview-types';

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPreviousWeekBounds(): { monday: string; sunday: string } {
  const today = new Date();
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const currentWeekMonday = new Date(today);
  currentWeekMonday.setHours(0, 0, 0, 0);
  currentWeekMonday.setDate(today.getDate() - daysSinceMonday);

  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(currentWeekMonday.getDate() - 7);

  const previousWeekSunday = new Date(previousWeekMonday);
  previousWeekSunday.setDate(previousWeekMonday.getDate() + 6);

  return {
    monday: formatDateInput(previousWeekMonday),
    sunday: formatDateInput(previousWeekSunday),
  };
}

function getDefaultDateFrom(): string {
  return getPreviousWeekBounds().monday;
}

function getDefaultDateTo(): string {
  return getPreviousWeekBounds().sunday;
}

function formatCurrency(value: number): string {
  return `£${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatHours(value: number): string {
  return `${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  })}h`;
}

function getRecordTypeLabel(item: QuoteOverviewItem): string {
  return item.kind === 'quote' ? 'Quote' : 'Job number';
}

function getStatusBadgeClass(item: QuoteOverviewItem): string {
  if (item.commercial_status === 'closed' || item.status === 'closed' || item.status === 'cancelled') {
    return 'border-slate-500/40 bg-slate-500/10 text-slate-200';
  }

  if (item.kind === 'project') {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
  }

  if (item.status === 'invoiced' || item.status === 'partially_invoiced') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  }

  return 'border-brand-yellow/30 bg-brand-yellow/10 text-brand-yellow';
}

function getStatusLabel(item: QuoteOverviewItem): string {
  return (item.status || item.commercial_status || item.kind).replace(/_/g, ' ');
}

function getEstimatedValue(hours: number, estimatedRate: number): number {
  if (!Number.isFinite(estimatedRate) || estimatedRate <= 0) return 0;
  return Math.round(hours * estimatedRate * 100) / 100;
}

interface SummaryTileProps {
  label: string;
  value: string;
  helper?: string;
  icon: ReactNode;
  accent?: 'yellow' | 'green' | 'blue' | 'slate';
}

function SummaryTile({ label, value, helper, icon, accent = 'slate' }: SummaryTileProps) {
  const accentClass = {
    yellow: 'border-brand-yellow/25 bg-brand-yellow/10 text-brand-yellow',
    green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
    slate: 'border-slate-700 bg-slate-900/70 text-slate-100',
  }[accent];

  return (
    <Card className={cn('overflow-hidden border', accentClass)}>
      <CardContent className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-xl font-semibold leading-tight text-white">{value}</p>
          {helper ? <p className="mt-0.5 truncate text-xs text-slate-400">{helper}</p> : null}
        </div>
        <div className="rounded-md border border-white/10 bg-white/5 p-1.5 text-current">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

interface RecentItemCardProps {
  item: QuoteOverviewItem;
  estimatedRate: number;
}

function RecentItemCard({ item, estimatedRate }: RecentItemCardProps) {
  return (
    <Link
      href={item.href}
      className="group flex h-full min-h-[134px] flex-col rounded-lg border border-slate-700 bg-slate-950/60 p-3 transition hover:border-brand-yellow/50 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{getRecordTypeLabel(item)}</p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-white">{item.reference}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-300">{item.title}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-brand-yellow" />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">Invoices</p>
          <p className="font-semibold text-emerald-200">{formatCurrency(item.invoice_total)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Hours</p>
          <p className="font-semibold text-blue-200">{formatHours(item.worked_hours)}</p>
        </div>
      </div>
      {estimatedRate > 0 ? (
        <p className="mt-2 truncate text-xs text-slate-400">
          Estimated labour: {formatCurrency(getEstimatedValue(item.worked_hours, estimatedRate))}
        </p>
      ) : null}
    </Link>
  );
}

interface SearchResultsDropdownProps {
  items: QuoteOverviewItem[];
  estimatedRate: number;
  loading: boolean;
  search: string;
  onClose: () => void;
}

function SearchResultsDropdown({
  items,
  estimatedRate,
  loading,
  search,
  onClose,
}: SearchResultsDropdownProps) {
  const visibleItems = items.slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-slate-700 bg-slate-950 text-sm text-slate-100 shadow-xl">
        <div className="flex items-start gap-3 px-4 py-5 text-slate-400">
          <Search className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-slate-200">{loading ? 'Searching...' : 'No quotes or jobs found'}</p>
            <p className="mt-1 text-xs">Try a different quote number, job number, customer, or name.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-slate-700 bg-slate-950 text-sm text-slate-100 shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span>
          {loading ? 'Searching...' : `${items.length} match${items.length === 1 ? '' : 'es'} for "${search}"`}
        </span>
        {items.length > visibleItems.length ? <span>Showing first {visibleItems.length}</span> : null}
      </div>
      <div className="max-h-96 overflow-y-auto p-1">
        {visibleItems.map(item => (
          <Link
            key={`${item.kind}-${item.reference}`}
            href={item.href}
            onClick={onClose}
            className="group block rounded-sm px-3 py-2 hover:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-white group-hover:text-brand-yellow">{item.reference}</span>
                  <Badge variant="outline" className={cn('shrink-0 capitalize', getStatusBadgeClass(item))}>
                    {getStatusLabel(item)}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {item.customer_name || item.contact_name || 'No customer linked'} · {item.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatCurrency(item.invoice_total)} invoiced · {formatHours(item.worked_hours)} worked
                  {estimatedRate > 0 ? ` · ${formatCurrency(getEstimatedValue(item.worked_hours, estimatedRate))} est.` : ''}
                </p>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-brand-yellow" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface DateRangeSummaryProps {
  summary: QuoteOverviewSummary;
  estimatedRate: number;
}

function DateRangeSummary({ summary, estimatedRate }: DateRangeSummaryProps) {
  const estimatedValue = getEstimatedValue(summary.worked_hours, estimatedRate);

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryTile
        label="Invoices Sent"
        value={formatCurrency(summary.invoice_total)}
        helper={`${summary.invoice_count} invoice${summary.invoice_count === 1 ? '' : 's'} sent`}
        icon={<Receipt className="h-5 w-5" />}
        accent="green"
      />
      <SummaryTile
        label="Worked Hours"
        value={formatHours(summary.worked_hours)}
        helper={`${summary.employee_count} people, ${summary.timesheet_count} timesheets`}
        icon={<Clock className="h-5 w-5" />}
        accent="blue"
      />
      <SummaryTile
        label="Estimated Labour"
        value={estimatedRate > 0 ? formatCurrency(estimatedValue) : 'Set rate'}
        helper={estimatedRate > 0 ? `${formatCurrency(estimatedRate)} per hour` : 'Enter an average hourly rate'}
        icon={<Coins className="h-5 w-5" />}
        accent="yellow"
      />
      <SummaryTile
        label="Manual Costs"
        value={formatCurrency(summary.manual_cost_total)}
        helper={`${summary.item_count} filtered records`}
        icon={<FileSearch className="h-5 w-5" />}
      />
    </div>
  );
}

export function QuotesOverviewTab() {
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<QuoteOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [dateTo, setDateTo] = useState(getDefaultDateTo);
  const [estimatedRateInput, setEstimatedRateInput] = useState('');
  const estimatedRate = useMemo(() => Number(estimatedRateInput || 0), [estimatedRateInput]);
  const hasSearchQuery = search.trim().length > 0;

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);

        const response = await fetch(`/api/quotes/overview?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load quotes overview.');
        setPayload(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        toast.error(error instanceof Error ? error.message : 'Unable to load quotes overview.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [dateFrom, dateTo, search]);

  useEffect(() => {
    if (!searchDropdownOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!searchContainerRef.current?.contains(target)) setSearchDropdownOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSearchDropdownOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [searchDropdownOpen]);

  const summary = payload?.summary;
  const dateRangeSummary = payload?.date_range_summary;
  const recentItems = payload?.recent_items || [];
  const items = payload?.items || [];
  const isInitialOverviewLoading = loading && !payload;

  return (
    <div className="space-y-6">
      <Card className="border-slate-700 bg-slate-950">
        <CardHeader className="gap-3 p-4 pb-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xl text-white">Overview</CardTitle>
            <p className="max-w-3xl text-sm text-slate-400">
              Search quote and job numbers, compare invoices sent against timesheet hours, and open a full cost detail view.
            </p>
          </div>
          {summary ? (
            <div className="text-sm text-slate-400">
              Showing <span className="font-semibold text-white">{summary.item_count}</span> matching records
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
            <div ref={searchContainerRef} className="relative space-y-2">
              <Label htmlFor="quotes-overview-search">Search quote / job, customer, or name</Label>
              <SearchInput
                id="quotes-overview-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchDropdownOpen(event.target.value.trim().length > 0);
                }}
                onFocus={() => {
                  if (hasSearchQuery) setSearchDropdownOpen(true);
                }}
                placeholder="e.g. 01234-MD, Acme, site contact..."
                containerClassName="border-slate-700 bg-slate-900"
              />
              {searchDropdownOpen && hasSearchQuery ? (
                <SearchResultsDropdown
                  items={items}
                  estimatedRate={estimatedRate}
                  loading={loading}
                  search={search.trim()}
                  onClose={() => setSearchDropdownOpen(false)}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotes-overview-date-from">From</Label>
              <Input
                id="quotes-overview-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white lg:w-40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotes-overview-date-to">To</Label>
              <Input
                id="quotes-overview-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white lg:w-40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotes-overview-rate">Avg hourly rate</Label>
              <Input
                id="quotes-overview-rate"
                type="number"
                min="0"
                step="0.01"
                value={estimatedRateInput}
                onChange={(event) => setEstimatedRateInput(event.target.value)}
                placeholder="Optional"
                className="border-slate-700 bg-slate-900 text-white lg:w-40"
              />
            </div>
          </div>

          {isInitialOverviewLoading ? (
            <PanelLoader message="Loading quotes overview..." className="py-10" />
          ) : dateRangeSummary ? (
            <DateRangeSummary summary={dateRangeSummary} estimatedRate={estimatedRate} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map(index => (
                <div key={index} className="h-20 animate-pulse rounded-lg border border-slate-800 bg-slate-900/60" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isInitialOverviewLoading ? (
        <Card className="border-slate-700 bg-slate-950">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-white">
              <CalendarDays className="h-5 w-5 text-brand-yellow" />
              Most Recent
            </CardTitle>
            <p className="text-sm text-slate-400">Latest quote and job-number activity.</p>
          </CardHeader>
          <CardContent className="grid gap-2 p-4 pt-0 md:grid-cols-2 lg:grid-cols-4">
            {recentItems.length > 0 ? recentItems.map(item => (
              <RecentItemCard key={`${item.kind}-${item.reference}`} item={item} estimatedRate={estimatedRate} />
            )) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                No recent quote or job activity found.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
