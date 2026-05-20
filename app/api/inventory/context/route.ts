import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_user_locations')
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      user_id: access.userId,
      is_manager_or_admin: access.isManagerOrAdmin === true,
      role_name: access.roleName,
      role_class: access.roleClass,
      user_location: data || null,
    });
  } catch (error) {
    console.error('Error fetching inventory context:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory context' }, { status: 500 });
  }
}
