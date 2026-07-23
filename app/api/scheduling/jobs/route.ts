import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { resolveCustomerSiteSelection } from '@/lib/server/customer-sites';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { syncProjectNumberSiteLocation } from '@/lib/server/inventory-site-location-sync';
import {
  loadScheduleJobTags,
  loadTagsForScheduleJob,
} from '@/lib/server/scheduling-tags';
import type { Database } from '@/types/database';

const jobSchema = z
  .object({
    project_number_id: z.uuid().nullish(),
    manager_profile_id: z.uuid().nullish(),
    project_title: z.string().trim().max(500).nullish(),
    project_description: z.string().trim().max(5000).nullish(),
    project_notes: z.string().trim().max(5000).nullish(),
    site_address: z.string().trim().max(2000).nullish(),
    customer_id: z.uuid(),
    customer_site_id: z.uuid().nullish(),
    status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).default('draft'),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    estimated_duration_minutes: z.number().int().min(15).max(100800).nullish(),
    is_drop_on_ready: z.boolean().default(false),
    tag_ids: z.array(z.uuid()).max(30).default([]),
    initial_visit: z.object({
      starts_at: z.iso.datetime(),
      ends_at: z.iso.datetime(),
    }).optional(),
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: 'End date must be on or after the start date.',
    path: ['end_date'],
  })
  .superRefine((value, context) => {
    if (value.project_number_id) return;
    if (!value.manager_profile_id) {
      context.addIssue({
        code: 'custom',
        message: 'Select a manager.',
        path: ['manager_profile_id'],
      });
    }
    if (!value.project_title) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a project title.',
        path: ['project_title'],
      });
    }
  });

type QuoteProjectNumberRow = Database['public']['Tables']['quote_project_numbers']['Row'];

export async function GET() {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [jobsResult, customersResult, tags] = await Promise.all([
      admin
        .from('schedule_jobs')
        .select('*, tag_links:schedule_job_tag_links(tag:schedule_job_tags(id, name, color, description, is_active))')
        .order('start_date', { ascending: false }),
      admin
        .from('customers')
        .select('id, company_name, status, sites:customer_sites(*)')
        .order('company_name', { ascending: true }),
      loadScheduleJobTags(admin),
    ]);
    if (jobsResult.error) throw jobsResult.error;
    if (customersResult.error) throw customersResult.error;
    return NextResponse.json({
      jobs: jobsResult.data || [],
      customers: customersResult.data || [],
      tags,
    });
  } catch (error) {
    console.error('Error loading schedule jobs:', error);
    return NextResponse.json({ error: 'Unable to load schedule jobs.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const parsed = jobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid job details.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const resolvedSite = await resolveCustomerSiteSelection(admin, {
      customerId: parsed.data.customer_id,
      customerSiteId: parsed.data.customer_site_id || null,
      siteAddress: parsed.data.site_address,
    });
    if (Object.keys(resolvedSite.fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: Object.values(resolvedSite.fieldErrors)[0],
          field_errors: resolvedSite.fieldErrors,
        },
        { status: 400 }
      );
    }

    const rpcName = parsed.data.initial_visit
      ? 'schedule_project_with_initial_visit'
      : 'create_project_schedule_job';
    const rpcArguments = {
      p_project_number_id: parsed.data.project_number_id || null,
      p_manager_profile_id: parsed.data.manager_profile_id || null,
      p_project_title: parsed.data.project_title || null,
      p_project_description: parsed.data.project_description || null,
      p_project_notes: parsed.data.project_notes || null,
      p_customer_id: parsed.data.customer_id,
      p_customer_site_id: resolvedSite.customerSiteId,
      p_site_address: resolvedSite.siteAddress,
      p_job_status: parsed.data.status,
      p_start_date: parsed.data.start_date,
      p_end_date: parsed.data.end_date,
      p_estimated_duration_minutes: parsed.data.estimated_duration_minutes || null,
      p_is_drop_on_ready: parsed.data.is_drop_on_ready,
      p_tag_ids: parsed.data.tag_ids,
      p_actor_user_id: access.userId,
      ...(parsed.data.initial_visit
        ? {
            p_visit_starts_at: parsed.data.initial_visit.starts_at,
            p_visit_ends_at: parsed.data.initial_visit.ends_at,
          }
        : {}),
    };
    const { data: creationRows, error: creationError } = await admin.rpc(
      rpcName,
      {
        ...rpcArguments,
      }
    );
    if (creationError) {
      if (creationError.code === '23505') {
        return NextResponse.json(
          { error: 'That Project Number is already scheduled.' },
          { status: 409 }
        );
      }
      if (
        creationError.message.includes('Only an open Project Number')
        || creationError.message.includes('already scheduled')
      ) {
        return NextResponse.json({ error: creationError.message }, { status: 409 });
      }
      if (creationError.code === 'P0001') {
        return NextResponse.json({ error: creationError.message }, { status: 400 });
      }
      throw creationError;
    }
    const creation = creationRows?.[0];
    if (!creation) {
      throw new Error('Project scheduling creation returned no result.');
    }

    if (creation.was_project_created) {
      const projectResult = await admin
        .from('quote_project_numbers')
        .select('*')
        .eq('id', creation.project_number_id)
        .single();
      if (projectResult.error) throw projectResult.error;
      try {
        await syncProjectNumberSiteLocation(
          admin,
          projectResult.data as QuoteProjectNumberRow,
          access.userId
        );
      } catch (syncError) {
        console.error('Unable to sync Project Number inventory location:', syncError);
      }
    }

    const jobResult = await admin
      .from('schedule_jobs')
      .select('*')
      .eq('id', creation.schedule_job_id)
      .single();
    if (jobResult.error) throw jobResult.error;
    const tags = await loadTagsForScheduleJob(admin, creation.schedule_job_id);
    return NextResponse.json(
      { job: { ...jobResult.data, tags }, project_reference: creation.project_reference },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating schedule job:', error);
    return NextResponse.json({ error: 'Unable to create this job.' }, { status: 500 });
  }
}
