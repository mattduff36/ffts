import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260601_advisor_performance_hardening.sql'),
  'utf-8'
);

describe('advisor performance hardening migration', () => {
  it('rewrites the live auth_rls_initplan policy set with authenticated scope', () => {
    expect(migration).toContain('CREATE POLICY "Users can view own timesheets"');
    expect(migration).toContain('CREATE POLICY "Users can delete own timesheet entries"');
    expect(migration).toContain('CREATE POLICY "Managers and admins can manage template sections"');
    expect(migration).toContain('CREATE POLICY "Workshop users can update field responses v2"');
    expect(migration).toContain('CREATE POLICY "Only admins delete user module permissions"');
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('user_id = (SELECT auth.uid())');
    expect(migration).toContain('p.id = (SELECT auth.uid())');
  });

  it('drops obvious historical duplicate policies', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Managers can update all timesheets"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Managers can update all timesheet entries"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Managers can view all RAMS documents"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Managers can update RAMS documents"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Managers can delete RAMS documents"');
  });

  it('adds targeted foreign key indexes for high-traffic domains', () => {
    const indexMatches = migration.match(/CREATE INDEX IF NOT EXISTS/g) ?? [];
    expect(indexMatches).toHaveLength(39);
    expect(migration).toContain('idx_absences_archive_archive_run_id');
    expect(migration).toContain('idx_inventory_items_category');
    expect(migration).toContain('idx_quote_invoice_allocations_quote_line_item_id');
    expect(migration).toContain('idx_reminder_actions_resolved_by');
    expect(migration).toContain('idx_user_usage_events_app_session_id');
  });
});
