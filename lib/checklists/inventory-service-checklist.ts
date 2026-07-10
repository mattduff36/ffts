export const INVENTORY_SERVICE_CHECKLIST_VERSION = 'minor-plant-equipment-service-record-v1';
export const INVENTORY_PAT_CHECKLIST_VERSION = 'portable-appliance-test-v1';

export type InventoryChecklistStatus = 'ok' | 'attention' | 'na';

export type InventoryCheckOverallStatus = 'pass' | 'fail' | 'partial';

export interface InventoryServiceChecklistItem {
  item_number: number;
  label: string;
}

export interface InventoryChecklistDefinition {
  version: string;
  label: string;
  modalTitle: string;
  modalDescription: string;
  pdfTitle: string;
  pdfSubtitle: string;
  items: InventoryServiceChecklistItem[];
}

export interface InventoryChecklistItemResult extends InventoryServiceChecklistItem {
  status: InventoryChecklistStatus;
  comment: string | null;
}

export interface InventoryChecklistSummary {
  pass: number;
  fail: number;
  na: number;
  total: number;
}

export const INVENTORY_SERVICE_CHECKLIST_ITEMS: InventoryServiceChecklistItem[] = [
  { item_number: 1, label: 'Spark Plug' },
  { item_number: 2, label: 'HT Lead and Plug Cover' },
  { item_number: 3, label: 'Pre Filter' },
  { item_number: 4, label: 'Main Filter' },
  { item_number: 5, label: 'Pull cord' },
  { item_number: 6, label: 'Fuel System' },
  { item_number: 7, label: 'Vibration Suppression' },
  { item_number: 8, label: 'Fuel Cap Vent' },
  { item_number: 9, label: 'Fuel Cap' },
  { item_number: 10, label: 'Spray Suppression' },
  { item_number: 11, label: 'Carrying Handles' },
  { item_number: 12, label: 'Handle Control Bars' },
  { item_number: 13, label: 'Safety Shields' },
  { item_number: 14, label: 'Base Plate Condition' },
  { item_number: 15, label: 'Couplings' },
  { item_number: 16, label: 'Point Holding Device' },
  { item_number: 17, label: 'Air Seals' },
  { item_number: 18, label: 'Throttle Cable' },
  { item_number: 19, label: 'Water Hose & Unions' },
  { item_number: 20, label: 'Floor Saw Location Bolts' },
  { item_number: 21, label: 'Service Record Complete' },
  { item_number: 22, label: 'Plant Tag Fitted and Complete' },
  { item_number: 23, label: 'Plant Number Legible' },
  { item_number: 24, label: 'Next Service Date Complete' },
  { item_number: 25, label: 'Cutting Head Aligned' },
  { item_number: 26, label: 'Blade Cover Debris Free' },
  { item_number: 28, label: 'Oil Level' },
];

export const INVENTORY_PAT_CHECKLIST_ITEMS: InventoryServiceChecklistItem[] = [
  { item_number: 1, label: 'Cable' },
  { item_number: 2, label: 'Appliance' },
  { item_number: 3, label: 'Plug (Ext/Int)' },
  { item_number: 4, label: 'Earth' },
  { item_number: 5, label: 'Insulation' },
  { item_number: 6, label: 'Polarity' },
];

export const INVENTORY_CHECKLIST_DEFINITIONS: InventoryChecklistDefinition[] = [
  {
    version: INVENTORY_SERVICE_CHECKLIST_VERSION,
    label: 'Regular Check',
    modalTitle: 'Record Regular Check',
    modalDescription: 'Complete the service checklist for this inventory item.',
    pdfTitle: 'Inventory Regular Check',
    pdfSubtitle: 'Minor Plant and Equipment Service Record',
    items: INVENTORY_SERVICE_CHECKLIST_ITEMS,
  },
  {
    version: INVENTORY_PAT_CHECKLIST_VERSION,
    label: 'PAT Test',
    modalTitle: 'Record PAT Test',
    modalDescription: 'Complete the Portable Appliance Testing checklist for this inventory item.',
    pdfTitle: 'Inventory PAT Test',
    pdfSubtitle: 'Portable Appliance Testing Record',
    items: INVENTORY_PAT_CHECKLIST_ITEMS,
  },
];

export const INVENTORY_CHECKLIST_STATUS_LABELS: Record<InventoryChecklistStatus, string> = {
  ok: 'Pass',
  attention: 'Fail',
  na: 'N/A',
};

export const INVENTORY_CHECK_OVERALL_STATUS_LABELS: Record<InventoryCheckOverallStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  partial: 'Partial',
};

export function isInventoryChecklistStatus(value: unknown): value is InventoryChecklistStatus {
  return value === 'ok' || value === 'attention' || value === 'na';
}

export function getInventoryChecklistSummary(items: InventoryChecklistItemResult[]): InventoryChecklistSummary {
  return items.reduce<InventoryChecklistSummary>(
    (summary, item) => {
      if (item.status === 'ok') summary.pass += 1;
      if (item.status === 'attention') summary.fail += 1;
      if (item.status === 'na') summary.na += 1;
      return summary;
    },
    { pass: 0, fail: 0, na: 0, total: items.length },
  );
}

export function getInventoryChecklistDefinition(version: string | null | undefined): InventoryChecklistDefinition | null {
  if (!version) return null;
  return INVENTORY_CHECKLIST_DEFINITIONS.find((definition) => definition.version === version) || null;
}

export function getInventoryChecklistLabel(version: string | null | undefined): string {
  return getInventoryChecklistDefinition(version)?.label || 'Inventory Check';
}

export function getInventoryCheckOverallStatus(
  items: InventoryChecklistItemResult[],
  definition: InventoryChecklistDefinition = INVENTORY_CHECKLIST_DEFINITIONS[0],
): InventoryCheckOverallStatus {
  if (items.length !== definition.items.length) return 'partial';
  return items.some((item) => item.status === 'attention') ? 'fail' : 'pass';
}
