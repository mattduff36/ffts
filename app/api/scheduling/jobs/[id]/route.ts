import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingAccess, requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { resolveCustomerSiteSelection } from '@/lib/server/customer-sites';
import {
  loadTagsForScheduleJob,
  syncScheduleJobTags,
} from '@/lib/server/scheduling-tags';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateSchema = z
  .object({
    job_reference: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    site_address: z.string().trim().max(2000).nullable().optional(),
    customer_id: z.uuid().nullable().optional(),
    customer_site_id: z.uuid().nullable().optional(),
    status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    estimated_duration_minutes: z.number().int().min(15).max(100800).nullable().optional(),
    is_drop_on_ready: z.boolean().optional(),
    tag_ids: z.array(z.uuid()).max(30).optional(),
  })
  .refine(
    (value) => !value.start_date || !value.end_date || value.end_date >= value.start_date,
    { message: 'End date must be on or after the start date.', path: ['end_date'] }
  );

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const admin = createAdminClient();
    if (!access.isManagerOrAdmin && access.userId) {
      const assignment = await admin
        .from('schedule_employee_assignments')
        .select('id')
        .eq('job_id', id)
        .eq('profile_id', access.userId)
        .limit(1);
      if (assignment.error) throw assignment.error;
      if ((assignment.data || []).length === 0) {
        return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
      }
    }
    const { data, error } = await admin
      .from('schedule_jobs')
      .select('*, tag_links:schedule_job_tag_links(tag:schedule_job_tags(id, name, color, description, is_active))')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error loading schedule job:', error);
    return NextResponse.json({ error: 'Unable to load this job.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid job details.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existingResult = await admin
      .from('schedule_jobs')
      .select('start_date, end_date, source_type, customer_id, customer_site_id, site_address')
      .eq('id', id)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    const classificationFields = new Set(['is_drop_on_ready', 'tag_ids']);
    const quoteOwnedFields = Object.keys(parsed.data).filter(
      (field) => !classificationFields.has(field)
    );
    if (existingResult.data.source_type === 'quote' && quoteOwnedFields.length > 0) {
      return NextResponse.json(
        { error: 'Edit Quote planning details from the Quotes module.' },
        { status: 409 }
      );
    }

    const { tag_ids: tagIds, ...jobUpdates } = parsed.data;
    const startDate = jobUpdates.start_date || existingResult.data.start_date;
    const endDate = jobUpdates.end_date || existingResult.data.end_date;
    if (endDate < startDate) {
      return NextResponse.json(
        { error: 'End date must be on or after the start date.' },
        { status: 400 }
      );
    }

    const hasCustomerUpdate = Object.prototype.hasOwnProperty.call(jobUpdates, 'customer_id');
    const hasSiteUpdate = Object.prototype.hasOwnProperty.call(jobUpdates, 'customer_site_id');
    const hasAddressUpdate = Object.prototype.hasOwnProperty.call(jobUpdates, 'site_address');
    const customerId = hasCustomerUpdate
      ? jobUpdates.customer_id || null
      : existingResult.data.customer_id;
    const customerSiteId = hasSiteUpdate
      ? jobUpdates.customer_site_id || null
      : hasCustomerUpdate
        ? null
        : existingResult.data.customer_site_id;
    const resolvedSite = (hasCustomerUpdate || hasSiteUpdate || hasAddressUpdate)
      ? await resolveCustomerSiteSelection(admin, {
        customerId,
        customerSiteId,
        siteAddress: hasAddressUpdate ? jobUpdates.site_address : existingResult.data.site_address,
        allowInactive: customerSiteId === existingResult.data.customer_site_id,
      })
      : null;
    if (resolvedSite && Object.keys(resolvedSite.fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: Object.values(resolvedSite.fieldErrors)[0],
          field_errors: resolvedSite.fieldErrors,
        },
        { status: 400 }
      );
    }

    if (jobUpdates.start_date || jobUpdates.end_date) {
      const [employeeAssignments, plantAssignments] = await Promise.all([
        admin.from('schedule_employee_assignments').select('work_date').eq('job_id', id),
        admin.from('schedule_plant_assignments').select('work_date').eq('job_id', id),
      ]);
      if (employeeAssignments.error) throw employeeAssignments.error;
      if (plantAssignments.error) throw plantAssignments.error;
      const outsideRange = [...(employeeAssignments.data || []), ...(plantAssignments.data || [])]
        .some((assignment) => assignment.work_date < startDate || assignment.work_date > endDate);
      if (outsideRange) {
        return NextResponse.json(
          { error: 'Remove assignments outside the new job date range before changing these dates.' },
          { status: 409 }
        );
      }
    }

    const updates = {
      ...jobUpdates,
      ...(resolvedSite
        ? {
          customer_id: customerId,
          customer_site_id: resolvedSite.customerSiteId,
          site_address: resolvedSite.siteAddress,
        }
        : {}),
      updated_by: access.userId,
    };
    const { data, error } = await admin
      .from('schedule_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That job reference already exists.' }, { status: 409 });
      }
      throw error;
    }
    if (tagIds) {
      await syncScheduleJobTags(admin, id, tagIds, access.userId);
    }
    const tags = await loadTagsForScheduleJob(admin, id);
    return NextResponse.json({ job: { ...data, tags } });
  } catch (error) {
    console.error('Error updating schedule job:', error);
    return NextResponse.json({ error: 'Unable to update this job.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const admin = createAdminClient();
    const existing = await admin
      .from('schedule_jobs')
      .select('source_type')
      .eq('id', id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    if (existing.data.source_type === 'quote') {
      return NextResponse.json(
        { error: 'Quote jobs are removed by changing the Quote status.' },
        { status: 409 }
      );
    }
    const { error } = await admin.from('schedule_jobs').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule job:', error);
    return NextResponse.json({ error: 'Unable to delete this job.' }, { status: 500 });
  }
}
