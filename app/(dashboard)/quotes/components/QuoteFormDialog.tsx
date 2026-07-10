'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, GripVertical, Upload, X } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { cn } from '@/lib/utils/cn';
import { getQuoteRichPasteText } from '@/lib/quotes/quote-rich-text';
import { toast } from 'sonner';
import {
  deleteQuoteAttachment,
  getQuoteAttachmentUrl,
  replaceQuoteAttachment,
} from '../quote-attachment-client';
import type { Quote, QuoteAttachment, QuoteFormData, QuoteLineItem, QuoteManagerOption } from '../types';

interface Customer {
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
  secondary_contacts?: Array<{
    id: string;
    customer_id: string;
    name: string | null;
    job_title: string | null;
    email: string | null;
    phone: string | null;
  }>;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface QuoteAssistDraft {
  subject_line: string;
  project_description: string;
  scope: string;
  caveats: string[];
}

interface QuoteFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: QuoteFormData, isEdit: boolean) => Promise<void>;
  onAttachmentsChange?: (quoteId: string) => Promise<Quote | void>;
  quote?: Quote | null;
  customers: Customer[];
  managerOptions: QuoteManagerOption[];
  approvers: ApproverOption[];
  initialCustomerId?: string | null;
  createdCustomerId?: string | null;
  onCreatedCustomerApplied?: () => void;
  onAddCustomer?: () => void;
}

const EMPTY_LINE_ITEM: QuoteLineItem = {
  description: '',
  quantity: 1,
  unit: '',
  unit_rate: 0,
  line_total: 0,
  sort_order: 0,
};

type QuoteFieldErrors = Record<string, string>;

function getAttachmentFileSignature(file: File) {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
}

function buildQuoteFormDirtySnapshot(
  form: QuoteFormData,
  attachmentFiles: File[],
  quoteAssistEmail: string,
  quoteAssistDraft: QuoteAssistDraft | null
) {
  return JSON.stringify({
    form,
    attachmentFiles: attachmentFiles.map(getAttachmentFileSignature),
    quoteAssistEmail,
    quoteAssistDraft,
  });
}

