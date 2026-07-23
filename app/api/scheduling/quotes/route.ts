import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendQuoteTimelineEvent } from '@/lib/server/quote-workflow';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ScheduleQuoteCandidate } from '@/types/scheduling';

const scheduleQuoteSchema = z
  .object({
    quote_id: z.uuid(),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    initial_visit: z.object({
      starts_at: z.iso.datetime(),
      ends_at: z.iso.datetime(),
    }).optional(),
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: 'End date must be on or after the start date.',
    path: ['end_date'],
  });

interface CustomerRelation {
  company_name?: string | null;
}

function pickRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapQuoteCandidate(row: Record<string, unknown>): ScheduleQuoteCandidate {
  const customer = pickRelation(
    row.customer as CustomerRelation | CustomerRelation[] | null
  );
  const startDate = typeof row.start_date === 'string' ? row.start_date : null;
  const estimatedDays =
    typeof row.estimated_duration_days === 'number'
      ? Math.max(row.estimated_duration_days, 1)
      : null;

  return {
    id: String(row.id),
    quote_reference: String(row.quote_reference),
    base_quote_reference: String(row.base_quote_reference || row.quote_reference),
    title:
      (typeof row.subject_line === 'string' && row.subject_line.trim())
      || (typeof row.project_description === 'string' && row.project_description.trim())
      || 'Quoted work',
    customer_name: customer?.company_name || null,
    status: typeof row.status === 'string' ? row.status : null,
    start_date: startDate,
    end_date:
      startDate
        ? format(addDays(parseISO(startDate), (estimatedDays || 1) - 1), 'yyyy-MM-dd')
        : null,
    estimated_duration_days: estimatedDays,
    estimated_duration_minutes:
      typeof row.estimated_duration_minutes === 'number'
        ? row.estimated_duration_minutes
        : null,
  };
}

export async function GET() {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('quotes')
      .select(`
        id,
        quote_reference,
        base_quote_reference,
        subject_line,
        project_description,
        status,
        start_date,
        estimated_duration_days,
        estimated_duration_minutes,
        customer:customers(company_name)
      `)
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .order('quote_reference');
    if (error) throw error;

    return NextResponse.json({
      quotes: ((data || []) as Array<Record<string, unknown>>).map(mapQuoteCandidate),
    });
  } catch (error) {
    console.error('Error loading Quotes for scheduling:', error);
    return NextResponse.json(
      { error: 'Unable to load Quotes for scheduling.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = scheduleQuoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid Quote schedule.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const quoteResult = await admin
      .from('quotes')
      .select(`
        id,
        quote_reference,
        quote_thread_id,
        is_latest_version,
        commercial_status,
        start_date
        , estimated_duration_minutes
      `)
      .eq('id', parsed.data.quote_id)
      .maybeSingle();
    if (quoteResult.error) throw quoteResult.error;
    if (!quoteResult.data) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 });
    }
    if (
      quoteResult.data.is_latest_version !== true
      || quoteResult.data.commercial_status !== 'open'
    ) {
      return NextResponse.json(
        { error: 'Only the latest version of an open Quote can be scheduled.' },
        { status: 409 }
      );
    }

    const estimatedDurationDays =
      differenceInCalendarDays(
        parseISO(parsed.data.end_date),
        parseISO(parsed.data.start_date)
      ) + 1;
    if (parsed.data.initial_visit) {
      const startsAt = new Date(parsed.data.initial_visit.starts_at);
      const endsAt = new Date(parsed.data.initial_visit.ends_at);
      const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
      const authoritativeDuration = Math.min(
        Math.max(Number(quoteResult.data.estimated_duration_minutes) || 180, 30),
        180
      );
      if (
        !Number.isFinite(durationMinutes)
        || durationMinutes < 30
        || durationMinutes > authoritativeDuration
      ) {
        return NextResponse.json({ error: 'Invalid initial visit duration.' }, { status: 400 });
      }
      const rpcResult = await admin.rpc('schedule_quote_with_initial_visit', {
        p_quote_id: parsed.data.quote_id,
        p_start_date: parsed.data.start_date,
        p_end_date: parsed.data.end_date,
        p_visit_starts_at: parsed.data.initial_visit.starts_at,
        p_visit_ends_at: parsed.data.initial_visit.ends_at,
        p_actor_user_id: access.userId,
      });
      if (rpcResult.error) throw rpcResult.error;
      return NextResponse.json(rpcResult.data);
    }
    const updateResult = await admin
      .from('quotes')
      .update({
        start_date: parsed.data.start_date,
        estimated_duration_days: estimatedDurationDays,
        updated_by: access.userId,
      })
      .eq('id', parsed.data.quote_id)
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .select('id')
      .maybeSingle();
    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) {
      return NextResponse.json(
        { error: 'The Quote changed while it was being scheduled. Reload and try again.' },
        { status: 409 }
      );
    }

    const jobResult = await admin
      .from('schedule_jobs')
      .select('*')
      .eq('quote_id', parsed.data.quote_id)
      .eq('source_type', 'quote')
      .maybeSingle();
    if (jobResult.error) throw jobResult.error;
    if (!jobResult.data) {
      return NextResponse.json(
        { error: 'The Quote was saved but its scheduling job could not be synchronized.' },
        { status: 409 }
      );
    }

    await appendQuoteTimelineEvent(admin, {
      quoteId: quoteResult.data.id,
      quoteThreadId: quoteResult.data.quote_thread_id,
      quoteReference: quoteResult.data.quote_reference,
      eventType: 'schedule_updated',
      title: quoteResult.data.start_date ? 'Schedule updated' : 'Quote scheduled',
      description: `Scheduled from ${parsed.data.start_date} to ${parsed.data.end_date} in Job Scheduling.`,
      actorUserId: access.userId,
    });

    return NextResponse.json({ job: jobResult.data });
  } catch (error) {
    console.error('Error scheduling Quote:', error);
    return NextResponse.json(
      { error: 'Unable to schedule this Quote.' },
      { status: 500 }
    );
  }
}
