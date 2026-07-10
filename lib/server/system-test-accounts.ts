import { isHiddenSystemTestAccountEmail, isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';

interface AuthAdminClient {
  auth?: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
        error: { message?: string } | null;
      }>;
    };
  };
}

export async function getHiddenSystemTestAccountIds(admin: AuthAdminClient): Promise<Set<string>> {
  const hiddenIds = new Set<string>();
  const listUsers = admin.auth?.admin?.listUsers?.bind(admin.auth.admin);
  if (!listUsers) {
    return hiddenIds;
  }

  let page = 1;
  const perPage = 1000;

  try {
    while (true) {
      const { data, error } = await listUsers({ page, perPage });
      if (error) throw new Error(error.message || 'Failed to load auth users');

      for (const user of data.users) {
        if (isHiddenSystemTestAccountEmail(user.email)) {
          hiddenIds.add(user.id);
        }
      }

      if (data.users.length < perPage) break;
      page++;
    }
  } catch (error) {
    console.warn('Unable to load hidden system test account auth IDs:', error);
  }

  return hiddenIds;
}

export async function filterHiddenSystemTestAccountProfiles<T extends { id?: string | null }>(
  admin: AuthAdminClient,
  rows: Array<T & Parameters<typeof isHiddenSystemTestAccountProfile>[0]>
): Promise<Array<T & Parameters<typeof isHiddenSystemTestAccountProfile>[0]>> {
  const hiddenIds = await getHiddenSystemTestAccountIds(admin);
  return rows.filter((row) => {
    if (row.id && hiddenIds.has(row.id)) return false;
    return !isHiddenSystemTestAccountProfile(row);
  });
}
