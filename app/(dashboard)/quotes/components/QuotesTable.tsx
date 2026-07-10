'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { MultiSelectFilter, type MultiSelectFilterOption } from '@/components/ui/multi-select-filter';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { format } from 'date-fns';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { buildQuoteDisplayName, getQuoteLocationSegment } from '@/lib/quotes/quote-display-name';
import { cn } from '@/lib/utils';
import { getQuoteManagerNameFilterValue, isQuoteManagerNameFilterValue } from '../types';
import type { Quote, QuoteListSummary, QuoteSageStatus, QuoteStatus } from '../types';
import { ACTIVE_QUOTE_STATUS_ORDER, getQuoteStatusConfig } from '../types';

interface QuotesTableProps {
  quotes: Quote[];
  statusCounts?: QuoteListSummary['status_counts'];
  onRowClick: (quote: Quote) => void;
  managerFilter?: string;
  emptyMessage?: string;
  emptySearchMessage?: string;
}

type SortField = 'quote_reference' | 'customer' | 'quote_date' | 'total' | 'status';
type SortDir = 'asc' | 'desc';
type PoFilter = 'with_po' | 'without_po';
type BillingFilter = 'not_invoiced' | 'ready_to_invoice' | 'partially_invoiced' | 'invoiced';

const BILLING_FILTER_OPTIONS = [
  { value: 'not_invoiced', label: 'Not billed' },
  { value: 'ready_to_invoice', label: 'Ready to invoice' },
  { value: 'partially_invoiced', label: 'Part billed' },
  { value: 'invoiced', label: 'Fully billed' },
] as const;

const PO_FILTER_OPTIONS = [
  { value: 'with_po', label: 'With PO' },
  { value: 'without_po', label: 'No PO' },
] as const;

const SAGE_FILTER_OPTIONS = [
  { value: 'not_on_sage', label: 'Not on Sage' },
  { value: 'on_sage', label: 'On Sage' },
] as const;

const STATUS_COLUMN_BADGE_CLASS = 'whitespace-nowrap';

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function quoteMatchesStatus(quote: Quote, status: QuoteStatus) {
  if (status === 'closed') {
    return quote.status === 'closed' || quote.commercial_status === 'closed';
  }

  return quote.status === status;
}

function isTestCustomerName(name: string | null | undefined) {
  return name?.toLowerCase().includes('test customer') ?? false;
}

function getQuoteDetailsLines(quote: Quote) {
  const lines = [
    getQuoteLocationSegment(quote.site_address),
    quote.subject_line,
    quote.project_description,
  ]
    .map((value) => value?.replace(/\s+/g, ' ').trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(lines));
}

function QuoteDetailsCell({ quote, muted = false }: { quote: Quote; muted?: boolean }) {
  const details = getQuoteDetailsLines(quote);

  if (details.length === 0) {
    return <span className={muted ? 'text-slate-500' : 'text-muted-foreground'}>—</span>;
  }

  return (
    <>
      <span className={cn('line-clamp-2 leading-snug', muted ? 'text-slate-300' : 'text-white')}>
        {details[0]}
      </span>
      {details[1] ? (
        <span className={cn('mt-1 block truncate', muted ? 'text-slate-500' : 'text-muted-foreground')}>
          {details[1]}
        </span>
      ) : null}
    </>
  );
}

function getQuoteSageStatus(quote: Pick<Quote, 'sage_posted_at'>): QuoteSageStatus {
  return quote.sage_posted_at ? 'on_sage' : 'not_on_sage';
}

function getSageStatusConfig(status: QuoteSageStatus) {
  switch (status) {
    case 'on_sage':
      return { label: 'On Sage' };
    default:
      return { label: 'Not on Sage' };
  }
}

