import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260720_admin_only_faq_operational_scripts.sql'),
  'utf8'
);

describe('admin-only operational FAQ migration', () => {
  it('adds database-enforced Admin and Super Admin visibility', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migration).toContain('profile.super_admin = TRUE');
    expect(migration).toContain('role.is_super_admin = TRUE');
    expect(migration).toContain("role.role_class = 'admin'");
    expect(migration).toContain('admin_only = FALSE');
  });

  it('publishes the cleanup article as restricted content', () => {
    expect(migration).toContain("'admin-operational-cleanup-scripts'");
    expect(migration).toContain('npm run scheduling:sample:cleanup -- --dry-run');
    expect(migration).toContain('npm run fixerrors -- --no-clear');
    expect(migration).toContain('admin_only = TRUE');
  });
});
