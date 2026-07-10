import { createAdminClient } from '@/lib/supabase/admin';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { hasWorkshopInspectionFullVisibilityOverride } from '@/lib/utils/inspection-visibility';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole, type EffectiveRoleInfo } from '@/lib/utils/view-as';
import { hasAccountsTimesheetFullVisibilityOverride } from '@/lib/utils/timesheet-visibility';
import type { ModuleName } from '@/types/roles';

export interface ReportScopeContext {
  effectiveRole: EffectiveRoleInfo;
  isAdminTier: boolean;
  isManagerLike: boolean;
  shouldScopeToTeam: boolean;
}

function isInspectionModule(moduleName: ModuleName): boolean {
  return (
    moduleName === 'inspections' ||
    moduleName === 'plant-inspections' ||
    moduleName === 'hgv-inspections'
  );
}

function isAdminTierRole(effectiveRole: EffectiveRoleInfo): boolean {
  return hasEffectiveRoleFullAccess(effectiveRole);
}

export async function getReportScopeContext(): Promise<ReportScopeContext> {
  const effectiveRole = await getEffectiveRole();
  const reportAccessLevel = await getEffectiveModuleAccessLevel('reports');
  const hasAccountsVisibilityOverride = hasAccountsTimesheetFullVisibilityOverride(
    effectiveRole.role_name,
    effectiveRole.team_name
  );
  const isAdminTier = isAdminTierRole(effectiveRole) || reportAccessLevel >= 5 || hasAccountsVisibilityOverride;
  const isManagerLike = reportAccessLevel >= 3;

  return {
    effectiveRole,
    isAdminTier,
    isManagerLike,
    shouldScopeToTeam: isManagerLike && !isAdminTier,
  };
}

export async function getScopedProfileIdsForModule(
  moduleName: ModuleName,
  context: ReportScopeContext
): Promise<Set<string> | null> {
  const hasWorkshopInspectionVisibilityOverride =
    isInspectionModule(moduleName) &&
    hasWorkshopInspectionFullVisibilityOverride(context.effectiveRole.team_name);

  if (hasWorkshopInspectionVisibilityOverride) {
    return null;
  }

  if (context.isAdminTier) {
    return null;
  }

  const actorUserId = context.effectiveRole.user_id;
  if (!actorUserId) {
    return new Set<string>();
  }

  const admin = createAdminClient();
  let profileQuery = admin
    .from('profiles')
    .select('id, team_id')
    .not('full_name', 'ilike', '%(Deleted User)%');

  if (context.shouldScopeToTeam) {
    if (context.effectiveRole.team_id) {
      profileQuery = profileQuery.eq('team_id', context.effectiveRole.team_id);
    } else {
      profileQuery = profileQuery.eq('id', actorUserId);
    }
  } else {
    profileQuery = profileQuery.eq('id', actorUserId);
  }

  const { data: profileRows, error: profileError } = await profileQuery;
  if (profileError) {
    throw profileError;
  }

  const candidateIds = ((profileRows || []) as Array<{ id: string }>).map((row) => row.id);
  if (candidateIds.length === 0) {
    return new Set<string>();
  }

  const moduleAllowedIds = await getUsersWithModuleAccess(moduleName, candidateIds, admin);
  return new Set(candidateIds.filter((id) => moduleAllowedIds.has(id)));
}
