import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ScheduleJob,
  ScheduleVisit,
  ScheduleVisitBacklogItem,
} from '@/types/scheduling';

interface DatabaseError {
  code?: string;
  message?: string;
}

interface TransitionErrorResponse {
  code: string;
  message: string;
  status: number;
}

function pickRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function loadScheduleVisitBacklog(
  admin: SupabaseClient
): Promise<ScheduleVisitBacklogItem[]> {
  const result = await admin
    .from('schedule_visit_backlog')
    .select(`
      visit_id,
      original_starts_at,
      original_ends_at,
      queued_at,
      visit:schedule_visits!inner(
        id,
        job_id,
        sequence_number,
        title,
        notes,
        starts_at,
        ends_at,
        status,
        created_by,
        updated_by,
        created_at,
        updated_at,
        job:schedule_jobs!inner(
          id,
          job_reference,
          title,
          description,
          site_address,
          status,
          source_type,
          start_date,
          end_date,
          estimated_duration_minutes,
          quote_id,
          quote_project_number_id,
          customer_id,
          customer_site_id,
          is_drop_on_ready,
          created_by,
          updated_by,
          created_at,
          updated_at,
          customer:customers(company_name)
        )
      )
    `)
    .order('queued_at', { ascending: false });
  if (result.error) throw result.error;

  return ((result.data || []) as Array<Record<string, unknown>>).flatMap((row) => {
    const visit = pickRelation(
      row.visit as Record<string, unknown> | Array<Record<string, unknown>> | null
    );
    const job = pickRelation(
      visit?.job as Record<string, unknown> | Array<Record<string, unknown>> | null
    );
    if (!visit || !job) return [];
    const customer = pickRelation(
      job.customer as Record<string, unknown> | Array<Record<string, unknown>> | null
    );
    const originalStartsAt = String(row.original_starts_at);
    const originalEndsAt = String(row.original_ends_at);
    const durationMilliseconds = Math.max(
      1,
      new Date(originalEndsAt).getTime() - new Date(originalStartsAt).getTime()
    );
    const durationMinutes = Math.max(1, Math.ceil(durationMilliseconds / 60_000));
    const customerName =
      typeof customer?.company_name === 'string' ? customer.company_name : null;
    const authoritativeJob: ScheduleJob = {
      id: String(job.id),
      job_reference: String(job.job_reference),
      title: String(job.title),
      description: typeof job.description === 'string' ? job.description : null,
      site_address: typeof job.site_address === 'string' ? job.site_address : null,
      status: job.status as ScheduleJob['status'],
      source_type: job.source_type as ScheduleJob['source_type'],
      start_date: String(job.start_date),
      end_date: String(job.end_date),
      estimated_duration_minutes:
        typeof job.estimated_duration_minutes === 'number'
          ? job.estimated_duration_minutes
          : null,
      quote_id: typeof job.quote_id === 'string' ? job.quote_id : null,
      quote_project_number_id:
        typeof job.quote_project_number_id === 'string'
          ? job.quote_project_number_id
          : null,
      customer_id: typeof job.customer_id === 'string' ? job.customer_id : null,
      customer_site_id:
        typeof job.customer_site_id === 'string' ? job.customer_site_id : null,
      customer_name: customerName,
      is_drop_on_ready: job.is_drop_on_ready === true,
      tags: [],
      created_by: typeof job.created_by === 'string' ? job.created_by : null,
      updated_by: typeof job.updated_by === 'string' ? job.updated_by : null,
      created_at: String(job.created_at),
      updated_at: String(job.updated_at),
    };
    const authoritativeVisit: ScheduleVisit = {
      id: String(visit.id),
      job_id: String(visit.job_id),
      sequence_number: Number(visit.sequence_number),
      title: typeof visit.title === 'string' ? visit.title : null,
      starts_at: String(visit.starts_at),
      ends_at: String(visit.ends_at),
      status: visit.status as ScheduleVisit['status'],
      notes: typeof visit.notes === 'string' ? visit.notes : null,
      created_by: typeof visit.created_by === 'string' ? visit.created_by : null,
      updated_by: typeof visit.updated_by === 'string' ? visit.updated_by : null,
      created_at: String(visit.created_at),
      updated_at: String(visit.updated_at),
    };

    return [{
      visit_id: String(row.visit_id),
      job_id: String(visit.job_id),
      job_reference: String(job.job_reference),
      job_title: String(job.title),
      source_type: job.source_type as ScheduleVisitBacklogItem['source_type'],
      customer_name: customerName,
      sequence_number: Number(visit.sequence_number),
      title: typeof visit.title === 'string' ? visit.title : null,
      notes: typeof visit.notes === 'string' ? visit.notes : null,
      original_starts_at: originalStartsAt,
      original_ends_at: originalEndsAt,
      duration_milliseconds: durationMilliseconds,
      duration_minutes: durationMinutes,
      queued_at: String(row.queued_at),
      job: authoritativeJob,
      visit: authoritativeVisit,
    }];
  });
}

