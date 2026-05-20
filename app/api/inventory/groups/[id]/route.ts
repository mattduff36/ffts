import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateInventoryGroupBody {
  name?: string;
  description?: string | null;
  item_ids?: string[];
}

function cleanItemIds(itemIds: string[] | undefined): string[] {
  return Array.from(new Set((itemIds || []).map((id) => id.trim()).filter(Boolean)));
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateInventoryGroupBody;
    const admin = createAdminClient();
    let groupName: string | null = null;
    let groupDescription: string | null = null;

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
      }
      groupName = name;
    }

    if (body.description !== undefined) {
      groupDescription = body.description?.trim() || null;
    }

    const itemIds = body.item_ids === undefined ? [] : cleanItemIds(body.item_ids);
    const { error: groupUpdateError } = await admin.rpc('inventory_update_group_and_members', {
      p_group_id: id,
      p_name: groupName,
      p_should_update_name: body.name !== undefined,
      p_description: groupDescription,
      p_should_update_description: body.description !== undefined,
      p_should_replace_members: body.item_ids !== undefined,
      p_item_ids: itemIds,
      p_actor: access.userId,
    });

    if (groupUpdateError) {
      if (groupUpdateError.code === '23505') {
        if (groupUpdateError.message?.includes('inventory_item_group_members')) {
          return NextResponse.json({ error: 'One or more selected items already belong to another group' }, { status: 400 });
        }
        return NextResponse.json({ error: 'An active group with this name already exists' }, { status: 400 });
      }
      if (groupUpdateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory group not found' }, { status: 404 });
      }
      if (groupUpdateError.code === 'P0001' && groupUpdateError.message?.includes('not found')) {
        return NextResponse.json({ error: 'Inventory group not found' }, { status: 404 });
      }
      if (groupUpdateError.code === 'P0001' && groupUpdateError.message?.includes('Group name is required')) {
        return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
      }
      throw groupUpdateError;
    }

    const { data: group, error: groupFetchError } = await admin
      .from('inventory_item_groups')
      .select('*')
      .eq('id', id)
      .single();

    if (groupFetchError) throw groupFetchError;

    return NextResponse.json({ group });
  } catch (error) {
    console.error('Error updating inventory group:', error);
    return NextResponse.json({ error: 'Failed to update inventory group' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const { error: memberError } = await admin
      .from('inventory_item_group_members')
      .delete()
      .eq('group_id', id);

    if (memberError) throw memberError;

    const { error } = await admin
      .from('inventory_item_groups')
      .update({
        status: 'inactive',
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing inventory group:', error);
    return NextResponse.json({ error: 'Failed to remove inventory group' }, { status: 500 });
  }
}
