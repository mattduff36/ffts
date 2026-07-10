import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isInventorySupervisorOrHigher, requireInventoryAccess } from '@/lib/server/inventory-auth';
import { getCurrentFleetAssignmentSummary } from '@/lib/server/profile-fleet-assignments';
import type { Database } from '@/types/database';

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];
type InventoryUserSiteLocationRow = Database['public']['Tables']['inventory_user_site_locations']['Row'];

interface InventoryContextUserLocationRow {
  location_id: string | null;
  location?: { is_active: boolean | null; location_type?: string | null } | Array<{ is_active: boolean | null; location_type?: string | null }> | null;
}

interface InventoryContextSiteLocationRow extends InventoryUserSiteLocationRow {
  location?: InventoryLocationRow | InventoryLocationRow[] | null;
}

function pickUserLocationRelation(
  location: InventoryContextUserLocationRow['location']
): { is_active: boolean | null; location_type?: string | null } | null {
  if (!location) return null;
  return Array.isArray(location) ? location[0] ?? null : location;
}

function pickSiteLocationRelation(
  location: InventoryContextSiteLocationRow['location']
): InventoryLocationRow | null {
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
    const [{ data, error }, { data: siteLocationRows, error: siteLocationsError }, currentFleetAssignment] = await Promise.all([
      admin
      .from('inventory_user_locations')
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .maybeSingle(),
      admin
      .from('inventory_user_site_locations')
      .select(`
        user_id,
        location_id,
        assigned_by,
        assigned_at,
        note,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .order('assigned_at', { ascending: false }),
      getCurrentFleetAssignmentSummary(admin, access.userId),
    ]);

    if (error) throw error;
    if (siteLocationsError) throw siteLocationsError;
    const userLocation = (data || null) as InventoryContextUserLocationRow | null;
    const location = pickUserLocationRelation(userLocation?.location);
    const isUserLocationValid = Boolean(
      userLocation?.location_id &&
      location?.is_active !== false &&
      location?.location_type !== 'site'
    );
    const secondarySiteLocations = ((siteLocationRows || []) as unknown as InventoryContextSiteLocationRow[])
      .map((row) => ({
        ...row,
        location: pickSiteLocationRelation(row.location),
      }))
      .filter((row) => row.location?.is_active === true && row.location.location_type === 'site');

    return NextResponse.json({
      user_id: access.userId,
      is_manager_or_admin: access.isManagerOrAdmin === true,
      can_manage_site_locations: isInventorySupervisorOrHigher(access),
      role_name: access.roleName,
      role_class: access.roleClass,
      team_id: access.teamId,
      team_name: access.teamName,
      user_location: userLocation,
      secondary_site_locations: secondarySiteLocations,
      is_user_location_valid: isUserLocationValid,
      current_fleet_assignment: currentFleetAssignment,
    });
  } catch (error) {
    console.error('Error fetching inventory context:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory context' }, { status: 500 });
  }
}
