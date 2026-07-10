import type { ModuleName, PermissionAccessLevel, PermissionModuleMatrixColumn } from '@/types/roles';

const MODULE_ENFORCED_MINIMUM_ACCESS_LEVELS: Partial<Record<ModuleName, PermissionAccessLevel>> = {
  'toolbox-talks': 4,
  'admin-settings': 4,
};

const FULL_ACCESS_ROLE_ONLY_MODULES = new Set<ModuleName>();

function normalizeAccessLevel(value: number | null | undefined): PermissionAccessLevel {
  if (value === 5) return 5;
  if (value === 4) return 4;
  if (value === 3) return 3;
  if (value === 2) return 2;
  if (value === 1) return 1;
  return 0;
}

export function getModuleEnforcedMinimumAccessLevel(
  moduleName: ModuleName,
  configuredMinimumLevel: number | null | undefined
): PermissionAccessLevel {
  const configuredLevel = normalizeAccessLevel(configuredMinimumLevel);
  const hardRuleLevel = MODULE_ENFORCED_MINIMUM_ACCESS_LEVELS[moduleName] ?? 0;
  return normalizeAccessLevel(Math.max(configuredLevel, hardRuleLevel));
}

export function moduleRequiresFullAccessRole(moduleName: ModuleName): boolean {
  return FULL_ACCESS_ROLE_ONLY_MODULES.has(moduleName);
}

export function isPermissionLevelAllowedForModule(
  module: Pick<PermissionModuleMatrixColumn, 'module_name' | 'enforced_minimum_access_level' | 'requires_full_access_role'>,
  level: PermissionAccessLevel,
  options?: { hasFullAccessRole?: boolean }
): boolean {
  if (level === 0) return true;
  if (module.requires_full_access_role) {
    return options?.hasFullAccessRole === true;
  }
  return level >= module.enforced_minimum_access_level;
}

export function getUsablePermissionAccessLevel(
  module: Pick<PermissionModuleMatrixColumn, 'module_name' | 'enforced_minimum_access_level' | 'requires_full_access_role'>,
  level: PermissionAccessLevel,
  options?: { hasFullAccessRole?: boolean }
): PermissionAccessLevel {
  return isPermissionLevelAllowedForModule(module, level, options) ? level : 0;
}
