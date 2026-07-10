import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';
import { ALL_MODULES, type ModuleName } from '@/types/roles';
import { getUsersWithPermission } from '@/lib/utils/permissions';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const moduleName = request.nextUrl.searchParams.get('module');
  if (!moduleName || !ALL_MODULES.includes(moduleName as ModuleName)) {
    return NextResponse.json({ error: 'Valid module query parameter is required' }, { status: 400 });
  }

  const allowedUserIds = await getUsersWithPermission(moduleName as ModuleName);
  if (allowedUserIds.length === 0) {
    return NextResponse.json({ success: true, users: [] });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      full_name,
      employee_id,
      is_placeholder,
      role:roles(
        name,
        display_name
      )
    `)
    .in('id', allowedUserIds)
    .order('full_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status: 500 });
  }

  const users = await filterHiddenSystemTestAccountProfiles(admin, data || []);

  return NextResponse.json({
    success: true,
    users,
  });
}
