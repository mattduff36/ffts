import type { ScheduleJobTag } from '@/types/scheduling';

export type QuoteOverviewRecordKind = 'quote' | 'project';

export interface QuoteOverviewSummary {
  item_count: number;
  quote_count: number;
  project_count: number;
  invoice_count: number;
  invoice_total: number;
  worked_hours: number;
  employee_count: number;
  timesheet_count: number;
  manual_cost_total: number;
}

export interface QuoteOverviewItem {
  id: string;
  kind: QuoteOverviewRecordKind;
  reference: string;
  title: string;
  customer_name: string | null;
  contact_name: string | null;
  manager_name: string | null;
  status: string | null;
  commercial_status: string | null;
  quote_id: string | null;
  project_number_id: string | null;
  quote_total: number;
  manual_cost_total: number;
  invoice_total: number;
  invoice_count: number;
  worked_hours: number;
  employee_count: number;
  timesheet_count: number;
  latest_activity_at: string | null;
  href: string;
}

export interface QuoteOverviewPayload {
  items: QuoteOverviewItem[];
  recent_items: QuoteOverviewItem[];
  summary: QuoteOverviewSummary;
  date_range_summary: QuoteOverviewSummary;
  search: string;
  date_from: string | null;
  date_to: string | null;
}

export interface QuoteOverviewInvoice {
  id: string;
  quote_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  invoice_scope: 'full' | 'partial';
  comments: string | null;
  created_at: string;
}

export interface QuoteOverviewInvoiceRequest {
  id: string;
  quote_id: string;
  requested_amount: number;
  requested_invoice_date: string;
  requested_invoice_scope: 'full' | 'partial';
  status: 'pending' | 'fulfilled' | 'cancelled';
  manager_comments: string | null;
  requested_at: string;
}

export interface QuoteOverviewLineItem {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface QuoteOverviewManualCost {
  id: string;
  project_number_id: string;
  cost_date: string;
  category: 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other';
  supplier: string | null;
  description: string;
  amount: number;
  notes: string | null;
  linked_quote_id: string | null;
}

export interface QuoteOverviewLabourRow {
  id: string;
  reference: string;
  timesheet_id: string;
  timesheet_entry_id: string;
  employee_id: string | null;
  employee_name: string;
  employee_number: string | null;
  timesheet_status: string | null;
  timesheet_type: string | null;
  week_ending: string;
  entry_date: string | null;
  day_of_week: number;
  job_numbers: string[];
  allocated_hours: number;
  raw_daily_total: number;
  time_started: string | null;
  time_finished: string | null;
  remarks: string | null;
  reg_number: string | null;
  site_address: string | null;
  hirer_name: string | null;
  is_hired_plant: boolean | null;
  hired_plant_id_serial: string | null;
  hired_plant_description: string | null;
  hired_plant_hiring_company: string | null;
  machine_start_time: string | null;
  machine_finish_time: string | null;
  machine_working_hours: number | null;
  machine_travel_hours: number | null;
  machine_standing_hours: number | null;
  machine_operator_hours: number | null;
  operator_travel_hours: number | null;
  operator_yard_hours: number | null;
  operator_working_hours: number | null;
  maintenance_breakdown_hours: number | null;
}

export interface QuoteOverviewEmployeeSummary {
  employee_id: string | null;
  employee_name: string;
  employee_number: string | null;
  total_hours: number;
  timesheet_count: number;
  entry_count: number;
}

export interface QuoteOverviewQuoteDetail {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  quote_date: string;
  subject_line: string | null;
  project_description: string | null;
  scope: string | null;
  site_address: string | null;
  attention_name: string | null;
  attention_email: string | null;
  subtotal: number | null;
  total: number | null;
  status: string | null;
  commercial_status: string | null;
  po_number: string | null;
  manager_name: string | null;
  customer?: {
    id: string;
    company_name: string;
    short_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
  } | null;
}

export interface QuoteOverviewProjectDetail {
  id: string;
  project_reference: string;
  title: string;
  description: string | null;
  status: string;
  notes: string | null;
  linked_quote_id: string | null;
  converted_quote_id: string | null;
  created_at: string;
  updated_at: string;
  manager?: {
    id: string;
    full_name: string | null;
  } | null;
}

export interface QuoteOverviewDetailPayload {
  item: QuoteOverviewItem;
  quote: QuoteOverviewQuoteDetail | null;
  project: QuoteOverviewProjectDetail | null;
  line_items: QuoteOverviewLineItem[];
  invoices: QuoteOverviewInvoice[];
  invoice_requests: QuoteOverviewInvoiceRequest[];
  manual_costs: QuoteOverviewManualCost[];
  labour_rows: QuoteOverviewLabourRow[];
  labour_by_employee: QuoteOverviewEmployeeSummary[];
  summary: QuoteOverviewSummary;
  schedule_job: {
    id: string;
    is_drop_on_ready: boolean;
    tags: ScheduleJobTag[];
  } | null;
}
