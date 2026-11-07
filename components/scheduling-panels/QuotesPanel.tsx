'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ComponentProps } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { QuoteQuickActionsMenu } from '@/app/(dashboard)/quotes/components/QuoteQuickActionsMenu';
import { QuoteMarkAsAcceptedDialog } from '@/app/(dashboard)/quotes/components/QuoteMarkAsAcceptedDialog';
import { ACTIVE_QUOTE_STATUS_ORDER, getQuoteStatusConfig, type Quote, type QuoteFormData, type QuoteFormSubmitIntent, type QuoteManagerOption } from '@/app/(dashboard)/quotes/types';
import { buildQuoteCreatePayload, markQuoteAsSent, runQuoteWorkflowAction, uploadClientQuoteAttachments } from '@/app/(dashboard)/quotes/quote-creation-client';
import type { QuoteQuickWorkflowAction } from '@/app/(dashboard)/quotes/quote-quick-actions';
import type { Customer, CustomerFormData } from '@/app/(dashboard)/customers/types';
import { acknowledgeSuccess } from '@/lib/client/action-feedback';
import { PanelAccess } from './PanelAccess';
import { panelRequest, savedFollowUpWarning, usePanelList } from './panel-data';

const QuoteDetailsModal = dynamic(() => import('@/app/(dashboard)/quotes/components/QuoteDetailsModal').then(module => module.QuoteDetailsModal));
const QuoteFormDialog = dynamic(() => import('@/app/(dashboard)/quotes/components/QuoteFormDialog').then(module => module.QuoteFormDialog));
const CustomerFormDialog = dynamic(() => import('@/app/(dashboard)/customers/components/CustomerFormDialog').then(module => module.CustomerFormDialog));
type Metadata = Pick<ComponentProps<typeof QuoteFormDialog>, 'managerOptions' | 'approvers'>;

