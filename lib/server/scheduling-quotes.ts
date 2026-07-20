import 'server-only';

import { addDays, format, parseISO } from 'date-fns';
import type { ScheduleJobStatus } from '@/types/scheduling';

export const SCHEDULING_OPERATIONAL_QUOTE_STATUSES = ['po_received', 'in_progress'] as const;

export interface SchedulingQuoteSource {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  customer_id: string;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  status: string | null;
  commercial_status: string;
  is_latest_version: boolean;
  start_date: string | null;
  estimated_duration_days: number | null;
  estimated_duration_minutes: number | null;
  created_by: string | null;
  updated_by: string | null;
}

export function isOperationalSchedulingQuote(
  quote: SchedulingQuoteSource
): quote is SchedulingQuoteSource & { start_date: string } {
  return (
    quote.is_latest_version
    && quote.commercial_status === 'open'
    && SCHEDULING_OPERATIONAL_QUOTE_STATUSES.includes(
      quote.status as (typeof SCHEDULING_OPERATIONAL_QUOTE_STATUSES)[number]
    )
    && Boolean(quote.start_date)
  );
}

export function mapOperationalQuoteToScheduleJob(
  quote: SchedulingQuoteSource & { start_date: string }
) {
  const estimatedDays = Math.max(quote.estimated_duration_days || 1, 1);
  return {
    job_reference: quote.base_quote_reference.trim() || quote.quote_reference,
    title: quote.subject_line?.trim() || quote.project_description?.trim() || 'Quoted work',
    description: quote.project_description,
    site_address: quote.site_address,
    status: (quote.status === 'in_progress' ? 'in_progress' : 'scheduled') as ScheduleJobStatus,
    source_type: 'quote' as const,
    start_date: quote.start_date,
    end_date: format(addDays(parseISO(quote.start_date), estimatedDays - 1), 'yyyy-MM-dd'),
    estimated_duration_minutes: quote.estimated_duration_minutes,
    quote_id: quote.id,
    customer_id: quote.customer_id,
    created_by: quote.created_by,
    updated_by: quote.updated_by || quote.created_by,
  };
}
