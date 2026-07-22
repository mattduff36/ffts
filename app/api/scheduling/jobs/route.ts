import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { resolveCustomerSiteSelection } from '@/lib/server/customer-sites';
import {
  loadScheduleJobTags,
  loadTagsForScheduleJob,
  syncScheduleJobTags,
} from '@/lib/server/scheduling-tags';

const jobSchema = z
  .object({
    job_reference: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullish(),
    site_address: z.string().trim().max(2000).nullish(),
    customer_id: z.uuid(),
    customer_site_id: z.uuid().nullish(),
    status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).default('draft'),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    estimated_duration_minutes: z.number().int().min(15).max(100800).nullish(),
    is_drop_on_ready: z.boolean().default(false),
    tag_ids: z.array(z.uuid()).max(30).default([]),
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: 'End date must be on or after the start date.',
    path: ['end_date'],
  });

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

    const { tag_ids: tagIds, ...jobData } = parsed.data;
    const { data, error } = await admin
      .from('schedule_jobs')
      .insert({
        ...jobData,
        description: parsed.data.description || null,
        customer_site_id: resolvedSite.customerSiteId,
        site_address: resolvedSite.siteAddress,
        source_type: 'manual',
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That job reference already exists.' }, { status: 409 });
      }
      throw error;
    }
    await syncScheduleJobTags(admin, data.id, tagIds, access.userId);
    const tags = await loadTagsForScheduleJob(admin, data.id);
    return NextResponse.json({ job: { ...data, tags } }, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule job:', error);
    return NextResponse.json({ error: 'Unable to create this job.' }, { status: 500 });
  }
}
