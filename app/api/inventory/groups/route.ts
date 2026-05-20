import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface CreateInventoryGroupBody {
  name?: string;
  description?: string | null;
  item_ids?: string[];
}

function cleanItemIds(itemIds: string[] | undefined): string[] {
  return Array.from(new Set((itemIds || []).map((id) => id.trim()).filter(Boolean)));
}

export async function GET() {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_item_groups')
      .select(`
        *,
        members:inventory_item_group_members(
          id,
          item_id,
          item:inventory_items(
            id,
            item_number,
            name,
            location_id,
            location:inventory_locations(id, name)
          )
        )
      `)
      .eq('status', 'active')
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ groups: data || [] });
  } catch (error) {
    console.error('Error fetching inventory groups:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory groups' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as CreateInventoryGroupBody;
    const name = body.name?.trim();
    const itemIds = cleanItemIds(body.item_ids);

    if (!name) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: group, error: groupError } = await admin
      .from('inventory_item_groups')
      .insert({
        name,
        description: body.description?.trim() || null,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('*')
      .single();

    if (groupError || !group?.id) {
      if (groupError?.code === '23505') {
        return NextResponse.json({ error: 'An active group with this name already exists' }, { status: 400 });
      }
      throw groupError || new Error('Failed to create inventory group');
    }

    if (itemIds.length > 0) {
      const { error: membersError } = await admin
        .from('inventory_item_group_members')
        .insert(itemIds.map((itemId) => ({
          group_id: group.id,
          item_id: itemId,
          created_by: access.userId,
        })));

      if (membersError) {
        if (membersError.code === '23505') {
          return NextResponse.json({ error: 'One or more selected items already belong to a group' }, { status: 400 });
        }
        throw membersError;
      }
    }

    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory group:', error);
    return NextResponse.json({ error: 'Failed to create inventory group' }, { status: 500 });
  }
}