function buildAddress(customer?: Customer): string {
  if (!customer) return '';
  return [
    customer.address_line_1,
    customer.address_line_2,
    [customer.city, customer.county].filter(Boolean).join(', ') || null,
    customer.postcode,
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeCustomerCompanyName(name: string): string {
  return name.trim().toLowerCase();
}

function getDuplicateCustomerCompanyNames(customers: Customer[]): Set<string> {
  const counts = new Map<string, number>();

  customers.forEach(customer => {
    const key = normalizeCustomerCompanyName(customer.company_name);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
  );
}

function getCustomerSelectLabel(customer: Customer, duplicateCompanyNames: Set<string>): string {
  const companyName = customer.company_name.trim() || customer.company_name;
  const contactName = customer.contact_name?.trim();

  if (contactName && duplicateCompanyNames.has(normalizeCustomerCompanyName(customer.company_name))) {
    return `${companyName} [${contactName}]`;
  }

  return companyName;
}

function getContactLabel(contact: NonNullable<Customer['secondary_contacts']>[number]): string {
  const name = contact.name?.trim() || contact.email?.trim() || 'Unnamed contact';
  return contact.job_title ? `${name} (${contact.job_title})` : name;
}

function isQuoteAssistDraft(value: unknown): value is QuoteAssistDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const draft = value as Partial<QuoteAssistDraft>;
  return typeof draft.subject_line === 'string'
    && typeof draft.project_description === 'string'
    && typeof draft.scope === 'string'
    && Array.isArray(draft.caveats)
    && draft.caveats.every(caveat => typeof caveat === 'string');
}

export function QuoteFormDialog({
  open,
  onClose,
  onSubmit,
  onAttachmentsChange,
  quote,
  customers,
  managerOptions,
  initialCustomerId,
  createdCustomerId,
  onCreatedCustomerApplied,
  onAddCustomer,
}: QuoteFormDialogProps) {
  const { profile } = useAuth();
  const isEditing = !!quote;
  const wasOpenRef = useRef(false);
  const lastDialogKeyRef = useRef<string | null>(null);
  const customerSelectRef = useRef<HTMLDivElement>(null);

  const defaultManager = managerOptions.find(option => option.profile_id === profile?.id) || managerOptions[0];
  const dialogKey = quote ? `edit:${quote.id}` : `new:${initialCustomerId || ''}`;
  const duplicateCustomerCompanyNames = useMemo(
    () => getDuplicateCustomerCompanyNames(customers),
    [customers]
  );

  const [form, setForm] = useState<QuoteFormData>({
    customer_id: '',
    manager_profile_id: '',
    requester_initials: '',
    quote_date: new Date().toISOString().slice(0, 10),
    attention_name: '',
    attention_email: '',
    site_address: '',
    subject_line: '',
    project_description: '',
    scope: '',
    salutation: '',
    validity_days: 30,
    pricing_mode: 'itemized',
    manager_name: '',
    manager_email: '',
    approver_profile_id: '',
    signoff_name: '',
    signoff_title: '',
    custom_footer_text: '',
    version_notes: '',
    start_date: '',
    start_alert_days: '',
    estimated_duration_days: '',
    secondary_contact_ids: [],
    line_items: [{ ...EMPTY_LINE_ITEM }],
  });
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<QuoteAttachment[]>([]);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [replacingAttachmentId, setReplacingAttachmentId] = useState<string | null>(null);
  const [attachmentActionError, setAttachmentActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<QuoteFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quoteAssistOpen, setQuoteAssistOpen] = useState(false);
  const [quoteAssistEmail, setQuoteAssistEmail] = useState('');
  const [quoteAssistDraft, setQuoteAssistDraft] = useState<QuoteAssistDraft | null>(null);
  const [quoteAssistError, setQuoteAssistError] = useState<string | null>(null);
  const [quoteAssistLoading, setQuoteAssistLoading] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [initialDirtySnapshot, setInitialDirtySnapshot] = useState('');
  const currentDirtySnapshot = buildQuoteFormDirtySnapshot(form, attachmentFiles, quoteAssistEmail, quoteAssistDraft);
  const isFormDirty = open && Boolean(initialDirtySnapshot) && currentDirtySnapshot !== initialDirtySnapshot;
  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handleEscapeKeyDown,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: saving,
    onOpenChange: (isOpen) => {
      if (!isOpen && !saving) onClose();
    },
  });

  const selectedCustomer = useMemo(
    () => customers.find(customer => customer.id === form.customer_id),
    [customers, form.customer_id]
  );
  const selectedCustomerLabel = selectedCustomer
    ? getCustomerSelectLabel(selectedCustomer, duplicateCustomerCompanyNames)
    : '';
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers;

    return customers.filter(customer => [
      getCustomerSelectLabel(customer, duplicateCustomerCompanyNames),
      customer.company_name,
      customer.short_name,
      customer.contact_name,
      customer.contact_email,
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [customerSearch, customers, duplicateCustomerCompanyNames]);

  useEffect(() => {
    if (!customerDropdownOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!customerSelectRef.current?.contains(target)) setCustomerDropdownOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCustomerDropdownOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [customerDropdownOpen]);

  function clearFieldError(field: string) {
    setFieldErrors(prev => {
      if (!(field in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function getFieldClassName(field: string) {
    return cn(
      'bg-slate-800',
      fieldErrors[field] ? 'border-red-500 focus-visible:ring-red-500/30' : 'border-slate-600'
    );
  }

  function getSelectClassName(field: string) {
    return cn(
      'bg-slate-800',
      fieldErrors[field] ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600'
    );
  }

  function renderFieldError(field: string) {
    if (!fieldErrors[field]) {
      return null;
    }

    return <p className="text-xs text-red-300">{fieldErrors[field]}</p>;
  }

  function isMeaningfulLineItem(item: QuoteLineItem) {
    return Boolean(
      item.description.trim()
      || item.unit.trim()
      || Number(item.unit_rate) !== 0
      || Number(item.quantity) !== 1
    );
  }

  function validateForm(currentForm: QuoteFormData): QuoteFieldErrors {
    const nextErrors: QuoteFieldErrors = {};

    if (!currentForm.customer_id) {
      nextErrors.customer_id = 'Select a customer.';
    }

    if (!currentForm.site_address.trim()) {
      nextErrors.site_address = 'Enter the site address for this quote.';
    }

    if (!currentForm.manager_profile_id) {
      nextErrors.manager_profile_id = 'Select a manager.';
    }

    if (!currentForm.quote_date) {
      nextErrors.quote_date = 'Select a quote date.';
    }

    if (!Number.isFinite(Number(currentForm.validity_days)) || Number(currentForm.validity_days) < 1) {
      nextErrors.validity_days = 'Enter quote validity in days.';
    }

    if (!currentForm.attention_name.trim()) {
      nextErrors.attention_name = 'Enter who this quote is for the attention of.';
    }

    if (!currentForm.attention_email.trim()) {
      nextErrors.attention_email = 'Enter the contact email.';
    }

    if (!currentForm.subject_line.trim()) {
      nextErrors.subject_line = 'Enter a quote title.';
    }

    if (!currentForm.project_description.trim()) {
      nextErrors.project_description = 'Enter a quote summary.';
    }

    if (!currentForm.scope.trim()) {
      nextErrors.scope = 'Enter the quote scope.';
    }

    if (currentForm.pricing_mode === 'itemized') {
      currentForm.line_items.forEach((item, index) => {
        if (isMeaningfulLineItem(item) && !item.description.trim()) {
          nextErrors[`line_items.${index}.description`] = 'Enter a description for this line item.';
        }
      });
    }

    if (currentForm.pricing_mode === 'attachments_only') {
      const hasExistingClientAttachment = existingAttachments.some(attachment => attachment.is_client_visible);
      if (!hasExistingClientAttachment && attachmentFiles.length === 0) {
        nextErrors.attachment_files = 'Add at least one client-visible attachment when pricing is supplied by attachment.';
      }
    }

    return nextErrors;
  }

  function applyManager(profileId: string, currentForm: QuoteFormData): QuoteFormData {
    const selected = managerOptions.find(option => option.profile_id === profileId);
    if (!selected) return currentForm;

    return {
      ...currentForm,
      manager_profile_id: selected.profile_id,
      requester_initials: selected.initials,
      manager_name: currentForm.manager_name || selected.profile?.full_name || selected.signoff_name || '',
      manager_email: selected.manager_email || selected.profile?.email || currentForm.manager_email,
      approver_profile_id: currentForm.approver_profile_id || selected.approver_profile_id || selected.profile_id,
      signoff_name: currentForm.signoff_name || selected.signoff_name || selected.profile?.full_name || '',
      signoff_title: currentForm.signoff_title || selected.signoff_title || '',
    };
  }

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    const shouldInitialize = !wasOpenRef.current || lastDialogKeyRef.current !== dialogKey;
    if (!shouldInitialize) {
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setAttachmentActionError(null);
    setQuoteAssistOpen(false);
    setQuoteAssistEmail('');
    setQuoteAssistDraft(null);
    setQuoteAssistError(null);
    setAttachmentFiles([]);
    setExistingAttachments(quote?.attachments || []);
    if (quote) {
      const nextForm: QuoteFormData = {
        customer_id: quote.customer_id,
        manager_profile_id: quote.requester_id || '',
        requester_initials: quote.requester_initials || '',
        quote_date: quote.quote_date,
        attention_name: quote.attention_name || '',
        attention_email: quote.attention_email || '',
        site_address: quote.site_address || '',
        subject_line: quote.subject_line || '',
        project_description: quote.project_description || '',
        scope: quote.scope || '',
        salutation: quote.salutation || '',
        validity_days: quote.validity_days,
        pricing_mode: quote.pricing_mode || 'itemized',
        manager_name: quote.manager_name || '',
        manager_email: quote.manager_email || '',
        approver_profile_id: quote.approver_profile_id || quote.requester_id || '',
        signoff_name: quote.signoff_name || '',
        signoff_title: quote.signoff_title || '',
        custom_footer_text: quote.custom_footer_text || '',
        version_notes: quote.version_notes || '',
        start_date: quote.start_date || '',
        start_alert_days: quote.start_alert_days || '',
        estimated_duration_days: quote.estimated_duration_days || '',
        secondary_contact_ids: quote.selected_secondary_contact_ids || [],
        line_items: quote.line_items && quote.line_items.length > 0
          ? quote.line_items.map((li, i) => ({ ...li, sort_order: i }))
          : [{ ...EMPTY_LINE_ITEM }],
      };
      setForm(nextForm);
      setInitialDirtySnapshot(buildQuoteFormDirtySnapshot(nextForm, [], '', null));
    } else {
      const next = applyManager(defaultManager?.profile_id || '', {
        customer_id: '',
        manager_profile_id: defaultManager?.profile_id || '',
        requester_initials: defaultManager?.initials || 'XX',
        quote_date: new Date().toISOString().slice(0, 10),
        attention_name: '',
        attention_email: '',
        site_address: '',
        subject_line: '',
        project_description: '',
        scope: '',
        salutation: '',
        validity_days: 30,
        pricing_mode: 'itemized',
        manager_name: defaultManager?.profile?.full_name || profile?.full_name || '',
        manager_email: defaultManager?.manager_email || defaultManager?.profile?.email || '',
        approver_profile_id: defaultManager?.approver_profile_id || defaultManager?.profile_id || '',
        signoff_name: defaultManager?.signoff_name || profile?.full_name || '',
        signoff_title: defaultManager?.signoff_title || '',
        custom_footer_text: '',
        version_notes: '',
        start_date: '',
        start_alert_days: '',
        estimated_duration_days: '',
        secondary_contact_ids: [],
        line_items: [{ ...EMPTY_LINE_ITEM }],
      });

      if (initialCustomerId) {
        const customer = customers.find(item => item.id === initialCustomerId);
        next.customer_id = initialCustomerId;
        next.attention_name = customer?.contact_name || '';
        next.attention_email = customer?.contact_email || '';
        next.salutation = customer?.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '';
        next.validity_days = customer?.default_validity_days || 30;
        next.site_address = buildAddress(customer);
        next.secondary_contact_ids = [];
      }

      setForm(next);
      setInitialDirtySnapshot(buildQuoteFormDirtySnapshot(next, [], '', null));
    }
    wasOpenRef.current = true;
    lastDialogKeyRef.current = dialogKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, open, profile, defaultManager, initialCustomerId, customers, dialogKey]);

  function updateField<K extends keyof QuoteFormData>(key: K, value: QuoteFormData[K]) {
    clearFieldError(String(key));
    setSubmitError(null);
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function insertPastedText(currentValue: string, pastedText: string, target: HTMLTextAreaElement): string {
    const selectionStart = target.selectionStart ?? currentValue.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;

    return [
      currentValue.slice(0, selectionStart),
      pastedText,
      currentValue.slice(selectionEnd),
    ].join('');
  }

  function handleFormattedFieldPaste(
    key: 'project_description' | 'scope' | 'custom_footer_text' | 'version_notes',
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) {
    const pastedText = getQuoteRichPasteText(event.clipboardData);
    if (!pastedText) return;

    event.preventDefault();
    updateField(key, insertPastedText(form[key], pastedText, event.currentTarget));
  }

  function handleLineItemDescriptionPaste(
    idx: number,
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) {
    const pastedText = getQuoteRichPasteText(event.clipboardData);
    if (!pastedText) return;

    event.preventDefault();
    updateLineItem(
      idx,
      'description',
      insertPastedText(form.line_items[idx]?.description || '', pastedText, event.currentTarget)
    );
  }

  function handleCustomerChange(customerId: string) {
    clearFieldError('customer_id');
    clearFieldError('site_address');
    setSubmitError(null);
    const customer = customers.find(c => c.id === customerId);
    setCustomerDropdownOpen(false);
    setCustomerSearch('');
    setForm(prev => ({
      ...prev,
      customer_id: customerId,
      attention_name: customer?.contact_name || '',
      attention_email: customer?.contact_email || '',
      site_address: buildAddress(customer),
      validity_days: customer?.default_validity_days || prev.validity_days,
      salutation: customer?.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '',
      secondary_contact_ids: [],
    }));
  }

  useEffect(() => {
    if (!open || isEditing || !createdCustomerId) return;
    const customer = customers.find(item => item.id === createdCustomerId);
    if (!customer) return;
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next.customer_id;
      delete next.site_address;
      return next;
    });
    setSubmitError(null);
    setCustomerDropdownOpen(false);
    setCustomerSearch('');
    setForm(prev => ({
      ...prev,
      customer_id: createdCustomerId,
      attention_name: customer.contact_name || '',
      attention_email: customer.contact_email || '',
      site_address: buildAddress(customer),
      validity_days: customer.default_validity_days || prev.validity_days,
      salutation: customer.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '',
      secondary_contact_ids: [],
    }));
    onCreatedCustomerApplied?.();
  }, [createdCustomerId, customers, isEditing, open, onCreatedCustomerApplied]);

  function toggleSecondaryContact(contactId: string, checked: boolean) {
    clearFieldError('secondary_contact_ids');
    setSubmitError(null);
    setForm(prev => ({
      ...prev,
      secondary_contact_ids: checked
        ? Array.from(new Set([...prev.secondary_contact_ids, contactId]))
        : prev.secondary_contact_ids.filter(id => id !== contactId),
    }));
  }

  function handleManagerChange(managerProfileId: string) {
    clearFieldError('manager_profile_id');
    setSubmitError(null);
    setForm(prev => applyManager(managerProfileId, {
      ...prev,
      manager_profile_id: managerProfileId,
      manager_name: '',
      manager_email: '',
      signoff_name: '',
      signoff_title: '',
      approver_profile_id: '',
    }));
  }

  async function generateQuoteAssistDraft() {
    const customerEmail = quoteAssistEmail.trim();
    if (!customerEmail) {
      setQuoteAssistError('Paste the customer email before generating a draft.');
      return;
    }

    setQuoteAssistLoading(true);
    setQuoteAssistError(null);
    setQuoteAssistDraft(null);

    try {
      const response = await fetch('/api/quotes/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail,
          customerName: selectedCustomer?.company_name,
          siteAddress: form.site_address,
          existingTitle: form.subject_line,
          existingSummary: form.project_description,
          existingScope: form.scope,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | unknown;

      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: string }).error || 'Unable to generate a quote draft.')
          : 'Unable to generate a quote draft.';
        throw new Error(message);
      }

      if (!isQuoteAssistDraft(payload)) {
        throw new Error('The generated draft was incomplete. Please try again.');
      }

      setQuoteAssistDraft(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate a quote draft.';
      setQuoteAssistError(message);
      toast.error(message);
    } finally {
      setQuoteAssistLoading(false);
    }
  }

  function applyQuoteAssistDraft() {
    if (!quoteAssistDraft) return;

    setForm(prev => ({
      ...prev,
      subject_line: quoteAssistDraft.subject_line,
      project_description: quoteAssistDraft.project_description,
      scope: quoteAssistDraft.scope,
    }));
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next.subject_line;
      delete next.project_description;
      delete next.scope;
      return next;
    });
    setSubmitError(null);
    setQuoteAssistOpen(false);
    toast.success('AI draft applied. Please check it before sending the quote.');
  }

  function updateLineItem(idx: number, field: keyof QuoteLineItem, value: string | number) {
    clearFieldError(`line_items.${idx}.description`);
    setSubmitError(null);
    setForm(prev => {
      const items = [...prev.line_items];
      const item = { ...items[idx], [field]: value };
      item.line_total = Math.round(Number(item.quantity) * Number(item.unit_rate) * 100) / 100;
      items[idx] = item;
      return { ...prev, line_items: items };
    });
  }

  function addLineItem() {
    setSubmitError(null);
    setForm(prev => ({
      ...prev,
      line_items: [...prev.line_items, { ...EMPTY_LINE_ITEM, sort_order: prev.line_items.length }],
    }));
  }

  function removeLineItem(idx: number) {
    clearFieldError(`line_items.${idx}.description`);
    setSubmitError(null);
    setForm(prev => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== idx).map((li, i) => ({ ...li, sort_order: i })),
    }));
  }

  function handleAttachmentFilesChange(files: FileList | null) {
    if (!files?.length) return;
    setSubmitError(null);
    clearFieldError('attachment_files');
    setAttachmentFiles(prev => [...prev, ...Array.from(files)]);
  }

  function removeAttachmentFile(index: number) {
    clearFieldError('attachment_files');
    setAttachmentFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function refreshExistingAttachments(quoteId: string, fallbackAttachments: QuoteAttachment[]) {
    const updatedQuote = await onAttachmentsChange?.(quoteId);
    const nextAttachments = updatedQuote?.attachments || fallbackAttachments;
    setExistingAttachments(nextAttachments);
  }

  function openSavedAttachment(attachment: QuoteAttachment) {
    if (!quote?.id) return;
    window.open(getQuoteAttachmentUrl(quote.id, attachment.id), '_blank', 'noopener,noreferrer');
  }

  async function removeSavedAttachment(attachment: QuoteAttachment) {
    if (!quote?.id) return;

    setRemovingAttachmentId(attachment.id);
    setAttachmentActionError(null);
    clearFieldError('attachment_files');
    try {
      await deleteQuoteAttachment(quote.id, attachment.id);
      const fallbackAttachments = existingAttachments.filter(item => item.id !== attachment.id);
      await refreshExistingAttachments(quote.id, fallbackAttachments);
      toast.success('Attachment removed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove this attachment right now.';
      setAttachmentActionError(message);
      toast.error(message);
    } finally {
      setRemovingAttachmentId(null);
    }
  }

  async function replaceSavedAttachment(attachment: QuoteAttachment, file: File) {
    if (!quote?.id) return;

    setReplacingAttachmentId(attachment.id);
    setAttachmentActionError(null);
    clearFieldError('attachment_files');
    try {
      const replacement = await replaceQuoteAttachment({
        quoteId: quote.id,
        attachmentId: attachment.id,
        file,
        isClientVisible: attachment.is_client_visible,
        attachmentPurpose: attachment.attachment_purpose,
      });
      const fallbackAttachments = [
        replacement,
        ...existingAttachments.filter(item => item.id !== attachment.id),
      ];
      await refreshExistingAttachments(quote.id, fallbackAttachments);
      toast.success('Attachment replaced');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to replace this attachment right now.';
      setAttachmentActionError(message);
      toast.error(message);
    } finally {
      setReplacingAttachmentId(null);
    }
  }

  const subtotal = form.line_items.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unit_rate), 0);
  const clientVisibleAttachments = existingAttachments.filter(attachment => attachment.is_client_visible);
  const canManageSavedAttachments = Boolean(quote?.id && quote.is_latest_version);
  const selectedSecondaryContacts = (selectedCustomer?.secondary_contacts || [])
    .filter(contact => form.secondary_contact_ids.includes(contact.id));
  const contactEmailDisplay = selectedSecondaryContacts.length > 0
    ? `${form.attention_email || selectedCustomer?.contact_email || 'Primary email'}, plus ${selectedSecondaryContacts.length} more...`
    : form.attention_email || selectedCustomer?.contact_email || 'Select primary contact email';
  const areCustomerDependentFieldsDisabled = !form.customer_id;
  const customerDependentContactEmailDisplay = areCustomerDependentFieldsDisabled ? '' : contactEmailDisplay;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validateForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setSubmitError('Please correct the highlighted fields and try again.');
      toast.error('Please correct the highlighted fields and try again.');
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit({ ...form, attachment_files: attachmentFiles }, isEditing);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save quote';
      const nextFieldErrors = error instanceof Error && 'fieldErrors' in error
        ? ((error as Error & { fieldErrors?: QuoteFieldErrors }).fieldErrors || {})
        : {};

      setFieldErrors(nextFieldErrors);
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle className="text-white">
              {isEditing ? 'Edit Quote' : 'New Quote'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {isEditing ? 'Modify quote details and line items.' : 'Create a new customer quotation.'}
            </DialogDescription>
          </DialogHeader>

          {submitError ? (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {submitError}
            </div>
          ) : null}

          {!isEditing ? (
            <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-amber-300/20 p-2 text-amber-200">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">Draft quote from customer email</h3>
                      <span className="rounded-full border border-amber-300/50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                        Beta feature
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuoteAssistOpen(prev => !prev)}
                  className="border-amber-300/50 bg-slate-900/40 text-amber-50 hover:bg-amber-300/10"
                >
                  {quoteAssistOpen ? 'Hide AI helper' : 'Open AI helper'}
                </Button>
              </div>

              {quoteAssistOpen ? (
                <div className="mt-4 space-y-3 border-t border-amber-300/20 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="quote-assist-email" className="text-amber-50">Customer email</Label>
                    <Textarea
                      id="quote-assist-email"
                      value={quoteAssistEmail}
                      onChange={event => {
                        setQuoteAssistEmail(event.target.value);
                        setQuoteAssistError(null);
                        setQuoteAssistDraft(null);
                      }}
                      placeholder="Paste the customer email or enquiry here..."
                      rows={6}
                      className="border-amber-300/30 bg-slate-950/60 text-white placeholder:text-slate-500 focus-visible:ring-amber-300/30"
                    />
                    <p className="text-xs text-amber-100/80">
                      The email is sent to the configured AI provider to generate a draft. It is not saved by this form.
                    </p>
                  </div>

                  {quoteAssistError ? (
                    <div className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                      {quoteAssistError}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => void generateQuoteAssistDraft()}
                      disabled={quoteAssistLoading || !quoteAssistEmail.trim()}
                      className="bg-amber-300 text-slate-950 hover:bg-amber-200"
                    >
                      {quoteAssistLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Generate draft
                    </Button>
                    {quoteAssistDraft ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={applyQuoteAssistDraft}
                        className="border-amber-300/50 bg-slate-900/40 text-amber-50 hover:bg-amber-300/10"
                      >
                        Apply to quote
                      </Button>
                    ) : null}
                  </div>

                  {quoteAssistDraft ? (
                    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-slate-100">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Preview title</p>
                        <p className="mt-1">{quoteAssistDraft.subject_line}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Preview summary</p>
                        <p className="mt-1 whitespace-pre-wrap">{quoteAssistDraft.project_description}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Preview scope</p>
                        <p className="mt-1 whitespace-pre-wrap">{quoteAssistDraft.scope}</p>
                      </div>
                      {quoteAssistDraft.caveats.length > 0 ? (
                        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
                          <div className="flex items-start gap-2 text-amber-100">
                            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div>
                              <p className="font-medium">Check before using</p>
                              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-100/90">
                                {quoteAssistDraft.caveats.map(caveat => (
                                  <li key={caveat}>{caveat}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="mt-4 text-xs text-slate-400">
            Only fields marked with `*` are required to create the initial draft.
          </p>

          <div className="grid gap-4 py-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-white">Quote Details</h4>
                <p className="text-xs text-slate-400">Select a customer first to unlock the quote details.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <div ref={customerSelectRef} className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={customerDropdownOpen}
                      aria-invalid={!!fieldErrors.customer_id}
                      onClick={() => setCustomerDropdownOpen(current => !current)}
                      className={cn(
                        'w-full justify-between text-left font-normal',
                        getSelectClassName('customer_id')
                      )}
                    >
                      <span className={cn('truncate', !selectedCustomerLabel && 'text-muted-foreground')}>
                        {selectedCustomerLabel || 'Select customer'}
                      </span>
                      <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', customerDropdownOpen && 'rotate-180')} />
                    </Button>

                    {customerDropdownOpen ? (
                      <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950 text-sm text-slate-100 shadow-xl">
                        <div className="border-b border-slate-800 p-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              value={customerSearch}
                              onChange={(event) => setCustomerSearch(event.target.value)}
                              placeholder="Search customers..."
                              autoFocus
                              className="border-slate-700 bg-slate-900 pl-9 text-white"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto p-1">
                          {filteredCustomers.length > 0 ? (
                            filteredCustomers.map(customer => (
                              <button
                                key={customer.id}
                                type="button"
                                onClick={() => handleCustomerChange(customer.id)}
                                className={cn(
                                  'block w-full rounded-sm px-3 py-2 text-left hover:bg-slate-800',
                                  form.customer_id === customer.id && 'bg-slate-800 text-brand-yellow'
                                )}
                              >
                                <span className="block truncate font-medium">
                                  {getCustomerSelectLabel(customer, duplicateCustomerCompanyNames)}
                                </span>
                                {customer.contact_email ? (
                                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                                    {customer.contact_email}
                                  </span>
                                ) : null}
                              </button>
                            ))
                          ) : (
                            <p className="px-3 py-4 text-center text-sm text-slate-400">
                              No customers match your search.
                            </p>
                          )}
                        </div>
                        {onAddCustomer ? (
                          <div className="border-t border-slate-800 p-1">
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerDropdownOpen(false);
                                setCustomerSearch('');
                                onAddCustomer();
                              }}
                              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left font-medium text-brand-yellow hover:bg-slate-800"
                            >
                              <Plus className="h-4 w-4" />
                              Add New Customer
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {renderFieldError('customer_id')}
                </div>

                <div className="space-y-2">
                  <Label>Manager *</Label>
                  <Select
                    value={areCustomerDependentFieldsDisabled ? '' : form.manager_profile_id}
                    onValueChange={handleManagerChange}
                    disabled={areCustomerDependentFieldsDisabled}
                  >
                    <SelectTrigger className={getSelectClassName('manager_profile_id')} aria-invalid={!!fieldErrors.manager_profile_id}>
                      <SelectValue placeholder={areCustomerDependentFieldsDisabled ? '' : 'Select manager'} />
                    </SelectTrigger>
                    <SelectContent>
                      {managerOptions.map(option => (
                        <SelectItem key={option.profile_id} value={option.profile_id}>
                          {(option.profile?.full_name || option.signoff_name || option.initials)} ({option.initials})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {renderFieldError('manager_profile_id')}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <Input
                    type="date"
                    value={areCustomerDependentFieldsDisabled ? '' : form.quote_date}
                    disabled={areCustomerDependentFieldsDisabled}
                    aria-label="Quote date"
                    aria-invalid={!!fieldErrors.quote_date}
                    onChange={e => updateField('quote_date', e.target.value)}
                    className={getFieldClassName('quote_date')}
                  />
                  {renderFieldError('quote_date')}
                </div>
                <div className="space-y-2">
                  <Label>Validity (days) *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={areCustomerDependentFieldsDisabled ? '' : form.validity_days}
                    disabled={areCustomerDependentFieldsDisabled}
                    aria-label="Validity days"
                    aria-invalid={!!fieldErrors.validity_days}
                    onChange={e => updateField('validity_days', parseInt(e.target.value) || 30)}
                    className={getFieldClassName('validity_days')}
                  />
                  {renderFieldError('validity_days')}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>For the attention of *</Label>
                  <Input
                    value={form.attention_name}
                    disabled={areCustomerDependentFieldsDisabled}
                    aria-label="For the attention of"
                    aria-invalid={!!fieldErrors.attention_name}
                    onChange={e => updateField('attention_name', e.target.value)}
                    className={getFieldClassName('attention_name')}
                  />
                  {renderFieldError('attention_name')}
                </div>
                <div className="space-y-2">
                  <Label>Contact Email *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={areCustomerDependentFieldsDisabled}
                        className={cn(
                          'flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
                          getFieldClassName('attention_email')
                        )}
                      >
                        <span className={customerDependentContactEmailDisplay ? 'text-white' : 'text-muted-foreground'}>
                          {customerDependentContactEmailDisplay}
                        </span>
                        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] border-slate-700 bg-slate-900 text-white">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="quote-primary-contact-email">Primary recipient</Label>
                          <Input
                            id="quote-primary-contact-email"
                            type="email"
                            value={form.attention_email}
                            disabled={areCustomerDependentFieldsDisabled}
                            onChange={e => updateField('attention_email', e.target.value)}
                            className={getFieldClassName('attention_email')}
                          />
                          <p className="text-xs text-slate-400">The primary contact is sent in the quote To field.</p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional customer To recipients</p>
                          {selectedCustomer?.secondary_contacts?.length ? (
                            <div className="space-y-2">
                              {selectedCustomer.secondary_contacts.map(contact => {
                                const hasEmail = Boolean(contact.email?.trim());
                                return (
                                  <label key={contact.id} className={cn(
                                    'flex items-start gap-3 rounded-md border border-slate-700 bg-slate-950/30 p-2 text-sm',
                                    (!hasEmail || areCustomerDependentFieldsDisabled) && 'opacity-60'
                                  )}>
                                    <Checkbox
                                      checked={form.secondary_contact_ids.includes(contact.id)}
                                      disabled={!hasEmail || areCustomerDependentFieldsDisabled}
                                      onCheckedChange={checked => toggleSecondaryContact(contact.id, checked === true)}
                                      className="mt-0.5"
                                    />
                                    <span>
                                      <span className="block text-white">{getContactLabel(contact)}</span>
                                      <span className="block text-xs text-muted-foreground">
                                        {contact.email || 'No email on file'}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-400">No saved secondary contacts for this customer.</p>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {renderFieldError('attention_email')}
                  {renderFieldError('secondary_contact_ids')}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Site Address *</Label>
                <Textarea
                  value={form.site_address}
                  onChange={e => updateField('site_address', e.target.value)}
                  rows={3}
                  required
                  disabled={areCustomerDependentFieldsDisabled}
                  aria-label="Site address"
                  aria-invalid={!!fieldErrors.site_address}
                  className={getFieldClassName('site_address')}
                />
                {renderFieldError('site_address')}
              </div>
            </div>

            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-white">Quote Content</h4>
                <p className="text-xs text-slate-400">Customer-facing title, summary and scope shown on the quote.</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Title *</Label>
                  <Input
                    value={form.subject_line}
                    onChange={e => updateField('subject_line', e.target.value)}
                    placeholder="e.g. Supply of Fence Panels & Accessories"
                    aria-invalid={!!fieldErrors.subject_line}
                    className={getFieldClassName('subject_line')}
                  />
                  {renderFieldError('subject_line')}
                </div>
                <div className="space-y-2">
                  <Label>Summary *</Label>
                  <Textarea
                    value={form.project_description}
                    onChange={e => updateField('project_description', e.target.value)}
                    onPaste={e => handleFormattedFieldPaste('project_description', e)}
                    placeholder="Brief customer-facing summary"
                    rows={4}
                    aria-invalid={!!fieldErrors.project_description}
                    className={getFieldClassName('project_description')}
                  />
                  <p className="text-xs text-slate-400">Supports pasted ChatGPT-style headings, bold text, bullets and numbered lists.</p>
                  {renderFieldError('project_description')}
                </div>
                <div className="space-y-2">
                  <Label>Scope *</Label>
                  <Textarea
                    value={form.scope}
                    onChange={e => updateField('scope', e.target.value)}
                    onPaste={e => handleFormattedFieldPaste('scope', e)}
                    placeholder="Describe the included scope of works"
                    rows={5}
                    aria-invalid={!!fieldErrors.scope}
                    className={getFieldClassName('scope')}
                  />
                  <p className="text-xs text-slate-400">Use simple formatting such as headings, bullets, numbered lists, bold and italic text.</p>
                  {renderFieldError('scope')}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-white">Internal Comms</h4>
                <p className="text-xs text-slate-400">Planning notes and schedule details are internal only and are not shown on the client quote.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={e => updateField('start_date', e.target.value)}
                    className={getFieldClassName('start_date')}
                  />
                  {renderFieldError('start_date')}
                </div>
                <div className="space-y-2">
                  <Label>Alert Days Before Start</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.start_alert_days}
                    onChange={e => updateField('start_alert_days', e.target.value ? Number(e.target.value) : '')}
                    placeholder="7"
                    className={getFieldClassName('start_alert_days')}
                  />
                  {renderFieldError('start_alert_days')}
                </div>
                <div className="space-y-2">
                  <Label>Estimated Duration (days)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.estimated_duration_days}
                    onChange={e => updateField('estimated_duration_days', e.target.value ? Number(e.target.value) : '')}
                    placeholder="e.g. 5"
                    className={getFieldClassName('estimated_duration_days')}
                  />
                  {renderFieldError('estimated_duration_days')}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Internal Notes / Version Notes</Label>
                <Textarea
                  value={form.version_notes}
                  onChange={e => updateField('version_notes', e.target.value)}
                  onPaste={e => handleFormattedFieldPaste('version_notes', e)}
                  rows={3}
                  placeholder="Use this for revision context, handover notes, or customer-specific context."
                  className={getFieldClassName('version_notes')}
                />
                {renderFieldError('version_notes')}
              </div>
            </div>

            {/* Line Items */}
            <div className="border-t border-slate-700 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground">Pricing / Line Items</h4>
                  <p className="text-xs text-slate-400">Use itemised pricing or refer the client to attached pricing documents.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={form.pricing_mode} onValueChange={(value: 'itemized' | 'attachments_only') => updateField('pricing_mode', value)}>
                    <SelectTrigger className="w-[240px] bg-slate-800 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="itemized">Itemised pricing</SelectItem>
                      <SelectItem value="attachments_only">Refer to attachments</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.pricing_mode === 'itemized' && (
                    <Button type="button" variant="outline" size="sm" onClick={addLineItem} className="border-slate-600 text-muted-foreground hover:bg-slate-700/50">
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  )}
                </div>
              </div>

              {form.pricing_mode === 'attachments_only' ? (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                  The client quote will refer to attached documents for pricing/details instead of showing line item prices.
                </div>
              ) : (
              <div className="space-y-2">
                {/* Header */}
                <div className="hidden sm:grid grid-cols-[1fr_80px_80px_100px_100px_40px] gap-2 text-xs font-semibold text-muted-foreground px-1">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit</span>
                  <span>Rate (£)</span>
                  <span className="text-right">Total</span>
                  <span></span>
                </div>

                {form.line_items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_100px_100px_40px] gap-2 items-center bg-slate-800/30 rounded-lg p-2 sm:p-1">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <GripVertical className="h-4 w-4 text-slate-600 hidden sm:block flex-shrink-0" />
                        <Textarea
                          value={item.description}
                          onChange={e => updateLineItem(idx, 'description', e.target.value)}
                          onPaste={e => handleLineItemDescriptionPaste(idx, e)}
                          placeholder="Item description"
                          rows={2}
                          className={cn('min-h-10 text-sm', getFieldClassName(`line_items.${idx}.description`))}
                        />
                      </div>
                      {renderFieldError(`line_items.${idx}.description`)}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={item.quantity}
                      onChange={e => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <Input
                      value={item.unit}
                      onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                      placeholder="each"
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unit_rate}
                      onChange={e => updateLineItem(idx, 'unit_rate', parseFloat(e.target.value) || 0)}
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <div className="text-right font-semibold text-white text-sm pr-1">
                      £{(Number(item.quantity) * Number(item.unit_rate)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLineItem(idx)}
                      disabled={form.line_items.length <= 1}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}

                {/* Subtotal */}
                <div className="flex justify-end pt-2 pr-12">
                  <div className="text-sm">
                    <span className="text-muted-foreground mr-4">Total</span>
                    <span className="font-bold text-white">
                      £{subtotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="border-t border-slate-700 pt-4 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground">Client Attachments</h4>
                <p className="text-xs text-slate-400">Attach pricing sheets, drawings, or supporting documents that can be sent with the client quote.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-600 px-3 py-2 text-sm text-muted-foreground hover:bg-slate-800">
                <Upload className="h-4 w-4" />
                Add Attachment
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={event => {
                    handleAttachmentFilesChange(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              {renderFieldError('attachment_files')}
              {attachmentActionError ? (
                <p className="rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">{attachmentActionError}</p>
              ) : null}
              {clientVisibleAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-300">Existing client-visible attachments</p>
                  {clientVisibleAttachments.map(attachment => (
                    <div key={attachment.id} className="flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="truncate text-slate-200">{attachment.file_name}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openSavedAttachment(attachment)}
                          className="h-8 border-slate-600 text-muted-foreground"
                        >
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Open
                        </Button>
                        <label
                          className={cn(
                            'inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-600 px-3 text-xs text-muted-foreground hover:bg-slate-800',
                            (!canManageSavedAttachments || replacingAttachmentId === attachment.id) && 'pointer-events-none opacity-50'
                          )}
                        >
                          {replacingAttachmentId === attachment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          Replace
                          <input
                            type="file"
                            className="hidden"
                            disabled={!canManageSavedAttachments || replacingAttachmentId === attachment.id}
                            onChange={event => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void replaceSavedAttachment(attachment, file);
                                event.target.value = '';
                              }
                            }}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canManageSavedAttachments || removingAttachmentId === attachment.id}
                          onClick={() => void removeSavedAttachment(attachment)}
                          className="h-8 text-muted-foreground hover:text-red-300"
                        >
                          {removingAttachmentId === attachment.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!canManageSavedAttachments ? (
                    <p className="text-xs text-slate-400">Only the latest quote version can have attachments changed.</p>
                  ) : null}
                </div>
              )}
              {attachmentFiles.length > 0 && (
                <div className="space-y-2">
                  {attachmentFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm">
                      <span className="truncate text-slate-200">{file.name}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachmentFile(index)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-300">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={discard} disabled={saving} className="border-slate-600 text-muted-foreground">
              {isFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold"
            >
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : isEditing ? 'Update Quote' : 'Create Quote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
