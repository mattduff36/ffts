import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleEmployeeAssignment, ScheduleJob, ScheduleSelfJobDetails, ScheduleSelfCrewMember } from '@/types/scheduling';

const key = (row: { job_id: string; work_date: string; visit_id: string | null }) =>
  JSON.stringify([row.job_id, row.work_date, row.visit_id ?? null]);

/** Only operational details for jobs and visits already authorised by the self loader. */
export async function loadSchedulingSelfDetails(
  admin: SupabaseClient,
  userId: string,
  jobs: ScheduleJob[],
  assignments: ScheduleEmployeeAssignment[]
): Promise<{ job_details: ScheduleSelfJobDetails[]; crew_assignments: ScheduleSelfCrewMember[] }> {
  if (!assignments.length) return { job_details: [], crew_assignments: [] };
  const jobIds = [...new Set(assignments.map((a) => a.job_id))];
  const customerIds = [...new Set(jobs.flatMap((j) => j.customer_id ? [j.customer_id] : []))];
  const siteIds = [...new Set(jobs.flatMap((j) => j.customer_site_id ? [j.customer_site_id] : []))];
  const dates = [...new Set(assignments.map((a) => a.work_date))];
  const [customers, sites, crew] = await Promise.all([
    customerIds.length ? admin.from('customers').select('id, contact_name, contact_phone, contact_email, contact_job_title').in('id', customerIds) : Promise.resolve({ data: [], error: null }),
    siteIds.length ? admin.from('customer_sites').select('id, customer_id, site_name, notes').in('id', siteIds) : Promise.resolve({ data: [], error: null }),
    admin.from('schedule_employee_assignments').select('job_id, work_date, visit_id, profile_id, employee:profiles!schedule_employee_assignments_profile_id_fkey(full_name)').in('job_id', jobIds).in('work_date', dates),
  ]);
  for (const result of [customers, sites, crew]) if (result.error) throw result.error;
  const customerMap = new Map((customers.data || []).map((c) => [c.id, c]));
  const siteMap = new Map((sites.data || []).map((s) => [s.id, s]));
  const job_details: ScheduleSelfJobDetails[] = jobs.map((job) => {
    const customer = job.customer_id ? customerMap.get(job.customer_id) : null;
    const candidateSite = job.customer_site_id ? siteMap.get(job.customer_site_id) : null;
    const site = candidateSite && candidateSite.customer_id === job.customer_id ? candidateSite : null;
    return {
      job_id: job.id,
      site_name: site?.site_name || null,
      site_notes: site?.notes || null,
      customer_contact: customer && (customer.contact_name || customer.contact_phone || customer.contact_email) ? {
        name: customer.contact_name || null,
        phone: customer.contact_phone || null,
        email: customer.contact_email || null,
        job_title: customer.contact_job_title || null,
      } : null,
    };
  });
  const allowed = new Set(assignments.map(key));
  const seen = new Set<string>();
  const crew_assignments: ScheduleSelfCrewMember[] = [];
  for (const row of crew.data || []) {
    if (row.profile_id === userId || !allowed.has(key(row))) continue;
    const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    if (!employee?.full_name?.trim()) continue;
    const identity = `${key(row)}:${row.profile_id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    crew_assignments.push({ job_id: row.job_id, work_date: row.work_date, visit_id: row.visit_id, profile_id: row.profile_id, full_name: employee.full_name });
  }
  crew_assignments.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { job_details, crew_assignments };
}
