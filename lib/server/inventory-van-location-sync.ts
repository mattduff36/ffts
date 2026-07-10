import {
  buildFleetLocationName,
  type InventoryAdminClient,
  type InventoryLocationRow,
} from './inventory-locations';

interface ActiveVanRow {
  id: string;
  reg_number: string;
  nickname: string | null;
}

export interface VanLocationSyncResult {
  active_van_count: number;
  created_count: number;
  updated_count: number;
  reactivated_count: number;
  unchanged_count: number;
  location_ids: string[];
}

function buildVanDescription(van: ActiveVanRow): string | null {
  return van.nickname?.trim() ? `Synced from active fleet van: ${van.nickname.trim()}` : 'Synced from active fleet van.';
}

async function loadLocationsByLinkedVanId(
  admin: InventoryAdminClient
): Promise<Map<string, InventoryLocationRow>> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .not('linked_van_id', 'is', null)
    .order('is_active', { ascending: false });

  if (error) throw error;

  const locationsByVanId = new Map<string, InventoryLocationRow>();
  (data || []).forEach((location) => {
    if (!location.linked_van_id || locationsByVanId.has(location.linked_van_id)) return;
    locationsByVanId.set(location.linked_van_id, location);
  });
  return locationsByVanId;
}

export async function syncActiveVanInventoryLocations(
  admin: InventoryAdminClient,
  actorUserId: string | null = null,
  options: { dryRun?: boolean } = {}
): Promise<VanLocationSyncResult> {
  const { data: vans, error: vansError } = await admin
    .from('vans')
    .select('id, reg_number, nickname')
    .eq('status', 'active')
    .order('reg_number', { ascending: true });

  if (vansError) throw vansError;

  const activeVans = (vans || []) as ActiveVanRow[];
  const locationsByVanId = await loadLocationsByLinkedVanId(admin);
  const result: VanLocationSyncResult = {
    active_van_count: activeVans.length,
    created_count: 0,
    updated_count: 0,
    reactivated_count: 0,
    unchanged_count: 0,
    location_ids: [],
  };

  for (const van of activeVans) {
    const existingLocation = locationsByVanId.get(van.id);
    const name = buildFleetLocationName('van', van.reg_number);
    const description = buildVanDescription(van);
    const update = {
      name,
      description,
      is_active: true,
      location_type: 'van' as const,
      source_type: 'fleet' as const,
      sync_status: 'synced' as const,
      source_synced_at: new Date().toISOString(),
      linked_van_id: van.id,
      linked_hgv_id: null,
      linked_plant_id: null,
      updated_by: actorUserId,
    };

    if (existingLocation) {
      const shouldUpdate =
        existingLocation.name !== name ||
        existingLocation.description !== description ||
        existingLocation.is_active !== true ||
        existingLocation.location_type !== 'van' ||
        existingLocation.source_type !== 'fleet' ||
        existingLocation.sync_status !== 'synced';

      if (shouldUpdate) {
        if (options.dryRun) {
          result.location_ids.push(existingLocation.id);
          if (existingLocation.is_active) result.updated_count += 1;
          else result.reactivated_count += 1;
          continue;
        }

        const { data: updated, error } = await admin
          .from('inventory_locations')
          .update(update)
          .eq('id', existingLocation.id)
          .select('id, is_active')
          .single();

        if (error) throw error;
        result.location_ids.push(updated.id);
        if (existingLocation.is_active) result.updated_count += 1;
        else result.reactivated_count += 1;
      } else {
        result.location_ids.push(existingLocation.id);
        result.unchanged_count += 1;
      }
      continue;
    }

    if (options.dryRun) {
      result.created_count += 1;
      continue;
    }

    const { data: created, error } = await admin
      .from('inventory_locations')
      .insert({
        ...update,
        created_by: actorUserId,
      })
      .select('id')
      .single();

    if (error) throw error;
    result.location_ids.push(created.id);
    result.created_count += 1;
  }

  return result;
}
