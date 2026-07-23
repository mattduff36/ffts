import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

export async function GET() {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const [projectsResult, scheduledResult] = await Promise.all([
      admin
        .from('quote_project_numbers')
        .select('id, project_reference, manager_profile_id, requester_initials, title, description, status')
        .eq('status', 'open')
        .order('project_reference'),
      admin
        .from('schedule_jobs')
        .select('quote_project_number_id')
        .not('quote_project_number_id', 'is', null),
    ]);
    if (projectsResult.error) throw projectsResult.error;
    if (scheduledResult.error) throw scheduledResult.error;

    const scheduledProjectIds = new Set(
      (scheduledResult.data || []).flatMap((job) =>
        job.quote_project_number_id ? [job.quote_project_number_id] : []
      )
    );

    return NextResponse.json({
      projects: (projectsResult.data || []).filter(
        (project) => !scheduledProjectIds.has(project.id)
      ),
    });
  } catch (error) {
    console.error('Error loading Projects for scheduling:', error);
    return NextResponse.json(
      { error: 'Unable to load Project Numbers for scheduling.' },
      { status: 500 }
    );
  }
}
