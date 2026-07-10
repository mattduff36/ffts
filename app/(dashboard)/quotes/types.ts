export interface QuoteLineItem {
  id?: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface QuoteAttachment {
  id: string;
  quote_id: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
  is_client_visible: boolean;
  attachment_purpose: 'internal' | 'client_pricing' | 'client_supporting';
}

export interface QuoteRamsDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  created_at: string;
  document_type_id: string | null;
}

export interface QuoteInvoiceAllocation {
  id: string;
  quote_invoice_id: string;
  quote_line_item_id: string | null;
  quantity_invoiced: number | null;
  amount_invoiced: number;
  comments: string | null;
  created_at: string;
}

export interface QuoteInvoice {
  id: string;
  quote_id: string;
  invoice_request_id: string | null;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  invoice_scope: 'full' | 'partial';
  comments: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  allocations?: QuoteInvoiceAllocation[];
}

export interface QuoteInvoiceRequest {
  id: string;
  quote_id: string;
  requested_amount: number;
  requested_invoice_date: string;
  requested_invoice_scope: 'full' | 'partial';
  manager_comments: string | null;
  status: 'pending' | 'fulfilled' | 'cancelled';
  requested_by: string | null;
  requested_at: string;
  notified_at: string | null;
  fulfilled_invoice_id: string | null;
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteManagerOption {
  profile_id: string;
  initials: string;
  next_number: number;
  number_start: number;
  signoff_name: string | null;
  signoff_title: string | null;
  manager_email: string | null;
  approver_profile_id: string | null;
  is_active: boolean;
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  approver?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

const QUOTE_MANAGER_NAME_FILTER_PREFIX = 'manager-name:';

export function normalizeQuoteManagerName(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

export function getQuoteManagerNameFilterValue(value: string | null | undefined) {
  const normalizedName = normalizeQuoteManagerName(value).toLowerCase();
  return normalizedName ? `${QUOTE_MANAGER_NAME_FILTER_PREFIX}${normalizedName}` : '';
}

export function isQuoteManagerNameFilterValue(value: string) {
  return value.startsWith(QUOTE_MANAGER_NAME_FILTER_PREFIX);
}

export interface LegacyQuote {
  id: string;
  source_row: number;
  quote_reference: string | null;
  customer_name: string;
  title: string;
  quote_date: string | null;
  quote_date_raw: string | null;
  quote_manager_name: string;
  quote_manager_initials: string | null;
  quote_value_text: string | null;
  quote_value_amount: number | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export type QuoteProjectNumberStatus = 'open' | 'linked' | 'converted' | 'cancelled';
export type QuoteProjectCostCategory = 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other';

export interface QuoteProjectCost {
  id: string;
  project_number_id: string;
  cost_date: string;
  category: QuoteProjectCostCategory;
  supplier: string | null;
  description: string;
  amount: number;
  notes: string | null;
  linked_quote_id: string | null;
  linked_quote_line_item_id: string | null;
  linked_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteProjectLabourSummary {
  total_hours: number;
  entry_count: number;
  timesheet_count: number;
  employee_count: number;
  first_week_ending: string | null;
  last_week_ending: string | null;
}

export interface QuoteProjectNumber {
  id: string;
  project_reference: string;
  manager_profile_id: string;
  requester_initials: string;
  title: string;
  description: string | null;
  status: QuoteProjectNumberStatus;
  linked_quote_id: string | null;
  linked_at: string | null;
  converted_quote_id: string | null;
  converted_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  manager?: {
    id: string;
    full_name: string | null;
  } | null;
  linked_quote?: {
    id: string;
    quote_reference: string;
    base_quote_reference: string;
    subject_line: string | null;
    customer?: {
      company_name: string;
    } | null;
  } | null;
  converted_quote?: {
    id: string;
    quote_reference: string;
    base_quote_reference: string;
    subject_line: string | null;
    customer?: {
      company_name: string;
    } | null;
  } | null;
  costs?: QuoteProjectCost[];
  manual_cost_total?: number;
  unlinked_manual_cost_total?: number;
  labour_summary?: QuoteProjectLabourSummary;
}

export interface QuoteTimelineEvent {
  id: string;
  quote_id: string;
  quote_thread_id: string;
  quote_reference: string;
  event_type: string;
  title: string;
  description: string | null;
  from_status: string | null;
  to_status: string | null;
  actor_user_id: string | null;
  created_at: string;
  actor?: {
    id: string;
    full_name: string | null;
  } | null;
}

export interface Quote {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  quote_thread_id: string;
  parent_quote_id: string | null;
  customer_id: string;
  requester_id: string | null;
  requester_initials: string | null;
  quote_date: string;
  attention_name: string | null;
  attention_email: string | null;
  subject_line: string | null;
  project_description: string | null;
  scope: string | null;
  salutation: string | null;
  site_address: string | null;
  validity_days: number;
  subtotal: number;
  total: number;
  pricing_mode: 'itemized' | 'attachments_only';
  status: QuoteStatus;
  accepted: boolean;
  po_number: string | null;
  po_received_at: string | null;
  po_value: number | null;
  started: boolean;
  start_date: string | null;
  start_alert_days: number | null;
  start_alert_sent_at: string | null;
  estimated_duration_days: number | null;
  invoice_number: string | null;
  invoice_notes: string | null;
  last_invoice_at: string | null;
  signoff_name: string | null;
  signoff_title: string | null;
  custom_footer_text: string | null;
  revision_number: number;
  revision_type: QuoteRevisionType;
  version_label: string | null;
  version_notes: string | null;
  is_latest_version: boolean;
  duplicate_source_quote_id: string | null;
  manager_name: string | null;
  manager_email: string | null;
  approver_profile_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  returned_at: string | null;
  return_comments: string | null;
  customer_sent_at: string | null;
  customer_sent_by: string | null;
  completion_status: QuoteCompletionStatus;
  completion_comments: string | null;
  commercial_status: QuoteCommercialStatus;
  closed_at: string | null;
  rams_requested_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  invoiced_at: string | null;
  sage_posted_at: string | null;
  sage_posted_by: string | null;
  sage_status?: QuoteSageStatus;
  can_manage_sage?: boolean;
  // Joined
  customer?: {
    id: string;
    company_name: string;
    short_name: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    address_line_1?: string | null;
    address_line_2?: string | null;
    city?: string | null;
    county?: string | null;
    postcode?: string | null;
    secondary_contacts?: CustomerContact[];
  };
  selected_secondary_contact_ids?: string[];
  selected_secondary_contacts?: CustomerContact[];
  line_items?: QuoteLineItem[];
  attachments?: QuoteAttachment[];
  rams_documents?: QuoteRamsDocument[];
  invoices?: QuoteInvoice[];
  invoice_requests?: QuoteInvoiceRequest[];
  versions?: Quote[];
  previous_versions?: Quote[];
  timeline?: QuoteTimelineEvent[];
  invoice_summary?: {
    invoicedTotal: number;
    pendingRequestedTotal: number;
    remainingBalance: number;
    availableToRequest: number;
    lastInvoiceAt: string | null;
    status: 'not_invoiced' | 'ready_to_invoice' | 'partially_invoiced' | 'invoiced';
  };
}

export interface QuoteListSummary {
  total_quotes: number;
  status_counts: Record<QuoteStatus | 'all', number>;
  accepted_quotes: number;
  accepted_value: number;
}

export type QuoteSageStatus =
  | 'not_on_sage'
  | 'on_sage';

export type QuoteRevisionType =
  | 'original'
  | 'revision'
  | 'extra'
  | 'variation'
  | 'future_work'
  | 'duplicate';

export type QuoteCompletionStatus =
  | 'not_completed'
  | 'approved_in_full'
  | 'approved_in_part';

export type QuoteCommercialStatus = 'open' | 'closed';

export type QuoteStatus =
  | 'draft'
  | 'pending_internal_approval'
  | 'approved'
  | 'changes_requested'
  | 'sent'
  | 'won'
  | 'lost'
  | 'ready_to_invoice'
  | 'po_received'
  | 'in_progress'
  | 'completed_part'
  | 'completed_full'
  | 'partially_invoiced'
  | 'invoiced'
  | 'closed';

export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'border-slate-500/30 text-slate-400 bg-slate-500/10' },
  pending_internal_approval: { label: 'Pending Confirmation', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
  approved: { label: 'Approved', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  changes_requested: { label: 'Changes Requested', color: 'border-orange-500/30 text-orange-400 bg-orange-500/10' },
  sent: { label: 'Confirmed', color: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
  won: { label: 'Won', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  lost: { label: 'Lost', color: 'border-rose-500/30 text-rose-400 bg-rose-500/10' },
  ready_to_invoice: { label: 'Ready To Invoice', color: 'border-violet-500/30 text-violet-400 bg-violet-500/10' },
  po_received: { label: 'Accepted', color: 'border-sky-500/30 text-sky-400 bg-sky-500/10' },
  in_progress: { label: 'In Progress', color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' },
  completed_part: { label: 'Completed In Part', color: 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' },
  completed_full: { label: 'Completed In Full', color: 'border-lime-500/30 text-lime-400 bg-lime-500/10' },
  partially_invoiced: { label: 'Partially Invoiced', color: 'border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10' },
  invoiced: { label: 'Invoiced', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  closed: { label: 'Archived', color: 'border-slate-500/30 text-slate-400 bg-slate-500/10' },
};

export const ACTIVE_QUOTE_STATUS_ORDER: QuoteStatus[] = [
  'draft',
  'pending_internal_approval',
  'approved',
  'changes_requested',
  'sent',
  'won',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
  'closed',
];

export const ACCEPTED_QUOTE_STATUSES = new Set<QuoteStatus>([
  'po_received',
  'approved',
  'won',
  'ready_to_invoice',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
]);

const FALLBACK_QUOTE_STATUS_CONFIG = {
  label: 'Legacy Status',
  color: 'border-slate-500/30 text-slate-400 bg-slate-500/10',
};

export function getQuoteStatusConfig(status: string) {
  return QUOTE_STATUS_CONFIG[status as QuoteStatus] || FALLBACK_QUOTE_STATUS_CONFIG;
}

export interface QuoteFormData {
  customer_id: string;
  manager_profile_id: string;
  requester_initials: string;
  quote_date: string;
  attention_name: string;
  attention_email: string;
  site_address: string;
  subject_line: string;
  project_description: string;
  scope: string;
  salutation: string;
  validity_days: number;
  pricing_mode: 'itemized' | 'attachments_only';
  manager_name: string;
  manager_email: string;
  approver_profile_id: string;
  signoff_name: string;
  signoff_title: string;
  custom_footer_text: string;
  version_notes: string;
  start_date: string;
  start_alert_days: number | '';
  estimated_duration_days: number | '';
  secondary_contact_ids: string[];
  line_items: QuoteLineItem[];
  attachment_files?: File[];
}
