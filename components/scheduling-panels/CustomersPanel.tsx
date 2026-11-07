'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { acknowledgeSuccess } from '@/lib/client/action-feedback';
import type { Customer, CustomerFormData } from '@/app/(dashboard)/customers/types';
import { PanelAccess } from './PanelAccess';
import { panelRequest, usePanelList } from './panel-data';

const CustomerFormDialog = dynamic(() => import('@/app/(dashboard)/customers/components/CustomerFormDialog').then(module => module.CustomerFormDialog));
const CustomerSiteFormDialog = dynamic(() => import('@/app/(dashboard)/customers/components/CustomerSiteFormDialog').then(module => module.CustomerSiteFormDialog));
const QuotesPanel = dynamic(() => import('./QuotesPanel').then(module => module.QuotesPanel));

export function CustomersPanel() {
  const list = usePanelList<Customer>('/api/customers', 'customers');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ customer: Customer | null } | null>(null);
  const [siteOpen, setSiteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const customer = list.items.find(item => item.id === selectedId);
  const matches = list.items.filter(item => [item.company_name, item.short_name, item.contact_name, item.contact_email, item.postcode]
    .filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase().trim()));

  async function save(data: CustomerFormData) {
    const id = editor?.customer?.id;
    const payload = await panelRequest<{ customer: Customer }>(id ? `/api/customers/${id}` : '/api/customers', {
      method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    list.saved(payload.customer);
    setSelectedId(payload.customer.id);
    acknowledgeSuccess();
  }

  async function editCustomer() {
    if (!customer) return;
    try {
      const result = await panelRequest<{ customer: Customer }>(`/api/customers/${customer.id}`);
      setEditor({ customer: result.customer });
    } catch (error) {
      const { toast } = await import('sonner');
      toast.error(error instanceof Error ? error.message : 'Unable to load customer.');
    }
  }

  return <div className="space-y-4">
    {list.error && <div role="alert" className="rounded border border-amber-500/40 p-3 text-sm text-amber-200">
      {list.error.message} <Button variant="ghost" onClick={() => void list.refresh()}>Retry</Button>
    </div>}
    {customer ? <>
      <Button variant="ghost" onClick={() => { setSelectedId(null); setHistoryOpen(false); }}><ArrowLeft className="mr-2 h-4 w-4" />Customer list</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{customer.company_name}</h2><p className="text-sm text-slate-400">{customer.short_name} / {customer.status}</p></div>
        <Button variant="outline" onClick={() => void editCustomer()}><Pencil className="mr-2 h-4 w-4" />Edit customer & sites</Button>
      </div>
      <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <h3 className="font-semibold">Contact details</h3>
        <p>{[customer.contact_name, customer.contact_job_title].filter(Boolean).join(' - ') || 'No primary contact'}</p>
        {customer.contact_email && <p><a className="break-all text-brand-yellow" href={`mailto:${customer.contact_email}`}>{customer.contact_email}</a></p>}
        {customer.contact_phone && <p>{customer.contact_phone}</p>}
        <p className="whitespace-pre-line text-sm text-slate-300">{[customer.address_line_1, customer.address_line_2, customer.city, customer.county, customer.postcode].filter(Boolean).join('\n')}</p>
        {(customer.secondary_contacts || []).map(contact => <div key={contact.id} className="border-t border-slate-700 pt-2 text-sm">
          <p>{[contact.name, contact.job_title].filter(Boolean).join(' - ')}</p>
          <p className="break-all">{[contact.email, contact.phone].filter(Boolean).join(' / ')}</p>
        </div>)}
        {customer.notes && <p className="whitespace-pre-wrap text-sm text-slate-400">{customer.notes}</p>}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Sites</h3><Button variant="outline" onClick={() => setSiteOpen(true)}><Plus className="mr-2 h-4 w-4" />Add site</Button></div>
        <p className="text-xs text-slate-400">Use Edit customer & sites to update existing sites.</p>
        {(customer.sites || []).map(site => <div key={site.id} className="rounded-lg border border-slate-700 p-3">
          <h4 className="font-medium">{site.site_name}{site.is_default ? ' (default)' : ''}{!site.is_active ? ' (inactive)' : ''}</h4>
          <p className="text-sm text-slate-400">{[site.address_line_1, site.address_line_2, site.city, site.county, site.postcode].filter(Boolean).join(', ')}</p>
          {site.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{site.notes}</p>}
        </div>)}
        {!customer.sites?.length && <p className="text-sm text-slate-400">No sites yet.</p>}
      </section>
      <section className="space-y-3 border-t border-slate-700 pt-4">
        <Button variant="outline" onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? 'Hide quotes & history' : 'Show quotes & history'}</Button>
        {historyOpen && <PanelAccess module="quotes"><QuotesPanel customerId={customer.id} history /></PanelAccess>}
      </section>
    </> : <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">Customers, contacts and sites</p>
        <Button className="bg-brand-yellow font-semibold text-slate-900 hover:bg-brand-yellow/90" onClick={() => setEditor({ customer: null })}><Plus className="mr-2 h-4 w-4" />Add Customer</Button>
      </div>
      <Input aria-label="Search customers" placeholder="Search customers or contacts..." value={search} onChange={event => setSearch(event.target.value)} className="border-slate-600 bg-slate-800" />
      {list.loading && <p role="status">Loading customers...</p>}
      <div className="space-y-2">{matches.map(item => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="w-full rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-left hover:border-brand-yellow focus-visible:ring-2 focus-visible:ring-brand-yellow">
        <span className="block font-semibold">{item.company_name}</span>
        <span className="block break-words text-sm text-slate-400">{[item.contact_name, item.contact_email, item.postcode].filter(Boolean).join(' / ')}</span>
      </button>)}</div>
      {!list.loading && !matches.length && <p className="text-slate-400">No matching customers.</p>}
    </>}
    {editor && <CustomerFormDialog open customer={editor.customer} onClose={() => setEditor(null)} onSubmit={save} />}
    {customer && siteOpen && <CustomerSiteFormDialog open customerId={customer.id} onClose={() => setSiteOpen(false)} onCreated={site => {
      list.saved({ ...customer, sites: [site, ...(customer.sites || []).filter(existing => existing.id !== site.id)] });
      acknowledgeSuccess();
    }} />}
  </div>;
}
