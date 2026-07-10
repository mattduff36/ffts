import { canEffectiveRoleAccessModule, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface TrainingAccessResult {
  allowed: boolean;
  status: 401 | 403 | 200;
  error?: string;
  userId?: string;
  accessLevel?: number;
  isAdminLevel?: boolean;
}

export async function requireTrainingAccess(): Promise<TrainingAccessResult> {
  const effectiveRole = await getEffectiveRole();

  if (!effectiveRole.user_id) {
    return { allowed: false, status: 401, error: 'Unauthorized' };
  }

  const hasPermission = await canEffectiveRoleAccessModule('training');
  if (!hasPermission) {
    return { allowed: false, status: 403, error: 'Forbidden' };
  }

  const accessLevel = await getEffectiveModuleAccessLevel('training');

  return {
    allowed: true,
    status: 200,
    userId: effectiveRole.user_id,
    accessLevel,
    isAdminLevel: accessLevel >= 5,
  };
}

export async function requireTrainingAdminAccess(): Promise<TrainingAccessResult> {
  const access = await requireTrainingAccess();
  if (!access.allowed) return access;

  if (!access.isAdminLevel) {
    return { allowed: false, status: 403, error: 'Admin Training access required' };
  }

  return access;
}
