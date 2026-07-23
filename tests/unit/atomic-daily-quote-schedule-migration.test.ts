import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260723235000_atomic_daily_quote_schedule.sql'),
  'utf8'
);

describe('atomic Daily Quote schedule migration', () => {
  it('locks Quote then job and inserts the initial visit in one function', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('UPDATE public.quotes');
    expect(migration).toContain('FROM public.schedule_jobs');
    expect(migration).toContain('INSERT INTO public.schedule_visits');
    expect(migration).toContain('Quote is already scheduled.');
    expect(migration).toContain('Initial visit already exists.');
  });

  it('uses a safe definer context restricted to service_role', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('REVOKE ALL ON FUNCTION');
    expect(migration).toContain('FROM PUBLIC, authenticated, anon');
    expect(migration).toContain('TO service_role');
  });
});
