'use client';

import { Fragment, useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import type { Quote, QuoteListSummary, QuoteStatus } from '../types';
import { ACTIVE_QUOTE_STATUS_ORDER, getQuoteStatusConfig } from '../types';

interface QuotesTableProps {
  quotes: Quote[];
  statusCounts?: QuoteListSummary['status_counts'];
  onRowClick: (quote: Quote) => void;
  statusFilter: QuoteStatus | 'all';
  onStatusFilterChange: (s: QuoteStatus | 'all') => void;
}

type SortField = 'quote_reference' | 'customer' | 'quote_date' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

const BILLING_FILTER_OPTIONS = [
  { value: 'all', label: 'All billing' },
  { value: 'not_invoiced', label: 'Not billed' },
  { value: 'partially_invoiced', label: 'Part billed' },
  { value: 'invoiced', label: 'Fully billed' },
] as const;

const PO_FILTER_OPTIONS = [
  { value: 'all', label: 'All PO' },
  { value: 'with_po', label: 'With PO' },
  { value: 'without_po', label: 'No PO' },
] as const;

const COMMERCIAL_FILTER_OPTIONS = [
  { value: 'all', label: 'All commercial' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Archived' },
] as const;

export function QuotesTable({
  quotes,
  statusCounts: providedStatusCounts,
  onRowClick,
  statusFilter,
  onStatusFilterChange,
}: QuotesTableProps) {
  const [search, setSearch] = useState('');
  const [poFilter, setPoFilter] = useState<'all' | 'with_po' | 'without_po'>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'not_invoiced' | 'partially_invoiced' | 'invoiced'>('all');
  const [commercialFilter, setCommercialFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [sortField, setSortField] = useState<SortField>('quote_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

  function quoteMatchesSearch(quote: Quote, query: string) {
    return (
      quote.quote_reference.toLowerCase().includes(query) ||
      quote.base_quote_reference.toLowerCase().includes(query) ||
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

    if (statusFilter !== 'all') {
      list = list.filter(q => q.status === statusFilter);
    }

    if (poFilter === 'with_po') {
      list = list.filter(q => Boolean(q.po_number));
    } else if (poFilter === 'without_po') {
      list = list.filter(q => !q.po_number);
    }

    if (invoiceFilter !== 'all') {
      list = list.filter(q => q.invoice_summary?.status === invoiceFilter);
    }

    if (commercialFilter !== 'all') {
      list = list.filter(q => q.commercial_status === commercialFilter);
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
  }, [quotes, search, statusFilter, poFilter, invoiceFilter, commercialFilter, sortField, sortDir]);

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
    if (providedStatusCounts) {
      return providedStatusCounts;
    }

    const counts: Partial<Record<QuoteStatus | 'all', number>> = { all: quotes.length };
    quotes.forEach(q => { counts[q.status] = (counts[q.status] || 0) + 1; });
    return counts;
  }, [providedStatusCounts, quotes]);

  function toggleThread(threadId: string) {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  }

  const hasSecondaryFilters = poFilter !== 'all' || invoiceFilter !== 'all' || commercialFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Select value={poFilter} onValueChange={(value: 'all' | 'with_po' | 'without_po') => setPoFilter(value)}>
            <SelectTrigger className="w-full bg-slate-800 border-slate-600 text-white sm:w-[140px]">
              <SelectValue placeholder="PO" />
            </SelectTrigger>
            <SelectContent>
              {PO_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={invoiceFilter}
            onValueChange={(value: 'all' | 'not_invoiced' | 'partially_invoiced' | 'invoiced') => setInvoiceFilter(value)}
          >
            <SelectTrigger className="w-full bg-slate-800 border-slate-600 text-white sm:w-[150px]">
              <SelectValue placeholder="Billing" />
            </SelectTrigger>
            <SelectContent>
              {BILLING_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={commercialFilter} onValueChange={(value: 'all' | 'open' | 'closed') => setCommercialFilter(value)}>
            <SelectTrigger className="w-full bg-slate-800 border-slate-600 text-white sm:w-[165px]">
              <SelectValue placeholder="Commercial" />
            </SelectTrigger>
            <SelectContent>
              {COMMERCIAL_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasSecondaryFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPoFilter('all');
                setInvoiceFilter('all');
                setCommercialFilter('all');
              }}
              className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
            >
              Reset Filters
            </Button>
          ) : null}
        </div>
      </div>

      {/* Status filter chips */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Workflow Status</p>
        <div className="flex flex-wrap gap-2">
        {(['all', ...ACTIVE_QUOTE_STATUS_ORDER] as const).map(s => {
          const cfg = s === 'all' ? { label: 'All', color: '' } : getQuoteStatusConfig(s);
          const count = statusCounts[s] || 0;
          const isActive = statusFilter === s;
          return (
            <Button
              key={s}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => onStatusFilterChange(s)}
              className={isActive
                ? 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90'
                : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'
              }
            >
              {cfg.label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </Button>
          );
        })}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_reference')}>
                Reference {renderSortIcon('quote_reference')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Version</th>
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
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">PO Number</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                Status {renderSortIcon('status')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Invoice</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-muted-foreground">
                  {search ? 'No quotes match your search.' : 'No quotes yet. Create your first quote to get started.'}
                </td>
              </tr>
            ) : (
              filtered.map(quote => {
                const cfg = getQuoteStatusConfig(quote.status);
                const previousVersions = quote.previous_versions || [];
                const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
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
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <span>{quote.version_label || 'Original'}</span>
                      </td>
                      <td className="px-4 py-3 text-white">{quote.customer?.company_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs truncate max-w-[200px]">{quote.subject_line || '—'}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        £{Number(quote.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">{quote.po_number || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                          {quote.commercial_status === 'closed' && (
                            <Badge variant="outline" className="border-slate-300/30 text-slate-200 bg-slate-400/10">Archived</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">{quote.invoice_summary?.status.replace(/_/g, ' ') || quote.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        £{Number(quote.invoice_summary?.remainingBalance ?? quote.total ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    {isExpanded ? previousVersions.map(version => {
                      const versionCfg = getQuoteStatusConfig(version.status);
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
                          <td className="px-4 py-3 text-xs">
                            <span>{version.version_label || 'Original'}</span>
                          </td>
                          <td className="px-4 py-3">{version.customer?.company_name || quote.customer?.company_name || '—'}</td>
                          <td className="px-4 py-3 text-xs truncate max-w-[200px]">{version.subject_line || '—'}</td>
                          <td className="px-4 py-3 text-xs">{format(new Date(version.quote_date), 'dd/MM/yyyy')}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            £{Number(version.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-xs">{version.po_number || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className={versionCfg.color}>{versionCfg.label}</Badge>
                              {version.commercial_status === 'closed' && (
                                <Badge variant="outline" className="border-slate-300/30 text-slate-300 bg-slate-400/10">Archived</Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">{version.invoice_summary?.status.replace(/_/g, ' ') || version.invoice_number || '—'}</td>
                          <td className="px-4 py-3 text-xs">
                            £{Number(version.invoice_summary?.remainingBalance ?? version.total ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
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
            {search ? 'No quotes match your search.' : 'No quotes yet.'}
          </div>
        ) : (
          filtered.map(quote => {
            const cfg = getQuoteStatusConfig(quote.status);
            const previousVersions = quote.previous_versions || [];
            const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
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
                    <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                    {quote.commercial_status === 'closed' && (
                      <Badge variant="outline" className="border-slate-300/30 text-slate-200 bg-slate-400/10">Archived</Badge>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400">{quote.version_label || 'Original'}</div>
                <div className="text-sm text-white">{quote.customer?.company_name}</div>
                {quote.subject_line && (
                  <div className="text-xs text-muted-foreground truncate">{quote.subject_line}</div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</span>
                  <span className="font-semibold text-white">
                    £{Number(quote.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Remaining: £{Number(quote.invoice_summary?.remainingBalance ?? quote.total ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
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
                            <Badge variant="outline" className={versionCfg.color}>{versionCfg.label}</Badge>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {version.version_label || 'Original'}
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
    </div>
  );
}
