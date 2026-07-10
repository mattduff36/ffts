import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldGrantFullAccessSnapshot } from '@/app/api/me/permissions/route';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';

function readSource(relativePath: string): string {
  const absolutePath = path.join(process.cwd(), relativePath);
  return readFileSync(absolutePath, 'utf8');
}

describe('shouldGrantFullAccessSnapshot', () => {
  it('does not grant full access while actual superadmin is viewing as another role', () => {
    expect(
      shouldGrantFullAccessSnapshot({
        role_name: 'employee',
        role_class: 'employee',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: true,
      })
    ).toBe(false);
  });

  it('grants full access for actual superadmin outside view-as mode', () => {
    expect(
      shouldGrantFullAccessSnapshot({
        role_name: 'employee',
        role_class: 'employee',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: false,
      })
    ).toBe(true);
  });

  it('grants full access for effective superadmin roles', () => {
    expect(
      shouldGrantFullAccessSnapshot({
        role_name: 'super-admin',
        role_class: 'admin',
        is_super_admin: true,
        is_actual_super_admin: true,
        is_viewing_as: true,
      })
    ).toBe(true);
  });

  it('grants full access for admin-class roles even when the name is custom', () => {
    expect(
      shouldGrantFullAccessSnapshot({
        role_name: 'regional-admin',
        role_class: 'admin',
        is_super_admin: false,
        is_actual_super_admin: false,
        is_viewing_as: false,
      })
    ).toBe(true);
  });
});

describe('hasEffectiveRoleFullAccess', () => {
  it('does not grant actual superadmin bypass while viewing as an employee role', () => {
    expect(
      hasEffectiveRoleFullAccess({
        role_name: 'employee',
        role_class: 'employee',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: true,
      })
    ).toBe(false);
  });

  it('keeps actual superadmin bypass outside view-as mode', () => {
    expect(
      hasEffectiveRoleFullAccess({
        role_name: 'employee',
        role_class: 'employee',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: false,
      })
    ).toBe(true);
  });

  it('still grants full access for effective admin roles during view-as', () => {
    expect(
      hasEffectiveRoleFullAccess({
        role_name: 'admin',
        role_class: 'admin',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: true,
      })
    ).toBe(true);
  });
});

describe('module guard alignment checks', () => {
  it('uses reports module permission check on reports page', () => {
    const source = readSource('app/(dashboard)/reports/page.tsx');
    expect(source).toContain("usePermissionCheck('reports'");
  });

  it('uses admin-vans module permission on fleet page', () => {
    const source = readSource('app/(dashboard)/fleet/page.tsx');
    expect(source).toContain("usePermissionCheck('admin-vans'");
    expect(source).not.toContain('permissions?.maintenance');
  });

  it('keeps actions module guard on actions page', () => {
    const source = readSource('app/(dashboard)/actions/page.tsx');
    expect(source).toContain("usePermissionCheck('actions', false)");
  });

  it('keeps projects read page accessible for assigned employees', () => {
    const source = readSource('app/(dashboard)/projects/[id]/read/page.tsx');
    expect(source).toContain("usePermissionCheck('rams'");
    expect(source).toContain(".from('rams_assignments')");
    expect(source).not.toContain('isManager');
    expect(source).not.toContain('isAdmin');
  });

  it('uses reports module RBAC guard on report APIs', () => {
    const reportRouteFiles = [
      'app/api/reports/timesheets/summary/route.ts',
      'app/api/reports/timesheets/payroll/route.ts',
      'app/api/reports/stats/route.ts',
      'app/api/reports/absence-leave/bookings/route.ts',
      'app/api/reports/suggestions/route.ts',
      'app/api/reports/inspections/compliance/route.ts',
      'app/api/reports/inspections/defects/route.ts',
      'app/api/reports/inspections/bulk-pdf/route.ts',
    ];

    reportRouteFiles.forEach((routeFile) => {
      const source = readSource(routeFile);
      expect(source).toContain("canEffectiveRoleAccessModule('reports')");
      expect(source).not.toContain('getProfileWithRole');
    });
  });

  it('shows a superadmin bypass action on protected absence tabs', () => {
    const source = readSource('app/(dashboard)/absence/manage/page.tsx');
    expect(source).toContain('isActualSuperAdmin');
    expect(source).toContain('handleSuperAdminBypass');
    expect(source).toContain('Bypass');
  });

  it('treats supervisor as inspection viewer on list pages', () => {
    const vanSource = readSource('app/(dashboard)/van-inspections/page.tsx');
    const plantSource = readSource('app/(dashboard)/plant-inspections/page.tsx');
    const hgvSource = readSource('app/(dashboard)/hgv-inspections/page.tsx');
    const accessHelperSource = readSource('lib/utils/inspection-access.ts');

    [vanSource, plantSource, hgvSource].forEach((source) => {
      expect(source).toContain('isSupervisor');
      expect(source).toContain('canViewCrossUserInspections');
      expect(source).toContain('canDeleteInspections');
    });

    expect(accessHelperSource).toContain('input.isManager || input.isSupervisor || input.isAdmin || input.isSuperAdmin');
    expect(accessHelperSource).toContain('input.isAdmin || input.isSuperAdmin || (input.isManager && hasWorkshopReadAllOverride)');
  });

  it('keeps supervisor read-only on inspection list actions', () => {
    const vanSource = readSource('app/(dashboard)/van-inspections/page.tsx');
    const plantSource = readSource('app/(dashboard)/plant-inspections/page.tsx');
    const hgvSource = readSource('app/(dashboard)/hgv-inspections/page.tsx');

    [vanSource, plantSource, hgvSource].forEach((source) => {
      expect(source).toContain('canDeleteInspection={canDeleteInspection}');
      expect(source).toContain('canEditDraftInspection');
    });
  });

  it('does not include retired account lock/switch entry points in navbar menu variants', () => {
    const source = readSource('components/layout/Navbar.tsx');
    expect(source).not.toContain('Lock / Switch');
    expect(source).not.toContain('accountLockLabel');
    expect(source).not.toContain("buildLockPathWithReturnTo");
  });

  it('keeps biometric settings but removes account switcher settings from profile hub', () => {
    const profileSource = readSource('app/(dashboard)/profile/page.tsx');
    const securityTabSource = readSource('components/profile/ProfileSecurityTab.tsx');

    expect(securityTabSource).toContain('ProfileBiometricsCard');
    expect(profileSource).not.toContain('AccountSwitcherSettingsCard');
    expect(securityTabSource).not.toContain('AccountSwitcherSettingsCard');
  });
});
