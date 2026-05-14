import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('timesheet manager RLS policy regression fix', () => {
  it('adds a migration that restores effective-role checks for timesheet manager policies', () => {
    const sql = read('supabase/migrations/20260421_fix_timesheet_manager_rls_role_checks.sql');

    expect(sql).toContain('CREATE POLICY "Managers can create timesheets for any user"');
    expect(sql).toContain('WITH CHECK ((SELECT effective_is_manager_admin()));');
    expect(sql).toContain('CREATE POLICY "Managers and admins can delete any timesheet"');
    expect(sql).toContain('USING ((SELECT effective_is_manager_admin()));');
    expect(sql).toContain('CREATE POLICY "Managers can delete any timesheet entries"');
    expect(sql).toContain('USING ((SELECT effective_is_manager_admin()));');
  });
});
