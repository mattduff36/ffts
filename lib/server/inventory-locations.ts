import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type InventoryLocationType = Database['public']['Tables']['inventory_locations']['Row']['location_type'];
export type InventoryLocationSourceType = Database['public']['Tables']['inventory_locations']['Row']['source_type'];
export type InventoryLocationSyncStatus = Database['public']['Tables']['inventory_locations']['Row']['sync_status'];
export type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];
export type FleetAssetType = 'van' | 'hgv' | 'plant';

export interface InventoryLinkedAsset {
  type: FleetAssetType;
  id: string;
}

export interface LinkedAssetColumns {
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
}

export type InventoryAdminClient = SupabaseClient<Database>;

export function getInventoryLinkedAsset(location: Pick<
  InventoryLocationRow,
  'linked_van_id' | 'linked_hgv_id' | 'linked_plant_id'
>): InventoryLinkedAsset | null {
  if (location.linked_van_id) return { type: 'van', id: location.linked_van_id };
  if (location.linked_hgv_id) return { type: 'hgv', id: location.linked_hgv_id };
  if (location.linked_plant_id) return { type: 'plant', id: location.linked_plant_id };
  return null;
}

export function buildLinkedAssetColumns(
  linkedAssetType: FleetAssetType | 'none' | null | undefined,
  linkedAssetId: string | null | undefined
): LinkedAssetColumns {
  const assetId = linkedAssetId?.trim() || null;

  return {
    linked_van_id: linkedAssetType === 'van' ? assetId : null,
    linked_hgv_id: linkedAssetType === 'hgv' ? assetId : null,
    linked_plant_id: linkedAssetType === 'plant' ? assetId : null,
  };
}

export function getLocationTypeForLinkedAsset(linkedAssetType: FleetAssetType | 'none' | null | undefined): InventoryLocationType {
  if (linkedAssetType === 'van') return 'van';
  if (linkedAssetType === 'hgv') return 'hgv';
  if (linkedAssetType === 'plant') return 'plant';
  return 'manual';
}

export function buildFleetLocationName(assetType: FleetAssetType, assetReference: string): string {
  const trimmedReference = assetReference.trim();
  if (assetType === 'van') return `Van - ${trimmedReference}`;
  if (assetType === 'hgv') return `HGV - ${trimmedReference}`;
  return `Plant - ${trimmedReference}`;
}

export function normalizeExternalReference(reference: string | null | undefined): string | null {
  const trimmed = reference?.trim().toUpperCase();
  return trimmed || null;
}

export function isGeneratedInventoryLocation(location: Pick<InventoryLocationRow, 'location_type'>): boolean {
  return ['van', 'hgv', 'plant', 'site', 'yard', 'unknown'].includes(location.location_type);
}

export function canManuallyRelinkInventoryLocation(location: Pick<InventoryLocationRow, 'location_type'>): boolean {
  return location.location_type === 'manual';
}

export async function loadInventoryLocationById(
  admin: InventoryAdminClient,
  locationId: string
): Promise<InventoryLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .eq('id', locationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
