import { getEffectiveRole } from '@/lib/utils/view-as';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';

export async function canManageQuoteSage(): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  return hasEffectiveRoleFullAccess(effectiveRole) || effectiveRole.team_id === 'accounts';
}
