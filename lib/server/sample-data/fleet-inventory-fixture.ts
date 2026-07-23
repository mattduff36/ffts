import 'server-only';

import {
  buildFixtureDefinitions,
  determineCategoryPlan,
  type CategoryCandidate,
  type CategoryPlan,
  type FixtureDefinitions,
} from '@/scripts/testing/fleet-inventory-sample';
import type { SampleDataDbClient } from './database';
import type { SampleDataFixtureStatus } from './types';

export const FLEET_INVENTORY_FIXTURE_KEY = 'fleet-inventory-sample-v1' as const;
export const FLEET_INVENTORY_TOOLING_VERSION = 'debug-fleet-inventory-v1';

const SAMPLE_CATEGORY_ID = 'f17e4000-0000-4000-8000-000000000001';
const SAMPLE_CATEGORY_NAME = 'SAMPLE Tree Surgery Plant';
const SAMPLE_CATEGORY_DESCRIPTION =
  `Owned by ${FLEET_INVENTORY_FIXTURE_KEY}; remove only through the guarded cleanup command.`;
const ALL_PLANT_CATEGORY_NAME = 'All plant';
const ALL_PLANT_CATEGORY_DESCRIPTION = 'All plant machinery and equipment';
const TEMPORARY_CATEGORY_DESCRIPTION =
  `${ALL_PLANT_CATEGORY_DESCRIPTION} [${FLEET_INVENTORY_FIXTURE_KEY}]`;

function fixtureUuid(group: number, index: number): string {
  return `f17e${String(group).padStart(4, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function allPlants(fixture: FixtureDefinitions) {
  return [...fixture.active_plants, ...fixture.minor_plant.map((entry) => entry.plant)];
}

function allItems(fixture: FixtureDefinitions) {
  return [...fixture.small_tools, ...fixture.minor_plant.map((entry) => entry.item)];
}

function getProjectAvailabilityReason(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  const allowedProjectRef =
    process.env.FLEET_INVENTORY_SAMPLE_PRODUCTION_PROJECT_REF;
  if (!supabaseUrl || !connectionString || !allowedProjectRef) {
    return 'Fleet and Inventory sample production allowlist is not configured.';
  }
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    if (
      projectRef !== allowedProjectRef
      || !connectionString.includes(allowedProjectRef)
    ) {
      return 'Configured URL and database do not match the Fleet sample allowlist.';
    }
  } catch {
    return 'Fleet sample environment configuration is invalid.';
  }
  return null;
}

async function loadCategoryCandidates(
  client: SampleDataDbClient
): Promise<CategoryCandidate[]> {
  const result = await client.query<CategoryCandidate>(
    `
      SELECT
        category.id,
        category.name,
        category.description,
        category.applies_to,
        COUNT(plant.id)::int AS plant_usage_count
      FROM public.van_categories AS category
      LEFT JOIN public.plant AS plant ON plant.category_id = category.id
      WHERE LOWER(BTRIM(category.name)) IN (LOWER($1), LOWER($2))
         OR category.id = $3
         OR category.description = $4
      GROUP BY category.id
      ORDER BY category.name, category.id
    `,
    [
      ALL_PLANT_CATEGORY_NAME,
      SAMPLE_CATEGORY_NAME,
      SAMPLE_CATEGORY_ID,
      SAMPLE_CATEGORY_DESCRIPTION,
    ]
  );
  return result.rows;
}

async function loadYardLocationId(client: SampleDataDbClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM public.inventory_locations
      WHERE LOWER(BTRIM(name)) = 'yard' AND is_active = TRUE
      ORDER BY id
    `
  );
  if (result.rows.length !== 1) {
    throw new Error(`Expected exactly one active Yard location, found ${result.rows.length}.`);
  }
  return result.rows[0].id;
}