function SageStatusBadge({ status }: { status: QuoteSageStatus }) {
  const { label } = getSageStatusConfig(status);
  const isOnSage = status === 'on_sage';

  return (
    <Badge
      variant="outline"
      aria-label={label}
      title={label}
      className={cn(
        STATUS_COLUMN_BADGE_CLASS,
        'relative inline-flex h-6 w-6 items-center justify-center rounded-full p-0 text-[10px] font-bold leading-none tracking-[-0.08em]',
        isOnSage
          ? 'border-[#58d83f]/50 bg-[#58d83f]/15 text-[#7be85f] shadow-[inset_0_0_0_1px_rgba(88,216,63,0.14)]'
          : 'border-slate-600/70 bg-slate-800/80 text-slate-500'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'translate-x-[-0.5px]',
          isOnSage ? 'drop-shadow-[0_0_6px_rgba(123,232,95,0.35)]' : 'opacity-70'
        )}
      >
        S
      </span>
      {!isOnSage ? (
        <span
          aria-hidden="true"
          className="absolute h-px w-4 rotate-[-35deg] rounded-full bg-slate-500/80"
        />
      ) : null}
    </Badge>
  );
}

function getInvoiceProgress(quote: Quote) {
  const total = Number(quote.total || 0);
  const invoicedTotal = Number(quote.invoice_summary?.invoicedTotal || 0);
  const pendingRequestedTotal = Number(quote.invoice_summary?.pendingRequestedTotal || 0);
  const invoicedPercent = total > 0
    ? Math.min(100, Math.max(0, Math.round((invoicedTotal / total) * 100)))
    : 0;
  const pendingPercent = total > 0
    ? Math.min(100 - invoicedPercent, Math.max(0, Math.round((pendingRequestedTotal / total) * 100)))
    : 0;

  return {
    invoicedTotal,
    pendingRequestedTotal,
    invoicedPercent,
    pendingPercent,
  };
}

