import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleJob, ScheduleEmployeeAssignment } from '@/types/scheduling';
import { loadSchedulingSelfDetails } from '@/lib/server/scheduling-self-details';

function client(tables: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const query = { select: vi.fn(), in: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] || [], error: null }).then(resolve) };
    query.select.mockReturnValue(query); query.in.mockReturnValue(query);
    return query;
  });
  return { admin: { from } as unknown as SupabaseClient, from };
}
const jobs = [{ id: 'job-a', customer_id: 'customer-a', customer_site_id: 'site-a' }] as ScheduleJob[];
const assignment = { job_id: 'job-a', work_date: '2026-10-12', visit_id: 'visit-a' } as ScheduleEmployeeAssignment;

describe('personal schedule operational details', () => {
  it('loads only saved business contact and matching site details, not commercial notes', async () => {
    const { admin, from } = client({
      customers: [{ id: 'customer-a', contact_name: 'Site coordinator', contact_phone: '01234 567890', contact_email: null, contact_job_title: 'Coordinator' }],
      customer_sites: [{ id: 'site-a', customer_id: 'customer-a', site_name: 'North site', notes: 'Use the north gate.' }],
    });
    const result = await loadSchedulingSelfDetails(admin, 'me', jobs, [assignment]);
    expect(result.job_details[0]).toEqual({ job_id: 'job-a', site_name: 'North site', site_notes: 'Use the north gate.', customer_contact: { name: 'Site coordinator', phone: '01234 567890', email: null, job_title: 'Coordinator' } });
    const customerQuery = from.mock.results.find((_, i) => from.mock.calls[i][0] === 'customers')!.value;
    expect(customerQuery.select).toHaveBeenCalledWith('id, contact_name, contact_phone, contact_email, contact_job_title');
    expect(customerQuery.in).toHaveBeenCalledWith('id', ['customer-a']);
  });
  it('includes only names of crew assigned to the exact same slot, excluding self and duplicates', async () => {
    const row = { ...assignment, profile_id: 'colleague', employee: { full_name: 'Crew member' } };
    const { admin } = client({ schedule_employee_assignments: [row, row, { ...row, profile_id: 'me' }, { ...row, visit_id: 'other-visit' }, { ...row, work_date: '2026-10-13' }, { ...row, job_id: 'other-job' }, { ...row, visit_id: null }] });
    const result = await loadSchedulingSelfDetails(admin, 'me', jobs, [assignment]);
    expect(result.crew_assignments).toEqual([{ job_id: 'job-a', work_date: '2026-10-12', visit_id: 'visit-a', profile_id: 'colleague', full_name: 'Crew member' }]);
  });
  it('matches day-level work only to day-level crew and omits missing details', async () => {
    const { admin } = client({ schedule_employee_assignments: [{ ...assignment, visit_id: null, profile_id: 'colleague', employee: [{ full_name: 'Crew member' }] }, { ...assignment, profile_id: 'timed', employee: { full_name: 'Different visit' } }] });
    const result = await loadSchedulingSelfDetails(admin, 'me', jobs, [{ ...assignment, visit_id: null }]);
    expect(result.crew_assignments).toHaveLength(1);
    expect(result.crew_assignments[0].visit_id).toBeNull();
    expect(result.job_details[0]).toEqual({ job_id: 'job-a', site_name: null, site_notes: null, customer_contact: null });
  });
  it('does not attach a site belonging to a different customer', async () => {
    const { admin } = client({ customer_sites: [{ id: 'site-a', customer_id: 'other', site_name: 'Wrong site', notes: 'Do not disclose' }] });
    const result = await loadSchedulingSelfDetails(admin, 'me', jobs, [assignment]);
    expect(result.job_details[0].site_name).toBeNull(); expect(result.job_details[0].site_notes).toBeNull();
  });
  it('does not query anything for an empty personal schedule', async () => {
    const { admin, from } = client({});
    expect(await loadSchedulingSelfDetails(admin, 'me', [], [])).toEqual({ job_details: [], crew_assignments: [] });
    expect(from).not.toHaveBeenCalled();
  });
});