export async function inspectFleetInventoryFixture(
  client: SampleDataDbClient
): Promise<SampleDataFixtureStatus> {
  const availabilityReason = getProjectAvailabilityReason();
  if (availabilityReason) return unavailableFleetStatus(availabilityReason);

  const schemaResult = await client.query<Record<string, string | null>>(`
    SELECT
      to_regclass('public.plant')::text AS plant_table,
      to_regclass('public.inventory_items')::text AS inventory_table,
      to_regclass('public.inventory_minor_plant_details')::text AS detail_table,
      to_regclass('public.sample_data_operations')::text AS operations_table
  `);
  const schema = schemaResult.rows[0];
  if (
    schema?.plant_table !== 'plant'
    || schema.inventory_table !== 'inventory_items'
    || schema.detail_table !== 'inventory_minor_plant_details'
    || schema.operations_table !== 'sample_data_operations'
  ) {
    return unavailableFleetStatus(
      'Required Fleet, Inventory or sample-operation schema is not deployed.'
    );
  }

  const fixture = buildFixtureDefinitions(new Date());
  const yardLocationId = await loadYardLocationId(client);
  const plantIds = allPlants(fixture).map((plant) => plant.id);
  const itemIds = allItems(fixture).map((item) => item.id);
  const maintenanceIds = fixture.active_plants.map(
    (_, index) => fixtureUuid(301, index + 1)
  );
  const detailIds = fixture.minor_plant.map((entry) => entry.detail_id);
  const result = await client.query<Record<string, string>>(
    `
      SELECT
        (
          SELECT COUNT(*)::text FROM public.plant
          WHERE id = ANY($1::uuid[])
        ) AS plant_rows,
        (
          SELECT COUNT(*)::text FROM public.plant
          WHERE id = ANY($2::uuid[]) AND status = 'active'
        ) AS active_plant_rows,
        (
          SELECT COUNT(*)::text FROM public.plant
          WHERE id = ANY($3::uuid[]) AND status = 'inactive'
        ) AS inactive_backing_rows,
        (
          SELECT COUNT(*)::text FROM public.vehicle_maintenance
          WHERE id = ANY($4::uuid[]) AND notes = $6
        ) AS maintenance_rows,
        (
          SELECT COUNT(*)::text FROM public.inventory_items
          WHERE id = ANY($5::uuid[]) AND status = 'active'
        ) AS inventory_rows,
        (
          SELECT COUNT(*)::text FROM public.inventory_items
          WHERE id = ANY($7::uuid[]) AND category <> 'minor_plant'
        ) AS small_tool_rows,
        (
          SELECT COUNT(*)::text FROM public.inventory_items
          WHERE id = ANY($8::uuid[]) AND category = 'minor_plant'
        ) AS minor_plant_rows,
        (
          SELECT COUNT(*)::text FROM public.inventory_minor_plant_details
          WHERE id = ANY($9::uuid[])
        ) AS minor_detail_rows,
        (
          SELECT COUNT(*)::text FROM public.plant
          WHERE id = ANY($1::uuid[]) AND reg_number IS NOT NULL
        ) AS registrations,
        (
          SELECT COUNT(*)::text FROM public.vehicle_maintenance
          WHERE id = ANY($4::uuid[]) AND tracker_id IS NOT NULL
        ) AS trackers,
        (
          SELECT COUNT(*)::text FROM public.actions
          WHERE plant_id = ANY($1::uuid[])
        ) AS actions,
        (
          SELECT COUNT(*)::text FROM public.asset_maintenance_category_values
          WHERE plant_id = ANY($1::uuid[])
        ) AS custom_maintenance_values,
        (
          SELECT COUNT(*)::text FROM public.dvla_sync_log
          WHERE plant_id = ANY($1::uuid[])
        ) AS dvla_sync_logs,
        (
          SELECT COUNT(*)::text FROM public.inventory_locations
          WHERE linked_plant_id = ANY($1::uuid[])
        ) AS linked_inventory_locations,
        (
          SELECT COUNT(*)::text FROM public.maintenance_history
          WHERE plant_id = ANY($1::uuid[])
        ) AS maintenance_history,
        (
          SELECT COUNT(*)::text FROM public.plant_inspections
          WHERE plant_id = ANY($1::uuid[])
        ) AS plant_inspections,
        (
          SELECT COUNT(*)::text FROM public.profile_fleet_assignments
          WHERE linked_plant_id = ANY($1::uuid[])
        ) AS fleet_assignments,
        (
          SELECT COUNT(*)::text FROM public.reminder_actions
          WHERE plant_id = ANY($1::uuid[])
        ) AS reminder_actions,
        (
          SELECT COUNT(*)::text FROM public.schedule_plant_assignments
          WHERE plant_id = ANY($1::uuid[])
        ) AS schedule_assignments,
        (
          SELECT COUNT(*)::text FROM public.schedule_plant_unavailability
          WHERE plant_id = ANY($1::uuid[])
        ) AS schedule_unavailability,
        (
          SELECT COUNT(*)::text FROM public.van_inspections
          WHERE plant_id = ANY($1::uuid[])
        ) AS van_inspections,
        (
          SELECT COUNT(*)::text FROM public.inventory_check_history
          WHERE item_id = ANY($5::uuid[])
        ) AS inventory_checks,
        (
          SELECT COUNT(*)::text FROM public.inventory_item_group_members
          WHERE item_id = ANY($5::uuid[])
        ) AS inventory_groups,
        (
          SELECT COUNT(*)::text FROM public.inventory_item_movements
          WHERE item_id = ANY($5::uuid[])
        ) AS inventory_movements,
        (
          SELECT COUNT(*)::text FROM public.plant
          WHERE (
            plant_id = ANY($10::text[])
            OR serial_number = ANY($11::text[])
          )
          AND id <> ALL($1::uuid[])
        ) AS plant_collisions,
        (
          SELECT COUNT(*)::text FROM public.inventory_items
          WHERE item_number_normalized = ANY($12::text[])
            AND id <> ALL($5::uuid[])
        ) AS inventory_collisions
    `,
    [
      plantIds,
      fixture.active_plants.map((plant) => plant.id),
      fixture.minor_plant.map((entry) => entry.plant.id),
      maintenanceIds,
      itemIds,
      FLEET_INVENTORY_FIXTURE_KEY,
      fixture.small_tools.map((item) => item.id),
      fixture.minor_plant.map((entry) => entry.item.id),
      detailIds,
      allPlants(fixture).map((plant) => plant.plant_id),
      allPlants(fixture).map((plant) => plant.serial_number),
      allItems(fixture).map((item) => item.item_number_normalized),
    ]
  );
  const observed = Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
  const [plantRows, itemRows, maintenanceRows] = await Promise.all([
    client.query<{
      id: string;
      plant_id: string;
      nickname: string | null;
      serial_number: string | null;
      status: string;
      category_id: string;
      reg_number: string | null;
      updated_by: string | null;
    }>(
      `
        SELECT id, plant_id, nickname, serial_number, status, category_id,
          reg_number, updated_by
        FROM public.plant
        WHERE id = ANY($1::uuid[])
      `,
      [plantIds]
    ),
    client.query<{
      id: string;
      item_number: string;
      item_number_normalized: string;
      name: string;
      category: string;
      location_id: string;
      status: string;
      source: string | null;
      source_reference: string | null;
      updated_by: string | null;
    }>(
      `
        SELECT id, item_number, item_number_normalized, name, category, location_id,
          status, source, source_reference, updated_by
        FROM public.inventory_items
        WHERE id = ANY($1::uuid[])
      `,
      [itemIds]
    ),
    client.query<{
      id: string;
      plant_id: string | null;
      notes: string | null;
      tracker_id: string | null;
    }>(
      `
        SELECT id, plant_id, notes, tracker_id
        FROM public.vehicle_maintenance
        WHERE id = ANY($1::uuid[])
      `,
      [maintenanceIds]
    ),
  ]);
  const expectedPlants = new Map(allPlants(fixture).map((plant) => [plant.id, plant]));
  const expectedItems = new Map(allItems(fixture).map((item) => [item.id, item]));
  const expectedMaintenance = new Map(
    fixture.active_plants.map((plant, index) => [
      fixtureUuid(301, index + 1),
      plant.id,
    ])
  );
  let managedMutations = 0;
  const categoryIds = new Set(plantRows.rows.map((row) => row.category_id));
  for (const row of plantRows.rows) {
    const expectedPlant = expectedPlants.get(row.id);
    if (
      !expectedPlant
      || row.plant_id !== expectedPlant.plant_id
      || row.nickname !== expectedPlant.nickname
      || row.serial_number !== expectedPlant.serial_number
      || row.status !== expectedPlant.status
      || row.reg_number !== null
      || row.updated_by !== null
    ) {
      managedMutations += 1;
    }
  }
  for (const row of itemRows.rows) {
    const expectedItem = expectedItems.get(row.id);
    if (
      !expectedItem
      || row.item_number !== expectedItem.item_number
      || row.item_number_normalized !== expectedItem.item_number_normalized
      || row.name !== expectedItem.name
      || row.category !== expectedItem.category
      || row.location_id !== yardLocationId
      || row.status !== 'active'
      || row.source !== expectedItem.source
      || row.source_reference !== expectedItem.source_reference
      || row.updated_by !== null
    ) {
      managedMutations += 1;
    }
  }
  for (const row of maintenanceRows.rows) {
    if (
      expectedMaintenance.get(row.id) !== row.plant_id
      || row.notes !== FLEET_INVENTORY_FIXTURE_KEY
      || row.tracker_id !== null
    ) {
      managedMutations += 1;
    }
  }
  if (categoryIds.size > 1) managedMutations += 1;
  if (plantRows.rows.length > 0) {
    try {
      await resolveOwnedCategoryPlan(client, fixture);
    } catch {
      managedMutations += 1;
    }
  }
  observed.managed_mutations = managedMutations;
  const expected = {
    plant_rows: 18,
    active_plant_rows: 10,
    inactive_backing_rows: 8,
    maintenance_rows: 10,
    inventory_rows: 20,
    small_tool_rows: 12,
    minor_plant_rows: 8,
    minor_detail_rows: 8,
    registrations: 0,
    trackers: 0,
  };
  const dependencyKeys = [
    'actions',
    'custom_maintenance_values',
    'dvla_sync_logs',
    'linked_inventory_locations',
    'maintenance_history',
    'plant_inspections',
    'fleet_assignments',
    'reminder_actions',
    'schedule_assignments',
    'schedule_unavailability',
    'van_inspections',
    'inventory_checks',
    'inventory_groups',
    'inventory_movements',
  ];
  const collisionKeys = ['plant_collisions', 'inventory_collisions'];
  const blockers = [...dependencyKeys, ...collisionKeys]
    .filter((key) => observed[key] > 0)
    .map((key) => `${key.replaceAll('_', ' ')}: ${observed[key]}`);
  if (observed.managed_mutations > 0) {
    blockers.push(`managed row mutations: ${observed.managed_mutations}`);
  }
  const ownedRows =
    observed.plant_rows + observed.maintenance_rows + observed.inventory_rows
    + observed.minor_detail_rows;
  const exact = Object.entries(expected).every(
    ([key, value]) => observed[key] === value
  );
  let state: SampleDataFixtureStatus['state'];
  if (ownedRows === 0 && blockers.length === 0) state = 'absent';
  else if (exact) {
    state =
      observed.managed_mutations > 0
        ? 'drifted'
        : blockers.length > 0
          ? 'blocked'
          : 'installed';
  }
  else {
    const hasExcess = Object.entries(expected).some(
      ([key, value]) => observed[key] > value
    );
    state = hasExcess ? 'drifted' : 'partial';
    blockers.unshift('Managed Fleet and Inventory ownership is incomplete or changed.');
  }

  return {
    fixtureKey: FLEET_INVENTORY_FIXTURE_KEY,
    label: 'Fleet and Inventory Sample Data',
    description:
      'Deterministic fictional Plant, maintenance, Small Tool and Minor Plant records.',
    toolingVersion: FLEET_INVENTORY_TOOLING_VERSION,
    state,
    available: true,
    expected,
    observed,
    blockers,
    availabilityReason: null,
    lastOperation: null,
  };
}

