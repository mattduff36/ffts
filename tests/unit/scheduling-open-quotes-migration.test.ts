import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260723_schedule_open_quotes.sql'),
  'utf8'
);

describe('open Quote scheduling migration', () => {
  it('synchronizes latest open dated Quotes without a workflow-status gate', () => {
    expect(migration).toContain('NEW.is_latest_version = TRUE');
    expect(migration).toContain("NEW.commercial_status = 'open'");
    expect(migration).toContain('NEW.start_date IS NOT NULL');
    expect(migration).not.toContain("NEW.status IN ('po_received', 'in_progress')");
  });

  it('preserves Quote ownership, customer sites, and out-of-window visit cancellation', () => {
    expect(migration).toContain("source_type = 'quote'");
    expect(migration).toContain('customer_site_id = NEW.customer_site_id');
    expect(migration).toContain("AT TIME ZONE 'Europe/London'");
    expect(migration).toContain("status = 'cancelled'");
  });

  it('backfills eligible Quotes and fails if any cannot be synchronized', () => {
    expect(migration).toContain('INSERT INTO public.schedule_jobs');
    expect(migration).toContain('One or more open Quotes could not be synchronized');
  });
});
