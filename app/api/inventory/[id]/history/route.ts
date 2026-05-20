import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const [itemResult, movementsResult, checksResult, groupResult] = await Promise.all([
      admin
        .from('inventory_items')
        .select(`
          *,
          location:inventory_locations(*)
        `)
        .eq('id', id)
        .single(),
      admin
        .from('inventory_item_movements')
        .select(`
          *,
          from_location:inventory_locations!inventory_item_movements_from_location_id_fkey(id, name),
          to_location:inventory_locations!inventory_item_movements_to_location_id_fkey(id, name),
          moved_by_profile:profiles!inventory_item_movements_moved_by_fkey(id, full_name),
          batch:inventory_item_movement_batches(id, move_scope, group_id, created_at, group:inventory_item_groups(id, name))
        `)
        .eq('item_id', id)
        .order('moved_at', { ascending: false }),
      admin
        .from('inventory_check_history')
        .select(`
          *,
          checked_by_profile:profiles!inventory_check_history_checked_by_fkey(id, full_name)
        `)
        .eq('item_id', id)
        .order('checked_at', { ascending: false })
        .order('created_at', { ascending: false }),
      admin
        .from('inventory_item_group_members')
        .select(`
          group:inventory_item_groups(id, name, description, status)
        `)
        .eq('item_id', id)
        .maybeSingle(),
    ]);

    if (itemResult.error) {
      if (itemResult.error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw itemResult.error;
    }
    if (movementsResult.error) throw movementsResult.error;
    if (checksResult.error) throw checksResult.error;
    if (groupResult.error) throw groupResult.error;

    return NextResponse.json({
      item: itemResult.data,
      movements: movementsResult.data || [],
      checks: checksResult.data || [],
      group: groupResult.data?.group || null,
    });
  } catch (error) {
    console.error('Error fetching inventory item history:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory item history' }, { status: 500 });
  }
}
