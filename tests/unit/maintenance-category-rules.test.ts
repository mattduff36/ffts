import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_CATEGORY_NAMES,
  categoryAppliesToAsset,
  createMaintenanceCategoryMap,
  getDistanceTypeLabel,
  getMaintenanceCategory,
  getVisibleMaintenanceStatuses,
  isMaintenanceCategoryVisibleOnOverview,
  type MaintenanceCategoryConfig,
} from '@/lib/utils/maintenanceCategoryRules';

function category(overrides: Partial<MaintenanceCategoryConfig> = {}): MaintenanceCategoryConfig {
  return {
    name: 'Service Due',
    applies_to: ['van', 'hgv'],
    is_active: true,
    show_on_overview: true,
    ...overrides,
  };
}

describe('maintenance category rules', () => {
  it('uses default rules to keep cambelt off HGVs when the category row is missing', () => {
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.cambelt)).toBe(false);
    expect(categoryAppliesToAsset(undefined, 'van', MAINTENANCE_CATEGORY_NAMES.cambelt)).toBe(true);
  });

  it('respects category visibility and applicability for overview statuses', () => {
    const categoryMap = createMaintenanceCategoryMap([
      category({
        name: 'Engine Service',
        applies_to: ['hgv'],
        show_on_overview: true,
      }),
      category({
        name: 'Cambelt Replacement',
        applies_to: ['van'],
        show_on_overview: true,
      }),
      category({
        name: 'First Aid Kit Expiry',
        applies_to: ['hgv'],
        show_on_overview: false,
      }),
    ]);

    const visibleStatuses = getVisibleMaintenanceStatuses('hgv', categoryMap, [
      { categoryName: MAINTENANCE_CATEGORY_NAMES.engineService, status: { status: 'due_soon' } },
      { categoryName: MAINTENANCE_CATEGORY_NAMES.cambelt, status: { status: 'overdue' } },
      { categoryName: MAINTENANCE_CATEGORY_NAMES.firstAid, status: { status: 'overdue' } },
    ]);

    expect(visibleStatuses).toEqual([{ status: 'due_soon' }]);
  });

  it('maps legacy vehicle applicability to vans', () => {
    const legacyCategory = category({ applies_to: ['vehicle'] });

    expect(isMaintenanceCategoryVisibleOnOverview(legacyCategory, 'van', 'Service Due')).toBe(true);
    expect(isMaintenanceCategoryVisibleOnOverview(legacyCategory, 'hgv', 'Service Due')).toBe(false);
  });

  it('keeps shared Service Due off HGVs while allowing HGV-only service categories', () => {
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.service)).toBe(false);
    expect(categoryAppliesToAsset(undefined, 'van', MAINTENANCE_CATEGORY_NAMES.service)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.engineService)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.fullService)).toBe(true);
  });

  it('returns contextual distance labels for vans and HGVs', () => {
    expect(getDistanceTypeLabel(['van'])).toBe('Miles');
    expect(getDistanceTypeLabel(['hgv'])).toBe('Kilometres');
    expect(getDistanceTypeLabel(['van', 'hgv'])).toBe('Miles / Kilometres');
  });

  it('normalizes category names in maps', () => {
    const categoryMap = createMaintenanceCategoryMap([category({ name: 'Service Due' })]);

    expect(getMaintenanceCategory(categoryMap, 'service due')?.name).toBe('Service Due');
  });
});
