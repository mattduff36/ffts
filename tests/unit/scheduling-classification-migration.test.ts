import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260721_schedule_job_classification.sql'),
  'utf8'
);

describe('schedule job classification migration', () => {
  it('adds reusable tags, links, and independent drop-on readiness', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schedule_job_tags');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schedule_job_tag_links');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS is_drop_on_ready BOOLEAN');
    expect(migration).toContain('PRIMARY KEY (job_id, tag_id)');
  });

  it('indexes operational filtering and protects both tag tables with RLS', () => {
    expect(migration).toContain('schedule_jobs_drop_on_ready_idx');
    expect(migration).toContain('schedule_job_tag_links_tag_job_idx');
    expect(migration).toContain('ALTER TABLE public.schedule_job_tags ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.schedule_job_tag_links ENABLE ROW LEVEL SECURITY');
  });

  it('does not seed client-specific classifications', () => {
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.schedule_job_tags/i);
    expect(migration).not.toContain("'Hospital'");
  });
});
