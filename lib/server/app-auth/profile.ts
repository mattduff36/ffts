import { createAdminClient } from '@/lib/supabase/admin';

export interface AppAuthRole {
  name: string;
  display_name: string;
  role_class?: 'admin' | 'manager' | 'employee';
  is_manager_admin: boolean;
  is_super_admin: boolean;
}

export interface AppAuthTeam {
  id: string;
  name: string;
}

export interface AppAuthProfile {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  employee_id: string | null;
  avatar_url: string | null;
  must_change_password: boolean | null;
  annual_holiday_allowance_days?: number | null;
  super_admin?: boolean | null;
  team_id?: string | null;
  team?: AppAuthTeam | null;
  role?: AppAuthRole | null;
  email: string | null;
}

export class PasswordChangeRequiredError extends Error {
  readonly status = 403;
  readonly code = 'PASSWORD_CHANGE_REQUIRED';

  constructor() {
    super('Choose a permanent password before using the app.');
    this.name = 'PasswordChangeRequiredError';
  }
}

// Never cache this security flag: an administrator can reset an active account.
export async function isPasswordChangeRequired(profileId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('must_change_password')
    .eq('id', profileId)
    .single();

  if (error || !data) {
    throw new Error('Unable to verify password-change requirement');
  }
  return data.must_change_password === true;
}

export async function getAppAuthProfile(profileId: string, email: string | null): Promise<AppAuthProfile> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      full_name,
      phone_number,
      employee_id,
      avatar_url,
      must_change_password,
      annual_holiday_allowance_days,
      super_admin,
      team_id,
      team:org_teams!profiles_team_id_fkey(id, name),
      role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)
    `)
    .eq('id', profileId)
    .single();

  if (error || !data) {
    throw error || new Error('Profile not found');
  }

  const teamValue = Array.isArray(data.team) ? data.team[0] || null : data.team || null;
  const roleValue = Array.isArray(data.role) ? data.role[0] || null : data.role || null;

  return {
    ...data,
    team: teamValue,
    role: roleValue,
    email,
  } as AppAuthProfile;
}
