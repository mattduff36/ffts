import { describe, expect, it } from 'vitest';
import {
  INVENTORY_PAT_CHECKLIST_ITEMS,
  INVENTORY_PAT_CHECKLIST_VERSION,
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  getInventoryChecklistDefinition,
  getInventoryChecklistLabel,
  getInventoryCheckOverallStatus,
  getInventoryChecklistSummary,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

describe('inventory service checklist', () => {
  it('preserves the scanned form item numbering and omits the blank row', () => {
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS).toHaveLength(27);
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item) => item.item_number)).not.toContain(27);
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.at(0)).toEqual({ item_number: 1, label: 'Spark Plug' });
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.at(-1)).toEqual({ item_number: 28, label: 'Oil Level' });
  });

  it('defines the PAT checklist items and label', () => {
    expect(INVENTORY_PAT_CHECKLIST_ITEMS).toEqual([
      { item_number: 1, label: 'Cable' },
      { item_number: 2, label: 'Appliance' },
      { item_number: 3, label: 'Plug (Ext/Int)' },
      { item_number: 4, label: 'Earth' },
      { item_number: 5, label: 'Insulation' },
      { item_number: 6, label: 'Polarity' },
    ]);
    expect(getInventoryChecklistLabel(INVENTORY_PAT_CHECKLIST_VERSION)).toBe('PAT Test');
  });

  it('summarises checklist results and derives an overall result', () => {
    const results: InventoryChecklistItemResult[] = INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index === 0 ? 'attention' : index === 1 ? 'na' : 'ok',
      comment: index === 0 ? 'Needs replacement' : null,
    }));

    expect(getInventoryChecklistSummary(results)).toEqual({
      pass: 25,
      fail: 1,
      na: 1,
      total: 27,
    });
    expect(getInventoryCheckOverallStatus(results)).toBe('fail');
  });

  it('marks complete all-pass or not-applicable checklists as pass', () => {
    const results: InventoryChecklistItemResult[] = INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index % 3 === 0 ? 'na' : 'ok',
      comment: null,
    }));

    expect(getInventoryCheckOverallStatus(results)).toBe('pass');
  });

  it('derives PAT checklist status using the PAT definition length', () => {
    const patDefinition = getInventoryChecklistDefinition(INVENTORY_PAT_CHECKLIST_VERSION);
    if (!patDefinition) throw new Error('PAT checklist definition missing');

    const results: InventoryChecklistItemResult[] = INVENTORY_PAT_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index === 0 ? 'attention' : 'ok',
      comment: index === 0 ? 'Cable damaged' : null,
    }));

    expect(getInventoryCheckOverallStatus(results, patDefinition)).toBe('fail');
  });
});
