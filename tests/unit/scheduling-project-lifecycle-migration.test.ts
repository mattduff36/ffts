import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260723201500_project_backed_scheduling_jobs.sql'
  ),
  'utf8'
);
const schedulingSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260715_scheduling_module.sql'),
  'utf8'
);
const visitSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260720_quote_scheduling_visits.sql'),
  'utf8'
);
const classificationSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260721_schedule_job_classification.sql'),
  'utf8'
);
const projectNumberRoute = readFileSync(
  resolve(process.cwd(), 'app/api/quotes/project-numbers/route.ts'),
  'utf8'
);

describe('project-backed scheduling lifecycle migration', () => {
  it('performs the explicitly authorized manual-job cleanup', () => {
    expect(migration).toContain('DELETE FROM public.schedule_jobs');
    expect(migration).toContain("WHERE source_type = 'manual'");
  });

  it('enforces one Project schedule and consistent source ownership', () => {
    expect(migration).toContain('schedule_jobs_project_number_unique_idx');
    expect(migration).toContain('schedule_jobs_source_owner_check');
    expect(migration).toContain("source_type = 'manual'");
    expect(migration).toContain('quote_project_number_id IS NOT NULL');
    expect(migration).toContain("source_type = 'quote'");
    expect(migration).toContain('quote_id IS NOT NULL');
  });

  it('creates and removes scheduling projections transactionally', () => {
    expect(migration).toContain('FUNCTION public.create_project_schedule_job');
    expect(migration).toContain('FUNCTION public.remove_schedule_job');
    expect(migration).toContain("start_date = NULL");
    expect(migration).toContain("'schedule_removed'");
    expect(migration).toContain('DELETE FROM public.schedule_jobs');
  });

  it('relies on verified job cascades for every operational child record', () => {
    expect(schedulingSchema).toContain(
      'job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE'
    );
    expect(visitSchema).toContain(
      'job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE'
    );
    expect(visitSchema).toContain(
      'visit_id UUID REFERENCES public.schedule_visits(id) ON DELETE CASCADE'
    );
    expect(classificationSchema).toContain(
      'job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE'
    );
    expect(migration).toContain(
      'Child visits, assignments, and tag links are removed by their job_id cascades.'
    );
  });

  it('transfers Project schedules to Quote ownership without replacing the job id', () => {
    expect(migration).toContain('FUNCTION public.transfer_project_schedule_to_quote');
    expect(migration).toContain("source_type = 'quote'");
    expect(migration).toContain('quote_project_number_id = NEW.id');
    expect(migration).toContain('WHERE id = v_job.id');
    expect(migration).toContain('transfer_project_schedule_to_quote_trigger');
  });

  it('covers both Project-to-Quote lifecycle paths through the database trigger', () => {
    expect(projectNumberRoute).toContain("action === 'link_existing_quote'");
    expect(projectNumberRoute).toContain("action === 'convert_to_quote'");
    expect(projectNumberRoute).toContain("status: 'linked'");
    expect(projectNumberRoute).toContain("status: 'converted'");
    expect(migration).toContain(
      'AFTER UPDATE OF status, linked_quote_id, converted_quote_id'
    );
  });

  it('restricts lifecycle functions to the service role', () => {
    expect(migration).toContain('FROM PUBLIC, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
