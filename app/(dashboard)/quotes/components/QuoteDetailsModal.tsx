'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { PanelLoader } from '@/components/ui/panel-loader';
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
  ExternalLink,
  RefreshCw,
  Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils/cn';
import { buildQuoteDisplayName, buildQuotePdfFilename } from '@/lib/quotes/quote-display-name';
import { useAuth } from '@/lib/hooks/useAuth';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import {
  deleteQuoteAttachment,
  getQuoteAttachmentUrl,
  replaceQuoteAttachment,
  uploadQuoteAttachment,
} from '../quote-attachment-client';
import { FormattedQuoteText } from './FormattedQuoteText';
import type { Quote, QuoteAttachment, QuoteCompletionStatus, QuoteManagerOption, QuoteRevisionType } from '../types';
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
  managerOptions: QuoteManagerOption[];
}

type DetailFieldErrors = Record<string, string>;
interface QuoteRecipientOption {
  email: string;
  label: string;
}

interface QuoteDetailsDirtySnapshot {
  poNumber: string;
  poValue: string;
  startDate: string;
  startAlertDays: string;
  completionStatus: QuoteCompletionStatus;
  completionComments: string;
  invoiceNumber: string;
  invoiceAmount: string;
  invoiceDate: string;
  invoiceScope: 'full' | 'partial';
  invoiceComments: string;
  invoiceRequestAmount: string;
  invoiceRequestDate: string;
  invoiceRequestScope: 'full' | 'partial';
  invoiceRequestComments: string;
  selectedInvoiceRequestId: string;
  invoiceMatchesRequest: boolean;
  revisionType: QuoteRevisionType;
  revisionNotes: string;
}

function buildDirtySnapshot(value: QuoteDetailsDirtySnapshot) {
  return JSON.stringify(value);
}

function buildEmailSelectionSnapshot(emails: string[]) {
  return JSON.stringify(emails.map(email => email.trim().toLowerCase()).sort());
}

