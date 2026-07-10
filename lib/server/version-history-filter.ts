import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getPermissionMapForUser, getPermissionModules } from '@/lib/server/team-permissions';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { isAdminRole } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  getReleaseDescriptorById,
  getReleaseDescriptorByArea,
  getReleaseDescriptorByScope,
} from '@/lib/config/release-module-descriptors';
import type { ReleaseHistoryEntry } from '@/lib/config/release-version-logic';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

export interface ReleaseHistoryAccessSnapshot {
  authenticated: boolean;
  fullAccess: boolean;
  accessibleModules: Set<ModuleName>;
  sensitivePinModules: Set<string>;
  canAccessDebug: boolean;
}

const GENERIC_RESTRICTED_TITLE = 'App update';
const GENERIC_RESTRICTED_SUMMARY = 'This release includes updates to parts of the app that are not available to your current permissions.';
const GENERIC_RESTRICTED_DETAIL = 'Some details are hidden because your current access does not include every module touched by this release.';
const GENERIC_RESTRICTED_AREA = 'Restricted update';

interface EffectiveRoleLike {
  role_id?: string | null;
  team_id?: string | null;
  role_name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  is_super_admin?: boolean;
  is_actual_super_admin?: boolean;
  is_viewing_as?: boolean;
}

function getEntryDescriptorIds(entry: ReleaseHistoryEntry): string[] {
  const ids = new Set<string>();

  (entry.areaKeys || []).forEach((key) => ids.add(key));
  entry.areas.forEach((area) => {
    const descriptor = getReleaseDescriptorByArea(area);
    if (descriptor) ids.add(descriptor.id);
  });

  return Array.from(ids);
}

function canAccessDescriptorId(id: string, access: ReleaseHistoryAccessSnapshot): boolean {
  const descriptor =
    getReleaseDescriptorById(id) ||
    getReleaseDescriptorByScope(id) ||
    getReleaseDescriptorByArea(id);
  if (!descriptor) return true;
  if (descriptor.sensitiveModule === 'debug') return access.canAccessDebug;
  if (!descriptor.permissionModule) return true;
  if (access.fullAccess) return true;
  return access.accessibleModules.has(descriptor.permissionModule);
}

function isRestrictedDetail(detail: string, restrictedAreas: Set<string>): boolean {
  const normalizedDetail = detail.toLowerCase();
  return Array.from(restrictedAreas).some((area) =>
    normalizedDetail.includes(area.toLowerCase())
  );
}

function formatAreaList(areas: string[]): string {
  if (areas.length === 0) return '';
  const lowered = areas.map((area) => area.charAt(0).toLowerCase() + area.slice(1));
  if (lowered.length === 1) return lowered[0];
  if (lowered.length === 2) return `${lowered[0]} and ${lowered[1]}`;
  return `${lowered.slice(0, -1).join(', ')}, and ${lowered[lowered.length - 1]}`;
}

function containsRestrictedArea(value: string, restrictedAreas: Set<string>): boolean {
  const normalized = value.toLowerCase();
  return Array.from(restrictedAreas).some((area) => normalized.includes(area.toLowerCase()));
}

function containsVisibleArea(value: string, visibleAreas: string[]): boolean {
  const normalized = value.toLowerCase();
  return visibleAreas.some((area) => normalized.includes(area.toLowerCase()));
}

