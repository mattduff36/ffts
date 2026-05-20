import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface UpdateLocationBody {
  location_id?: string;
  change_reason?: string | null;
}

interface ExistingUserLocationRow {
  location_id: string | null;
  location?: { is_active: boolean | null } | { is_active: boolean | null }[] | null;
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

    return NextResponse.json({ user_location: data || null });
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
      .select('id, is_active')
      .eq('id', locationId)
      .maybeSingle();

    if (locationError) throw locationError;
    if (!location?.is_active) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
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

    const { data, error } = await admin
      .from('inventory_user_locations')
      .upsert({
        user_id: access.userId,
        location_id: locationId,
        change_reason: changeReason,
        updated_by: access.userId,
      }, { onConflict: 'user_id' })
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ user_location: data });
  } catch (error) {
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

    const { error } = await createAdminClient()
      .from('inventory_user_locations')
      .delete()
      .eq('user_id', access.userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error unsetting user inventory location:', error);
    return NextResponse.json({ error: 'Failed to unset user inventory location' }, { status: 500 });
  }
}
