import { describe, expect, it } from 'vitest';
import {
  CONFIRMATION,
  FIXTURE_KEY,
  buildFixtureDefinitions,
  createManifest,
  determineCategoryPlan,
  type CategoryCandidate,
} from '@/scripts/testing/fleet-inventory-sample';

const existingPlantCategory: CategoryCandidate = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'All plant',
  description: 'All plant machinery and equipment',
  applies_to: ['van', 'plant'],
  plant_usage_count: 2,
};

describe('Fleet and Inventory SAMPLE fixture', () => {
  it('creates the approved removable dataset counts', () => {
    const fixture = buildFixtureDefinitions(new Date('2026-07-23T12:00:00Z'));

    expect(fixture.active_plants).toHaveLength(10);
    expect(fixture.small_tools).toHaveLength(12);
    expect(fixture.minor_plant).toHaveLength(8);
    expect(fixture.minor_plant.every((entry) => entry.plant.status === 'inactive')).toBe(true);
    expect(fixture.minor_plant.every((entry) => entry.item.category === 'minor_plant')).toBe(true);
  });

  it('keeps chainsaws exclusively in Inventory Minor Plant', () => {
    const fixture = buildFixtureDefinitions(new Date('2026-07-23T12:00:00Z'));
    const activePlantNames = fixture.active_plants.map((plant) => plant.nickname.toLowerCase());
    const minorPlantNames = fixture.minor_plant.map((entry) => entry.item.name.toLowerCase());

    expect(activePlantNames.some((name) => name.includes('chainsaw'))).toBe(false);
    expect(minorPlantNames.filter((name) => name.includes('chainsaw'))).toHaveLength(3);
  });

  it('uses deterministic fictional identifiers and omits integration identifiers', () => {
    const fixture = buildFixtureDefinitions(new Date('2026-07-23T12:00:00Z'));
    const allPlants = [
      ...fixture.active_plants,
      ...fixture.minor_plant.map((entry) => entry.plant),
    ];
    const allItems = [
      ...fixture.small_tools,
      ...fixture.minor_plant.map((entry) => entry.item),
    ];

    expect(new Set(allPlants.map((plant) => plant.id)).size).toBe(allPlants.length);
    expect(new Set(allItems.map((item) => item.id)).size).toBe(allItems.length);
    expect(allPlants.every((plant) => plant.plant_id.startsWith('ZZ99-'))).toBe(true);
    expect(allPlants.every((plant) => /^[A-Z0-9]+$/.test(plant.serial_number))).toBe(true);
    expect(allItems.every((item) => item.item_number.startsWith('ZZ99-'))).toBe(true);
    expect(fixture.small_tools.every((item) => item.source === FIXTURE_KEY)).toBe(true);
    expect(fixture.minor_plant.every((entry) =>
      entry.item.source === 'fleet_plant'
      && entry.item.source_reference === entry.plant.id
    )).toBe(true);
  });

  it('uses an existing applicable All plant category without changing it', () => {
    expect(determineCategoryPlan([existingPlantCategory])).toEqual({
      strategy: 'existing',
      category_id: existingPlantCategory.id,
      category_name: 'All plant',
      original_applies_to: ['van', 'plant'],
    });
  });

  it('temporarily patches only the exact unused legacy All plant category', () => {
    const plan = determineCategoryPlan([{
      ...existingPlantCategory,
      applies_to: ['van'],
      plant_usage_count: 0,
    }]);

    expect(plan).toEqual({
      strategy: 'temporary-patch',
      category_id: existingPlantCategory.id,
      category_name: 'All plant',
      original_applies_to: ['van'],
    });
  });

  it('falls back to a dedicated category when the shared category is ambiguous', () => {
    const plan = determineCategoryPlan([
      { ...existingPlantCategory, id: '11111111-1111-4111-8111-111111111111' },
      { ...existingPlantCategory, id: '22222222-2222-4222-8222-222222222222' },
    ]);

    expect(plan.strategy).toBe('dedicated');
    expect(plan.category_name).toBe('SAMPLE Tree Surgery Plant');
  });

  it('reports ownership, zero overlap, confirmation and cleanup in the manifest', () => {
    const manifest = createManifest(
      'approved-project',
      determineCategoryPlan([existingPlantCategory]),
      new Date('2026-07-23T12:00:00Z')
    );

    expect(manifest.project_ref).toBe('approved-project');
    expect(manifest.fixture_key).toBe(FIXTURE_KEY);
    expect(manifest.confirmation).toBe(CONFIRMATION);
    expect(manifest.cleanup_command).toContain(CONFIRMATION);
    expect(manifest.identifiers).toEqual({
      active_fleet_plant: 'ZZ99-FP-001..ZZ99-FP-010',
      inactive_minor_plant_backing: 'ZZ99-MP-001..ZZ99-MP-008',
      inventory_small_tools: 'ZZ99-TL-001..ZZ99-TL-012',
      inventory_minor_plant: 'ZZ99-MP-001..ZZ99-MP-008',
    });
    expect(manifest.safety).toEqual({
      registrations: 0,
      tracker_identifiers: 0,
      inventory_locations_created: 0,
      external_service_calls: 0,
      active_overlap: 0,
    });
    expect(manifest.counts).toEqual({
      active_fleet_plant: 10,
      inactive_minor_plant_backing: 8,
      plant_maintenance: 10,
      inventory_small_tools: 12,
      inventory_minor_plant: 8,
      inventory_minor_plant_details: 8,
      active_overlap: 0,
    });
  });
});