export function mapScheduleVisitTransitionError(
  error: DatabaseError
): TransitionErrorResponse | null {
  const message = error.message || '';
  const known: Record<string, TransitionErrorResponse> = {
    STALE_VISIT_PREVIEW: {
      code: 'stale_visit_preview',
      message: 'This visit changed after the confirmation opened. Review it and try again.',
      status: 409,
    },
    VISIT_ALREADY_QUEUED: {
      code: 'visit_already_queued',
      message: 'This visit is already in the Jobs queue.',
      status: 409,
    },
    VISIT_NOT_QUEUED: {
      code: 'visit_not_queued',
      message: 'This visit is no longer in the Jobs queue.',
      status: 409,
    },
    VISIT_NOT_QUEUEABLE: {
      code: 'visit_not_queueable',
      message: 'Completed or cancelled visits cannot be returned to Jobs.',
      status: 409,
    },
    VISIT_QUEUED: {
      code: 'visit_queued',
      message: 'This visit is in the Jobs queue and cannot receive assignments.',
      status: 409,
    },
    REQUEST_ID_REUSED: {
      code: 'request_id_reused',
      message: 'This scheduling request ID was already used for another change.',
      status: 409,
    },
    QUOTE_NOT_SCHEDULABLE: {
      code: 'quote_not_schedulable',
      message: 'The source Quote changed and can no longer accept this visit.',
      status: 409,
    },
    VISIT_DURATION_CHANGED: {
      code: 'visit_duration_changed',
      message: 'The returned visit must keep its original duration.',
      status: 400,
    },
    VISIT_MUST_FIT_ONE_DAY: {
      code: 'visit_must_fit_one_day',
      message: 'The visit must start and finish on the same day.',
      status: 400,
    },
    INVALID_VISIT_WINDOW: {
      code: 'invalid_visit_window',
      message: 'Select a valid start and end time for this visit.',
      status: 400,
    },
    VISIT_NOT_FOUND: {
      code: 'visit_not_found',
      message: 'Scheduling visit not found.',
      status: 404,
    },
    JOB_NOT_FOUND: {
      code: 'job_not_found',
      message: 'Scheduling job not found.',
      status: 404,
    },
    JOB_NOT_SCHEDULABLE: {
      code: 'job_not_schedulable',
      message: 'This job can no longer accept the returned visit.',
      status: 409,
    },
    JOB_CHANGED: {
      code: 'job_changed',
      message: 'This job changed while the visit was queued. Refresh and try again.',
      status: 409,
    },
  };

  const key = Object.keys(known).find((candidate) => message.includes(candidate));
  if (key) return known[key];
  if (error.code === 'P0001') {
    return {
      code: 'visit_transition_conflict',
      message: 'The visit could not be changed because its schedule changed.',
      status: 409,
    };
  }
  return null;
}