export function QuotesPanel({ customerId, history = false }: { customerId?: string; history?: boolean }) {
  const list = usePanelList<Quote>(`/api/quotes?include_summary=false${customerId ? `&customer_id=${encodeURIComponent(customerId)}` : ''}`, 'quotes');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ quote: Quote | null } | null>(null);
  const [acceptQuote, setAcceptQuote] = useState<Quote | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [managerOptions, setManagerOptions] = useState<QuoteManagerOption[]>([]);
  useEffect(() => {
    let active = true;
    void panelRequest<Metadata>('/api/quotes/metadata').then(data => { if (active) setManagerOptions(data.managerOptions); })
      .catch(error => { if (active) toast.error(error.message); });
    return () => { active = false; };
  }, []);
  const matches = list.items.filter(quote => (history || (quote.status !== 'closed' && quote.commercial_status !== 'closed'))
    && (status === 'all' || quote.status === status)
    && [quote.quote_reference, quote.customer?.company_name, quote.subject_line, quote.project_description, quote.customer_site?.site_name]
      .filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()));

  async function workflow(quote: Quote, action: QuoteQuickWorkflowAction) {
    if (action === 'mark_as_accepted') { setAcceptQuote(quote); return; }
    if (action === 'request_po' || action === 'schedule' || action === 'mark_complete') { setDetailId(quote.id); return; }
    setBusyId(quote.id);
    try {
      list.saved(await runQuoteWorkflowAction(quote.id, action));
      acknowledgeSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update quote.');
    } finally { setBusyId(null); }
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">{history ? 'Customer quotes & history' : 'Current quotes'}</h2>
      <Button className="bg-brand-yellow font-semibold text-slate-900 hover:bg-brand-yellow/90" onClick={() => setEditor({ quote: null })}><Plus className="mr-2 h-4 w-4" />New Quote</Button>
    </div>
    <div className="flex flex-wrap gap-2">
      <Input aria-label="Search quotes" placeholder="Search quotes, customers or sites..." value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 border-slate-600 bg-slate-800" />
      <select aria-label="Quote status" value={status} onChange={event => setStatus(event.target.value)} className="h-10 max-w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm">
        <option value="all">All statuses</option>
        {[...ACTIVE_QUOTE_STATUS_ORDER, ...(history ? ['closed'] : [])].map(value => <option key={value} value={value}>{getQuoteStatusConfig(value).label}</option>)}
      </select>
    </div>
    {list.error && <div role="alert" className="rounded border border-amber-500/40 p-3 text-sm text-amber-200">{list.error.message} <Button variant="ghost" onClick={() => void list.refresh()}>Retry</Button></div>}
    {list.loading && <p role="status">Loading quotes...</p>}
    <div className="space-y-2">{matches.map(quote => <article key={quote.id} className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <button type="button" onClick={() => setDetailId(quote.id)} className="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-brand-yellow">
        <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-white">{quote.quote_reference}</span><Badge variant="outline" className={getQuoteStatusConfig(quote.status).color}>{getQuoteStatusConfig(quote.status).label}</Badge></span>
        <span className="mt-1 block font-medium">{quote.subject_line || quote.project_description}</span>
        <span className="block text-sm text-slate-400">{[quote.customer?.company_name, quote.customer_site?.site_name].filter(Boolean).join(' / ')}</span>
      </button>
      <QuoteQuickActionsMenu quote={quote} onViewDetails={setDetailId} onEdit={quote => setEditor({ quote })} onWorkflowAction={(quote, action) => void workflow(quote, action)} actionLoading={busyId === quote.id} />
    </article>)}</div>
    {!list.loading && !matches.length && <p className="text-slate-400">No matching quotes.</p>}
    {detailId && <QuoteDetailsModal open quoteId={detailId} onClose={() => setDetailId(null)} onQuoteChange={setDetailId} onEdit={quote => setEditor({ quote })} managerOptions={managerOptions} onRefresh={quote => list.saved(quote)} />}
    {editor && <div className="rounded-lg border border-slate-700 p-3">
      <PanelAccess module="customers"><QuoteEditor quote={editor.quote} customerId={customerId} onClose={() => setEditor(null)} onSaved={quote => list.saved(quote)} /></PanelAccess>
      <Button variant="ghost" onClick={() => setEditor(null)}>Cancel opening quote editor</Button>
    </div>}
    <QuoteMarkAsAcceptedDialog open={!!acceptQuote} quoteId={acceptQuote?.id || null} actionLoading={!!busyId} onOpenChange={open => { if (!open) setAcceptQuote(null); }} onAcceptWithoutRams={async () => {
      if (!acceptQuote) return;
      setBusyId(acceptQuote.id);
      try {
        list.saved(await runQuoteWorkflowAction(acceptQuote.id, 'mark_as_accepted'));
        setAcceptQuote(null);
        acknowledgeSuccess();
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to accept quote.'); }
      finally { setBusyId(null); }
    }} onRamsAccepted={result => {
      if (result.email_warning) toast.warning('Quote accepted with a RAMS email warning', { description: result.email_warning });
      else acknowledgeSuccess();
      list.saved();
      setAcceptQuote(null);
    }} />
  </div>;
}

function QuoteEditor({ quote: initialQuote, customerId, onClose, onSaved }: {
  quote: Quote | null; customerId?: string; onClose: () => void; onSaved: (quote: Quote) => void;
}) {
  const customers = usePanelList<Customer>('/api/customers', 'customers');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [quote, setQuote] = useState(initialQuote);
  const [ready, setReady] = useState(!initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      panelRequest<Metadata>('/api/quotes/metadata'),
      initialQuote ? panelRequest<{ quote: Quote }>(`/api/quotes/${initialQuote.id}`) : Promise.resolve(null),
    ]).then(([metadata, result]) => {
      if (!active) return;
      setMetadata(metadata);
      if (result) setQuote(result.quote);
      setReady(true);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [initialQuote]);

  async function save(data: QuoteFormData, _isEdit: boolean, intent: QuoteFormSubmitIntent = 'save') {
    const payload = await panelRequest<{ quote: Quote }>(quote ? `/api/quotes/${quote.id}` : '/api/quotes', {
      method: quote ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildQuoteCreatePayload(data)),
    });
    setQuote(payload.quote);
    onSaved(payload.quote);
    acknowledgeSuccess();
    try {
      await uploadClientQuoteAttachments(payload.quote.id, data.attachment_files);
      if (intent === 'mark_as_sent') onSaved(await markQuoteAsSent(payload.quote.id));
    } catch (error) { savedFollowUpWarning(error); }
  }
  async function createCustomer(data: CustomerFormData) {
    const result = await panelRequest<{ customer: Customer }>('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    customers.saved(result.customer);
    setCreatedCustomerId(result.customer.id);
    acknowledgeSuccess();
  }
  if (error) return <p role="alert">{error}</p>;
  if (!ready || !metadata || customers.loading) return <p role="status">Loading quote editor...</p>;
  return <>
    {customers.error && <p role="alert">{customers.error.message} <Button variant="ghost" onClick={() => void customers.refresh()}>Retry</Button></p>}
    <QuoteFormDialog open quote={quote} customers={customers.items} managerOptions={metadata.managerOptions} approvers={metadata.approvers} initialCustomerId={customerId}
      onClose={onClose} onSubmit={save} onAddCustomer={() => setCustomerOpen(true)} createdCustomerId={createdCustomerId} onCreatedCustomerApplied={() => setCreatedCustomerId(null)}
      onAttachmentsChange={async id => {
        const result = await panelRequest<{ quote: Quote }>(`/api/quotes/${id}`);
        setQuote(result.quote); onSaved(result.quote); return result.quote;
      }}
      onSiteCreated={site => {
        const customer = customers.items.find(customer => customer.id === site.customer_id);
        if (customer) customers.saved({ ...customer, sites: [site, ...(customer.sites || []).filter(item => item.id !== site.id)] });
      }} />
    {customerOpen && <CustomerFormDialog open onClose={() => setCustomerOpen(false)} onSubmit={createCustomer} />}
  </>;
}
