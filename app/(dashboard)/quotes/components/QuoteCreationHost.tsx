'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { toast } from 'sonner';
import { CustomerFormDialog } from '@/app/(dashboard)/customers/components/CustomerFormDialog';
import type { CustomerFormData } from '@/app/(dashboard)/customers/types';
import { QuoteFormDialog } from './QuoteFormDialog';
import type { Quote, QuoteFormData, QuoteFormSubmitIntent } from '../types';
import { createQuoteWithAttachments, markQuoteAsSent } from '../quote-creation-client';

interface QuoteCreationHostProps {
  open: boolean;
  onClose: () => void;
  onCreated: (quote: Quote) => void | Promise<void>;
}

type QuoteFormProps = ComponentProps<typeof QuoteFormDialog>;

export function QuoteCreationHost({ open, onClose, onCreated }: QuoteCreationHostProps) {
  const [customers, setCustomers] = useState<QuoteFormProps['customers']>([]);
  const [managerOptions, setManagerOptions] = useState<QuoteFormProps['managerOptions']>([]);
  const [approvers, setApprovers] = useState<QuoteFormProps['approvers']>([]);
  const submittingRef = useRef(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch('/api/quotes/metadata?include_customers=true')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load Quote metadata.');
        setCustomers(payload.customers || []);
        setManagerOptions(payload.managerOptions || []);
        setApprovers(payload.approvers || []);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Unable to load Quote metadata.'));
  }, [open]);

  async function handleSubmit(data: QuoteFormData, _isEdit: boolean, intent: QuoteFormSubmitIntent = 'save') {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const quote = await createQuoteWithAttachments(data);
      if (intent === 'mark_as_sent') {
        try {
          const sentQuote = await markQuoteAsSent(quote.id);
          await onCreated(sentQuote);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Quote saved, but it could not be marked as sent.');
          await onCreated(quote);
        }
      } else {
        await onCreated(quote);
      }
      onClose();
    } finally {
      submittingRef.current = false;
    }
  }

  async function createCustomer(data: CustomerFormData) {
    const response = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const payload = await response.json();
    if (!response.ok || !payload.customer?.id) throw new Error(payload.error || 'Unable to create customer.');
    setCustomers(current => [payload.customer, ...current.filter(customer => customer.id !== payload.customer.id)]);
    setCreatedCustomerId(payload.customer.id);
  }

  return open ? (<>
    {customerOpen && <CustomerFormDialog open onClose={() => setCustomerOpen(false)} onSubmit={createCustomer} />}

    <QuoteFormDialog
      open
      onClose={onClose}
      onSubmit={handleSubmit}
      quote={null}
      customers={customers}
      managerOptions={managerOptions}
      approvers={approvers}
      onAddCustomer={() => setCustomerOpen(true)}
      createdCustomerId={createdCustomerId}
      onCreatedCustomerApplied={() => setCreatedCustomerId(null)}
      onSiteCreated={site => setCustomers(current => current.map(customer => customer.id === site.customer_id
        ? { ...customer, sites: [site, ...(customer.sites || []).filter(existing => existing.id !== site.id)] } : customer))}
    />
  </>) : null;
}
