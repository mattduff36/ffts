import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventorySupervisorAccess } from '@/lib/server/inventory-auth';
import { getUsersWithPermission } from '@/lib/utils/permissions';
import type { Database } from '@/types/database';

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];
type InventoryUserSiteLocationRow = Database['public']['Tables']['inventory_user_site_locations']['Row'];

const SUPABASE_PAGE_SIZE = 1000;

interface SiteAssignmentRequestBody {
  user_id?: string;
  location_id?: string;
  note?: string | null;
}

interface AssignmentRelationRow extends InventoryUserSiteLocationRow {
  user?: { id: string; full_name: string | null; employee_id: string | null } | Array<{ id: string; full_name: string | null; employee_id: string | null }> | null;
  location?: InventoryLocationRow | InventoryLocationRow[] | null;
}

function pickRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function normalizeAssignment(row: AssignmentRelationRow) {
  return {
    user_id: row.user_id,
    location_id: row.location_id,
    assigned_by: row.assigned_by,
    assigned_at: row.assigned_at,
    note: row.note,
    user: pickRelation(row.user),
    location: pickRelation(row.location),
  };
}

async function loadActiveSiteLocation(
  admin: ReturnType<typeof createAdminClient>,
  locationId: string
): Promise<InventoryLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .eq('id', locationId)
    .eq('location_type', 'site')
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadActiveSiteLocations(
  admin: ReturnType<typeof createAdminClient>
): Promise<InventoryLocationRow[]> {
  const locations: InventoryLocationRow[] = [];

  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const { data, error } = await admin
      .from('inventory_locations')
      .select('*')
      .eq('is_active', true)
      .eq('location_type', 'site')
      .order('name', { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;

    const page = data || [];
    locations.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return locations;
}

export async function GET() {
  try {
    const access = await requireInventorySupervisorAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const inventoryUserIdsPromise = getUsersWithPermission('inventory');
    const activeSitesPromise = loadActiveSiteLocations(admin);
    const assignmentsPromise = admin
      .from('inventory_user_site_locations')
      .select(`
        user_id,
        location_id,
        assigned_by,
        assigned_at,
        note,
        user:profiles!inventory_user_site_locations_user_id_fkey(id, full_name, employee_id),
        location:inventory_locations(*)
      `)
      .order('assigned_at', { ascending: false });

    const [inventoryUserIds, activeSitesResult, assignmentsResult] = await Promise.all([
      inventoryUserIdsPromise,
      activeSitesPromise,
      assignmentsPromise,
    ]);

    if (assignmentsResult.error) throw assignmentsResult.error;

    const activeSites = activeSitesResult;
    const activeSiteIds = new Set(activeSites.map((site) => site.id));
    const users = inventoryUserIds.length > 0
      ? await admin
        .from('profiles')
        .select('id, full_name, employee_id')
        .in('id', inventoryUserIds)
        .order('full_name', { ascending: true })
      : { data: [], error: null };

    if (users.error) throw users.error;

    const assignments = ((assignmentsResult.data || []) as unknown as AssignmentRelationRow[])
      .map(normalizeAssignment)
      .filter((assignment) => activeSiteIds.has(assignment.location_id));

    return NextResponse.json({
      active_sites: activeSites,
      users: users.data || [],
      assignments,
    });
  } catch (error) {
    console.error('Error fetching inventory site assignments:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory site assignments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventorySupervisorAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as SiteAssignmentRequestBody;
    const userId = body.user_id?.trim();
    const locationId = body.location_id?.trim();
    if (!userId || !locationId) {
      return NextResponse.json({ error: 'User and Site location are required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const siteLocation = await loadActiveSiteLocation(admin, locationId);
    if (!siteLocation) {
      return NextResponse.json({ error: 'Active Site location not found' }, { status: 400 });
    }

    const { data, error } = await admin
      .from('inventory_user_site_locations')
      .upsert({
        user_id: userId,
        location_id: locationId,
        assigned_by: access.userId,
        assigned_at: new Date().toISOString(),
        note: body.note?.trim() || null,
      }, { onConflict: 'user_id,location_id' })
      .select('user_id, location_id, assigned_by, assigned_at, note')
      .single();

    if (error) throw error;

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('Error assigning inventory site location:', error);
    return NextResponse.json({ error: 'Failed to assign inventory site location' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireInventorySupervisorAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as SiteAssignmentRequestBody;
    const userId = body.user_id?.trim();
    const locationId = body.location_id?.trim();
    if (!userId || !locationId) {
      return NextResponse.json({ error: 'User and Site location are required' }, { status: 400 });
    }

    const { error } = await createAdminClient()
      .from('inventory_user_site_locations')
      .delete()
      .eq('user_id', userId)
      .eq('location_id', locationId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing inventory site assignment:', error);
    return NextResponse.json({ error: 'Failed to remove inventory site assignment' }, { status: 500 });
  }
}
