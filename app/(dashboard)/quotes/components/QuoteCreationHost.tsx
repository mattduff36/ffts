'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { toast } from 'sonner';
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
  }

  return open ? (
    <QuoteFormDialog
      open
      onClose={onClose}
      onSubmit={handleSubmit}
      quote={null}
      customers={customers}
      managerOptions={managerOptions}
      approvers={approvers}
    />
  ) : null;
}
