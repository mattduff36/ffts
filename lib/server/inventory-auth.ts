import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface InventoryAccessResult {
  allowed: boolean;
  status: 401 | 403 | 200;
  error?: string;
  userId?: string;
  isManagerOrAdmin?: boolean;
  roleName?: string | null;
  roleClass?: 'admin' | 'manager' | 'employee' | null;
}

function isEffectiveInventoryManagerOrAdmin(role: {
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_manager_admin: boolean;
  is_super_admin: boolean;
}): boolean {
  return (
    role.is_super_admin ||
    role.is_manager_admin ||
    role.role_class === 'admin' ||
    role.role_name?.trim().toLowerCase() === 'admin'
  );
}

export async function requireInventoryAccess(): Promise<InventoryAccessResult> {
  const effectiveRole = await getEffectiveRole();

  if (!effectiveRole.user_id) {
    return { allowed: false, status: 401, error: 'Unauthorized' };
  }

  const hasPermission = await canEffectiveRoleAccessModule('inventory');
  if (!hasPermission) {
    return { allowed: false, status: 403, error: 'Forbidden' };
  }

  return {
    allowed: true,
    status: 200,
    userId: effectiveRole.user_id,
    isManagerOrAdmin: isEffectiveInventoryManagerOrAdmin(effectiveRole),
    roleName: effectiveRole.role_name,
    roleClass: effectiveRole.role_class,
  };
}

export async function requireInventoryManagerAccess(): Promise<InventoryAccessResult> {
  const access = await requireInventoryAccess();
  if (!access.allowed) return access;

  if (!access.isManagerOrAdmin) {
    return { allowed: false, status: 403, error: 'Manager or admin access required' };
  }

  return access;
}

export function normalizeInventoryItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}
