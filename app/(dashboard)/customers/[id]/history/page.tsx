'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  Pencil,
  Receipt,
  FileText,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import Link from 'next/link';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { CustomerFormDialog } from '../../components/CustomerFormDialog';
import type { Customer, CustomerFormData } from '../../types';
import { ACCEPTED_QUOTE_STATUSES, getQuoteStatusConfig, type QuoteListSummary, type QuoteStatus } from '@/app/(dashboard)/quotes/types';

interface QuoteSummary {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  version_label: string | null;
  subject_line: string | null;
  status: string;
  total: number;
  quote_date: string;
  po_number: string | null;
  commercial_status: 'open' | 'closed';
  invoice_summary?: {
    remainingBalance: number;
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CustomerHistoryPage({ params }: PageProps) {
  const { id } = use(params);
  const { hasPermission: canViewCustomers, loading: permissionLoading } = usePermissionCheck('customers', false);
  const sensitiveAccess = useSensitiveModuleAccess('customers');
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [quoteSummary, setQuoteSummary] = useState<QuoteListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const fetchCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setCustomer(data.customer);
    } catch {
      toast.error('Customer not found', { id: 'customers-history-load-customer-not-found' });
      router.push('/customers');
    }
  }, [id, router]);

  const fetchQuotes = useCallback(async () => {
    try {
      const result = await fetchAllPaginatedItems<QuoteSummary>(`/api/quotes?customer_id=${id}`, 'quotes', {
        limit: 250,
        errorMessage: 'Failed to fetch quotes',
      });
      setQuotes(result.items);
      setQuoteSummary((result.firstPagePayload?.summary as QuoteListSummary | undefined) || null);
    } catch {
      // quotes endpoint may not exist yet during incremental build
    }
  }, [id]);

  useEffect(() => {
    if (permissionLoading || sensitiveAccess.loading) return;
    if (!canViewCustomers) {
      router.push('/dashboard');
      return;
    }
    if (!sensitiveAccess.canAccess) return;
    Promise.all([fetchCustomer(), fetchQuotes()]).finally(() => setLoading(false));
  }, [permissionLoading, sensitiveAccess.loading, sensitiveAccess.canAccess, canViewCustomers, router, fetchCustomer, fetchQuotes]);

  async function handleUpdate(data: CustomerFormData) {
    const res = await fetch(`/api/customers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Update failed');
    toast.success('Customer updated');
    await fetchCustomer();
  }

  if (permissionLoading || sensitiveAccess.loading || (sensitiveAccess.canAccess && loading)) {
    return <PageLoader message="Loading customer history..." />;
  }

  if (!sensitiveAccess.canAccess) {
    return <SensitiveModuleGate moduleLabel="Customers" access={sensitiveAccess} />;
  }

  if (!customer) return null;

  const statusColor = customer.status === 'active'
    ? 'border-green-500/30 text-green-400 bg-green-500/10'
    : 'border-slate-500/30 text-slate-400 bg-slate-500/10';

  const totalQuotes = quoteSummary?.total_quotes ?? quotes.length;
  const acceptedQuotesCount = quoteSummary?.accepted_quotes ?? quotes.filter((quote) => ACCEPTED_QUOTE_STATUSES.has(quote.status as QuoteStatus)).length;
  const totalQuoteValue = quoteSummary?.accepted_value
    ?? quotes
      .filter((quote) => ACCEPTED_QUOTE_STATUSES.has(quote.status as QuoteStatus))
      .reduce((sum, quote) => sum + Number(quote.total || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <SensitiveModuleSessionManager moduleLabel="Customers" access={sensitiveAccess} />
      {/* Back nav */}
      <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Customers
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-brand-yellow/10">
            <Building2 className="h-6 w-6 text-brand-yellow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{customer.company_name}</h1>
              <Badge variant="outline" className={statusColor}>{customer.status}</Badge>
            </div>
            {customer.short_name && customer.short_name !== customer.company_name && (
              <p className="text-sm text-muted-foreground">{customer.short_name}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)} className="border-slate-600 text-muted-foreground hover:bg-slate-700/50">
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Link href={`/quotes?customer_id=${customer.id}`}>
            <Button className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold">
              <Receipt className="h-4 w-4 mr-1" /> View Quotes
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Total Quotes</p>
            </div>
            <p className="text-2xl font-bold text-white">{totalQuotes}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-green-400" />
              <p className="text-xs text-muted-foreground font-medium">Accepted</p>
            </div>
            <p className="text-2xl font-bold text-white">{acceptedQuotesCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-brand-yellow" />
              <p className="text-xs text-muted-foreground font-medium">Total Value</p>
            </div>
            <p className="text-2xl font-bold text-white">
              {totalQuoteValue > 0 ? `£${totalQuoteValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Payment Terms</p>
            </div>
            <p className="text-2xl font-bold text-white">{customer.payment_terms_days} days</p>
          </CardContent>
        </Card>
      </div>

      {/* Contact & Address Details */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary Contact</p>
              {customer.contact_name ? (
                <div className="mt-1">
                  <span className="font-medium text-white">{customer.contact_name}</span>
                  {customer.contact_job_title && (
                    <span className="text-muted-foreground"> — {customer.contact_job_title}</span>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">No primary contact name on file</p>
              )}
            </div>
            {customer.contact_email && (
              <div className="flex items-center gap-2 text-slate-300">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${customer.contact_email}`} className="hover:text-brand-yellow transition-colors">{customer.contact_email}</a>
              </div>
            )}
            {customer.contact_phone && (
              <div className="flex items-center gap-2 text-slate-300">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {customer.contact_phone}
              </div>
            )}

            {customer.secondary_contacts?.length ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secondary Contacts</p>
                <div className="space-y-2">
                  {customer.secondary_contacts.map(contact => (
                    <div key={contact.id} className="rounded-md border border-slate-700/70 bg-slate-950/30 p-2">
                      <p className="font-medium text-white">{contact.name || 'Unnamed contact'}</p>
                      {contact.job_title && <p className="text-xs text-muted-foreground">{contact.job_title}</p>}
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-300">
                        {contact.email && <a href={`mailto:${contact.email}`} className="hover:text-brand-yellow">{contact.email}</a>}
                        {contact.phone && <span>{contact.phone}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-300">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                {customer.address_line_1 && <p>{customer.address_line_1}</p>}
                {customer.address_line_2 && <p>{customer.address_line_2}</p>}
                {(customer.city || customer.county) && (
                  <p>{[customer.city, customer.county].filter(Boolean).join(', ')}</p>
                )}
                {customer.postcode && <p>{customer.postcode}</p>}
                {!customer.address_line_1 && !customer.city && (
                  <p className="text-muted-foreground">No address on file</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quote History */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Receipt className="h-5 w-5 text-brand-yellow" /> Quote History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>No quotes for this customer yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {quotes.map(q => (
                <Link key={q.id} href={`/quotes?customer_id=${customer.id}&quote_id=${q.id}`} className="block group">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 hover:bg-slate-700/50 border border-slate-700/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-brand-yellow text-sm">{q.quote_reference}</span>
                      <div>
                        <span className="text-sm text-slate-300 truncate max-w-[200px] block">{q.subject_line || 'Untitled'}</span>
                        <span className="text-xs text-muted-foreground">
                          {q.version_label || 'Original'}{q.po_number ? ` • PO ${q.po_number}` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{format(new Date(q.quote_date), 'dd/MM/yyyy')}</span>
                      <span className="text-sm font-semibold text-white">
                        £{Number(q.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </span>
                      {typeof q.invoice_summary?.remainingBalance === 'number' && (
                        <span className="text-xs text-muted-foreground">
                          Balance £{Number(q.invoice_summary.remainingBalance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs capitalize">
                          {getQuoteStatusConfig(q.status).label}
                        </Badge>
                        {q.commercial_status === 'closed' && (
                          <Badge variant="outline" className="text-xs border-slate-300/30 text-slate-200 bg-slate-400/10">
                            Archived
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {customer.notes && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{customer.notes}</p>
          </CardContent>
        </Card>
      )}

      <CustomerFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate}
        customer={customer}
      />
    </div>
  );
}
