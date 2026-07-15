import { canEffectiveRoleAccessModule, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface SchedulingAccessResult {
  allowed: boolean;
  status: 200 | 401 | 403;
  error?: string;
  userId?: string;
  accessLevel?: number;
  isManagerOrAdmin?: boolean;
  roleName?: string | null;
  roleClass?: 'admin' | 'manager' | 'employee' | null;
  teamId?: string | null;
  teamName?: string | null;
}

export async function requireSchedulingAccess(): Promise<SchedulingAccessResult> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return { allowed: false, status: 401, error: 'Unauthorized' };
  }

  if (!(await canEffectiveRoleAccessModule('scheduling'))) {
    return { allowed: false, status: 403, error: 'Scheduling access required' };
  }

  const accessLevel = await getEffectiveModuleAccessLevel('scheduling');
  return {
    allowed: true,
    status: 200,
    userId: effectiveRole.user_id,
    accessLevel,
    isManagerOrAdmin: accessLevel >= 4,
    roleName: effectiveRole.role_name,
    roleClass: effectiveRole.role_class,
    teamId: effectiveRole.team_id,
    teamName: effectiveRole.team_name,
  };
}

export async function requireSchedulingManagerAccess(): Promise<SchedulingAccessResult> {
  const access = await requireSchedulingAccess();
  if (!access.allowed) return access;
  if (!access.isManagerOrAdmin) {
    return { allowed: false, status: 403, error: 'Manager or admin access required' };
  }
  return access;
}
