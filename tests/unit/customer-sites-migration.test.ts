import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260721_customer_sites.sql'),
  'utf8'
);

describe('customer sites migration', () => {
  it('creates structured sites with matching customer access policies', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.customer_sites');
    expect(migration).toContain("public.effective_has_module_permission('customers')");
    expect(migration).toContain('customer_sites_one_default_idx');
    expect(migration).toContain('customer_sites_default_active');
  });

  it('backfills Main site only from populated structured customer addresses', () => {
    expect(migration).toContain("'Main site'");
    expect(migration).toContain("NULLIF(BTRIM(COALESCE(customer.address_line_1, '')), '') IS NOT NULL");
    expect(migration).toContain('NOT EXISTS (');
  });

  it('links snapshots only by exact normalized equality without fuzzy guessing', () => {
    expect(migration).toContain("LOWER(REGEXP_REPLACE(BTRIM(quote.site_address), '\\s+', ' ', 'g'))");
    expect(migration).toContain('= site.normalized_address');
    expect(migration.toLowerCase()).not.toContain('site_address like');
    expect(migration.toLowerCase()).not.toContain('similarity(');
  });

  it('propagates the site id and address snapshot to quote jobs', () => {
    expect(migration).toContain('sync_quote_customer_site_schedule_job');
    expect(migration).toContain('customer_site_id = NEW.customer_site_id');
    expect(migration).toContain('site_address = NEW.site_address');
    expect(migration).toContain("source_type = 'quote'");
  });
});
