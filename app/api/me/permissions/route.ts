import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { isAdminRole } from '@/lib/utils/role-access';
import { ALL_MODULES } from '@/types/roles';
import {
  getPermissionModules,
  getPermissionLevelsForUser,
  getPermissionMapForUser,
  isMissingTeamPermissionSchemaError,
} from '@/lib/server/team-permissions';

interface EffectiveRoleSnapshot {
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_super_admin: boolean;
  is_actual_super_admin: boolean;
  is_viewing_as: boolean;
}

export function shouldGrantFullAccessSnapshot(effectiveRole: EffectiveRoleSnapshot): boolean {
  return (
    effectiveRole.is_super_admin ||
    isAdminRole({ name: effectiveRole.role_name, role_class: effectiveRole.role_class }) ||
    (effectiveRole.is_actual_super_admin && !effectiveRole.is_viewing_as)
  );
}

function isTransientPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|schema cache/i.test(message);
}

async function withRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientPermissionError(error) || attempt === retries) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getSensitivePinModules(admin: ReturnType<typeof createAdminClient>) {
  const modules = await getPermissionModules(admin);
  return modules
    .filter((module) => module.requires_sensitive_pin)
    .map((module) => module.module_name);
}

export async function GET() {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const effectiveRole = await withRetry(() => getEffectiveRole());
    const hasFullAccessSnapshot = shouldGrantFullAccessSnapshot(effectiveRole);
    const admin = createAdminClient();

    if (hasFullAccessSnapshot) {
      const sensitivePinModules = await withRetry(() => getSensitivePinModules(admin));
      const fullAccessPermissions = ALL_MODULES.reduce<Record<string, boolean>>((acc, moduleName) => {
        acc[moduleName] = true;
        return acc;
      }, {}) as Record<(typeof ALL_MODULES)[number], boolean>;

      return NextResponse.json({
        success: true,
        permissions: fullAccessPermissions,
        permission_levels: ALL_MODULES.reduce<Record<string, number>>((acc, moduleName) => {
          acc[moduleName] = 5;
          return acc;
        }, {}),
        enabled_modules: ALL_MODULES,
        sensitive_pin_modules: sensitivePinModules,
        effective_team_id: effectiveRole.team_id,
        effective_team_name: effectiveRole.team_name,
      });
    }

    const [permissions, permissionLevels, sensitivePinModules] = await withRetry(() =>
      Promise.all([
        getPermissionMapForUser(
          current.profile.id,
          effectiveRole.role_id,
          admin,
          effectiveRole.team_id,
          { includeUserOverrides: effectiveRole.is_viewing_as !== true }
        ),
        getPermissionLevelsForUser(
          current.profile.id,
          effectiveRole.role_id,
          admin,
          effectiveRole.team_id,
          { includeUserOverrides: effectiveRole.is_viewing_as !== true }
        ),
        getSensitivePinModules(admin),
      ])
    );

    return NextResponse.json({
      success: true,
      permissions,
      permission_levels: permissionLevels,
      enabled_modules: ALL_MODULES.filter((moduleName) => permissions[moduleName]),
      sensitive_pin_modules: sensitivePinModules,
      effective_team_id: effectiveRole.team_id,
      effective_team_name: effectiveRole.team_name,
    });
  } catch (error) {
    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json({
        success: true,
        permissions: ALL_MODULES.reduce<Record<string, boolean>>((acc, moduleName) => {
          acc[moduleName] = false;
          return acc;
        }, {}),
        enabled_modules: [],
        sensitive_pin_modules: [],
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
