import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule, canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';

export async function requireAbsenceUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
  if (!canAccessAbsence) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Forbidden: Absence access required' }, { status: 403 }),
    };
  }

  return {
    user,
    response: null,
  };
}

export async function requireAdminAbsenceAccess() {
  const auth = await requireAbsenceUser();
  if (auth.response) {
    return auth;
  }

  const isAdmin = await canEffectiveRoleUseModuleLevel('absence', 5);
  if (!isAdmin) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireAdminWorkShiftAccess() {
  return requireAdminAbsenceAccess();
}

export async function requireManagerWorkShiftReadAccess() {
  const auth = await requireAbsenceUser();
  if (auth.response) {
    return auth;
  }

  const canReadTeamWorkShifts = await canEffectiveRoleUseModuleLevel('absence', 3);
  if (!canReadTeamWorkShifts) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Forbidden: Supervisor access required' }, { status: 403 }),
    };
  }

  return auth;
}
