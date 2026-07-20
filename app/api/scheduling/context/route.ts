import { NextResponse } from 'next/server';
import { requireSchedulingAccess } from '@/lib/server/scheduling-auth';

export async function GET() {
  try {
    const access = await requireSchedulingAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    return NextResponse.json({
      user_id: access.userId,
      access_level: access.accessLevel || 0,
      is_manager_or_admin: access.isManagerOrAdmin === true,
      role_name: access.roleName || null,
      role_class: access.roleClass || null,
      team_id: access.teamId || null,
      team_name: access.teamName || null,
    });
  } catch (error) {
    console.error('Error loading scheduling context:', error);
    return NextResponse.json(
      { error: 'Unable to verify scheduling access right now.' },
      { status: 503 }
    );
  }
}
