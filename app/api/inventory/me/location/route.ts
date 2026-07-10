import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { canShareInventoryPrimaryLocation } from '@/app/(dashboard)/inventory/utils';
import {
  clearUserInventoryLocationWithFleetAssignment,
  getCurrentFleetAssignmentSummary,
  setUserInventoryLocationWithFleetAssignment,
} from '@/lib/server/profile-fleet-assignments';

interface UpdateLocationBody {
  location_id?: string;
  change_reason?: string | null;
}

interface ExistingUserLocationRow {
  location_id: string | null;
  location?: { is_active: boolean | null } | { is_active: boolean | null }[] | null;
}

interface InventoryLocationRow {
  id: string;
  name: string;
  location_type: 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual';
  is_active: boolean | null;
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
}

function pickExistingLocation(
  location: ExistingUserLocationRow['location']
): { is_active: boolean | null } | null {
  if (!location) return null;
  return Array.isArray(location) ? location[0] ?? null : location;
}

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [{ data, error }, currentFleetAssignment] = await Promise.all([
      admin
      .from('inventory_user_locations')
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .maybeSingle(),
      getCurrentFleetAssignmentSummary(admin, access.userId),
    ]);

    if (error) throw error;

    return NextResponse.json({
      user_location: data || null,
      current_fleet_assignment: currentFleetAssignment,
    });
  } catch (error) {
    console.error('Error fetching user inventory location:', error);
    return NextResponse.json({ error: 'Failed to fetch user inventory location' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as UpdateLocationBody;
    const locationId = body.location_id?.trim();
    const changeReason = body.change_reason?.trim() || null;
    if (!locationId) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: location, error: locationError } = await admin
      .from('inventory_locations')
      .select('id, name, location_type, is_active, linked_van_id, linked_hgv_id, linked_plant_id')
      .eq('id', locationId)
      .maybeSingle();

    if (locationError) throw locationError;
    const typedLocation = location as InventoryLocationRow | null;
    if (!typedLocation?.is_active) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }
    if (typedLocation.location_type === 'site') {
      return NextResponse.json(
        { error: 'Site locations can only be assigned as secondary locations by a supervisor or higher' },
        { status: 400 }
      );
    }

    const canShareLocation = canShareInventoryPrimaryLocation(typedLocation, {
      teamId: access.teamId,
      teamName: access.teamName,
    });
    if (!canShareLocation) {
      const { data: conflictingAssignments, error: conflictError } = await admin
        .from('inventory_user_locations')
        .select('user_id')
        .eq('location_id', locationId)
        .neq('user_id', access.userId)
        .limit(1);

      if (conflictError) throw conflictError;
      if ((conflictingAssignments || []).length > 0) {
        return NextResponse.json({ error: 'Location is already assigned to another user' }, { status: 400 });
      }
    }

    const { data: existingUserLocation, error: existingError } = await admin
      .from('inventory_user_locations')
      .select(`
        location_id,
        location:inventory_locations(is_active)
      `)
      .eq('user_id', access.userId)
      .maybeSingle();

    if (existingError) throw existingError;
    const typedExistingUserLocation = existingUserLocation as ExistingUserLocationRow | null;
    const existingLocation = pickExistingLocation(typedExistingUserLocation?.location);
    const hasActiveExistingLocation =
      Boolean(typedExistingUserLocation?.location_id) && existingLocation?.is_active !== false;

    if (typedExistingUserLocation?.location_id === locationId && hasActiveExistingLocation) {
      return NextResponse.json({ error: 'This location is already selected' }, { status: 400 });
    }
    if (hasActiveExistingLocation && !changeReason) {
      return NextResponse.json({ error: 'Reason for changing location is required' }, { status: 400 });
    }

    await setUserInventoryLocationWithFleetAssignment(admin, {
      userId: access.userId,
      locationId,
      changeReason,
      actorUserId: access.userId,
    });

    const [{ data, error }, currentFleetAssignment] = await Promise.all([
      admin
      .from('inventory_user_locations')
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .single(),
      getCurrentFleetAssignmentSummary(admin, access.userId),
    ]);

    if (error) throw error;

    return NextResponse.json({
      user_location: data,
      current_fleet_assignment: currentFleetAssignment,
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'This fleet asset is already assigned to another user' }, { status: 400 });
    }
    console.error('Error updating user inventory location:', error);
    return NextResponse.json({ error: 'Failed to update user inventory location' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    await clearUserInventoryLocationWithFleetAssignment(admin, {
      userId: access.userId,
      actorUserId: access.userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error unsetting user inventory location:', error);
    return NextResponse.json({ error: 'Failed to unset user inventory location' }, { status: 500 });
  }
}
