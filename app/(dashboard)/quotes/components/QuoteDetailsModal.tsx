'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  FileDown,
  Send,
  Files,
  Copy,
  Receipt,
  CalendarClock,
  Pencil,
  Upload,
  FolderKanban,
  Trash2,
  Clock3,
  CheckCircle2,
  Mail,
  Paperclip,
  FileEdit,
  GitBranch,
  CircleDot,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils/cn';
import type { Quote, QuoteCompletionStatus, QuoteRevisionType } from '../types';
import { getQuoteStatusConfig } from '../types';

const PO_EDITABLE_STATUSES = new Set([
  'sent',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
]);

interface QuoteDetailsModalProps {
  open: boolean;
  onClose: () => void;
  quoteId: string | null;
  onQuoteChange: (quoteId: string) => void;
  onEdit: (quote: Quote) => void;
  onRefresh: () => void;
}

type DetailFieldErrors = Record<string, string>;

function getTimelineEventMeta(eventType: string) {
  switch (eventType) {
    case 'quote_created':
      return {
        icon: FileEdit,
        iconClassName: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
      };
    case 'quote_updated':
      return {
        icon: Pencil,
        iconClassName: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
      };
    case 'submitted_for_approval':
      return {
        icon: Send,
        iconClassName: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
      };
    case 'approved_and_sent':
    case 'confirmed_and_sent':
      return {
        icon: Mail,
        iconClassName: 'text-blue-300 bg-blue-500/10 border-blue-500/20',
      };
    case 'returned_for_changes':
      return {
        icon: Pencil,
        iconClassName: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
      };
    case 'po_details_saved':
      return {
        icon: FolderKanban,
        iconClassName: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
      };
    case 'rams_triggered':
      return {
        icon: FolderKanban,
        iconClassName: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
      };
    case 'schedule_updated':
      return {
        icon: CalendarClock,
        iconClassName: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
      };
    case 'marked_complete':
      return {
        icon: CheckCircle2,
        iconClassName: 'text-lime-300 bg-lime-500/10 border-lime-500/20',
      };
    case 'quote_closed':
      return {
        icon: CircleDot,
        iconClassName: 'text-slate-200 bg-slate-400/10 border-slate-400/20',
      };
    case 'quote_reopened':
      return {
        icon: CircleDot,
        iconClassName: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
      };
    case 'invoice_added':
      return {
        icon: Receipt,
        iconClassName: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20',
      };
    case 'attachment_uploaded':
      return {
        icon: Upload,
        iconClassName: 'text-teal-300 bg-teal-500/10 border-teal-500/20',
      };
    case 'attachment_removed':
      return {
        icon: Paperclip,
        iconClassName: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
      };
    case 'version_created':
      return {
        icon: GitBranch,
        iconClassName: 'text-purple-300 bg-purple-500/10 border-purple-500/20',
      };
    case 'quote_duplicated':
      return {
        icon: Copy,
        iconClassName: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
      };
    default:
      return {
        icon: Clock3,
        iconClassName: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
      };
  }
}

async function buildResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string; field_errors?: DetailFieldErrors } | null;
  const error = new Error(payload?.error || fallback) as Error & { fieldErrors?: DetailFieldErrors };
  error.fieldErrors = payload?.field_errors || {};
  return error;
}