function unavailableFleetStatus(reason: string): SampleDataFixtureStatus {
  return {
    fixtureKey: FLEET_INVENTORY_FIXTURE_KEY,
    label: 'Fleet and Inventory Sample Data',
    description:
      'Deterministic fictional Plant, maintenance, Small Tool and Minor Plant records.',
    toolingVersion: FLEET_INVENTORY_TOOLING_VERSION,
    state: 'unavailable',
    available: false,
    expected: {},
    observed: {},
    blockers: [reason],
    availabilityReason: reason,
    lastOperation: null,
  };
}

export async function insertFleetInventoryFixture(
  client: SampleDataDbClient,
  fixtureDate = new Date()
): Promise<CategoryPlan> {
  const fixture = buildFixtureDefinitions(fixtureDate);
  const yardLocationId = await loadYardLocationId(client);
  const categoryPlan = determineCategoryPlan(await loadCategoryCandidates(client));
  let categoryId = categoryPlan.category_id;

  if (categoryPlan.strategy === 'temporary-patch') {
    const result = await client.query(
      `
        UPDATE public.van_categories
        SET applies_to = ARRAY['van', 'plant']::text[],
            description = $2,
            updated_at = NOW()
        WHERE id = $1
          AND name = $3
          AND description = $4
          AND applies_to = ARRAY['van']::text[]
          AND NOT EXISTS (
            SELECT 1 FROM public.plant WHERE category_id = $1
          )
      `,
      [
        categoryId,
        TEMPORARY_CATEGORY_DESCRIPTION,
        ALL_PLANT_CATEGORY_NAME,
        ALL_PLANT_CATEGORY_DESCRIPTION,
      ]
    );
    if (result.rowCount !== 1) throw new Error('Plant category changed after preview.');
  } else if (categoryPlan.strategy === 'dedicated') {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO public.van_categories (id, name, description, applies_to)
        VALUES ($1, $2, $3, ARRAY['plant']::text[])
        RETURNING id
      `,
      [SAMPLE_CATEGORY_ID, SAMPLE_CATEGORY_NAME, SAMPLE_CATEGORY_DESCRIPTION]
    );
    categoryId = result.rows[0]?.id;
    if (categoryId !== SAMPLE_CATEGORY_ID) {
      throw new Error('Unable to create the managed SAMPLE Plant category.');
    }
  }

  for (const plant of allPlants(fixture)) {
    await client.query(
      `
        INSERT INTO public.plant (
          id, plant_id, nickname, make, model, serial_number, year,
          weight_class, category_id, loler_due_date, current_hours,
          status, reg_number, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, NULL, NULL, NULL
        )
      `,
      [
        plant.id,
        plant.plant_id,
        plant.nickname,
        plant.make,
        plant.model,
        plant.serial_number,
        plant.year,
        plant.weight_class,
        categoryId,
        plant.loler_due_date,
        plant.current_hours,
        plant.status,
      ]
    );
  }
  for (const [index, plant] of fixture.active_plants.entries()) {
    await client.query(
      `
        INSERT INTO public.vehicle_maintenance (
          id, van_id, hgv_id, plant_id, current_hours, last_service_hours,
          next_service_hours, last_hours_update, notes, tracker_id,
          last_updated_by
        ) VALUES ($1, NULL, NULL, $2, $3, $4, $5, NOW(), $6, NULL, NULL)
      `,
      [
        fixtureUuid(301, index + 1),
        plant.id,
        plant.current_hours,
        plant.last_service_hours,
        plant.next_service_hours,
        FLEET_INVENTORY_FIXTURE_KEY,
      ]
    );
  }
  for (const item of allItems(fixture)) {
    await client.query(
      `
        INSERT INTO public.inventory_items (
          id, item_number, item_number_normalized, name, category, location_id,
          last_checked_at, check_interval_days, status, source, source_reference,
          created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, 'active', $9, $10, NULL, NULL
        )
      `,
      [
        item.id,
        item.item_number,
        item.item_number_normalized,
        item.name,
        item.category,
        yardLocationId,
        item.last_checked_at,
        item.check_interval_days,
        item.source,
        item.source_reference,
      ]
    );
  }
  for (const entry of fixture.minor_plant) {
    await client.query(
      `
        INSERT INTO public.inventory_minor_plant_details (
          id, inventory_item_id, source_plant_id, plant_identifier,
          make, model, serial_number, reg_number, year, weight_class,
          copied_at, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, NOW(), NULL, NULL
        )
      `,
      [
        entry.detail_id,
        entry.item.id,
        entry.plant.id,
        entry.plant.plant_id,
        entry.plant.make,
        entry.plant.model,
        entry.plant.serial_number,
        entry.plant.year,
        entry.plant.weight_class,
      ]
    );
  }
  return categoryPlan;
}

async function resolveOwnedCategoryPlan(
  client: SampleDataDbClient,
  fixture: FixtureDefinitions
): Promise<CategoryPlan> {
  const result = await client.query<CategoryCandidate>(
    `
      SELECT
        category.id, category.name, category.description,
        category.applies_to, COUNT(plant.id)::int AS plant_usage_count
      FROM public.van_categories AS category
      JOIN public.plant AS owned
        ON owned.category_id = category.id
       AND owned.id = ANY($1::uuid[])
      LEFT JOIN public.plant AS plant ON plant.category_id = category.id
      GROUP BY category.id
    `,
    [allPlants(fixture).map((plant) => plant.id)]
  );
  if (result.rows.length !== 1) {
    throw new Error('Managed Plant rows do not resolve to one category.');
  }
  const category = result.rows[0];
  if (
    category.id === SAMPLE_CATEGORY_ID
    && category.description === SAMPLE_CATEGORY_DESCRIPTION
  ) {
    return {
      strategy: 'dedicated',
      category_id: category.id,
      category_name: category.name,
      original_applies_to: null,
    };
  }
  if (category.description === TEMPORARY_CATEGORY_DESCRIPTION) {
    return {
      strategy: 'temporary-patch',
      category_id: category.id,
      category_name: category.name,
      original_applies_to: ['van'],
    };
  }
  if (
    category.name === ALL_PLANT_CATEGORY_NAME
    && category.applies_to?.includes('plant')
  ) {
    return {
      strategy: 'existing',
      category_id: category.id,
      category_name: category.name,
      original_applies_to: category.applies_to,
    };
  }
  throw new Error('Managed Plant category has drifted.');
}

export async function removeFleetInventoryRows(
  client: SampleDataDbClient
): Promise<void> {
  const fixture = buildFixtureDefinitions(new Date());
  const categoryPlan = await resolveOwnedCategoryPlan(client, fixture);
  const plantIds = allPlants(fixture).map((plant) => plant.id);
  const itemIds = allItems(fixture).map((item) => item.id);
  const maintenanceIds = fixture.active_plants.map(
    (_, index) => fixtureUuid(301, index + 1)
  );

  await client.query(
    `DELETE FROM public.inventory_items WHERE id = ANY($1::uuid[])`,
    [itemIds]
  );
  await client.query(
    `DELETE FROM public.vehicle_maintenance WHERE id = ANY($1::uuid[])`,
    [maintenanceIds]
  );
  await client.query(
    `DELETE FROM public.plant WHERE id = ANY($1::uuid[])`,
    [plantIds]
  );

  if (categoryPlan.strategy === 'temporary-patch') {
    const result = await client.query(
      `
        UPDATE public.van_categories
        SET applies_to = ARRAY['van']::text[],
            description = $2,
            updated_at = NOW()
        WHERE id = $1
          AND description = $3
          AND NOT EXISTS (
            SELECT 1 FROM public.plant WHERE category_id = $1
          )
      `,
      [
        categoryPlan.category_id,
        ALL_PLANT_CATEGORY_DESCRIPTION,
        TEMPORARY_CATEGORY_DESCRIPTION,
      ]
    );
    if (result.rowCount !== 1) throw new Error('Unable to restore Plant category.');
  } else if (categoryPlan.strategy === 'dedicated') {
    const result = await client.query(
      `
        DELETE FROM public.van_categories
        WHERE id = $1
          AND name = $2
          AND description = $3
          AND NOT EXISTS (
            SELECT 1 FROM public.plant WHERE category_id = $1
          )
      `,
      [SAMPLE_CATEGORY_ID, SAMPLE_CATEGORY_NAME, SAMPLE_CATEGORY_DESCRIPTION]
    );
    if (result.rowCount !== 1) {
      throw new Error('Unable to remove managed SAMPLE Plant category.');
    }
  }
}
