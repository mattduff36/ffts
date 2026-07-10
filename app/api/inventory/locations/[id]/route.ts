import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { INVENTORY_UNKNOWN_LOCATION_NAME, isUnknownInventoryLocationName } from '@/app/(dashboard)/inventory/utils';
import type { FleetAssetLinkType } from '@/app/(dashboard)/inventory/types';
import {
  buildLinkedAssetColumns,
  canManuallyRelinkInventoryLocation,
  getLocationTypeForLinkedAsset,
  isGeneratedInventoryLocation,
} from '@/lib/server/inventory-locations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface LocationUpdateBody {
  name?: string;
  description?: string | null;
  linked_asset_type?: FleetAssetLinkType | 'none';
  linked_asset_id?: string | null;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as LocationUpdateBody;
    const admin = createAdminClient();
    const { data: currentLocation, error: currentLocationError } = await admin
      .from('inventory_locations')
      .select('id, name, location_type')
      .eq('id', id)
      .single();

    if (currentLocationError) {
      if (currentLocationError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Location not found' }, { status: 404 });
      }
      throw currentLocationError;
    }

    if (
      (currentLocation.location_type === 'unknown' || isUnknownInventoryLocationName(currentLocation.name)) &&
      body.name !== undefined &&
      !isUnknownInventoryLocationName(body.name)
    ) {
      return NextResponse.json(
        { error: `${INVENTORY_UNKNOWN_LOCATION_NAME} is a system location and cannot be renamed` },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.linked_asset_type !== undefined) {
      if (!canManuallyRelinkInventoryLocation(currentLocation)) {
        return NextResponse.json(
          { error: 'Generated inventory locations cannot be manually relinked' },
          { status: 400 }
        );
      }
      update.location_type = getLocationTypeForLinkedAsset(body.linked_asset_type);
      update.source_type = body.linked_asset_type === 'none' ? 'manual' : 'fleet';
      update.sync_status = body.linked_asset_type === 'none' ? 'manual' : 'needs_review';
      Object.assign(update, buildLinkedAssetColumns(body.linked_asset_type, body.linked_asset_id));
    }

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

    const { data, error } = await admin
      .from('inventory_locations')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'An active location with this name or linked asset already exists' },
          { status: 400 }
        );
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
    const { data: location, error: locationError } = await admin
      .from('inventory_locations')
      .select('id, name, location_type')
      .eq('id', id)
      .single();

    if (locationError) {
      if (locationError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Location not found' }, { status: 404 });
      }
      throw locationError;
    }

    if (location.location_type === 'unknown' || isUnknownInventoryLocationName(location.name)) {
      return NextResponse.json(
        { error: `${INVENTORY_UNKNOWN_LOCATION_NAME} is a system location and cannot be removed` },
        { status: 400 }
      );
    }

    if (isGeneratedInventoryLocation(location)) {
      return NextResponse.json(
        { error: 'Generated inventory locations are managed by sync and cannot be removed manually' },
        { status: 400 }
      );
    }

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

    const { error: assignmentError } = await admin
      .from('profile_fleet_assignments')
      .update({
        ended_at: new Date().toISOString(),
        ended_by: access.userId,
      })
      .eq('source_location_id', id)
      .is('ended_at', null);

    if (assignmentError) throw assignmentError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing inventory location:', error);
    return NextResponse.json({ error: 'Failed to remove inventory location' }, { status: 500 });
  }
}
