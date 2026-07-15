import { NextResponse } from 'next/server';
import { requireSchedulingAccess } from '@/lib/server/scheduling-auth';

export async function GET() {
  const access = await requireSchedulingAccess();
  if (!access.allowed || !access.userId) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json({
    user_id: access.userId,
    is_manager_or_admin: access.isManagerOrAdmin === true,
    role_name: access.roleName || null,
    role_class: access.roleClass || null,
    team_id: access.teamId || null,
    team_name: access.teamName || null,
  });
}
