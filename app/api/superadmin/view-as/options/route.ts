import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

export async function GET() {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = current.profile.id;

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select(`
      super_admin,
      role:roles(
        is_super_admin
      )
    `)
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Unable to verify user' }, { status: 403 });
  }

  const typedProfile = profile as {
    super_admin?: boolean | null;
    role?: { is_super_admin?: boolean | null } | null;
  };

  const isActualSuperAdmin =
    typedProfile.super_admin === true ||
    typedProfile.role?.is_super_admin === true;

  if (!isActualSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [{ data: roles, error: rolesError }, { data: teams, error: teamsError }] = await Promise.all([
    admin
      .from('roles')
      .select('id, name, display_name, role_class, is_super_admin, is_manager_admin')
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('display_name', { ascending: true }),
    admin
      .from('org_teams')
      .select('id, name, code, active')
      .eq('active', true)
      .order('name', { ascending: true }),
  ]);

  if (rolesError || teamsError) {
    return NextResponse.json(
      { error: rolesError?.message || teamsError?.message || 'Failed to load view-as options' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    roles: roles || [],
    teams: teams || [],
  });
}
