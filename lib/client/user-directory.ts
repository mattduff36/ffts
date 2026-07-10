import type { ModuleName } from '@/types/roles';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { createStatusError } from '@/lib/utils/http-error';

export interface DirectoryUserRole {
  id?: string | null;
  name?: string | null;
  display_name?: string | null;
  is_manager_admin?: boolean | null;
  is_super_admin?: boolean | null;
}

export interface DirectoryUserTeam {
  id?: string | null;
  name?: string | null;
}

export interface DirectoryUser {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  super_admin?: boolean | null;
  annual_holiday_allowance_days?: number | null;
  role?: DirectoryUserRole | null;
  team?: DirectoryUserTeam | null;
  has_module_access?: boolean;
}

export interface FetchUserDirectoryOptions {
  includeRole?: boolean;
  includeAllowance?: boolean;
  includeDeleted?: boolean;
  ids?: string[];
  module?: ModuleName;
  context?: 'actions-assignment' | 'toolbox-talks-assignment';
  limit?: number;
  offset?: number;
}

export async function fetchUserDirectory(
  options: FetchUserDirectoryOptions = {}
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams();

  if (options.includeRole) {
    params.set('includeRole', 'true');
  }

  if (options.includeAllowance) {
    params.set('includeAllowance', 'true');
  }

  if (options.includeDeleted) {
    params.set('includeDeleted', 'true');
  }

  if (options.ids?.length) {
    params.set('ids', options.ids.join(','));
  }

  if (options.module) {
    params.set('module', options.module);
  }

  if (options.context) {
    params.set('context', options.context);
  }

  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit));
  }

  if (typeof options.offset === 'number') {
    params.set('offset', String(options.offset));
  }

  const query = params.toString();
  const endpoint = query ? `/api/users/directory?${query}` : '/api/users/directory';

  if (typeof options.limit === 'number' || typeof options.offset === 'number') {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const payload = (await response.json()) as {
      error?: string;
      users?: DirectoryUser[];
    };

    if (!response.ok) {
      throw createStatusError(payload.error || 'Failed to load users', response.status, payload);
    }

    return payload.users || [];
  }

  const { items } = await fetchAllPaginatedItems<DirectoryUser>(endpoint, 'users', {
    limit: 500,
    errorMessage: 'Failed to load users',
  });

  return items;
}
