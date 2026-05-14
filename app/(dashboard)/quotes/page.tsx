'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { CalendarClock, Plus, Receipt, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QuotesTable } from './components/QuotesTable';
import { QuoteDetailsModal } from './components/QuoteDetailsModal';
import { QuoteFormDialog } from './components/QuoteFormDialog';
import type { Quote, QuoteFormData, QuoteListSummary, QuoteManagerOption, QuoteStatus } from './types';

interface CustomerOption {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  default_validity_days: number;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

function buildFormRequestError(payload: { error?: string; field_errors?: Record<string, string> }, fallback: string) {
  const error = new Error(payload.error || fallback) as Error & { fieldErrors?: Record<string, string> };
  error.fieldErrors = payload.field_errors || {};
  return error;
}

function buildQuotePayload(data: QuoteFormData) {
  const { attachment_files: _attachmentFiles, ...payload } = data;
  return payload;
}

async function uploadClientQuoteAttachments(quoteId: string, files?: File[]) {
  if (!files?.length) return;

  await Promise.all(files.map(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('is_client_visible', 'true');
    formData.append('attachment_purpose', 'client_pricing');

    const res = await fetch(`/api/quotes/${quoteId}/attachments`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `Failed to upload ${file.name}`);
    }
  }));
}

export default function QuotesPage() {
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const { hasPermission: canViewCustomers, loading: customerPermissionLoading } = usePermissionCheck('customers', false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const syncQuoteQuery = useCallback((nextQuoteId: string | null) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextQuoteId) {
      nextParams.set('quote_id', nextQuoteId);
    } else {
      nextParams.delete('quote_id');
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);


  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteSummary, setQuoteSummary] = useState<QuoteListSummary | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [managerOptions, setManagerOptions] = useState<QuoteManagerOption[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');
  const [pageTab, setPageTab] = useState<'overview' | 'settings'>('overview');

  // Modals
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const customerId = searchParams.get('customer_id');
  const quoteIdFromQuery = searchParams.get('quote_id');

  const fetchData = useCallback(async () => {
    try {
      const url = customerId ? `/api/quotes?customer_id=${customerId}` : '/api/quotes';
      const [quotesResult, customersResult, metadataRes] = await Promise.all([
        fetchAllPaginatedItems<Quote>(url, 'quotes', {
          limit: 250,
          errorMessage: 'Failed to load quotes',
        }),
        canViewCustomers
          ? fetchAllPaginatedItems<CustomerOption>('/api/customers', 'customers', {
            limit: 500,
            errorMessage: 'Failed to load customers',
          })
          : Promise.resolve({ items: [], firstPagePayload: null }),
        fetch('/api/quotes/metadata'),
      ]);

      setQuotes(quotesResult.items);
      setQuoteSummary((quotesResult.firstPagePayload?.summary as QuoteListSummary | undefined) || null);
      setCustomers(customersResult.items);
      if (metadataRes.ok) {
        const data = await metadataRes.json();
        setManagerOptions(data.managerOptions || []);
        setApprovers(data.approvers || []);
      }
    } catch (error) {
      const errorContextId = 'quotes-fetch-data-error';
      console.error('Error fetching data:', error, { errorContextId });
      toast.error('Unable to load quotes right now.', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [canViewCustomers, customerId]);

  useEffect(() => {
    if (permissionLoading || customerPermissionLoading) return;
    if (!canViewQuotes) {
      toast.error('You do not have access to quotes.', { id: 'quotes-access-denied' });
      router.push('/dashboard');
      return;
    }
    fetchData();
  }, [permissionLoading, customerPermissionLoading, canViewQuotes, router, fetchData]);

  useEffect(() => {
    setDetailQuoteId(quoteIdFromQuery);
  }, [quoteIdFromQuery]);

  async function handleCreate(data: QuoteFormData) {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuotePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to create quote');
    }
    const payload = await res.json();
    await uploadClientQuoteAttachments(payload.quote.id, data.attachment_files);
    toast.success('Quote created');
    await fetchData();
  }

  async function handleUpdate(data: QuoteFormData) {
    if (!editingQuote) return;
    const res = await fetch(`/api/quotes/${editingQuote.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuotePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to update quote');
    }
    await uploadClientQuoteAttachments(editingQuote.id, data.attachment_files);
    toast.success('Quote updated');
    setEditingQuote(null);
    await fetchData();
  }

  async function handleSubmit(data: QuoteFormData, isEdit: boolean) {
    if (isEdit) {
      await handleUpdate(data);
    } else {
      await handleCreate(data);
    }
  }

  function handleOpenQuoteDetails(nextQuoteId: string) {
    setDetailQuoteId(nextQuoteId);
    syncQuoteQuery(nextQuoteId);
  }

  function handleCloseQuoteDetails() {
    setDetailQuoteId(null);
    syncQuoteQuery(null);
  }

  function handleRowClick(quote: Quote) {
    handleOpenQuoteDetails(quote.id);
  }

  function handleEditFromModal(quote: Quote) {
    setEditingQuote(quote);
    setFormOpen(true);
  }

  if (permissionLoading || customerPermissionLoading || loading) {
    return <PageLoader message="Loading quotes..." />;
  }

  return (
    <AppPageShell>
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-brand-yellow/10">
              <Receipt className="h-5 w-5 text-brand-yellow" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
              <p className="text-muted-foreground">
                {customerId ? 'Track and manage quotes for this customer.' : 'Create, review, and manage customer quotations.'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link href="/quotes/work-calendar">
                <Button variant="outline" className="border-border text-muted-foreground">
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Work Calendar
                </Button>
              </Link>
              <Button
                onClick={() => {
                  if (!canViewCustomers) return;
                  setEditingQuote(null);
                  setFormOpen(true);
                }}
                disabled={!canViewCustomers}
                aria-describedby={!canViewCustomers ? 'quotes-customer-access-note' : undefined}
                className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Quote
              </Button>
            </div>
            {!canViewCustomers ? (
              <p id="quotes-customer-access-note" className="text-xs text-muted-foreground">
                Customer access is required to create quotes.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs value={pageTab} onValueChange={(value) => setPageTab(value as 'overview' | 'settings')}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Receipt className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-0">
          <QuotesTable
            quotes={quotes}
            statusCounts={quoteSummary?.status_counts}
            onRowClick={handleRowClick}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 mt-0">
          <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">Quote Settings</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Quote settings will be added here in a later update.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <QuoteDetailsModal
        open={!!detailQuoteId}
        onClose={handleCloseQuoteDetails}
        quoteId={detailQuoteId}
        onQuoteChange={handleOpenQuoteDetails}
        onEdit={handleEditFromModal}
        onRefresh={fetchData}
      />

      <QuoteFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingQuote(null); }}
        onSubmit={handleSubmit}
        quote={editingQuote}
        customers={customers}
        managerOptions={managerOptions}
        approvers={approvers}
        initialCustomerId={customerId}
      />
    </AppPageShell>
  );
}
