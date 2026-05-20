import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import type { FleetAssetLinkType } from '@/app/(dashboard)/inventory/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface LocationUpdateBody {
  name?: string;
  description?: string | null;
  linked_asset_type?: FleetAssetLinkType | 'none';
  linked_asset_id?: string | null;
}

function buildLinkedAssetColumns(body: LocationUpdateBody) {
  if (body.linked_asset_type === undefined) return {};

  const linkedAssetType = body.linked_asset_type;
  const linkedAssetId = body.linked_asset_id?.trim() || null;

  return {
    linked_van_id: linkedAssetType === 'van' ? linkedAssetId : null,
    linked_hgv_id: linkedAssetType === 'hgv' ? linkedAssetId : null,
    linked_plant_id: linkedAssetType === 'plant' ? linkedAssetId : null,
  };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as LocationUpdateBody;
    const update: Record<string, unknown> = {
      updated_by: access.userId,
      ...buildLinkedAssetColumns(body),
    };

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Location name is required' }, { status: 400 });
      }
      update.name = name;
    }
    if (body.description !== undefined) {
      update.description = body.description?.trim() || null;
    }

    const { data, error } = await createAdminClient()
      .from('inventory_locations')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An active location with this name already exists' }, { status: 400 });
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Location not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ location: data });
  } catch (error) {
    console.error('Error updating inventory location:', error);
    return NextResponse.json({ error: 'Failed to update inventory location' }, { status: 500 });
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
    const { count, error: countError } = await admin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', id)
      .eq('status', 'active');

    if (countError) throw countError;
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: 'Move all active items out of this location before removing it' },
        { status: 400 }
      );
    }

    const { error } = await admin
      .from('inventory_locations')
      .update({
        is_active: false,
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    const { error: userLocationError } = await admin
      .from('inventory_user_locations')
      .delete()
      .eq('location_id', id);

    if (userLocationError) throw userLocationError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing inventory location:', error);
    return NextResponse.json({ error: 'Failed to remove inventory location' }, { status: 500 });
  }
}
