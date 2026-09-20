import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260920133000_quote_project_reference_owner_ranges.sql'
  ),
  'utf8'
);
const sampleFix = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260920133100_quote_project_reference_sample_range_fix.sql'
  ),
  'utf8'
);

describe('quote/project owner-range remapping migration', () => {
  it('maps JC, SD, and SAMPLE references into reserved five-digit bands', () => {
    expect(migration).toContain("10000 + split_part(reference, '-', 1)::INTEGER");
    expect(migration).toContain("'90' || substring(reference FROM 3)");
    expect(migration).toContain('90199 + substring(reference FROM 9)::INTEGER');
    expect(migration).toContain('Reference remapping collision');
    expect(migration).toContain('10000 + next_number');
  });

  it('updates denormalized copies, series, and Matt Duffill defaults', () => {
    expect(migration).toContain('UPDATE public.quotes');
    expect(migration).toContain('UPDATE public.quote_timeline_events');
    expect(migration).toContain('UPDATE public.schedule_jobs');
    expect(migration).toContain('UPDATE public.inventory_locations');
    expect(migration).toContain("WHERE initials = 'JC'");
    expect(migration).toContain("WHERE initials = 'SD'");
    expect(migration).toContain("full_name = 'Matt Duffill'");
    expect(migration).toContain('80001');
  });

  it('guards project allocation before the reference check constraint', () => {
    expect(migration).toContain('Quote manager series must use numbers between 10000 and 99999.');
    expect(migration).toContain('Quote manager initials must be exactly two letters.');
    expect(migration).toContain("USING ERRCODE = 'P0001'");
    expect(migration).toContain('quote_manager_series_number_range_check');
    expect(migration).toContain('FUNCTION public.create_project_schedule_job');
  });

  it('repairs already-applied 99xxx sample references to the 90xxx band', () => {
    expect(sampleFix).toContain("'90' || substring(reference FROM 3)");
    expect(sampleFix).toContain('^99[0-9]{3}-SD$');
    expect(sampleFix).toContain('UPDATE public.quotes');
    expect(sampleFix).toContain('UPDATE public.schedule_jobs');
  });
});
