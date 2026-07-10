export type InventoryCategory = string;

export type InventoryStatus = 'active' | 'retired';

export type InventoryRetireReason = 'Sold' | 'Scrapped' | 'Lost' | 'Damaged' | 'Returned' | 'Other';

export type InventoryCheckStatus = 'ok' | 'due_soon' | 'overdue' | 'needs_check' | 'not_required';

export type FleetAssetLinkType = 'van' | 'hgv' | 'plant';

export type InventoryLocationType = 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual';

export type InventoryLocationSourceType = 'system' | 'fleet' | 'quote' | 'project_number' | 'legacy_quote' | 'manual';

export type InventoryLocationSyncStatus = 'manual' | 'synced' | 'needs_review' | 'archived';

export interface InventoryLocation {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
  location_type: InventoryLocationType;
  source_type: InventoryLocationSourceType | null;
  source_id: string | null;
  external_reference: string | null;
  sync_status: InventoryLocationSyncStatus;
  source_synced_at: string | null;
  item_count?: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  linked_asset_type?: FleetAssetLinkType | null;
  linked_asset_label?: string | null;
  linked_asset_nickname?: string | null;
  assigned_user_names?: string[];
}

export interface CurrentFleetAssignment {
  id: string;
  user_id: string;
  asset_type: FleetAssetLinkType;
  asset_id: string;
  asset_label: string | null;
  asset_nickname: string | null;
  source_location_id: string | null;
  assigned_at: string;
}

export interface InventoryItemCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  item_count?: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemCategoryFormData {
  name: string;
  slug: string;
  description: string;
  sort_order: string;
}

export interface InventoryItem {
  id: string;
  item_number: string;
  item_number_normalized: string;
  name: string;
  category: InventoryCategory;
  location_id: string;
  location?: InventoryLocation | null;
  last_checked_at: string | null;
  check_interval_days: number | null;
  status: InventoryStatus;
  retired_at: string | null;
  retire_reason: InventoryRetireReason | null;
  retired_by: string | null;
  source: string | null;
  source_reference: string | null;
  source_location_hint?: string | null;
  source_location_rows?: string | null;
  unknown_location_entered_at?: string | null;
  minor_plant_detail?: InventoryMinorPlantDetail | null;
  group?: InventoryItemGroupSummary | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface InventoryMinorPlantDetail {
  id: string;
  inventory_item_id: string;
  source_plant_id: string | null;
  plant_identifier: string | null;
  make: string | null;
  model: string | null;
  reg_number: string | null;
  year: number | null;
  weight_class: string | null;
  serial_number?: string | null;
  copied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemFormData {
  item_number: string;
  name: string;
  category: InventoryCategory;
  location_id: string;
  last_checked_at: string;
  check_interval_months: string;
  status: InventoryStatus;
}

export interface InventoryLocationFormData {
  name: string;
  description: string;
  linked_asset_type: FleetAssetLinkType | 'none';
  linked_asset_id: string;
}

export interface FleetAssetOption {
  id: string;
  type: FleetAssetLinkType;
  label: string;
  description: string | null;
}

export interface InventoryMovePayload {
  location_id: string;
  note: string;
  scope?: 'single' | 'bulk' | 'group' | 'claim';
  group_id?: string | null;
}

export interface InventoryItemGroupSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface InventoryGroupMember {
  id: string;
  item_id: string;
  item?: InventoryItem | null;
}

export interface InventoryItemGroup {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
  members?: InventoryGroupMember[];
  created_at: string;
  updated_at: string;
}

export interface InventoryUserLocation {
  user_id: string;
  location_id: string | null;
  change_reason?: string | null;
  location?: InventoryLocation | null;
}

export interface InventoryUserSiteLocation {
  user_id: string;
  location_id: string;
  assigned_by: string | null;
  assigned_at: string;
  note: string | null;
  location?: InventoryLocation | null;
}

export interface InventoryContext {
  user_id: string;
  is_manager_or_admin: boolean;
  can_manage_site_locations?: boolean;
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  team_id: string | null;
  team_name: string | null;
  user_location: InventoryUserLocation | null;
  secondary_site_locations?: InventoryUserSiteLocation[];
  is_user_location_valid?: boolean;
  current_fleet_assignment?: CurrentFleetAssignment | null;
}

export const INVENTORY_CATEGORY_LABELS: Record<string, string> = {
  hired_plant: 'Hired Plant',
  signs: 'Signs',
  minor_plant: 'Minor Plant',
  site_items: 'Site Items',
  van_stock: 'Van Stock',
  tools: 'Tools',
  equipment: 'Equipment',
  unknown: 'Unknown',
};

export const INVENTORY_RETIRE_REASONS: InventoryRetireReason[] = [
  'Sold',
  'Scrapped',
  'Lost',
  'Damaged',
  'Returned',
  'Other',
];

export function isInventoryRetireReason(value: unknown): value is InventoryRetireReason {
  return typeof value === 'string' && INVENTORY_RETIRE_REASONS.includes(value as InventoryRetireReason);
}

export function formatInventoryCategoryLabel(
  category: InventoryCategory,
  labels: Record<string, string> = INVENTORY_CATEGORY_LABELS
): string {
  return labels[category] || category.replace(/_/g, ' ');
}

export const EMPTY_INVENTORY_ITEM_FORM: InventoryItemFormData = {
  item_number: '',
  name: '',
  category: 'van_stock',
  location_id: '',
  last_checked_at: '',
  check_interval_months: '',
  status: 'active',
};

export const EMPTY_INVENTORY_LOCATION_FORM: InventoryLocationFormData = {
  name: '',
  description: '',
  linked_asset_type: 'none',
  linked_asset_id: '',
};