export function filterReleaseHistoryEntryForAccess(
  entry: ReleaseHistoryEntry,
  access: ReleaseHistoryAccessSnapshot
): ReleaseHistoryEntry {
  if (access.fullAccess) return entry;

  const restrictedDescriptorIds = getEntryDescriptorIds(entry)
    .filter((id) => !canAccessDescriptorId(id, access));

  if (restrictedDescriptorIds.length === 0) return entry;

  const restrictedAreas = new Set(
    restrictedDescriptorIds
      .map((id) =>
        getReleaseDescriptorById(id)?.versionHistoryArea ||
        getReleaseDescriptorByScope(id)?.versionHistoryArea ||
        getReleaseDescriptorByArea(id)?.versionHistoryArea ||
        ''
      )
      .filter(Boolean)
  );
  const visibleAreas = entry.areas.filter((area) => !restrictedAreas.has(area));
  const details = entry.details.filter((detail) =>
    !isRestrictedDetail(detail, restrictedAreas) && containsVisibleArea(detail, visibleAreas)
  );
  const releaseIsFullyRestricted = visibleAreas.length === 0;
  const partialSummary = `Updated ${formatAreaList(visibleAreas)}. Some restricted update details are hidden.`;
  const shouldMaskTitle = containsRestrictedArea(entry.title, restrictedAreas);
  const shouldMaskSummary =
    containsRestrictedArea(entry.summary || entry.description, restrictedAreas) ||
    containsRestrictedArea(entry.description, restrictedAreas);

  return {
    ...entry,
    title: releaseIsFullyRestricted
      ? GENERIC_RESTRICTED_TITLE
      : shouldMaskTitle
        ? `${visibleAreas[0]} update`
        : entry.title,
    description: releaseIsFullyRestricted
      ? GENERIC_RESTRICTED_SUMMARY
      : shouldMaskSummary
        ? partialSummary
        : entry.description,
    summary: releaseIsFullyRestricted
      ? GENERIC_RESTRICTED_SUMMARY
      : shouldMaskSummary
        ? partialSummary
        : entry.summary,
    details: [
      ...(releaseIsFullyRestricted ? [GENERIC_RESTRICTED_DETAIL] : details),
      ...(releaseIsFullyRestricted ? [] : [GENERIC_RESTRICTED_DETAIL]),
    ],
    areas: releaseIsFullyRestricted ? [GENERIC_RESTRICTED_AREA] : [...visibleAreas, GENERIC_RESTRICTED_AREA],
    areaKeys: (entry.areaKeys || []).filter((key) => !restrictedDescriptorIds.includes(key)),
  };
}

export function filterReleaseHistoryEntriesForAccess(
  entries: ReleaseHistoryEntry[],
  access: ReleaseHistoryAccessSnapshot
): ReleaseHistoryEntry[] {
  return entries.map((entry) => filterReleaseHistoryEntryForAccess(entry, access));
}

export async function getCurrentReleaseHistoryAccess(): Promise<ReleaseHistoryAccessSnapshot> {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return {
      authenticated: false,
      fullAccess: false,
      accessibleModules: new Set(),
      sensitivePinModules: new Set(),
      canAccessDebug: false,
    };
  }

  const effectiveRole = await getEffectiveRole() as EffectiveRoleLike;
  const fullAccess = Boolean(
    effectiveRole.is_super_admin ||
    isAdminRole({ name: effectiveRole.role_name || null, role_class: effectiveRole.role_class || null }) ||
    (effectiveRole.is_actual_super_admin && !effectiveRole.is_viewing_as)
  );
  const admin = createAdminClient();
  const [permissionMap, permissionModules] = await Promise.all([
    fullAccess
      ? Promise.resolve(Object.fromEntries(ALL_MODULES.map((moduleName) => [moduleName, true])) as Record<ModuleName, boolean>)
      : getPermissionMapForUser(
        current.profile.id,
        effectiveRole.role_id || null,
        admin,
        effectiveRole.team_id || null,
        { includeUserOverrides: effectiveRole.is_viewing_as !== true }
      ),
    getPermissionModules(admin),
  ]);

  return {
    authenticated: true,
    fullAccess,
    accessibleModules: new Set(ALL_MODULES.filter((moduleName) => permissionMap[moduleName])),
    sensitivePinModules: new Set(permissionModules.filter((module) => module.requires_sensitive_pin).map((module) => module.module_name)),
    canAccessDebug: canAccessDebugConsole({
      email: current.profile.email,
      isActualSuperAdmin: Boolean(effectiveRole.is_actual_super_admin),
      isViewingAs: Boolean(effectiveRole.is_viewing_as),
    }),
  };
}
