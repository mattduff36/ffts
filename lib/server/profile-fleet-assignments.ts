import type { Database } from '@/types/database';
import { type InventoryAdminClient, type InventoryLocationRow } from './inventory-locations';

export type ProfileFleetAssignmentRow = Database['public']['Tables']['profile_fleet_assignments']['Row'];

export interface CurrentFleetAssignmentSummary {
  id: string;
  user_id: string;
  asset_type: 'van' | 'hgv' | 'plant';
  asset_id: string;
  asset_label: string | null;
  asset_nickname: string | null;
  source_location_id: string | null;
  assigned_at: string;
}

interface CurrentFleetAssignmentRelation extends ProfileFleetAssignmentRow {
  van?: { reg_number: string | null; nickname: string | null } | { reg_number: string | null; nickname: string | null }[] | null;
  hgv?: { reg_number: string | null; nickname: string | null } | { reg_number: string | null; nickname: string | null }[] | null;
  plant?: { plant_id: string | null; reg_number: string | null; nickname: string | null } | { plant_id: string | null; reg_number: string | null; nickname: string | null }[] | null;
}

function pickRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

export function summarizeFleetAssignment(
  assignment: CurrentFleetAssignmentRelation | null
): CurrentFleetAssignmentSummary | null {
  if (!assignment) return null;

  if (assignment.linked_van_id) {
    const van = pickRelation(assignment.van);
    return {
      id: assignment.id,
      user_id: assignment.user_id,
      asset_type: 'van',
      asset_id: assignment.linked_van_id,
      asset_label: van?.reg_number || null,
      asset_nickname: van?.nickname || null,
      source_location_id: assignment.source_location_id,
      assigned_at: assignment.assigned_at,
    };
  }

  if (assignment.linked_hgv_id) {
    const hgv = pickRelation(assignment.hgv);
    return {
      id: assignment.id,
      user_id: assignment.user_id,
      asset_type: 'hgv',
      asset_id: assignment.linked_hgv_id,
      asset_label: hgv?.reg_number || null,
      asset_nickname: hgv?.nickname || null,
      source_location_id: assignment.source_location_id,
      assigned_at: assignment.assigned_at,
    };
  }

  const plant = pickRelation(assignment.plant);
  return {
    id: assignment.id,
    user_id: assignment.user_id,
    asset_type: 'plant',
    asset_id: assignment.linked_plant_id || '',
    asset_label: plant?.reg_number || plant?.plant_id || null,
    asset_nickname: plant?.nickname || null,
    source_location_id: assignment.source_location_id,
    assigned_at: assignment.assigned_at,
  };
}

export async function setUserInventoryLocationWithFleetAssignment(
  admin: InventoryAdminClient,
  payload: {
    userId: string;
    locationId: string;
    changeReason: string | null;
    actorUserId: string;
  }
) {
  const { error } = await admin.rpc('inventory_set_user_location_with_assignment', {
    p_user_id: payload.userId,
    p_location_id: payload.locationId,
    p_change_reason: payload.changeReason,
    p_actor_user_id: payload.actorUserId,
  });

  if (error) throw error;
}

export async function clearUserInventoryLocationWithFleetAssignment(
  admin: InventoryAdminClient,
  payload: {
    userId: string;
    actorUserId: string;
  }
) {
  const { error } = await admin.rpc('inventory_clear_user_location_with_assignment', {
    p_user_id: payload.userId,
    p_actor_user_id: payload.actorUserId,
  });

  if (error) throw error;
}

export async function getCurrentFleetAssignmentSummary(
  admin: InventoryAdminClient,
  userId: string
): Promise<CurrentFleetAssignmentSummary | null> {
  const { data, error } = await admin
    .from('profile_fleet_assignments')
    .select(`
      *,
      van:vans!profile_fleet_assignments_linked_van_id_fkey(reg_number, nickname),
      hgv:hgvs!profile_fleet_assignments_linked_hgv_id_fkey(reg_number, nickname),
      plant:plant!profile_fleet_assignments_linked_plant_id_fkey(plant_id, reg_number, nickname)
    `)
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle();

  if (error) throw error;
  return summarizeFleetAssignment(data as CurrentFleetAssignmentRelation | null);
}

export function describeLocationFleetAssignmentChange(
  location: Pick<InventoryLocationRow, 'linked_van_id' | 'linked_hgv_id' | 'linked_plant_id'> | null | undefined
): 'set' | 'clear' {
  return location?.linked_van_id || location?.linked_hgv_id || location?.linked_plant_id ? 'set' : 'clear';
}
