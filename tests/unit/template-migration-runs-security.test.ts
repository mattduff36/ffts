import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260720_secure_template_migration_runs.sql'),
  'utf8'
);

describe('template migration runs security migration', () => {
  it('enables RLS and removes client table privileges', () => {
    expect(migration).toContain(
      'ALTER TABLE public.template_migration_runs ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.template_migration_runs FROM anon, authenticated'
    );
  });

  it('defines an explicit deny-all client policy', () => {
    expect(migration).toContain('CREATE POLICY template_migration_runs_deny_client_access');
    expect(migration).toContain('FOR ALL');
    expect(migration).toContain('TO anon, authenticated');
    expect(migration).toContain('USING (FALSE)');
    expect(migration).toContain('WITH CHECK (FALSE)');
  });
});