function InvoiceProgressBadge({ quote }: { quote: Quote }) {
  const { invoicedTotal, pendingRequestedTotal, invoicedPercent, pendingPercent } = getInvoiceProgress(quote);

  return (
    <div
      className="relative inline-flex min-w-[150px] overflow-hidden rounded-full border border-emerald-500/30 bg-slate-800 text-xs font-semibold text-emerald-100"
      title={`${formatCurrency(invoicedTotal)} invoiced${pendingRequestedTotal > 0 ? `, ${formatCurrency(pendingRequestedTotal)} pending request` : ''}`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-emerald-500/35"
        style={{ width: `${invoicedPercent}%` }}
      />
      {pendingPercent > 0 ? (
        <span
          className="absolute inset-y-0 bg-violet-500/45"
          style={{
            left: `${invoicedPercent}%`,
            width: `${pendingPercent}%`,
          }}
        />
      ) : null}
      <span className="relative z-10 w-full px-3 py-1 text-center">
        {formatCurrency(invoicedTotal)}
      </span>
    </div>
  );
}

function InvoiceProgressCell({ quote }: { quote: Quote }) {
  return (
    <div className="inline-flex min-w-[150px] flex-col items-stretch">
      <InvoiceProgressBadge quote={quote} />
      {quote.po_number ? (
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          PO# {quote.po_number}
        </span>
      ) : null}
    </div>
  );
}

interface DateRangeFilterProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
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
  const panelId = 'quote-date-range-filter-menu';

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

export function QuotesTable({
  quotes,
  statusCounts: providedStatusCounts,
  onRowClick,
  managerFilter = 'all',
  emptyMessage = 'No quotes yet. Create your first quote to get started.',
  emptySearchMessage = 'No quotes match your search.',
}: QuotesTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<QuoteStatus[]>([]);
  const [poFilters, setPoFilters] = useState<PoFilter[]>([]);
  const [invoiceFilters, setInvoiceFilters] = useState<BillingFilter[]>([]);
  const [sageFilters, setSageFilters] = useState<QuoteSageStatus[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortField, setSortField] = useState<SortField>('quote_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

  function quoteMatchesSearch(quote: Quote, query: string) {
    return (
      quote.quote_reference.toLowerCase().includes(query) ||
      quote.base_quote_reference.toLowerCase().includes(query) ||
      buildQuoteDisplayName(quote).toLowerCase().includes(query) ||
      quote.customer?.company_name?.toLowerCase().includes(query) ||
      quote.subject_line?.toLowerCase().includes(query) ||
      quote.attention_name?.toLowerCase().includes(query) ||
      quote.po_number?.toLowerCase().includes(query) ||
      quote.invoice_number?.toLowerCase().includes(query) ||
      quote.manager_name?.toLowerCase().includes(query)
    );
  }

  const filtered = useMemo(() => {
    let list = quotes;

    if (statusFilters.length > 0) {
      list = list.filter(q => statusFilters.some((status) => quoteMatchesStatus(q, status)));
    }

    if (managerFilter !== 'all') {
      list = isQuoteManagerNameFilterValue(managerFilter)
        ? list.filter(q => getQuoteManagerNameFilterValue(q.manager_name) === managerFilter)
        : list.filter(q => q.requester_id === managerFilter);
    }

    if (poFilters.length > 0) {
      list = list.filter(q =>
        poFilters.some((poFilter) => (
          poFilter === 'with_po' ? Boolean(q.po_number) : !q.po_number
        ))
      );
    }

    if (invoiceFilters.length > 0) {
      list = list.filter(q => invoiceFilters.includes(q.invoice_summary?.status as BillingFilter));
    }

    if (sageFilters.length > 0) {
      list = list.filter(q => sageFilters.includes(getQuoteSageStatus(q)));
    }

    if (fromDate) {
      list = list.filter(q => q.quote_date >= fromDate);
    }

    if (toDate) {
      list = list.filter(q => q.quote_date <= toDate);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(quote =>
        quoteMatchesSearch(quote, q) ||
        (quote.previous_versions || []).some(version => quoteMatchesSearch(version, q))
      );
    }

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'quote_reference':
          cmp = a.quote_reference.localeCompare(b.quote_reference);
          break;
        case 'customer':
          cmp = (a.customer?.company_name || '').localeCompare(b.customer?.company_name || '');
          break;
        case 'quote_date':
          cmp = a.quote_date.localeCompare(b.quote_date);
          break;
        case 'total':
          cmp = Number(a.total) - Number(b.total);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [quotes, search, statusFilters, managerFilter, poFilters, invoiceFilters, sageFilters, fromDate, toDate, sortField, sortDir]);

  const paginationResetKey = [
    search.trim(),
    statusFilters.join(','),
    managerFilter,
    poFilters.join(','),
    invoiceFilters.join(','),
    sageFilters.join(','),
    fromDate,
    toDate,
    sortField,
    sortDir,
    filtered.length,
  ].join(':');
  const { visibleItems: visibleQuotes, showMore } = useLoadMorePagination(filtered, { resetKey: paginationResetKey });

  function handleSearchChange(value: string) {
    setSearch(value);
  }

  function handleStatusFiltersChange(values: QuoteStatus[]) {
    setStatusFilters(values);
  }

  function handlePoFiltersChange(values: PoFilter[]) {
    setPoFilters(values);
  }

  function handleInvoiceFiltersChange(values: BillingFilter[]) {
    setInvoiceFilters(values);
  }

  function handleSageFiltersChange(values: QuoteSageStatus[]) {
    setSageFilters(values);
  }

  function handleFromDateChange(value: string) {
    setFromDate(value);
  }

  function handleToDateChange(value: string) {
    setToDate(value);
  }

  function clearFilters() {
    setStatusFilters([]);
    setPoFilters([]);
    setInvoiceFilters([]);
    setSageFilters([]);
    setFromDate('');
    setToDate('');
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-1" />
      : <ChevronDown className="h-3 w-3 inline ml-1" />;
  }

  const statusCounts = useMemo(() => {
    const localCounts = ACTIVE_QUOTE_STATUS_ORDER.reduce<Record<QuoteStatus | 'all', number>>(
      (acc, status) => ({ ...acc, [status]: 0 }),
      { all: quotes.length } as Record<QuoteStatus | 'all', number>
    );

    quotes.forEach((quote) => {
      localCounts[quote.status] = (localCounts[quote.status] || 0) + 1;
      if (quote.commercial_status === 'closed' && quote.status !== 'closed') {
        localCounts.closed = (localCounts.closed || 0) + 1;
      }
    });

    if (providedStatusCounts) {
      return {
        ...providedStatusCounts,
        closed: Math.max(providedStatusCounts.closed || 0, localCounts.closed || 0),
      };
    }

    return localCounts;
  }, [providedStatusCounts, quotes]);

  const statusFilterOptions = useMemo<MultiSelectFilterOption<QuoteStatus>[]>(
    () => ACTIVE_QUOTE_STATUS_ORDER
      .filter((status) => (statusCounts[status] || 0) > 0)
      .map((status) => ({
        value: status,
        label: getQuoteStatusConfig(status).label,
        count: statusCounts[status] || 0,
      })),
    [statusCounts]
  );

  function toggleThread(threadId: string) {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  }

  const hasAnyFilters = statusFilters.length > 0 || poFilters.length > 0 || invoiceFilters.length > 0 || sageFilters.length > 0 || Boolean(fromDate || toDate);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 lg:items-end">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Filters</p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          {hasAnyFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
            >
              Reset Filters
            </Button>
          ) : null}

          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={handleFromDateChange}
            onToDateChange={handleToDateChange}
          />

          <MultiSelectFilter
            label="Workflow Status"
            allLabel="All workflow"
            selectedValues={statusFilters}
            options={statusFilterOptions}
            onSelectedValuesChange={handleStatusFiltersChange}
            triggerClassName="sm:w-[170px]"
          />

          <MultiSelectFilter
            label="PO"
            allLabel="All PO"
            selectedValues={poFilters}
            options={PO_FILTER_OPTIONS}
            onSelectedValuesChange={handlePoFiltersChange}
            triggerClassName="sm:w-[140px]"
          />

          <MultiSelectFilter
            label="Billing"
            allLabel="All billing"
            selectedValues={invoiceFilters}
            options={BILLING_FILTER_OPTIONS}
            onSelectedValuesChange={handleInvoiceFiltersChange}
            triggerClassName="sm:w-[150px]"
          />

          <MultiSelectFilter
            label="Sage"
            allLabel="All Sage"
            selectedValues={sageFilters}
            options={SAGE_FILTER_OPTIONS}
            onSelectedValuesChange={handleSageFiltersChange}
            triggerClassName="sm:w-[150px]"
          />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_reference')}>
                Job Number {renderSortIcon('quote_reference')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('customer')}>
                Customer {renderSortIcon('customer')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Details</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_date')}>
                Date {renderSortIcon('quote_date')}
              </th>
              <th className="text-right px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('total')}>
                Total {renderSortIcon('total')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                Status {renderSortIcon('status')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Invoiced</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  {search ? emptySearchMessage : emptyMessage}
                </td>
              </tr>
            ) : (
              visibleQuotes.map(quote => {
                const cfg = getQuoteStatusConfig(quote.status);
                const sageStatus = getQuoteSageStatus(quote);
                const previousVersions = quote.previous_versions || [];
                const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
                const quoteCustomerName = quote.customer?.company_name;
                return (
                  <Fragment key={quote.id}>
                    <tr
                      key={quote.id}
                      onClick={() => onRowClick(quote)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-brand-yellow">
                        <div className="flex items-center gap-2">
                          {previousVersions.length > 0 ? (
                            <button
                              type="button"
                              aria-label={isExpanded ? 'Collapse quote versions' : 'Expand quote versions'}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleThread(quote.quote_thread_id);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          ) : (
                            <span className="inline-flex h-6 w-6" />
                          )}
                          <span>{quote.quote_reference}</span>
                        </div>
                      </td>
                      <td className={cn('px-4 py-3 text-white', isTestCustomerName(quoteCustomerName) && 'text-red-300')}>
                        {quoteCustomerName || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs max-w-[240px]">
                        <QuoteDetailsCell quote={quote} />
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatCurrency(quote.total)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <SageStatusBadge status={sageStatus} />
                          <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, cfg.color)}>{cfg.label}</Badge>
                          {quote.commercial_status === 'closed' && (
                            <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-200 bg-slate-400/10')}>Archived</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <InvoiceProgressCell quote={quote} />
                      </td>
                    </tr>
                    {isExpanded ? previousVersions.map(version => {
                      const versionCfg = getQuoteStatusConfig(version.status);
                      const versionSageStatus = getQuoteSageStatus(version);
                      const versionCustomerName = version.customer?.company_name || quote.customer?.company_name;
                      return (
                        <tr
                          key={version.id}
                          onClick={() => onRowClick(version)}
                          className="cursor-pointer bg-slate-900/40 text-slate-400 transition-colors hover:bg-slate-800/40"
                        >
                          <td className="px-4 py-3 font-mono">
                            <div className="flex items-center gap-2 pl-8">
                              <ChevronRight className="h-3.5 w-3.5 rotate-90 text-slate-500" />
                              <span>{version.quote_reference}</span>
                            </div>
                          </td>
                          <td className={cn('px-4 py-3', isTestCustomerName(versionCustomerName) && 'text-red-300')}>
                            {versionCustomerName || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-[240px]">
                            <QuoteDetailsCell quote={version} muted />
                          </td>
                          <td className="px-4 py-3 text-xs">{format(new Date(version.quote_date), 'dd/MM/yyyy')}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatCurrency(version.total)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <SageStatusBadge status={versionSageStatus} />
                              <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionCfg.color)}>{versionCfg.label}</Badge>
                              {version.commercial_status === 'closed' && (
                                <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-300 bg-slate-400/10')}>Archived</Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <InvoiceProgressCell quote={version} />
                          </td>
                        </tr>
                      );
                    }) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? emptySearchMessage : emptyMessage}
          </div>
        ) : (
          visibleQuotes.map(quote => {
            const cfg = getQuoteStatusConfig(quote.status);
            const sageStatus = getQuoteSageStatus(quote);
            const previousVersions = quote.previous_versions || [];
            const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
            const quoteCustomerName = quote.customer?.company_name;
            return (
              <div
                key={quote.id}
                onClick={() => onRowClick(quote)}
                className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2 cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {previousVersions.length > 0 ? (
                      <button
                        type="button"
                        aria-label={isExpanded ? 'Collapse quote versions' : 'Expand quote versions'}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleThread(quote.quote_thread_id);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    ) : null}
                    <Receipt className="h-4 w-4 text-brand-yellow" />
                    <span className="font-mono font-semibold text-brand-yellow">{quote.quote_reference}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <SageStatusBadge status={sageStatus} />
                    <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, cfg.color)}>{cfg.label}</Badge>
                    {quote.commercial_status === 'closed' && (
                      <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-200 bg-slate-400/10')}>Archived</Badge>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400">{quote.version_label || 'Original'}</div>
                <div className="text-sm text-white">
                  <QuoteDetailsCell quote={quote} />
                </div>
                <div className={cn('text-xs text-slate-400', isTestCustomerName(quoteCustomerName) && 'text-red-300')}>
                  {quoteCustomerName}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</span>
                  <span className="font-semibold text-white">
                    {formatCurrency(quote.total)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <InvoiceProgressCell quote={quote} />
                </div>
                {isExpanded && previousVersions.length > 0 ? (
                  <div className="space-y-2 border-t border-slate-700/60 pt-3">
                    {previousVersions.map(version => {
                      const versionCfg = getQuoteStatusConfig(version.status);
                      return (
                        <button
                          key={version.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRowClick(version);
                          }}
                          className="block w-full rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ChevronRight className="h-3.5 w-3.5 rotate-90 text-slate-500" />
                              <span className="truncate font-mono text-xs text-slate-300">{version.quote_reference}</span>
                            </div>
                            <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionCfg.color)}>{versionCfg.label}</Badge>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {version.version_label || 'Original'}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                            <QuoteDetailsCell quote={version} muted />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <LoadMorePagination
        visibleCount={visibleQuotes.length}
        totalCount={filtered.length}
        itemLabel="quotes"
        onShowMore={showMore}
      />
    </div>
  );
}