function buildQuoteRecipientOptions(quote: Quote | null): QuoteRecipientOption[] {
  if (!quote) {
    return [];
  }

  const options: QuoteRecipientOption[] = [];
  const seen = new Set<string>();
  const addOption = (email: string | null | undefined, label: string) => {
    const normalizedEmail = email?.trim();
    if (!normalizedEmail || !normalizedEmail.includes('@')) return;

    const key = normalizedEmail.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    options.push({ email: normalizedEmail, label });
  };

  addOption(quote.attention_email || quote.customer?.contact_email, quote.attention_name || quote.customer?.contact_name || 'Primary contact');
  (quote.selected_secondary_contacts || []).forEach(contact => {
    addOption(contact.email, contact.name || contact.email || 'Secondary contact');
  });

  return options;
}

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
    case 'po_request_sent':
      return {
        icon: Mail,
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
    case 'invoice_requested':
      return {
        icon: Receipt,
        iconClassName: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20',
      };
    case 'invoice_marked_on_sage':
    case 'quote_marked_on_sage':
      return {
        icon: CheckCircle2,
        iconClassName: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
      };
    case 'invoice_removed_from_sage':
    case 'quote_removed_from_sage':
      return {
        icon: CircleDot,
        iconClassName: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
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

function getBillingStatusConfig(status: NonNullable<Quote['invoice_summary']>['status'] | undefined) {
  switch (status) {
    case 'ready_to_invoice':
      return { label: 'Ready to invoice', color: 'border-violet-500/30 text-violet-300 bg-violet-500/10' };
    case 'partially_invoiced':
      return { label: 'Part billed', color: 'border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10' };
    case 'invoiced':
      return { label: 'Fully billed', color: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' };
    default:
      return { label: 'Not billed', color: 'border-slate-500/30 text-slate-300 bg-slate-500/10' };
  }
}

async function buildResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string; field_errors?: DetailFieldErrors } | null;
  const error = new Error(payload?.error || fallback) as Error & { fieldErrors?: DetailFieldErrors };
  error.fieldErrors = payload?.field_errors || {};
  return error;
}

export function QuoteDetailsModal({ open, onClose, quoteId, onQuoteChange, onEdit, onRefresh, managerOptions }: QuoteDetailsModalProps) {
  const { profile } = useAuth();
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
  const [invoiceRequestAmount, setInvoiceRequestAmount] = useState('');
  const [invoiceRequestDate, setInvoiceRequestDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceRequestScope, setInvoiceRequestScope] = useState<'full' | 'partial'>('full');
  const [invoiceRequestComments, setInvoiceRequestComments] = useState('');
  const [selectedInvoiceRequestId, setSelectedInvoiceRequestId] = useState('');
  const [invoiceMatchesRequest, setInvoiceMatchesRequest] = useState(false);
  const [revisionType, setRevisionType] = useState<QuoteRevisionType>('revision');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateManagerProfileId, setDuplicateManagerProfileId] = useState('');
  const [poRequestDialogOpen, setPoRequestDialogOpen] = useState(false);
  const [poRequestRecipientEmails, setPoRequestRecipientEmails] = useState<string[]>([]);
  const [ramsComments, setRamsComments] = useState('');
  const [ramsDialogOpen, setRamsDialogOpen] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowFieldErrors, setWorkflowFieldErrors] = useState<DetailFieldErrors>({});
  const [invoiceRequestError, setInvoiceRequestError] = useState<string | null>(null);
  const [invoiceRequestFieldErrors, setInvoiceRequestFieldErrors] = useState<DetailFieldErrors>({});
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceFieldErrors, setInvoiceFieldErrors] = useState<DetailFieldErrors>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [replacingAttachmentId, setReplacingAttachmentId] = useState<string | null>(null);
  const [detailsBaselineSnapshot, setDetailsBaselineSnapshot] = useState('');
  const [poRequestBaselineSnapshot, setPoRequestBaselineSnapshot] = useState('');
  const [duplicateBaselineSnapshot, setDuplicateBaselineSnapshot] = useState('');
  const [ramsBaselineSnapshot, setRamsBaselineSnapshot] = useState('');
  const fetchRequestIdRef = useRef(0);
  const activeFetchAbortRef = useRef<AbortController | null>(null);
  const activeQuoteId = currentQuoteId || quoteId || quote?.id || null;
  const recipientEmail = quote?.attention_email || quote?.customer?.contact_email || '';
  const customerToContacts = quote?.selected_secondary_contacts || [];
  const quoteDisplayName = quote ? buildQuoteDisplayName(quote) : '';
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
  const canManageSage = Boolean(quote?.can_manage_sage);
  const canRequestPo = Boolean(isLatestVersion && quote && !quote.po_number && recipientEmail && (quote.sent_at || quote.customer_sent_at || quote.status === 'sent'));
  const hasMultipleVersions = (quote?.versions?.length ?? 0) > 1;
  const availableToRequest = Number(quote?.invoice_summary?.availableToRequest ?? quote?.invoice_summary?.remainingBalance ?? quote?.total ?? 0);
  const suggestedInvoiceAmount = Number(quote?.invoice_summary?.remainingBalance ?? quote?.total ?? 0);
  const isQuoteOnSage = Boolean(quote?.sage_posted_at);
  const sagePostedDateLabel = quote?.sage_posted_at ? format(new Date(quote.sage_posted_at), 'dd MMM yyyy') : null;
  const sageCardClassName = cn(
    'rounded-lg border p-4 text-left transition-colors',
    isQuoteOnSage
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : 'border-slate-700 bg-slate-800/30',
    canManageSage && !actionLoading ? 'cursor-pointer hover:bg-emerald-500/15' : '',
    canManageSage && actionLoading ? 'cursor-wait opacity-70' : ''
  );
  const pendingInvoiceRequests = useMemo(
    () => (quote?.invoice_requests || []).filter(request => request.status === 'pending'),
    [quote?.invoice_requests]
  );
  const selectedInvoiceRequest = pendingInvoiceRequests.find(request => request.id === selectedInvoiceRequestId) || null;
  const pendingFullInvoiceRequest = pendingInvoiceRequests.find(request => request.requested_invoice_scope === 'full') || null;
  const billingStatusConfig = getBillingStatusConfig(quote?.invoice_summary?.status);
  const duplicateManagerOptions = useMemo(
    () => managerOptions.filter(option => option.is_active || option.profile_id === quote?.requester_id),
    [managerOptions, quote?.requester_id]
  );
  const poRequestRecipientOptions = useMemo(() => buildQuoteRecipientOptions(quote), [quote]);
  const poRequestPdfFilename = quote ? buildQuotePdfFilename(quote) : 'Quote.pdf';
  const poRequestGreetingName = quote?.attention_name || quote?.customer?.contact_name || 'there';
  const poRequestSenderName = profile?.full_name || 'user';
  const managerRequestCtaLabel = pendingInvoiceRequests.length > 0 ? 'Request Another Invoice' : 'Mark Ready To Invoice';
  const managerRequestControlsDisabled = !canManageInvoices || availableToRequest <= 0 || Boolean(pendingFullInvoiceRequest);
  const currentDetailsSnapshot = buildDirtySnapshot({
    poNumber,
    poValue,
    startDate,
    startAlertDays,
    completionStatus,
    completionComments,
    invoiceNumber,
    invoiceAmount,
    invoiceDate,
    invoiceScope,
    invoiceComments,
    invoiceRequestAmount,
    invoiceRequestDate,
    invoiceRequestScope,
    invoiceRequestComments,
    selectedInvoiceRequestId,
    invoiceMatchesRequest,
    revisionType,
    revisionNotes,
  });
  const isDetailsDirty = Boolean(
    open
    && quote
    && detailsBaselineSnapshot
    && currentDetailsSnapshot !== detailsBaselineSnapshot
  );
  const isPoRequestDirty = poRequestDialogOpen
    && buildEmailSelectionSnapshot(poRequestRecipientEmails) !== poRequestBaselineSnapshot;
  const isDuplicateDialogDirty = duplicateDialogOpen
    && duplicateManagerProfileId !== duplicateBaselineSnapshot;
  const isRamsDialogDirty = ramsDialogOpen
    && ramsComments !== ramsBaselineSnapshot;
  const {
    contentRef: detailsDialogContentRef,
    handleOpenChange: handleDetailsDialogOpenChange,
    handleInteractOutside: handleDetailsDialogInteractOutside,
    handleEscapeKeyDown: handleDetailsDialogEscapeKeyDown,
    discard: discardDetailsDialog,
  } = useDirtyDialogGuard({
    isDirty: isDetailsDirty,
    disabled: loading || actionLoading || uploadingAttachment,
    onOpenChange: (isOpen) => {
      if (!isOpen) onClose();
    },
  });
  const {
    contentRef: poRequestDialogContentRef,
    handleOpenChange: handlePoRequestDialogOpenChange,
    handleInteractOutside: handlePoRequestDialogInteractOutside,
    handleEscapeKeyDown: handlePoRequestDialogEscapeKeyDown,
    discard: discardPoRequestDialog,
  } = useDirtyDialogGuard({
    isDirty: isPoRequestDirty,
    disabled: actionLoading,
    onOpenChange: (isOpen) => {
      setPoRequestDialogOpen(isOpen);
      if (!isOpen) {
        setPoRequestRecipientEmails([]);
        setPoRequestBaselineSnapshot('');
      }
    },
  });
  const {
    contentRef: duplicateDialogContentRef,
    handleOpenChange: handleDuplicateDialogOpenChange,
    handleInteractOutside: handleDuplicateDialogInteractOutside,
    handleEscapeKeyDown: handleDuplicateDialogEscapeKeyDown,
    discard: discardDuplicateDialog,
  } = useDirtyDialogGuard({
    isDirty: isDuplicateDialogDirty,
    disabled: actionLoading,
    onOpenChange: (isOpen) => {
      setDuplicateDialogOpen(isOpen);
      if (!isOpen) {
        setDuplicateManagerProfileId('');
        setDuplicateBaselineSnapshot('');
      }
    },
  });
  const {
    contentRef: ramsDialogContentRef,
    handleOpenChange: handleRamsDialogOpenChange,
    handleInteractOutside: handleRamsDialogInteractOutside,
    handleEscapeKeyDown: handleRamsDialogEscapeKeyDown,
    discard: discardRamsDialog,
  } = useDirtyDialogGuard({
    isDirty: isRamsDialogDirty,
    disabled: actionLoading,
    onOpenChange: (isOpen) => {
      setRamsDialogOpen(isOpen);
      if (!isOpen) {
        setRamsComments('');
        setRamsBaselineSnapshot('');
      }
    },
  });

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

  function clearInvoiceRequestError(field?: string) {
    setInvoiceRequestError(null);
    if (!field) {
      setInvoiceRequestFieldErrors({});
      return;
    }

    setInvoiceRequestFieldErrors(prev => {
      if (!(field in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateInvoiceRequestFields() {
    const errors: DetailFieldErrors = {};
    const amount = Number(invoiceRequestAmount);

    if (!invoiceRequestAmount || !Number.isFinite(amount) || amount <= 0) {
      errors.requested_amount = 'Enter an invoice request amount greater than 0.';
    }

    if (!invoiceRequestDate) {
      errors.requested_invoice_date = 'Enter the requested invoice date.';
    }

    if (Number.isFinite(amount) && amount - availableToRequest > 0.005) {
      errors.requested_amount = `This quote has £${availableToRequest.toLocaleString('en-GB', { minimumFractionDigits: 2 })} available to request.`;
    }

    if (Number.isFinite(amount) && invoiceRequestScope === 'full' && Math.abs(amount - availableToRequest) > 0.005) {
      errors.requested_amount = `Full invoice request must be £${availableToRequest.toLocaleString('en-GB', { minimumFractionDigits: 2 })}.`;
    }

    if (Number.isFinite(amount) && invoiceRequestScope === 'partial' && amount >= availableToRequest - 0.005) {
      errors.requested_invoice_scope = 'Select full invoice for the remaining balance.';
    }

    return errors;
  }

  function validateInvoiceFields() {
    const errors: DetailFieldErrors = {};
    if (!invoiceNumber.trim()) {
      errors.invoice_number = 'Enter an invoice number.';
    }

    const amount = selectedInvoiceRequest ? Number(selectedInvoiceRequest.requested_amount) : Number(invoiceAmount);
    if (!selectedInvoiceRequest) {
      if (!invoiceAmount || !Number.isFinite(amount) || amount <= 0) {
        errors.amount = 'Enter an invoice amount greater than 0.';
      }

      if (!invoiceDate) {
        errors.invoice_date = 'Enter an invoice date.';
      }
    } else if (!invoiceMatchesRequest) {
      errors.confirm_matches_request = 'Confirm the invoice details match the manager request.';
    }

    if (Number.isFinite(amount) && amount - suggestedInvoiceAmount > 0.005) {
      errors.amount = `This quote has £${suggestedInvoiceAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} remaining. Create a new version first if the amount has increased.`;
    }

    return errors;
  }

  const applyQuoteState = useCallback((nextQuote: Quote) => {
    const today = new Date().toISOString().slice(0, 10);
    const nextInvoiceAmount = nextQuote.invoice_summary?.remainingBalance ? String(nextQuote.invoice_summary.remainingBalance) : '';
    const nextInvoiceRequestAmount = nextQuote.invoice_summary?.availableToRequest ? String(nextQuote.invoice_summary.availableToRequest) : '';
    const nextInvoiceRequestScope = nextQuote.invoice_summary?.availableToRequest === nextQuote.invoice_summary?.remainingBalance ? 'full' : 'partial';
    const nextSelectedInvoiceRequestId = (nextQuote.invoice_requests || []).find(request => request.status === 'pending')?.id || '';

    setQuote(nextQuote);
    setPoNumber(nextQuote.po_number || '');
    setPoValue(nextQuote.po_value ? String(nextQuote.po_value) : '');
    setStartDate(nextQuote.start_date || '');
    setStartAlertDays(nextQuote.start_alert_days ? String(nextQuote.start_alert_days) : '');
    setCompletionStatus(nextQuote.completion_status === 'approved_in_part' ? 'approved_in_part' : 'approved_in_full');
    setCompletionComments(nextQuote.completion_comments || '');
    setInvoiceNumber('');
    setInvoiceAmount(nextInvoiceAmount);
    setInvoiceDate(today);
    setInvoiceScope(nextQuote.invoice_summary?.remainingBalance === 0 ? 'partial' : 'full');
    setInvoiceComments('');
    setInvoiceRequestAmount(nextInvoiceRequestAmount);
    setInvoiceRequestDate(today);
    setInvoiceRequestScope(nextInvoiceRequestScope);
    setInvoiceRequestComments('');
    setSelectedInvoiceRequestId(nextSelectedInvoiceRequestId);
    setInvoiceMatchesRequest(false);
    setRevisionType('revision');
    setRevisionNotes('');
    setDuplicateManagerProfileId(nextQuote.requester_id || '');
    setPoRequestRecipientEmails(buildQuoteRecipientOptions(nextQuote).map(option => option.email));
    setWorkflowError(null);
    setWorkflowFieldErrors({});
    setInvoiceRequestError(null);
    setInvoiceRequestFieldErrors({});
    setInvoiceError(null);
    setInvoiceFieldErrors({});
    setAttachmentError(null);
    setDeleteError(null);
    setRemovingAttachmentId(null);
    setReplacingAttachmentId(null);
    setDetailsBaselineSnapshot(buildDirtySnapshot({
      poNumber: nextQuote.po_number || '',
      poValue: nextQuote.po_value ? String(nextQuote.po_value) : '',
      startDate: nextQuote.start_date || '',
      startAlertDays: nextQuote.start_alert_days ? String(nextQuote.start_alert_days) : '',
      completionStatus: nextQuote.completion_status === 'approved_in_part' ? 'approved_in_part' : 'approved_in_full',
      completionComments: nextQuote.completion_comments || '',
      invoiceNumber: '',
      invoiceAmount: nextInvoiceAmount,
      invoiceDate: today,
      invoiceScope: nextQuote.invoice_summary?.remainingBalance === 0 ? 'partial' : 'full',
      invoiceComments: '',
      invoiceRequestAmount: nextInvoiceRequestAmount,
      invoiceRequestDate: today,
      invoiceRequestScope: nextInvoiceRequestScope,
      invoiceRequestComments: '',
      selectedInvoiceRequestId: nextSelectedInvoiceRequestId,
      invoiceMatchesRequest: false,
      revisionType: 'revision',
      revisionNotes: '',
    }));
  }, []);

  const selectQuoteVersion = useCallback((nextQuoteId: string) => {
    setCurrentQuoteId(nextQuoteId);
    onQuoteChange(nextQuoteId);
  }, [onQuoteChange]);

  const fetchQuote = useCallback(async () => {
    const idToLoad = activeQuoteId;
    if (!idToLoad) return;
    activeFetchAbortRef.current?.abort();
    const abortController = new AbortController();
    activeFetchAbortRef.current = abortController;
    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/quotes/${idToLoad}`, { signal: abortController.signal });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to load quote details right now.');
      }
      const data = await res.json();
      if (fetchRequestIdRef.current !== requestId) return;
      applyQuoteState(data.quote);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Unable to load quote details right now.';
      setLoadError(message);
      toast.error(message);
    } finally {
      if (fetchRequestIdRef.current === requestId) {
        activeFetchAbortRef.current = null;
        setLoading(false);
      }
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
      activeFetchAbortRef.current?.abort();
      activeFetchAbortRef.current = null;
      setCurrentQuoteId(null);
      setActiveTab('overview');
      setQuote(null);
      setLoadError(null);
      setWorkflowError(null);
      setWorkflowFieldErrors({});
      setInvoiceRequestError(null);
      setInvoiceRequestFieldErrors({});
      setInvoiceError(null);
      setInvoiceFieldErrors({});
      setSelectedInvoiceRequestId('');
      setInvoiceMatchesRequest(false);
      setAttachmentError(null);
      setDeleteError(null);
      setRemovingAttachmentId(null);
      setReplacingAttachmentId(null);
      setRamsDialogOpen(false);
      setRamsComments('');
      setDuplicateDialogOpen(false);
      setDuplicateManagerProfileId('');
      setPoRequestDialogOpen(false);
      setPoRequestRecipientEmails([]);
      setDetailsBaselineSnapshot('');
      setPoRequestBaselineSnapshot('');
      setDuplicateBaselineSnapshot('');
      setRamsBaselineSnapshot('');
    }
  }, [open]);

  async function updateQuote(
    updates: Record<string, unknown>,
    scope: 'workflow' | 'versions' | 'general' = 'workflow'
  ) {
    if (!activeQuoteId) return false;
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
      return true;
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
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function callAction(action: string, payload?: Record<string, unknown>, scope: 'workflow' | 'versions' | 'general' = 'workflow') {
    return updateQuote({ action, ...payload }, scope);
  }

  async function toggleQuoteSage(onSage: boolean) {
    if (!activeQuoteId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_sage',
          on_sage: onSage,
        }),
      });

      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to update Sage status right now.');
      }

      toast.success(onSage ? 'Quote marked on Sage' : 'Quote removed from Sage');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update Sage status right now.';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTriggerRams() {
    const ok = await callAction('trigger_rams', { rams_comments: ramsComments.trim() || null });
    if (ok) {
      setRamsDialogOpen(false);
      setRamsComments('');
    }
  }

  async function handleDuplicateQuote() {
    const ok = await callAction('duplicate', {
      version_notes: revisionNotes,
      manager_profile_id: duplicateManagerProfileId || quote?.requester_id || null,
    }, 'versions');
    if (ok) {
      setDuplicateDialogOpen(false);
    }
  }

  function togglePoRequestRecipient(email: string, checked: boolean) {
    setPoRequestRecipientEmails(prev => checked
      ? Array.from(new Set([...prev, email]))
      : prev.filter(item => item.toLowerCase() !== email.toLowerCase())
    );
  }

  async function handlePoRequestEmail() {
    const ok = await callAction('request_po', {
      po_request_recipient_emails: poRequestRecipientEmails,
    });
    if (ok) {
      setPoRequestDialogOpen(false);
    }
  }

  async function handleAttachmentUpload(file: File) {
    if (!activeQuoteId) return;

    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      await uploadQuoteAttachment({
        quoteId: activeQuoteId,
        file,
        isClientVisible: false,
        attachmentPurpose: 'internal',
      });

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

    setRemovingAttachmentId(attachmentId);
    try {
      await deleteQuoteAttachment(activeQuoteId, attachmentId);
      toast.success('Attachment removed');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove this attachment right now.';
      setAttachmentError(message);
      toast.error(message);
    } finally {
      setRemovingAttachmentId(null);
    }
  }

  function openAttachment(attachmentId: string) {
    if (!activeQuoteId) return;
    window.open(getQuoteAttachmentUrl(activeQuoteId, attachmentId), '_blank', 'noopener,noreferrer');
  }

  async function replaceAttachment(attachment: QuoteAttachment, file: File) {
    if (!activeQuoteId) return;

    setReplacingAttachmentId(attachment.id);
    setAttachmentError(null);
    try {
      await replaceQuoteAttachment({
        quoteId: activeQuoteId,
        attachmentId: attachment.id,
        file,
        isClientVisible: attachment.is_client_visible,
        attachmentPurpose: attachment.attachment_purpose,
      });
      toast.success('Attachment replaced');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to replace this attachment right now.';
      setAttachmentError(message);
      toast.error(message);
    } finally {
      setReplacingAttachmentId(null);
    }
  }

  async function createInvoiceRequest() {
    if (!activeQuoteId) return;

    const nextRequestErrors = validateInvoiceRequestFields();
    if (Object.keys(nextRequestErrors).length > 0) {
      setInvoiceRequestFieldErrors(nextRequestErrors);
      setInvoiceRequestError('Please correct the highlighted fields and try again.');
      toast.error('Please correct the highlighted fields and try again.');
      return;
    }

    setActionLoading(true);
    clearInvoiceRequestError();
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/invoice-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_amount: Number(invoiceRequestAmount),
          requested_invoice_date: invoiceRequestDate,
          requested_invoice_scope: invoiceRequestScope,
          manager_comments: invoiceRequestComments,
        }),
      });

      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to mark this quote ready to invoice right now.');
      }

      toast.success('Accounts notified');
      setInvoiceRequestComments('');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to mark this quote ready to invoice right now.';
      const fieldErrors = error instanceof Error && 'fieldErrors' in error
        ? ((error as Error & { fieldErrors?: DetailFieldErrors }).fieldErrors || {})
        : {};
      setInvoiceRequestFieldErrors(fieldErrors);
      setInvoiceRequestError(message);
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  }

  async function retractInvoiceRequest(invoiceRequestId: string) {
    if (!activeQuoteId || !invoiceRequestId) return;

    setActionLoading(true);
    clearInvoiceRequestError();
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/invoice-requests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          invoice_request_id: invoiceRequestId,
        }),
      });

      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to retract this invoice request right now.');
      }

      toast.success('Invoice request retracted');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retract this invoice request right now.';
      setInvoiceRequestError(message);
      toast.error(message);
    } finally {
      setActionLoading(false);
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
          invoice_request_id: selectedInvoiceRequest?.id || undefined,
          invoice_number: invoiceNumber,
          invoice_date: selectedInvoiceRequest?.requested_invoice_date || invoiceDate,
          amount: selectedInvoiceRequest ? Number(selectedInvoiceRequest.requested_amount) : Number(invoiceAmount),
          invoice_scope: selectedInvoiceRequest?.requested_invoice_scope || invoiceScope,
          confirm_matches_request: Boolean(selectedInvoiceRequest) ? invoiceMatchesRequest : undefined,
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
      setInvoiceMatchesRequest(false);
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
    <Dialog open={open} onOpenChange={handleDetailsDialogOpenChange}>
      <DialogContent
        ref={detailsDialogContentRef}
        className="w-[calc(100vw-2rem)] max-w-3xl xl:max-w-[60rem] max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white"
        onInteractOutside={handleDetailsDialogInteractOutside}
        onEscapeKeyDown={handleDetailsDialogEscapeKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Quote Details</DialogTitle>
        </DialogHeader>
        {loading ? (
          <PanelLoader message="Loading quote details..." className="py-12" />
        ) : !quote ? (
          <div className="space-y-4 py-8 text-center">
            <p className="text-sm text-red-200">{loadError || 'Unable to load quote details right now.'}</p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={discardDetailsDialog} className="border-slate-600 text-muted-foreground">
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
              <div className="flex min-w-0 items-center justify-between">
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-white">
                    <span className="font-mono text-sm text-brand-yellow">{quote.quote_reference}</span>
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
                  {customerToContacts.length > 0 && (
                    <div className="mt-2 rounded-md border border-slate-700 bg-slate-950/30 p-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional customer To</p>
                      <div className="mt-1 space-y-1">
                        {customerToContacts.map(contact => (
                          <p key={contact.id} className="text-xs text-slate-300">
                            {(contact.name || contact.email || 'Unnamed contact')}{contact.email ? ` <${contact.email}>` : ' (no email on file)'}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
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

              {(quote.site_address || quote.project_description) && (
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <div>
                    <span className="text-muted-foreground">Site Address</span>
                    {quote.site_address ? (
                      <p className="text-slate-300 whitespace-pre-wrap">{quote.site_address}</p>
                    ) : (
                      <p className="text-slate-500">—</p>
                    )}
                  </div>

                  <div>
                    <span className="text-muted-foreground">Summary</span>
                    {quote.project_description ? (
                      <FormattedQuoteText value={quote.project_description} className="mt-1" />
                    ) : (
                      <p className="text-slate-500">—</p>
                    )}
                  </div>
                </div>
              )}

              {quote.scope && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Scope</span>
                  <div className="mt-1 max-h-44 overflow-y-auto overscroll-contain rounded-md border border-slate-700/70 bg-slate-950/20 p-3 pr-4">
                    <FormattedQuoteText value={quote.scope} omitLeadingHeading="scope of works" />
                  </div>
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

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
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
                    {canManageSage ? (
                      <button
                        type="button"
                        className={sageCardClassName}
                        onClick={() => void toggleQuoteSage(!isQuoteOnSage)}
                        disabled={actionLoading}
                        aria-pressed={isQuoteOnSage}
                        aria-label={isQuoteOnSage ? 'Remove quote from Sage' : 'Mark quote on Sage'}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-muted-foreground">Sage</p>
                          {sagePostedDateLabel ? (
                            <span className="text-xs font-medium text-emerald-300">{sagePostedDateLabel}</span>
                          ) : null}
                        </div>
                        <p className={cn('mt-1 flex items-center gap-2 text-lg font-semibold', isQuoteOnSage ? 'text-emerald-100' : 'text-white')}>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              isQuoteOnSage
                                ? 'border-emerald-300 bg-emerald-400 text-slate-950'
                                : 'border-slate-500 bg-slate-900/60'
                            )}
                          >
                            {isQuoteOnSage ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                          </span>
                          <span>{isQuoteOnSage ? 'On Sage' : 'Not on Sage'}</span>
                        </p>
                      </button>
                    ) : (
                      <div className={sageCardClassName}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-muted-foreground">Sage</p>
                          {sagePostedDateLabel ? (
                            <span className="text-xs font-medium text-emerald-300">{sagePostedDateLabel}</span>
                          ) : null}
                        </div>
                        <p className={cn('mt-1 flex items-center gap-2 text-lg font-semibold', isQuoteOnSage ? 'text-emerald-100' : 'text-white')}>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              isQuoteOnSage
                                ? 'border-emerald-300 bg-emerald-400 text-slate-950'
                                : 'border-slate-500 bg-slate-900/60'
                            )}
                          >
                            {isQuoteOnSage ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                          </span>
                          <span>{isQuoteOnSage ? 'On Sage' : 'Not on Sage'}</span>
                        </p>
                      </div>
                    )}
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
                    {canRequestPo && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          const nextRecipients = poRequestRecipientOptions.map(option => option.email);
                          setPoRequestRecipientEmails(nextRecipients);
                          setPoRequestBaselineSnapshot(buildEmailSelectionSnapshot(nextRecipients));
                          setPoRequestDialogOpen(true);
                        }}
                        disabled={actionLoading || poRequestRecipientOptions.length === 0}
                        className="border-slate-600 text-muted-foreground"
                      >
                        <Mail className="mr-2 h-4 w-4" /> Request PO
                      </Button>
                    )}
                    {canTriggerRams && (
                      <Button
                        onClick={() => {
                          setRamsComments('');
                          setRamsBaselineSnapshot('');
                          setRamsDialogOpen(true);
                        }}
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
                      Add a primary customer contact email before confirming and sending this quote.
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div><span className="text-muted-foreground">PO Received</span><p className="text-white">{quote.po_received_at ? format(new Date(quote.po_received_at), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Start Date</span><p className="text-white">{quote.start_date ? format(new Date(quote.start_date), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Completion</span><p className="text-white">{quote.completion_status.replace(/_/g, ' ')}</p></div>
                  </div>
                </TabsContent>

                <TabsContent value="invoices" className="space-y-4">
                  {invoiceRequestError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {invoiceRequestError}
                    </div>
                  ) : null}
                  {invoiceError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {invoiceError}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm">
                      <p className="text-muted-foreground">Quote Total</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm">
                      <p className="text-muted-foreground">Actual Invoiced</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.invoicedTotal || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm">
                      <p className="text-muted-foreground">Pending Requested</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.pendingRequestedTotal || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm">
                      <p className="text-muted-foreground">Available To Request</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{availableToRequest.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-semibold text-white">Manager request</h4>
                        <p className="text-xs text-muted-foreground">Mark this quote as ready for Accounts to create invoice details.</p>
                      </div>
                      <Badge variant="outline" className={billingStatusConfig.color}>
                        {billingStatusConfig.label}
                      </Badge>
                    </div>

                    {pendingFullInvoiceRequest ? (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-100">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium">Full amount has already been requested.</p>
                            <p className="text-xs text-violet-100/80">
                              Marked ready: {format(new Date(pendingFullInvoiceRequest.requested_at), 'dd MMM yyyy')}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retractInvoiceRequest(pendingFullInvoiceRequest.id)}
                            disabled={actionLoading || !canManageInvoices}
                            className="border-violet-400/40 text-violet-100 hover:bg-violet-500/20"
                          >
                            Retract request
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                          <div className="space-y-2">
                            <Label>Amount *</Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={invoiceRequestAmount}
                              disabled={managerRequestControlsDisabled}
                              onChange={e => {
                                clearInvoiceRequestError('requested_amount');
                                const nextValue = e.target.value;
                                setInvoiceRequestAmount(nextValue);

                                const numericValue = Number(nextValue);
                                if (nextValue && Number.isFinite(numericValue) && numericValue < availableToRequest) {
                                  setInvoiceRequestScope('partial');
                                }
                              }}
                              className={getFieldClassName(invoiceRequestFieldErrors, 'requested_amount')}
                            />
                            {renderFieldError(invoiceRequestFieldErrors, 'requested_amount')}
                          </div>
                          <div className="space-y-2">
                            <Label>Date *</Label>
                            <Input
                              type="date"
                              value={invoiceRequestDate}
                              disabled={managerRequestControlsDisabled}
                              onChange={e => {
                                clearInvoiceRequestError('requested_invoice_date');
                                setInvoiceRequestDate(e.target.value);
                              }}
                              className={getFieldClassName(invoiceRequestFieldErrors, 'requested_invoice_date')}
                            />
                            {renderFieldError(invoiceRequestFieldErrors, 'requested_invoice_date')}
                          </div>
                          <div className="space-y-2">
                            <Label>Invoice Scope</Label>
                            <Select
                              value={invoiceRequestScope}
                              onValueChange={(value: 'full' | 'partial') => {
                                clearInvoiceRequestError('requested_invoice_scope');
                                setInvoiceRequestScope(value);
                              }}
                              disabled={managerRequestControlsDisabled}
                            >
                              <SelectTrigger className={getSelectClassName(invoiceRequestFieldErrors, 'requested_invoice_scope')}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="full">Invoice in full</SelectItem>
                                <SelectItem value="partial">Partial invoice</SelectItem>
                              </SelectContent>
                            </Select>
                            {renderFieldError(invoiceRequestFieldErrors, 'requested_invoice_scope')}
                          </div>
                          <div className="flex items-end">
                            <Button
                              onClick={createInvoiceRequest}
                              disabled={actionLoading || managerRequestControlsDisabled}
                              className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                            >
                              <Send className="mr-2 h-4 w-4" /> {managerRequestCtaLabel}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Internal Comments</Label>
                          <Textarea
                            value={invoiceRequestComments}
                            disabled={managerRequestControlsDisabled}
                            onChange={e => {
                              clearInvoiceRequestError('manager_comments');
                              setInvoiceRequestComments(e.target.value);
                            }}
                            rows={2}
                            className={getFieldClassName(invoiceRequestFieldErrors, 'manager_comments')}
                          />
                          {renderFieldError(invoiceRequestFieldErrors, 'manager_comments')}
                        </div>
                      </>
                    )}

                    {pendingInvoiceRequests.length > 0 && !pendingFullInvoiceRequest ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending invoice requests</p>
                        {pendingInvoiceRequests.map(request => (
                          <div key={request.id} className="flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-medium text-slate-100">
                                £{Number(request.requested_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} • {request.requested_invoice_scope === 'full' ? 'Full invoice' : 'Partial invoice'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Marked ready: {format(new Date(request.requested_at), 'dd MMM yyyy')} • Requested date: {format(new Date(request.requested_invoice_date), 'dd MMM yyyy')}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retractInvoiceRequest(request.id)}
                              disabled={actionLoading || !canManageInvoices}
                            >
                              Retract request
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {availableToRequest <= 0 && !pendingFullInvoiceRequest ? (
                      <p className="text-xs text-muted-foreground">No remaining balance is available to request.</p>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-4">
                    <div>
                      <h4 className="font-semibold text-white">Accounts invoice details</h4>
                      <p className="text-xs text-muted-foreground">Create the invoice, then record the invoice number here.</p>
                    </div>

                    {pendingInvoiceRequests.length ? (
                      <div className="space-y-2">
                        <Label>Pending Request</Label>
                        <Select
                          value={selectedInvoiceRequestId}
                          onValueChange={(value) => {
                            clearInvoiceError();
                            setSelectedInvoiceRequestId(value);
                            setInvoiceMatchesRequest(false);
                          }}
                          disabled={!canManageInvoices}
                        >
                          <SelectTrigger className="bg-slate-800 border-slate-600">
                            <SelectValue placeholder="Select pending request" />
                          </SelectTrigger>
                          <SelectContent>
                            {pendingInvoiceRequests.map(request => (
                              <SelectItem key={request.id} value={request.id}>
                                {format(new Date(request.requested_invoice_date), 'dd MMM yyyy')} • £{Number(request.requested_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} • {request.requested_invoice_scope}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No pending invoice requests. Accounts can still record ad-hoc invoice details if needed.</p>
                    )}

                    {selectedInvoiceRequest ? (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-100">
                        <p className="font-medium">Manager requested {selectedInvoiceRequest.requested_invoice_scope} invoice for £{Number(selectedInvoiceRequest.requested_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                        <p className="text-xs text-violet-100/80">Requested date: {format(new Date(selectedInvoiceRequest.requested_invoice_date), 'dd MMM yyyy')}</p>
                        {selectedInvoiceRequest.manager_comments ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm">{selectedInvoiceRequest.manager_comments}</p>
                        ) : null}
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
                          value={selectedInvoiceRequest ? String(selectedInvoiceRequest.requested_amount) : invoiceAmount}
                          disabled={!canManageInvoices || Boolean(selectedInvoiceRequest)}
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
                          value={selectedInvoiceRequest?.requested_invoice_date || invoiceDate}
                          disabled={!canManageInvoices || Boolean(selectedInvoiceRequest)}
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
                        <Select
                          value={selectedInvoiceRequest?.requested_invoice_scope || invoiceScope}
                          onValueChange={(value: 'full' | 'partial') => setInvoiceScope(value)}
                          disabled={!canManageInvoices || Boolean(selectedInvoiceRequest)}
                        >
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
                        <Label>Accounts Comments</Label>
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

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-h-10 flex-1">
                        {selectedInvoiceRequest ? (
                          <label className="flex items-start gap-2 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={invoiceMatchesRequest}
                              disabled={!canManageInvoices}
                              onChange={event => {
                                clearInvoiceError('confirm_matches_request');
                                setInvoiceMatchesRequest(event.target.checked);
                              }}
                              className="mt-1"
                            />
                            <span>I confirm the invoice details and total match the manager request.</span>
                          </label>
                        ) : null}
                        {renderFieldError(invoiceFieldErrors, 'confirm_matches_request')}
                      </div>

                      <Button
                        onClick={addInvoice}
                        disabled={actionLoading || !canManageInvoices}
                        className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 sm:self-start"
                      >
                        <Receipt className="mr-2 h-4 w-4" /> Add Invoice Details
                      </Button>
                    </div>
                  </div>

                  {!canManageInvoices ? (
                    <p className="text-xs text-muted-foreground">
                      Only the latest quote version can be invoiced.
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    {quote.invoices?.length ? quote.invoices.map(invoice => {
                      const linkedRequest = quote.invoice_requests?.find(request => request.id === invoice.invoice_request_id) || null;
                      return (
                        <div key={invoice.id} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="font-medium text-white">{invoice.invoice_number}</p>
                              <p className="text-xs text-muted-foreground">
                                Invoice date: {format(new Date(invoice.invoice_date), 'dd MMM yyyy')} • {invoice.invoice_scope === 'full' ? 'Full invoice' : 'Partial invoice'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {linkedRequest ? `Marked ready: ${format(new Date(linkedRequest.requested_at), 'dd MMM yyyy')} • ` : ''}
                                Added by Accounts: {format(new Date(invoice.created_at), 'dd MMM yyyy')}
                              </p>
                            </div>
                            <div className="space-y-2 text-right">
                              <p className="font-semibold text-white">£{Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                          {invoice.comments && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{invoice.comments}</p>}
                        </div>
                      );
                    }) : (
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
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-slate-600 text-muted-foreground"
                            onClick={() => openAttachment(attachment.id)}
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            Open
                          </Button>
                          <label
                            className={cn(
                              'inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-600 px-3 text-xs text-muted-foreground hover:bg-slate-800',
                              (!canManageAttachments || replacingAttachmentId === attachment.id) && 'pointer-events-none opacity-50'
                            )}
                          >
                            {replacingAttachmentId === attachment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Replace
                            <input
                              type="file"
                              className="hidden"
                              disabled={!canManageAttachments || replacingAttachmentId === attachment.id}
                              onChange={event => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  setAttachmentError(null);
                                  void replaceAttachment(attachment, file);
                                  event.target.value = '';
                                }
                              }}
                            />
                          </label>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canManageAttachments || removingAttachmentId === attachment.id}
                            className="border-slate-600 text-muted-foreground"
                            onClick={() => deleteAttachment(attachment.id)}
                          >
                            {removingAttachmentId === attachment.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            Remove
                          </Button>
                        </div>
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
                      onClick={() => {
                          const nextManagerId = quote.requester_id || '';
                          setDuplicateManagerProfileId(nextManagerId);
                          setDuplicateBaselineSnapshot(nextManagerId);
                        setDuplicateDialogOpen(true);
                      }}
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
    <Dialog open={poRequestDialogOpen} onOpenChange={handlePoRequestDialogOpenChange}>
      <DialogContent
        ref={poRequestDialogContentRef}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-slate-900 border-slate-700 text-white sm:max-w-2xl"
        onInteractOutside={handlePoRequestDialogInteractOutside}
        onEscapeKeyDown={handlePoRequestDialogEscapeKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Request purchase order</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Review the recipients and email preview before sending the attached quote PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-slate-700 bg-slate-950/30 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</p>
            <p className="mt-1 text-white">{quoteDisplayName || quote?.quote_reference || 'Quote'}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer recipients</p>
            {poRequestRecipientOptions.length > 0 ? (
              <div className="space-y-2">
                {poRequestRecipientOptions.map(option => (
                  <label key={option.email} className="flex items-start gap-3 rounded-md border border-slate-700 bg-slate-950/30 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={poRequestRecipientEmails.some(email => email.toLowerCase() === option.email.toLowerCase())}
                      onChange={event => togglePoRequestRecipient(option.email, event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-white">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-amber-300">No saved customer email recipients are available for this quote.</p>
            )}
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/30 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email preview</p>
            <div className="mt-2 space-y-3 whitespace-pre-wrap text-slate-200">
              <p>Hello {poRequestGreetingName},</p>
              <p>Please can I have a purchase order for the attached quotation.</p>
              <p>Kind Regards<br />{poRequestSenderName}</p>
            </div>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/30 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachment</p>
            <p className="mt-1 text-slate-200">{poRequestPdfFilename}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={discardPoRequestDialog} className="border-slate-600 text-muted-foreground">
            {isPoRequestDirty ? 'Discard Changes' : 'Cancel'}
          </Button>
          <Button
            onClick={() => void handlePoRequestEmail()}
            disabled={actionLoading || poRequestRecipientEmails.length === 0}
            className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
          >
            {actionLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : 'Send PO request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={duplicateDialogOpen} onOpenChange={handleDuplicateDialogOpenChange}>
      <DialogContent
        ref={duplicateDialogContentRef}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-slate-900 border-slate-700 text-white sm:max-w-lg"
        onInteractOutside={handleDuplicateDialogInteractOutside}
        onEscapeKeyDown={handleDuplicateDialogEscapeKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Duplicate quote</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This creates a new standalone quote with the next quote number from the selected manager series.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-slate-700 bg-slate-950/30 p-3 text-sm">
            <p className="text-muted-foreground">Source quote</p>
            <p className="font-medium text-white">{quoteDisplayName || quote?.quote_reference || 'Current quote'}</p>
          </div>
          <div className="space-y-2">
            <Label>Number series manager</Label>
            <Select value={duplicateManagerProfileId} onValueChange={setDuplicateManagerProfileId}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Use original quote manager" />
              </SelectTrigger>
              <SelectContent>
                {duplicateManagerOptions.map(option => (
                  <SelectItem key={option.profile_id} value={option.profile_id}>
                    {(option.profile?.full_name || option.signoff_name || option.initials)} ({option.initials})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Leave as the original manager unless the copied quote belongs under a different manager.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={discardDuplicateDialog} className="border-slate-600 text-muted-foreground">
            {isDuplicateDialogDirty ? 'Discard Changes' : 'Cancel'}
          </Button>
          <Button onClick={() => void handleDuplicateQuote()} disabled={actionLoading} className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90">
            {actionLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Duplicating...</> : 'Duplicate quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={ramsDialogOpen} onOpenChange={handleRamsDialogOpenChange}>
      <DialogContent
        ref={ramsDialogContentRef}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-slate-900 border-slate-700 text-white"
        onInteractOutside={handleRamsDialogInteractOutside}
        onEscapeKeyDown={handleRamsDialogEscapeKeyDown}
      >
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
          <Button variant="outline" onClick={discardRamsDialog} className="border-slate-600 text-muted-foreground">
            {isRamsDialogDirty ? 'Discard Changes' : 'Cancel'}
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
