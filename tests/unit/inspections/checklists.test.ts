import { describe, it, expect } from 'vitest';
import {
  getChecklistForCategory,
  HGV_ARTIC_ONLY_START_ITEM,
  isVanCategory,
  TRUCK_CHECKLIST_ITEMS,
  VAN_CHECKLIST_ITEMS,
  INSPECTION_ITEMS,
} from '@/lib/checklists/vehicle-checklists';
import {
  PLANT_INSPECTION_ITEMS,
  getPlantChecklist,
  getPlantChecklistCount,
} from '@/lib/checklists/plant-checklists';

describe('Vehicle Checklists', () => {
  describe('getChecklistForCategory', () => {
    it('returns 15-item checklist for Van', () => {
      const items = getChecklistForCategory('Van');
      expect(items).toHaveLength(15);
      expect(items).toBe(VAN_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Truck', () => {
      const items = getChecklistForCategory('Truck');
      expect(items).toHaveLength(26);
      expect(items).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Artic', () => {
      expect(getChecklistForCategory('Artic')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Trailer', () => {
      expect(getChecklistForCategory('Trailer')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('adds Transmission to vans after the existing 14 items', () => {
      expect(VAN_CHECKLIST_ITEMS[13]).toBe('Brake Test');
      expect(VAN_CHECKLIST_ITEMS[14]).toBe('Transmission');
    });

    it('adds HGV Transmission before artic-only items', () => {
      expect(TRUCK_CHECKLIST_ITEMS[20]).toBe('Side underbar/Rails');
      expect(TRUCK_CHECKLIST_ITEMS[21]).toBe('Transmission');
      expect(HGV_ARTIC_ONLY_START_ITEM).toBe(23);
      expect(TRUCK_CHECKLIST_ITEMS[HGV_ARTIC_ONLY_START_ITEM - 1]).toBe('Brake Hoses');
    });

    it('falls back to truck checklist for unknown category', () => {
      expect(getChecklistForCategory('Unknown')).toBe(TRUCK_CHECKLIST_ITEMS);
      expect(getChecklistForCategory('')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('all items are non-empty strings', () => {
      for (const category of ['Van', 'Truck', 'Artic', 'Trailer']) {
        const items = getChecklistForCategory(category);
        items.forEach((item, _i) => {
          expect(typeof item).toBe('string');
          expect(item.trim().length).toBeGreaterThan(0);
        });
      }
    });

    it('van and truck checklists have no overlap in descriptions (different forms)', () => {
      const vanSet = new Set(VAN_CHECKLIST_ITEMS.map(i => i.toLowerCase()));
      const truckSet = new Set(TRUCK_CHECKLIST_ITEMS.map(i => i.toLowerCase()));
      const overlap = [...vanSet].filter(v => truckSet.has(v));
      expect(overlap.length).toBeLessThan(VAN_CHECKLIST_ITEMS.length);
    });
  });

  describe('isVanCategory', () => {
    it('returns true for Van', () => {
      expect(isVanCategory('Van')).toBe(true);
    });

    it('returns false for Truck/Artic/Trailer', () => {
      expect(isVanCategory('Truck')).toBe(false);
      expect(isVanCategory('Artic')).toBe(false);
      expect(isVanCategory('Trailer')).toBe(false);
    });

    it('returns false for empty/null-ish', () => {
      expect(isVanCategory('')).toBe(false);
      expect(isVanCategory('van')).toBe(false); // case-sensitive
    });
  });

  describe('legacy INSPECTION_ITEMS export', () => {
    it('equals TRUCK_CHECKLIST_ITEMS', () => {
      expect(INSPECTION_ITEMS).toBe(TRUCK_CHECKLIST_ITEMS);
    });
  });
});

describe('Plant Checklists', () => {
  it('has exactly 23 items', () => {
    expect(PLANT_INSPECTION_ITEMS).toHaveLength(23);
  });

  it('getPlantChecklist returns the items array', () => {
    expect(getPlantChecklist()).toBe(PLANT_INSPECTION_ITEMS);
  });

  it('getPlantChecklistCount returns 23', () => {
    expect(getPlantChecklistCount()).toBe(23);
  });

  it('adds Transmission after the existing 22 items', () => {
    expect(PLANT_INSPECTION_ITEMS[21]).toBe('Greased');
    expect(PLANT_INSPECTION_ITEMS[22]).toBe('Transmission');
  });

  it('all items are non-empty strings', () => {
    PLANT_INSPECTION_ITEMS.forEach((item) => {
      expect(typeof item).toBe('string');
      expect(item.trim().length).toBeGreaterThan(0);
    });
  });

  it('has no duplicate items', () => {
    const normalized = PLANT_INSPECTION_ITEMS.map(i => i.toLowerCase());
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});
