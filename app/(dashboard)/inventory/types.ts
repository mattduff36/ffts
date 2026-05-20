export type InventoryCategory = string;

export type InventoryStatus = 'active' | 'inactive';

export type InventoryCheckStatus = 'ok' | 'due_soon' | 'overdue' | 'needs_check';

export type FleetAssetLinkType = 'van' | 'hgv' | 'plant';

export interface InventoryLocation {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
  item_count?: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  linked_asset_type?: FleetAssetLinkType | null;
  linked_asset_label?: string | null;
  linked_asset_nickname?: string | null;
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
  location_id: string | null;
  location?: InventoryLocation | null;
  last_checked_at: string | null;
  check_interval_days: number | null;
  status: InventoryStatus;
  source: string | null;
  source_reference: string | null;
  source_location_hint?: string | null;
  source_location_rows?: string | null;
  group?: InventoryItemGroupSummary | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface InventoryItemFormData {
  item_number: string;
  name: string;
  category: InventoryCategory;
  location_id: string;
  last_checked_at: string;
  check_interval_days: string;
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

export interface InventoryContext {
  user_id: string;
  is_manager_or_admin: boolean;
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  user_location: InventoryUserLocation | null;
}

export const INVENTORY_CATEGORY_LABELS: Record<string, string> = {
  hired_plant: 'Hired Plant',
  signs: 'Signs',
  minor_plant: 'Minor Plant',
  tools: 'Tools',
  equipment: 'Equipment',
  unknown: 'Unknown',
};

export function formatInventoryCategoryLabel(
  category: InventoryCategory,
  labels: Record<string, string> = INVENTORY_CATEGORY_LABELS
): string {
  return labels[category] || category.replace(/_/g, ' ');
}

export const EMPTY_INVENTORY_ITEM_FORM: InventoryItemFormData = {
  item_number: '',
  name: '',
  category: 'minor_plant',
  location_id: '',
  last_checked_at: '',
  check_interval_days: '',
  status: 'active',
};

export const EMPTY_INVENTORY_LOCATION_FORM: InventoryLocationFormData = {
  name: '',
  description: '',
  linked_asset_type: 'none',
  linked_asset_id: '',
};
