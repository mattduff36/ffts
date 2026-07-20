import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260720_single_super_admin_invariant.sql'),
  'utf8'
);
const assignmentFunctionMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260720_harden_super_admin_role_assignment_function.sql'
  ),
  'utf8'
);

describe('single Super Admin invariant migration', () => {
  it('normalizes existing assignments to the configured owner', () => {
    expect(migration).toContain("LOWER(auth_user.email) = 'admin@mpdee.co.uk'");
    expect(migration).toContain('profile.id <> owner_profile_id');
    expect(migration).toContain('role_id = administrator_role_id');
    expect(migration).toContain('role_id = super_admin_role_id');
  });

  it('blocks application users without imposing a database-wide maximum', () => {
    expect(migration).not.toContain('roles_single_super_admin_idx');
    expect(migration).not.toContain('profiles_single_super_admin_flag_idx');
    expect(migration).toContain('AS RESTRICTIVE');
    expect(migration).toContain('app_roles_block_super_admin_insert');
    expect(migration).toContain('app_profiles_block_super_admin_update');
  });

  it('allows existing Super Admin state to be preserved but not assigned by app users', () => {
    expect(migration).toContain('profile_super_admin_state_is_allowed');
    expect(migration).toContain(
      'existing_role_id IS NOT DISTINCT FROM target_role_id'
    );
    expect(migration).toContain(
      'existing_super_admin IS NOT DISTINCT FROM COALESCE(target_super_admin, FALSE)'
    );
  });

  it('checks the target role before granting admin assignment rights', () => {
    const targetRoleCheck = assignmentFunctionMigration.indexOf(
      'IF target_role_class IS NULL OR COALESCE(target_is_super, FALSE)'
    );
    const actorAdminCheck = assignmentFunctionMigration.indexOf(
      "IF COALESCE(eff_is_super, FALSE) OR eff_role_class = 'admin'"
    );

    expect(targetRoleCheck).toBeGreaterThan(-1);
    expect(actorAdminCheck).toBeGreaterThan(targetRoleCheck);
  });
});