export function QuoteDetailsModal({ open, onClose, quoteId, onQuoteChange, onEdit, onRefresh }: QuoteDetailsModalProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [currentQuoteId, setCurrentQuoteId] = useState<string | null>(quoteId);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [poValue, setPoValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startAlertDays, setStartAlertDays] = useState('');
  const [completionStatus, setCompletionStatus] = useState<QuoteCompletionStatus>('approved_in_full');
  const [completionComments, setCompletionComments] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceScope, setInvoiceScope] = useState<'full' | 'partial'>('partial');
  const [invoiceComments, setInvoiceComments] = useState('');
  const [revisionType, setRevisionType] = useState<QuoteRevisionType>('revision');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [ramsComments, setRamsComments] = useState('');
  const [ramsDialogOpen, setRamsDialogOpen] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowFieldErrors, setWorkflowFieldErrors] = useState<DetailFieldErrors>({});
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceFieldErrors, setInvoiceFieldErrors] = useState<DetailFieldErrors>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activeQuoteId = currentQuoteId || quoteId || quote?.id || null;
  const recipientEmail = quote?.attention_email || quote?.customer?.contact_email || '';
  const isLatestVersion = Boolean(quote?.is_latest_version);
  const isHistoricalVersion = Boolean(quote && !quote.is_latest_version);
  const canEditPoDetails = quote ? isLatestVersion && PO_EDITABLE_STATUSES.has(quote.status) : false;
  const canTriggerRams = Boolean(isLatestVersion && quote?.status === 'sent');
  const canManageSchedule = Boolean(isLatestVersion && quote && ['po_received', 'in_progress'].includes(quote.status));
  const canEditQuote = Boolean(isLatestVersion && quote && ['draft', 'changes_requested', 'pending_internal_approval'].includes(quote.status));
  const canDeleteDraft = Boolean(isLatestVersion && quote?.status === 'draft');
  const canManageInvoices = isLatestVersion;
  const canManageAttachments = isLatestVersion;
  const canCreateVersions = isLatestVersion;
  const hasMultipleVersions = (quote?.versions?.length ?? 0) > 1;
  const suggestedInvoiceAmount = Number(quote?.invoice_summary?.remainingBalance ?? quote?.total ?? 0);

  const groupedTimeline = useMemo(() => {
    const timeline = quote?.timeline ?? [];
    if (!timeline.length) {
      return [];
    }

    const groups = new Map<string, { label: string; events: typeof timeline }>();

    timeline.forEach((event) => {
      const groupKey = format(new Date(event.created_at), 'yyyy-MM-dd');
      const existing = groups.get(groupKey);
      if (existing) {
        existing.events.push(event);
        return;
      }

      groups.set(groupKey, {
        label: format(new Date(event.created_at), 'EEEE d MMM yyyy'),
        events: [event],
      });
    });

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      events: value.events,
    }));
  }, [quote?.timeline]);

  function getFieldClassName(errors: DetailFieldErrors, field: string) {
    return cn(
      'bg-slate-800',
      errors[field] ? 'border-red-500 focus-visible:ring-red-500/30' : 'border-slate-600'
    );
  }

  function getSelectClassName(errors: DetailFieldErrors, field: string) {
    return cn(
      'bg-slate-800',
      errors[field] ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600'
    );
  }

  function renderFieldError(errors: DetailFieldErrors, field: string) {
    if (!errors[field]) {
      return null;
    }

    return <p className="text-xs text-red-300">{errors[field]}</p>;
  }

  function clearWorkflowError(field?: string) {
    setWorkflowError(null);
    if (!field) {
      setWorkflowFieldErrors({});
      return;
    }

    setWorkflowFieldErrors(prev => {
      if (!(field in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function clearInvoiceError(field?: string) {
    setInvoiceError(null);
    if (!field) {
      setInvoiceFieldErrors({});
      return;
    }

    setInvoiceFieldErrors(prev => {
      if (!(field in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateInvoiceFields() {
    const errors: DetailFieldErrors = {};
    if (!invoiceNumber.trim()) {
      errors.invoice_number = 'Enter an invoice number.';
    }

    const amount = Number(invoiceAmount);
    if (!invoiceAmount || !Number.isFinite(amount) || amount <= 0) {
      errors.amount = 'Enter an invoice amount greater than 0.';
    }

    if (!invoiceDate) {
      errors.invoice_date = 'Enter an invoice date.';
    }

    if (Number.isFinite(amount) && amount - suggestedInvoiceAmount > 0.005) {
      errors.amount = `This quote has £${suggestedInvoiceAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} remaining. Create a new version first if the amount has increased.`;
    }

    return errors;
  }

  const applyQuoteState = useCallback((nextQuote: Quote) => {
    setQuote(nextQuote);
    setPoNumber(nextQuote.po_number || '');
    setPoValue(nextQuote.po_value ? String(nextQuote.po_value) : '');
    setStartDate(nextQuote.start_date || '');
    setStartAlertDays(nextQuote.start_alert_days ? String(nextQuote.start_alert_days) : '');
    setCompletionStatus(nextQuote.completion_status === 'approved_in_part' ? 'approved_in_part' : 'approved_in_full');
    setCompletionComments(nextQuote.completion_comments || '');
    setInvoiceNumber('');
    setInvoiceAmount(nextQuote.invoice_summary?.remainingBalance ? String(nextQuote.invoice_summary.remainingBalance) : '');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setInvoiceScope(nextQuote.invoice_summary?.remainingBalance === 0 ? 'partial' : 'full');
    setInvoiceComments('');
    setWorkflowError(null);
    setWorkflowFieldErrors({});
    setInvoiceError(null);
    setInvoiceFieldErrors({});
    setAttachmentError(null);
    setDeleteError(null);
  }, []);

  const selectQuoteVersion = useCallback((nextQuoteId: string) => {
    setCurrentQuoteId(nextQuoteId);
    onQuoteChange(nextQuoteId);
  }, [onQuoteChange]);

  const fetchQuote = useCallback(async () => {
    const idToLoad = activeQuoteId;
    if (!idToLoad) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/quotes/${idToLoad}`);
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to load quote details right now.');
      }
      const data = await res.json();
      applyQuoteState(data.quote);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load quote details right now.';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [activeQuoteId, applyQuoteState]);

  useEffect(() => {
    if (open) {
      setCurrentQuoteId(quoteId);
    }
  }, [open, quoteId]);

  useEffect(() => {
    if (open && activeQuoteId) {
      setQuote(null);
      fetchQuote();
    }
  }, [open, activeQuoteId, fetchQuote]);

  useEffect(() => {
    if (open && activeQuoteId) {
      setActiveTab('overview');
    }
  }, [open, activeQuoteId]);

  useEffect(() => {
    if (!open) {
      setCurrentQuoteId(null);
      setActiveTab('overview');
      setQuote(null);
      setLoadError(null);
      setWorkflowError(null);
      setWorkflowFieldErrors({});
      setInvoiceError(null);
      setInvoiceFieldErrors({});
      setAttachmentError(null);
      setDeleteError(null);
      setRamsDialogOpen(false);
      setRamsComments('');
    }
  }, [open]);

  async function updateQuote(
    updates: Record<string, unknown>,
    scope: 'workflow' | 'versions' | 'general' = 'workflow'
  ) {
    if (!activeQuoteId) return;
    setActionLoading(true);
    if (scope === 'workflow') {
      clearWorkflowError();
    }
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to update this quote right now.');
      }
      const data = await res.json();
      if (updates.action === 'create_revision' || updates.action === 'duplicate') {
        applyQuoteState(data.quote);
        selectQuoteVersion(data.quote.id);
      } else {
        await fetchQuote();
      }
      toast.success('Quote updated');
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update this quote right now.';
      const fieldErrors = error instanceof Error && 'fieldErrors' in error
        ? ((error as Error & { fieldErrors?: DetailFieldErrors }).fieldErrors || {})
        : {};

      if (scope === 'workflow') {
        setWorkflowError(message);
        setWorkflowFieldErrors(fieldErrors);
      }

      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  }

  async function callAction(action: string, payload?: Record<string, unknown>, scope: 'workflow' | 'versions' | 'general' = 'workflow') {
    await updateQuote({ action, ...(payload || {}) }, scope);
  }

  async function handleTriggerRams() {
    await callAction('trigger_rams', { rams_comments: ramsComments.trim() || null });
    setRamsDialogOpen(false);
    setRamsComments('');
  }

  async function handleAttachmentUpload(file: File) {
    if (!activeQuoteId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('is_client_visible', 'false');
    formData.append('attachment_purpose', 'internal');

    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to upload this attachment right now.');
      }

      toast.success('Attachment uploaded');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload this attachment right now.';
      setAttachmentError(message);
      toast.error(message);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function deleteAttachment(attachmentId: string) {
    if (!activeQuoteId) return;

    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/attachments/${attachmentId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to remove this attachment right now.');
      }
      toast.success('Attachment removed');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove this attachment right now.';
      setAttachmentError(message);
      toast.error(message);
    }
  }

  async function addInvoice() {
    if (!activeQuoteId) return;

    const nextInvoiceErrors = validateInvoiceFields();
    if (Object.keys(nextInvoiceErrors).length > 0) {
      setInvoiceFieldErrors(nextInvoiceErrors);
      setInvoiceError('Please correct the highlighted fields and try again.');
      toast.error('Please correct the highlighted fields and try again.');
      return;
    }

    setActionLoading(true);
    clearInvoiceError();
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          amount: Number(invoiceAmount),
          invoice_scope: invoiceScope,
          comments: invoiceComments,
        }),
      });

      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to add this invoice right now.');
      }

      toast.success('Invoice added');
      setInvoiceNumber('');
      setInvoiceAmount('');
      setInvoiceComments('');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add this invoice right now.';
      const fieldErrors = error instanceof Error && 'fieldErrors' in error
        ? ((error as Error & { fieldErrors?: DetailFieldErrors }).fieldErrors || {})
        : {};
      setInvoiceFieldErrors(fieldErrors);
      setInvoiceError(message);
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteQuote() {
    if (!activeQuoteId || !quote || !canDeleteDraft) {
      return;
    }

    const confirmMessage = hasMultipleVersions
      ? `Delete draft version ${quote.quote_reference}? This will only remove this draft version, not the whole quote history. This cannot be undone.`
      : `Delete draft quote ${quote.quote_reference}? This cannot be undone.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setActionLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to delete this quote right now.');
      }

      toast.success('Quote deleted');
      onClose();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete this quote right now.';
      setDeleteError(message);
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  }

  const statusConfig = quote ? getQuoteStatusConfig(quote.status) : null;

  if (!open) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
        <DialogHeader className="sr-only">
          <DialogTitle>Quote Details</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-brand-yellow" />
          </div>
        ) : !quote ? (
          <div className="space-y-4 py-8 text-center">
            <p className="text-sm text-red-200">{loadError || 'Unable to load quote details right now.'}</p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={onClose} className="border-slate-600 text-muted-foreground">
                Close
              </Button>
              {quoteId ? (
                <Button onClick={() => void fetchQuote()} className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90">
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="text-white flex items-center gap-2">
                  <span className="font-mono text-brand-yellow">{quote.quote_reference}</span>
                  <Badge variant="outline" className={statusConfig?.color}>
                    {statusConfig?.label}
                  </Badge>
                  {quote.commercial_status === 'closed' && (
                    <Badge variant="outline" className="border-slate-300/30 text-slate-200 bg-slate-400/10">
                      Archived
                    </Badge>
                  )}
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              {loadError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {loadError}
                </div>
              ) : null}

              {isHistoricalVersion ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  You are viewing an older quote version. Switch back to the latest version to edit, invoice, upload files, or delete.
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Customer</span>
                  <p className="font-medium text-white">{quote.customer?.company_name || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date</span>
                  <p className="text-white">{format(new Date(quote.quote_date), 'dd MMMM yyyy')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">For the attention of</span>
                  <p className="text-white">{quote.attention_name || '—'}</p>
                  {quote.attention_email && <p className="text-xs text-muted-foreground">{quote.attention_email}</p>}
                </div>
                <div>
                  <span className="text-muted-foreground">Title</span>
                  <p className="text-white">{quote.subject_line || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Manager</span>
                  <p className="text-white">{quote.manager_name || '—'}</p>
                  {quote.manager_email && <p className="text-xs text-muted-foreground">{quote.manager_email}</p>}
                </div>
                <div>
                  <span className="text-muted-foreground">Version</span>
                  <p className="text-white">{quote.version_label || 'Original'}</p>
                  {quote.base_quote_reference && quote.base_quote_reference !== quote.quote_reference && (
                    <p className="text-xs text-muted-foreground">Base: {quote.base_quote_reference}</p>
                  )}
                </div>
              </div>

              {quote.site_address && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Site Address</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.site_address}</p>
                </div>
              )}

              {quote.project_description && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Summary</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.project_description}</p>
                </div>
              )}

              {quote.scope && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Scope</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.scope}</p>
                </div>
              )}

              {quote.rams_documents?.length ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  <p className="font-medium text-emerald-100">RAMS documents linked</p>
                  <p className="text-xs text-emerald-200/80">
                    Requested {quote.rams_requested_at ? format(new Date(quote.rams_requested_at), 'dd MMM yyyy') : 'date not recorded'}
                  </p>
                  <div className="mt-2 space-y-1">
                    {quote.rams_documents.map(document => (
                      <p key={document.id} className="text-xs text-emerald-100">
                        {document.title} • {format(new Date(document.created_at), 'dd MMM yyyy')}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              <Separator className="bg-slate-700" />

              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-800 text-slate-300">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="workflow">Workflow</TabsTrigger>
                  <TabsTrigger value="invoices">Invoices</TabsTrigger>
                  <TabsTrigger value="attachments">Attachments</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="versions">Versions</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">Line Items</h4>
                    {quote.pricing_mode === 'attachments_only' ? (
                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                        Pricing/details are supplied in the client-visible attachments for this quote.
                      </div>
                    ) : quote.line_items && quote.line_items.length > 0 ? (
                      <div className="border border-slate-700 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-800/80 border-b border-slate-700">
                              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Qty</th>
                              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Rate</th>
                              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {quote.line_items.map((item, idx) => (
                              <tr key={idx}>
                                <td className="px-3 py-2 text-white">
                                  {item.description}
                                  {item.unit && <span className="text-muted-foreground ml-1">({item.unit})</span>}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-300">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-slate-300">
                                  £{Number(item.unit_rate).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-white">
                                  £{Number(item.line_total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No line items.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Quote Total</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Invoiced</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.invoicedTotal || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Remaining Balance</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.remainingBalance ?? quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  {(quote.signoff_name || quote.signoff_title) && (
                    <div className="text-xs text-muted-foreground">
                      {quote.signoff_name && <p>Signed by: {quote.signoff_name}</p>}
                      {quote.signoff_title && <p>{quote.signoff_title}</p>}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="workflow" className="space-y-4">
                  {workflowError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {workflowError}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>PO Number</Label>
                      <Input
                        value={poNumber}
                        disabled={!canEditPoDetails}
                        onChange={e => {
                          clearWorkflowError('po_number');
                          setPoNumber(e.target.value);
                        }}
                        className={getFieldClassName(workflowFieldErrors, 'po_number')}
                      />
                      {renderFieldError(workflowFieldErrors, 'po_number')}
                    </div>
                    <div className="space-y-2">
                      <Label>PO Value</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={poValue}
                        disabled={!canEditPoDetails}
                        onChange={e => {
                          clearWorkflowError('po_value');
                          setPoValue(e.target.value);
                        }}
                        className={getFieldClassName(workflowFieldErrors, 'po_value')}
                      />
                      {renderFieldError(workflowFieldErrors, 'po_value')}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        disabled={!canManageSchedule}
                        onChange={e => {
                          clearWorkflowError('start_date');
                          setStartDate(e.target.value);
                        }}
                        className={getFieldClassName(workflowFieldErrors, 'start_date')}
                      />
                      {renderFieldError(workflowFieldErrors, 'start_date')}
                    </div>
                    <div className="space-y-2">
                      <Label>Alert Days Before Start</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={startAlertDays}
                        disabled={!canManageSchedule}
                        onChange={e => {
                          clearWorkflowError('start_alert_days');
                          setStartAlertDays(e.target.value);
                        }}
                        className={getFieldClassName(workflowFieldErrors, 'start_alert_days')}
                      />
                      {renderFieldError(workflowFieldErrors, 'start_alert_days')}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Completion Status</Label>
                    <Select value={completionStatus} onValueChange={(value: QuoteCompletionStatus) => setCompletionStatus(value)} disabled={!canManageSchedule}>
                      <SelectTrigger className={getSelectClassName(workflowFieldErrors, 'completion_status')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved_in_full">Approve in full</SelectItem>
                        <SelectItem value="approved_in_part">Approve in part</SelectItem>
                      </SelectContent>
                    </Select>
                    {renderFieldError(workflowFieldErrors, 'completion_status')}
                  </div>

                  <div className="space-y-2">
                    <Label>Completion Comments</Label>
                    <Textarea
                      value={completionComments}
                      disabled={!canManageSchedule}
                      onChange={e => {
                        clearWorkflowError('completion_comments');
                        setCompletionComments(e.target.value);
                      }}
                      rows={3}
                      className={getFieldClassName(workflowFieldErrors, 'completion_comments')}
                    />
                    {renderFieldError(workflowFieldErrors, 'completion_comments')}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {isLatestVersion && ['draft', 'changes_requested', 'pending_internal_approval'].includes(quote.status) && (
                      <Button
                        onClick={() => callAction('confirm_and_send')}
                        disabled={actionLoading || !recipientEmail}
                        className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                      >
                        <Send className="mr-2 h-4 w-4" /> Confirm And Send
                      </Button>
                    )}
                    {canEditPoDetails && (
                      <Button
                        variant="outline"
                        onClick={() => callAction('save_po_details', {
                          po_number: poNumber.trim() || null,
                          po_value: poValue ? Number(poValue) : null,
                        })}
                        disabled={actionLoading}
                        className="border-slate-600 text-muted-foreground"
                      >
                        <FolderKanban className="mr-2 h-4 w-4" /> Save PO
                      </Button>
                    )}
                    {canTriggerRams && (
                      <Button
                        onClick={() => setRamsDialogOpen(true)}
                        disabled={actionLoading}
                        className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                      >
                        <FolderKanban className="mr-2 h-4 w-4" /> Trigger RAMS
                      </Button>
                    )}
                    {canManageSchedule && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => callAction('set_job_schedule', {
                            start_date: startDate || null,
                            start_alert_days: startAlertDays ? Number(startAlertDays) : null,
                          })}
                          disabled={actionLoading}
                          className="border-slate-600 text-muted-foreground"
                        >
                          <CalendarClock className="mr-2 h-4 w-4" /> Save Schedule
                        </Button>
                        <Button
                          onClick={() => callAction('mark_complete', {
                            completion_status: completionStatus,
                            completion_comments: completionComments,
                          })}
                          disabled={actionLoading}
                          className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                        >
                          <Receipt className="mr-2 h-4 w-4" /> Mark Complete
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => callAction('toggle_closed')}
                      disabled={actionLoading || !isLatestVersion}
                      className="border-slate-600 text-muted-foreground"
                    >
                      {quote.commercial_status === 'closed' ? 'Restore Quote' : 'Archive Quote'}
                    </Button>
                  </div>

                  {['draft', 'changes_requested', 'pending_internal_approval'].includes(quote.status) && !recipientEmail && (
                    <p className="text-sm text-amber-300">
                      Add a customer contact email before confirming and sending this quote.
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div><span className="text-muted-foreground">PO Received</span><p className="text-white">{quote.po_received_at ? format(new Date(quote.po_received_at), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Start Date</span><p className="text-white">{quote.start_date ? format(new Date(quote.start_date), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Completion</span><p className="text-white">{quote.completion_status.replace(/_/g, ' ')}</p></div>
                  </div>
                </TabsContent>

                <TabsContent value="invoices" className="space-y-4">
                  {invoiceError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {invoiceError}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Invoice Number *</Label>
                      <Input
                        value={invoiceNumber}
                        disabled={!canManageInvoices}
                        onChange={e => {
                          clearInvoiceError('invoice_number');
                          setInvoiceNumber(e.target.value);
                        }}
                        className={getFieldClassName(invoiceFieldErrors, 'invoice_number')}
                      />
                      {renderFieldError(invoiceFieldErrors, 'invoice_number')}
                    </div>
                    <div className="space-y-2">
                      <Label>Amount *</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={invoiceAmount}
                        disabled={!canManageInvoices}
                        onChange={e => {
                          clearInvoiceError('amount');
                          const nextValue = e.target.value;
                          setInvoiceAmount(nextValue);

                          const numericValue = Number(nextValue);
                          if (nextValue && Number.isFinite(numericValue) && numericValue < suggestedInvoiceAmount) {
                            setInvoiceScope('partial');
                          }
                        }}
                        className={getFieldClassName(invoiceFieldErrors, 'amount')}
                      />
                      {renderFieldError(invoiceFieldErrors, 'amount')}
                    </div>
                    <div className="space-y-2">
                      <Label>Date *</Label>
                      <Input
                        type="date"
                        value={invoiceDate}
                        disabled={!canManageInvoices}
                        onChange={e => {
                          clearInvoiceError('invoice_date');
                          setInvoiceDate(e.target.value);
                        }}
                        className={getFieldClassName(invoiceFieldErrors, 'invoice_date')}
                      />
                      {renderFieldError(invoiceFieldErrors, 'invoice_date')}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Invoice Scope</Label>
                      <Select value={invoiceScope} onValueChange={(value: 'full' | 'partial') => setInvoiceScope(value)} disabled={!canManageInvoices}>
                        <SelectTrigger className={getSelectClassName(invoiceFieldErrors, 'invoice_scope')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Invoice in full</SelectItem>
                          <SelectItem value="partial">Partial invoice</SelectItem>
                        </SelectContent>
                      </Select>
                      {renderFieldError(invoiceFieldErrors, 'invoice_scope')}
                    </div>
                    <div className="space-y-2">
                      <Label>Comments</Label>
                      <Textarea
                        value={invoiceComments}
                      disabled={!canManageInvoices}
                        onChange={e => {
                          clearInvoiceError('comments');
                          setInvoiceComments(e.target.value);
                        }}
                        rows={2}
                        className={getFieldClassName(invoiceFieldErrors, 'comments')}
                      />
                      {renderFieldError(invoiceFieldErrors, 'comments')}
                    </div>
                  </div>

                  <Button
                    onClick={addInvoice}
                    disabled={actionLoading || !canManageInvoices}
                    className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                  >
                    <Receipt className="mr-2 h-4 w-4" /> Add Invoice
                  </Button>

                  {!canManageInvoices ? (
                    <p className="text-xs text-muted-foreground">
                      Only the latest quote version can be invoiced.
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    {quote.invoices?.length ? quote.invoices.map(invoice => (
                      <div key={invoice.id} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-white">{invoice.invoice_number}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(invoice.invoice_date), 'dd MMM yyyy')} • {invoice.invoice_scope.replace('_', ' ')}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-white">£{Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                          </div>
                        </div>
                        {invoice.comments && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{invoice.comments}</p>}
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">No invoices recorded yet.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="attachments" className="space-y-4">
                  {attachmentError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {attachmentError}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <label className={cn(
                      'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold',
                      canManageAttachments
                        ? 'cursor-pointer bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90'
                        : 'cursor-not-allowed bg-slate-700 text-slate-300'
                    )}>
                      <Upload className="h-4 w-4" />
                      {uploadingAttachment ? 'Uploading...' : 'Upload Attachment'}
                      <input
                        type="file"
                        className="hidden"
                        disabled={!canManageAttachments}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file) {
                            setAttachmentError(null);
                            void handleAttachmentUpload(file);
                            event.target.value = '';
                          }
                        }}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">Cost sheets, drawings, and supporting files can be attached here.</p>
                  </div>

                  {!canManageAttachments ? (
                    <p className="text-xs text-muted-foreground">Only the latest quote version can be changed.</p>
                  ) : null}

                  <div className="space-y-2">
                    {quote.attachments?.length ? quote.attachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/30 p-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-white">{attachment.file_name}</p>
                            {attachment.is_client_visible && (
                              <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-200">Client</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {attachment.content_type || 'File'}{attachment.file_size ? ` • ${(attachment.file_size / 1024).toFixed(1)} KB` : ''}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canManageAttachments}
                          className="border-slate-600 text-muted-foreground"
                          onClick={() => deleteAttachment(attachment.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">No supporting files attached yet.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="versions" className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Create Revision Type</Label>
                      <Select value={revisionType} onValueChange={(value: QuoteRevisionType) => setRevisionType(value)} disabled={!canCreateVersions}>
                        <SelectTrigger className="bg-slate-800 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="revision">Revision</SelectItem>
                          <SelectItem value="extra">Extra</SelectItem>
                          <SelectItem value="variation">Variation</SelectItem>
                          <SelectItem value="future_work">Future Work</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Revision Notes</Label>
                      <Textarea
                        value={revisionNotes}
                        disabled={!canCreateVersions}
                        onChange={e => setRevisionNotes(e.target.value)}
                        rows={2}
                        className="bg-slate-800 border-slate-600"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => callAction('create_revision', { revision_type: revisionType, version_notes: revisionNotes }, 'versions')}
                      disabled={actionLoading || !canCreateVersions}
                      className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                    >
                      <Files className="mr-2 h-4 w-4" /> Create New Version
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => callAction('duplicate', { version_notes: revisionNotes }, 'versions')}
                      disabled={actionLoading || !canCreateVersions}
                      className="border-slate-600 text-muted-foreground"
                    >
                      <Copy className="mr-2 h-4 w-4" /> Duplicate As New Quote
                    </Button>
                  </div>

                  {!canCreateVersions ? (
                    <p className="text-xs text-muted-foreground">Open the latest version to create a new version or duplicate this quote.</p>
                  ) : null}

                  <div className="space-y-2">
                    {quote.versions?.length ? quote.versions.map(version => (
                        <button
                          key={version.id}
                          type="button"
                          onClick={() => selectQuoteVersion(version.id)}
                          className={cn(
                            'w-full rounded-lg border p-4 text-left transition-colors',
                            version.id === quote.id
                              ? 'border-brand-yellow/60 bg-brand-yellow/10'
                              : 'border-slate-700 bg-slate-800/30 hover:bg-slate-800/50'
                          )}
                        >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-mono font-medium text-brand-yellow">{version.quote_reference}</p>
                              {version.id === quote.id ? (
                                <Badge variant="outline" className="border-brand-yellow/40 text-brand-yellow">
                                  Current
                                </Badge>
                              ) : null}
                              {version.is_latest_version ? (
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                                  Latest
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-white">{version.version_label || 'Original'}</p>
                          </div>
                          <Badge variant="outline" className={getQuoteStatusConfig(version.status).color}>
                            {getQuoteStatusConfig(version.status).label}
                          </Badge>
                        </div>
                        {version.version_notes && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{version.version_notes}</p>}
                      </button>
                    )) : (
                      <p className="text-sm text-muted-foreground">No version history yet.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4">
                  {groupedTimeline.length ? (
                    <div className="space-y-5">
                      {groupedTimeline.map((group) => (
                        <div key={group.key} className="space-y-2">
                          <div className="sticky top-0 z-10">
                            <span className="inline-flex rounded-full border border-slate-700 bg-slate-950/90 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 backdrop-blur">
                              {group.label}
                            </span>
                          </div>

                          <div className="space-y-1">
                            {group.events.map((event) => {
                              const toStatusConfig = event.to_status ? getQuoteStatusConfig(event.to_status) : null;
                              const fromStatusConfig = event.from_status ? getQuoteStatusConfig(event.from_status) : null;
                              const meta = getTimelineEventMeta(event.event_type);
                              const Icon = meta.icon;

                              return (
                                <div key={event.id} className="grid grid-cols-[32px_1fr_auto] items-start gap-3 rounded-md px-1 py-2 hover:bg-slate-800/30">
                                  <div className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border', meta.iconClassName)}>
                                    <Icon className="h-4 w-4" />
                                  </div>

                                  <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <p className="text-sm font-medium text-white">{event.title}</p>
                                      {fromStatusConfig ? (
                                        <Badge variant="outline" className={cn('text-[10px]', fromStatusConfig.color)}>
                                          {fromStatusConfig.label}
                                        </Badge>
                                      ) : null}
                                      {fromStatusConfig && toStatusConfig ? (
                                        <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                                      ) : null}
                                      {toStatusConfig ? (
                                        <Badge variant="outline" className={cn('text-[10px]', toStatusConfig.color)}>
                                          {toStatusConfig.label}
                                        </Badge>
                                      ) : null}
                                    </div>

                                    <p className="text-xs text-muted-foreground">
                                      {event.actor?.full_name || 'Unknown user'}
                                      {' • '}
                                      {event.quote_reference}
                                    </p>

                                    {event.description ? (
                                      <p className="text-xs text-slate-300 whitespace-pre-wrap">{event.description}</p>
                                    ) : null}
                                  </div>

                                  <div className="pt-0.5 text-right text-[11px] text-slate-400">
                                    {format(new Date(event.created_at), 'HH:mm')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No timeline history yet.</p>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap gap-2">
                {deleteError ? (
                  <div className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                    {deleteError}
                  </div>
                ) : null}

                {canEditQuote && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { onClose(); onEdit(quote); }}
                    className="border-slate-600 text-muted-foreground"
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit Quote
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.open(`/api/quotes/${quote.id}/pdf`, '_blank');
                  }}
                  className="border-slate-600 text-muted-foreground"
                >
                  <FileDown className="h-4 w-4 mr-1" /> Download PDF
                </Button>

                {canDeleteDraft ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void deleteQuote()}
                    disabled={actionLoading}
                    className="border-red-500/40 text-red-200 hover:bg-red-500/10 hover:text-red-100"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> {hasMultipleVersions ? 'Delete Draft Version' : 'Delete Draft Quote'}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    <Dialog open={ramsDialogOpen} onOpenChange={setRamsDialogOpen}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>Trigger RAMS</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add any extra internal comments to include with the RAMS request email.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={ramsComments}
          onChange={event => setRamsComments(event.target.value)}
          rows={4}
          placeholder="Additional RAMS notes, constraints, site details, or handover context..."
          className="bg-slate-800 border-slate-600"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRamsDialogOpen(false)} className="border-slate-600 text-muted-foreground">
            Cancel
          </Button>
          <Button onClick={() => void handleTriggerRams()} disabled={actionLoading} className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90">
            {actionLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : 'Send RAMS Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
