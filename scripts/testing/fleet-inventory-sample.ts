import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import pg, { type Client } from 'pg';

const { Client: PgClient } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

export const FIXTURE_KEY = 'fleet-inventory-sample-v1';
export const CONFIRMATION = '--confirm-production=FFTS_FLEET_INVENTORY_SAMPLE';
export const ALLOWED_PROJECT_ENV = 'FLEET_INVENTORY_SAMPLE_PRODUCTION_PROJECT_REF';

const ALL_PLANT_CATEGORY_NAME = 'All plant';
const ALL_PLANT_CATEGORY_DESCRIPTION = 'All plant machinery and equipment';
const TEMPORARY_CATEGORY_DESCRIPTION = `${ALL_PLANT_CATEGORY_DESCRIPTION} [${FIXTURE_KEY}]`;
const SAMPLE_CATEGORY_ID = 'f17e4000-0000-4000-8000-000000000001';
const SAMPLE_CATEGORY_NAME = 'SAMPLE Tree Surgery Plant';
const SAMPLE_CATEGORY_DESCRIPTION = `Owned by ${FIXTURE_KEY}; remove only through the guarded cleanup command.`;
const MANIFEST_DIRECTORY = 'docs_private/automation/runs/fleet-inventory-sample';
const SOURCE_SMALL_TOOLS = FIXTURE_KEY;
const SOURCE_MINOR_PLANT = 'fleet_plant';

type Mode = 'plan' | 'apply' | 'cleanup';
type CategoryStrategy = 'existing' | 'temporary-patch' | 'dedicated';

export interface CategoryCandidate {
  id: string;
  name: string;
  description: string | null;
  applies_to: string[] | null;
  plant_usage_count: number;
}

export interface CategoryPlan {
  strategy: CategoryStrategy;
  category_id: string;
  category_name: string;
  original_applies_to: string[] | null;
}

export interface PlantDefinition {
  id: string;
  plant_id: string;
  nickname: string;
  make: string;
  model: string;
  serial_number: string;
  year: number;
  weight_class: string;
  current_hours: number;
  last_service_hours: number;
  next_service_hours: number;
  loler_due_date: string | null;
  status: 'active' | 'inactive';
}

export interface InventoryDefinition {
  id: string;
  item_number: string;
  item_number_normalized: string;
  name: string;
  category: string;
  last_checked_at: string;
  check_interval_days: number;
  source: string;
  source_reference: string;
}

export interface MinorPlantDefinition {
  plant: PlantDefinition;
  item: InventoryDefinition;
  detail_id: string;
}

export interface FixtureDefinitions {
  active_plants: PlantDefinition[];
  small_tools: InventoryDefinition[];
  minor_plant: MinorPlantDefinition[];
}

export interface FixtureManifest {
  fixture_key: string;
  project_ref: string;
  generated_at: string;
  confirmation: string;
  cleanup_command: string;
  category: CategoryPlan;
  identifiers: {
    active_fleet_plant: string;
    inactive_minor_plant_backing: string;
    inventory_small_tools: string;
    inventory_minor_plant: string;
  };
  safety: {
    registrations: number;
    tracker_identifiers: number;
    inventory_locations_created: number;
    external_service_calls: number;
    active_overlap: number;
  };
  counts: {
    active_fleet_plant: number;
    inactive_minor_plant_backing: number;
    plant_maintenance: number;
    inventory_small_tools: number;
    inventory_minor_plant: number;
    inventory_minor_plant_details: number;
    active_overlap: number;
  };
  active_fleet_plant: Array<{
    id: string;
    plant_id: string;
    name: string;
    make: string;
    model: string;
  }>;
  inventory_small_tools: Array<{
    id: string;
    item_number: string;
    name: string;
    category: string;
  }>;
  inventory_minor_plant: Array<{
    id: string;
    item_number: string;
    name: string;
    source_plant_id: string;
  }>;
}

interface RequiredEnvironment {
  connectionString: string;
  projectRef: string;
}

interface PreflightResult {
  categoryPlan: CategoryPlan;
  yardLocationId: string;
}

interface VerificationCounts {
  plant_rows: number;
  active_plant_rows: number;
  inactive_backing_rows: number;
  maintenance_rows: number;
  inventory_rows: number;
  small_tool_rows: number;
  minor_plant_rows: number;
  minor_detail_rows: number;
  active_overlap: number;
  registration_rows: number;
  tracker_rows: number;
}

interface DependencyCounts {
  actions: number;
  custom_maintenance_values: number;
  dvla_sync_logs: number;
  linked_inventory_locations: number;
  maintenance_history: number;
  plant_inspections: number;
  fleet_assignments: number;
  reminder_actions: number;
  schedule_assignments: number;
  schedule_unavailability: number;
  van_inspections: number;
  inventory_checks: number;
  inventory_groups: number;
  inventory_movements: number;
}

function fixtureUuid(group: number, index: number): string {
  return `f17e${String(group).padStart(4, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysFrom(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return dateOnly(copy);
}

function normalizeInventoryItemNumber(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '').trim();
}

function buildPlant(
  index: number,
  values: Omit<PlantDefinition, 'id' | 'plant_id' | 'serial_number' | 'status'>,
  options?: { group?: number; prefix?: 'FP' | 'MP'; status?: 'active' | 'inactive' }
): PlantDefinition {
  const group = options?.group ?? 1;
  const prefix = options?.prefix ?? 'FP';
  const paddedIndex = String(index).padStart(3, '0');
  return {
    id: fixtureUuid(group, index),
    plant_id: `ZZ99-${prefix}-${paddedIndex}`,
    serial_number: `ZZ99${prefix}${paddedIndex}`,
    status: options?.status ?? 'active',
    ...values,
  };
}

function buildInventoryItem(
  group: number,
  index: number,
  values: Omit<InventoryDefinition, 'id' | 'item_number_normalized'>
): InventoryDefinition {
  return {
    id: fixtureUuid(group, index),
    item_number_normalized: normalizeInventoryItemNumber(values.item_number),
    ...values,
  };
}

export function buildFixtureDefinitions(today = new Date()): FixtureDefinitions {
  const checkedRecently = daysFrom(today, -7);
  const checkedThisMonth = daysFrom(today, -18);

  const activePlants: PlantDefinition[] = [
    buildPlant(1, {
      nickname: 'SAMPLE Compact Tractor',
      make: 'Kubota',
      model: 'L2502',
      year: 2024,
      weight_class: '2.6 t',
      current_hours: 612,
      last_service_hours: 550,
      next_service_hours: 650,
      loler_due_date: null,
    }),
    buildPlant(2, {
      nickname: 'SAMPLE Forestry Tractor',
      make: 'John Deere',
      model: '5075E',
      year: 2023,
      weight_class: '3.4 t',
      current_hours: 984,
      last_service_hours: 900,
      next_service_hours: 1000,
      loler_due_date: null,
    }),
    buildPlant(3, {
      nickname: 'SAMPLE Tracked Wood Chipper',
      make: 'Forst',
      model: 'TR8D',
      year: 2023,
      weight_class: '1.45 t',
      current_hours: 1284,
      last_service_hours: 1200,
      next_service_hours: 1300,
      loler_due_date: null,
    }),
    buildPlant(4, {
      nickname: 'SAMPLE Towable Wood Chipper',
      make: 'Timberwolf',
      model: 'TW 280TDHB',
      year: 2022,
      weight_class: '1.28 t',
      current_hours: 846,
      last_service_hours: 800,
      next_service_hours: 900,
      loler_due_date: null,
    }),
    buildPlant(5, {
      nickname: 'SAMPLE Tracked Stump Grinder',
      make: 'Predator',
      model: '38RX',
      year: 2023,
      weight_class: '1.45 t',
      current_hours: 398,
      last_service_hours: 350,
      next_service_hours: 450,
      loler_due_date: null,
    }),
    buildPlant(6, {
      nickname: 'SAMPLE Compact Articulated Loader',
      make: 'Avant',
      model: '528',
      year: 2022,
      weight_class: '1.4 t',
      current_hours: 731,
      last_service_hours: 700,
      next_service_hours: 800,
      loler_due_date: daysFrom(today, 120),
    }),
    buildPlant(7, {
      nickname: 'SAMPLE Tracked MEWP',
      make: 'Hinowa',
      model: 'Lightlift 17.75',
      year: 2021,
      weight_class: '2.23 t',
      current_hours: 516,
      last_service_hours: 500,
      next_service_hours: 600,
      loler_due_date: daysFrom(today, 75),
    }),
    buildPlant(8, {
      nickname: 'SAMPLE Remote Forestry Mulcher',
      make: 'Green Climber',
      model: 'LV600',
      year: 2023,
      weight_class: '1.35 t',
      current_hours: 442,
      last_service_hours: 400,
      next_service_hours: 500,
      loler_due_date: null,
    }),
    buildPlant(9, {
      nickname: 'SAMPLE Mini Excavator With Tree Shear',
      make: 'Takeuchi',
      model: 'TB216',
      year: 2022,
      weight_class: '1.68 t',
      current_hours: 1098,
      last_service_hours: 1000,
      next_service_hours: 1100,
      loler_due_date: daysFrom(today, 105),
    }),
    buildPlant(10, {
      nickname: 'SAMPLE Tracked Material Carrier',
      make: 'Cormidi',
      model: 'C85',
      year: 2024,
      weight_class: '0.75 t',
      current_hours: 224,
      last_service_hours: 200,
      next_service_hours: 300,
      loler_due_date: null,
    }),
  ];

  const smallToolRows = [
    ['SAMPLE Pruning Saw 330mm', 'tools'],
    ['SAMPLE Felling Lever', 'tools'],
    ['SAMPLE Timber Lifting Tongs', 'tools'],
    ['SAMPLE Cant Hook', 'tools'],
    ['SAMPLE Throwline Cube Kit', 'tools'],
    ['SAMPLE Arborist Rigging Block', 'equipment'],
    ['SAMPLE Lowering Device', 'equipment'],
    ['SAMPLE Climbing Rope 45m', 'equipment'],
    ['SAMPLE Lowering Rope 60m', 'equipment'],
    ['SAMPLE Arborist Climbing Harness', 'equipment'],
    ['SAMPLE Arborist Trauma Kit', 'equipment'],
    ['SAMPLE Tree Work Ahead Folding Sign', 'signs'],
  ] as const;
  const smallTools = smallToolRows.map(([name, category], index) => {
    const itemIndex = index + 1;
    return buildInventoryItem(101, itemIndex, {
      item_number: `ZZ99-TL-${String(itemIndex).padStart(3, '0')}`,
      name,
      category,
      last_checked_at: index % 2 === 0 ? checkedRecently : checkedThisMonth,
      check_interval_days: category === 'signs' ? 90 : 30,
      source: SOURCE_SMALL_TOOLS,
      source_reference: `${FIXTURE_KEY}:small-tool:${String(itemIndex).padStart(3, '0')}`,
    });
  });

  const minorRows = [
    ['SAMPLE Top-Handle Chainsaw', 'Stihl', 'MS 201 TC-M', 2024, '3.7 kg'],
    ['SAMPLE Ground Chainsaw', 'Husqvarna', '560 XP Mark II', 2023, '5.9 kg'],
    ['SAMPLE Large Felling Chainsaw', 'Stihl', 'MS 661 C-M', 2022, '7.5 kg'],
    ['SAMPLE Telescopic Pole Pruner', 'Husqvarna', '525PT5S', 2023, '7.0 kg'],
    ['SAMPLE Petrol Capstan Winch', 'Portable Winch', 'PCW5000', 2022, '16 kg'],
    ['SAMPLE Portable Generator', 'Honda', 'EU32i', 2024, '26.5 kg'],
    ['SAMPLE Hydraulic Log Splitter', 'Forest Master', 'FM16TW', 2023, '97 kg'],
    ['SAMPLE Pedestrian Stump Grinder', 'FSI', 'B20', 2022, '145 kg'],
  ] as const;
  const minorPlant = minorRows.map(([nickname, make, model, year, weightClass], index) => {
    const itemIndex = index + 1;
    const plant = buildPlant(itemIndex, {
      nickname,
      make,
      model,
      year,
      weight_class: weightClass,
      current_hours: 0,
      last_service_hours: 0,
      next_service_hours: 0,
      loler_due_date: null,
    }, {
      group: 2,
      prefix: 'MP',
      status: 'inactive',
    });
    const item = buildInventoryItem(102, itemIndex, {
      item_number: plant.plant_id,
      name: nickname,
      category: 'minor_plant',
      last_checked_at: checkedRecently,
      check_interval_days: 30,
      source: SOURCE_MINOR_PLANT,
      source_reference: plant.id,
    });
    return {
      plant,
      item,
      detail_id: fixtureUuid(202, itemIndex),
    };
  });

  return {
    active_plants: activePlants,
    small_tools: smallTools,
    minor_plant: minorPlant,
  };
}

function sorted(values: string[] | null | undefined): string[] {
  return [...(values || [])].sort();
}

function arraysEqual(left: string[] | null | undefined, right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

export function determineCategoryPlan(candidates: CategoryCandidate[]): CategoryPlan {
  const allPlantCandidates = candidates.filter(
    (candidate) => candidate.name.trim().toLowerCase() === ALL_PLANT_CATEGORY_NAME.toLowerCase()
  );

  if (allPlantCandidates.length === 1) {
    const candidate = allPlantCandidates[0];
    if (candidate.applies_to?.includes('plant')) {
      return {
        strategy: 'existing',
        category_id: candidate.id,
        category_name: candidate.name,
        original_applies_to: candidate.applies_to,
      };
    }

    if (
      candidate.description === ALL_PLANT_CATEGORY_DESCRIPTION
      && arraysEqual(candidate.applies_to, ['van'])
      && candidate.plant_usage_count === 0
    ) {
      return {
        strategy: 'temporary-patch',
        category_id: candidate.id,
        category_name: candidate.name,
        original_applies_to: ['van'],
      };
    }
  }

  return {
    strategy: 'dedicated',
    category_id: SAMPLE_CATEGORY_ID,
    category_name: SAMPLE_CATEGORY_NAME,
    original_applies_to: null,
  };
}

export function createManifest(
  projectRef: string,
  categoryPlan: CategoryPlan,
  today = new Date()
): FixtureManifest {
  const fixture = buildFixtureDefinitions(today);
  return {
    fixture_key: FIXTURE_KEY,
    project_ref: projectRef,
    generated_at: today.toISOString(),
    confirmation: CONFIRMATION,
    cleanup_command: `npm run fleet-inventory:sample:cleanup -- ${CONFIRMATION}`,
    category: categoryPlan,
    identifiers: {
      active_fleet_plant: 'ZZ99-FP-001..ZZ99-FP-010',
      inactive_minor_plant_backing: 'ZZ99-MP-001..ZZ99-MP-008',
      inventory_small_tools: 'ZZ99-TL-001..ZZ99-TL-012',
      inventory_minor_plant: 'ZZ99-MP-001..ZZ99-MP-008',
    },
    safety: {
      registrations: 0,
      tracker_identifiers: 0,
      inventory_locations_created: 0,
      external_service_calls: 0,
      active_overlap: 0,
    },
    counts: {
      active_fleet_plant: fixture.active_plants.length,
      inactive_minor_plant_backing: fixture.minor_plant.length,
      plant_maintenance: fixture.active_plants.length,
      inventory_small_tools: fixture.small_tools.length,
      inventory_minor_plant: fixture.minor_plant.length,
      inventory_minor_plant_details: fixture.minor_plant.length,
      active_overlap: 0,
    },
    active_fleet_plant: fixture.active_plants.map((plant) => ({
      id: plant.id,
      plant_id: plant.plant_id,
      name: plant.nickname,
      make: plant.make,
      model: plant.model,
    })),
    inventory_small_tools: fixture.small_tools.map((item) => ({
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      category: item.category,
    })),
    inventory_minor_plant: fixture.minor_plant.map(({ item, plant }) => ({
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      source_plant_id: plant.id,
    })),
  };
}

function requiredEnvironment(): RequiredEnvironment {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  const allowedProjectRef = process.env[ALLOWED_PROJECT_ENV];

  if (!supabaseUrl || !connectionString || !allowedProjectRef) {
    throw new Error(
      `Set NEXT_PUBLIC_SUPABASE_URL, POSTGRES_URL_NON_POOLING, and ${ALLOWED_PROJECT_ENV}.`
    );
  }

  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (projectRef !== allowedProjectRef || !connectionString.includes(allowedProjectRef)) {
    throw new Error('Configured Supabase URL and database do not match the explicitly allowed production project.');
  }

  return { connectionString, projectRef };
}

function createPgClient(connectionString: string): Client {
  const url = new URL(connectionString);
  return new PgClient({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

async function assertSchema(client: Client): Promise<void> {
  const result = await client.query<{
    plant_table: string | null;
    inventory_table: string | null;
    minor_detail_table: string | null;
    category_table: string | null;
    location_table: string | null;
    maintenance_table: string | null;
    plant_serial: string | null;
    inventory_source: string | null;
    minor_source_plant: string | null;
  }>(`
    SELECT
      to_regclass('public.plant')::text AS plant_table,
      to_regclass('public.inventory_items')::text AS inventory_table,
      to_regclass('public.inventory_minor_plant_details')::text AS minor_detail_table,
      to_regclass('public.inventory_item_categories')::text AS category_table,
      to_regclass('public.inventory_locations')::text AS location_table,
      to_regclass('public.vehicle_maintenance')::text AS maintenance_table,
      (
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plant' AND column_name = 'serial_number'
      ) AS plant_serial,
      (
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'source_reference'
      ) AS inventory_source,
      (
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_minor_plant_details'
          AND column_name = 'source_plant_id'
      ) AS minor_source_plant
  `);
  const schema = result.rows[0];
  if (
    schema?.plant_table !== 'plant'
    || schema.inventory_table !== 'inventory_items'
    || schema.minor_detail_table !== 'inventory_minor_plant_details'
    || schema.category_table !== 'inventory_item_categories'
    || schema.location_table !== 'inventory_locations'
    || schema.maintenance_table !== 'vehicle_maintenance'
    || schema.plant_serial !== 'serial_number'
    || schema.inventory_source !== 'source_reference'
    || schema.minor_source_plant !== 'source_plant_id'
  ) {
    throw new Error('Fleet and Inventory schema is not ready for the guarded sample fixture.');
  }
}

function allPlantDefinitions(fixture: FixtureDefinitions): PlantDefinition[] {
  return [...fixture.active_plants, ...fixture.minor_plant.map((entry) => entry.plant)];
}

function allInventoryDefinitions(fixture: FixtureDefinitions): InventoryDefinition[] {
  return [...fixture.small_tools, ...fixture.minor_plant.map((entry) => entry.item)];
}

async function loadCategoryCandidates(client: Client): Promise<CategoryCandidate[]> {
  const result = await client.query<CategoryCandidate>(`
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
  `, [
    ALL_PLANT_CATEGORY_NAME,
    SAMPLE_CATEGORY_NAME,
    SAMPLE_CATEGORY_ID,
    SAMPLE_CATEGORY_DESCRIPTION,
  ]);
  return result.rows;
}

async function assertInventoryPrerequisites(client: Client): Promise<string> {
  const categoryResult = await client.query<{ slug: string }>(`
    SELECT slug
    FROM public.inventory_item_categories
    WHERE slug = ANY($1::text[])
      AND is_active = TRUE
    ORDER BY slug
  `, [['tools', 'equipment', 'signs', 'minor_plant']]);
  const foundCategories = categoryResult.rows.map((row) => row.slug).sort();
  if (!arraysEqual(foundCategories, ['equipment', 'minor_plant', 'signs', 'tools'])) {
    throw new Error(`Required active Inventory categories are missing: ${JSON.stringify(foundCategories)}`);
  }

  const yardResult = await client.query<{ id: string }>(`
    SELECT id
    FROM public.inventory_locations
    WHERE LOWER(BTRIM(name)) = 'yard'
      AND is_active = TRUE
    ORDER BY id
  `);
  if (yardResult.rows.length !== 1) {
    throw new Error(`Expected exactly one active Yard location, found ${yardResult.rows.length}.`);
  }
  return yardResult.rows[0].id;
}

async function collisionCounts(
  client: Client,
  fixture: FixtureDefinitions
): Promise<Record<string, number>> {
  const plants = allPlantDefinitions(fixture);
  const inventory = allInventoryDefinitions(fixture);
  const detailIds = fixture.minor_plant.map((entry) => entry.detail_id);
  const maintenanceIds = fixture.active_plants.map((_, index) => fixtureUuid(301, index + 1));
  const result = await client.query<Record<string, string>>(`
    SELECT
      (
        SELECT COUNT(*)::text FROM public.plant
        WHERE id = ANY($1::uuid[])
           OR plant_id = ANY($2::text[])
           OR serial_number = ANY($3::text[])
           OR nickname LIKE 'SAMPLE %'
      ) AS plant,
      (
        SELECT COUNT(*)::text FROM public.inventory_items
        WHERE id = ANY($4::uuid[])
           OR item_number_normalized = ANY($5::text[])
           OR source = $6
           OR source_reference = ANY($7::text[])
      ) AS inventory,
      (
        SELECT COUNT(*)::text FROM public.inventory_minor_plant_details
        WHERE id = ANY($8::uuid[])
           OR source_plant_id = ANY($1::uuid[])
      ) AS minor_details,
      (
        SELECT COUNT(*)::text FROM public.vehicle_maintenance
        WHERE id = ANY($9::uuid[])
           OR plant_id = ANY($1::uuid[])
           OR notes = $6
      ) AS maintenance,
      (
        SELECT COUNT(*)::text FROM public.van_categories
        WHERE id = $10
           OR LOWER(BTRIM(name)) = LOWER($11)
           OR description = $12
      ) AS dedicated_category
  `, [
    plants.map((plant) => plant.id),
    plants.map((plant) => plant.plant_id),
    plants.map((plant) => plant.serial_number),
    inventory.map((item) => item.id),
    inventory.map((item) => item.item_number_normalized),
    FIXTURE_KEY,
    inventory.map((item) => item.source_reference),
    detailIds,
    maintenanceIds,
    SAMPLE_CATEGORY_ID,
    SAMPLE_CATEGORY_NAME,
    SAMPLE_CATEGORY_DESCRIPTION,
  ]);
  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
}

async function preflight(client: Client, fixture: FixtureDefinitions): Promise<PreflightResult> {
  await assertSchema(client);
  const yardLocationId = await assertInventoryPrerequisites(client);
  const candidates = await loadCategoryCandidates(client);
  const categoryPlan = determineCategoryPlan(candidates);
  const collisions = await collisionCounts(client, fixture);
  if (Object.values(collisions).some((count) => count > 0)) {
    throw new Error(`Fixture collision detected: ${JSON.stringify(collisions)}`);
  }
  return { categoryPlan, yardLocationId };
}

function writeManifest(manifest: FixtureManifest): string {
  const directory = resolve(process.cwd(), MANIFEST_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `plan-${manifest.generated_at.slice(0, 10)}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest: ${path}`);
  return path;
}

async function prepareCategory(client: Client, categoryPlan: CategoryPlan): Promise<string> {
  if (categoryPlan.strategy === 'existing') return categoryPlan.category_id;

  if (categoryPlan.strategy === 'temporary-patch') {
    const result = await client.query(`
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
    `, [
      categoryPlan.category_id,
      TEMPORARY_CATEGORY_DESCRIPTION,
      ALL_PLANT_CATEGORY_NAME,
      ALL_PLANT_CATEGORY_DESCRIPTION,
    ]);
    if (result.rowCount !== 1) {
      throw new Error('The All plant category changed after preflight; refusing the temporary patch.');
    }
    return categoryPlan.category_id;
  }

  const result = await client.query<{ id: string }>(`
    INSERT INTO public.van_categories (id, name, description, applies_to)
    VALUES ($1, $2, $3, ARRAY['plant']::text[])
    RETURNING id
  `, [SAMPLE_CATEGORY_ID, SAMPLE_CATEGORY_NAME, SAMPLE_CATEGORY_DESCRIPTION]);
  if (result.rows[0]?.id !== SAMPLE_CATEGORY_ID) {
    throw new Error('Unable to create the dedicated sample Plant category.');
  }
  return SAMPLE_CATEGORY_ID;
}

async function insertPlantRows(
  client: Client,
  fixture: FixtureDefinitions,
  categoryId: string
): Promise<void> {
  for (const plant of allPlantDefinitions(fixture)) {
    await client.query(`
      INSERT INTO public.plant (
        id, plant_id, nickname, make, model, serial_number, year, weight_class,
        category_id, loler_due_date, current_hours, status, reg_number,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, NULL,
        NULL, NULL
      )
    `, [
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
    ]);
  }

  for (const [index, plant] of fixture.active_plants.entries()) {
    await client.query(`
      INSERT INTO public.vehicle_maintenance (
        id, van_id, hgv_id, plant_id, current_hours, last_service_hours,
        next_service_hours, last_hours_update, notes, tracker_id,
        last_updated_by
      ) VALUES (
        $1, NULL, NULL, $2, $3, $4,
        $5, NOW(), $6, NULL,
        NULL
      )
    `, [
      fixtureUuid(301, index + 1),
      plant.id,
      plant.current_hours,
      plant.last_service_hours,
      plant.next_service_hours,
      FIXTURE_KEY,
    ]);
  }
}

async function insertInventoryRows(
  client: Client,
  fixture: FixtureDefinitions,
  yardLocationId: string
): Promise<void> {
  for (const item of allInventoryDefinitions(fixture)) {
    await client.query(`
      INSERT INTO public.inventory_items (
        id, item_number, item_number_normalized, name, category, location_id,
        last_checked_at, check_interval_days, status, source, source_reference,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, 'active', $9, $10,
        NULL, NULL
      )
    `, [
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
    ]);
  }

  for (const entry of fixture.minor_plant) {
    await client.query(`
      INSERT INTO public.inventory_minor_plant_details (
        id, inventory_item_id, source_plant_id, plant_identifier,
        make, model, serial_number, reg_number, year, weight_class,
        copied_at, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, NULL, $8, $9,
        NOW(), NULL, NULL
      )
    `, [
      entry.detail_id,
      entry.item.id,
      entry.plant.id,
      entry.plant.plant_id,
      entry.plant.make,
      entry.plant.model,
      entry.plant.serial_number,
      entry.plant.year,
      entry.plant.weight_class,
    ]);
  }
}

function toVerificationCounts(row: Record<string, string>): VerificationCounts {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)])
  ) as unknown as VerificationCounts;
}

async function verifyFixture(client: Client, fixture: FixtureDefinitions): Promise<VerificationCounts> {
  const plants = allPlantDefinitions(fixture);
  const inventory = allInventoryDefinitions(fixture);
  const maintenanceIds = fixture.active_plants.map((_, index) => fixtureUuid(301, index + 1));
  const result = await client.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*)::text FROM public.plant WHERE id = ANY($1::uuid[])) AS plant_rows,
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
        WHERE id = ANY($7::uuid[]) AND status = 'active' AND category <> 'minor_plant'
      ) AS small_tool_rows,
      (
        SELECT COUNT(*)::text FROM public.inventory_items
        WHERE id = ANY($8::uuid[]) AND status = 'active' AND category = 'minor_plant'
      ) AS minor_plant_rows,
      (
        SELECT COUNT(*)::text FROM public.inventory_minor_plant_details
        WHERE inventory_item_id = ANY($8::uuid[])
          AND source_plant_id = ANY($3::uuid[])
      ) AS minor_detail_rows,
      (
        SELECT COUNT(*)::text
        FROM public.plant AS plant
        JOIN public.inventory_items AS item
          ON item.source = 'fleet_plant'
         AND item.source_reference = plant.id::text
        WHERE plant.status = 'active'
          AND item.status = 'active'
          AND (plant.id = ANY($1::uuid[]) OR item.id = ANY($5::uuid[]))
      ) AS active_overlap,
      (
        SELECT COUNT(*)::text FROM public.plant
        WHERE id = ANY($1::uuid[]) AND reg_number IS NOT NULL
      ) AS registration_rows,
      (
        SELECT COUNT(*)::text FROM public.vehicle_maintenance
        WHERE id = ANY($4::uuid[]) AND tracker_id IS NOT NULL
      ) AS tracker_rows
  `, [
    plants.map((plant) => plant.id),
    fixture.active_plants.map((plant) => plant.id),
    fixture.minor_plant.map((entry) => entry.plant.id),
    maintenanceIds,
    inventory.map((item) => item.id),
    FIXTURE_KEY,
    fixture.small_tools.map((item) => item.id),
    fixture.minor_plant.map((entry) => entry.item.id),
  ]);
  const counts = toVerificationCounts(result.rows[0]);
  const expected: VerificationCounts = {
    plant_rows: plants.length,
    active_plant_rows: fixture.active_plants.length,
    inactive_backing_rows: fixture.minor_plant.length,
    maintenance_rows: fixture.active_plants.length,
    inventory_rows: inventory.length,
    small_tool_rows: fixture.small_tools.length,
    minor_plant_rows: fixture.minor_plant.length,
    minor_detail_rows: fixture.minor_plant.length,
    active_overlap: 0,
    registration_rows: 0,
    tracker_rows: 0,
  };
  if (Object.entries(expected).some(([key, value]) => counts[key as keyof VerificationCounts] !== value)) {
    throw new Error(`Fixture verification failed: ${JSON.stringify({ expected, actual: counts })}`);
  }
  return counts;
}

async function applyFixture(
  client: Client,
  fixture: FixtureDefinitions
): Promise<{ counts: VerificationCounts; categoryPlan: CategoryPlan }> {
  await client.query('BEGIN');
  try {
    const { categoryPlan, yardLocationId } = await preflight(client, fixture);
    const categoryId = await prepareCategory(client, categoryPlan);
    await insertPlantRows(client, fixture, categoryId);
    await insertInventoryRows(client, fixture, yardLocationId);
    const counts = await verifyFixture(client, fixture);
    await client.query('COMMIT');
    return { counts, categoryPlan };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function loadOwnedCategoryPlan(client: Client, fixture: FixtureDefinitions): Promise<CategoryPlan> {
  const categoryIds = Array.from(new Set(allPlantDefinitions(fixture).map((plant) => plant.id)));
  const result = await client.query<CategoryCandidate>(`
    SELECT
      category.id,
      category.name,
      category.description,
      category.applies_to,
      COUNT(plant.id)::int AS plant_usage_count
    FROM public.van_categories AS category
    JOIN public.plant AS owned_plant
      ON owned_plant.category_id = category.id
     AND owned_plant.id = ANY($1::uuid[])
    LEFT JOIN public.plant AS plant ON plant.category_id = category.id
    GROUP BY category.id
  `, [categoryIds]);
  if (result.rows.length !== 1) {
    throw new Error('Owned Plant rows do not resolve to exactly one category.');
  }
  const category = result.rows[0];
  if (
    category.id === SAMPLE_CATEGORY_ID
    && category.name === SAMPLE_CATEGORY_NAME
    && category.description === SAMPLE_CATEGORY_DESCRIPTION
    && arraysEqual(category.applies_to, ['plant'])
  ) {
    return {
      strategy: 'dedicated',
      category_id: category.id,
      category_name: category.name,
      original_applies_to: null,
    };
  }
  if (
    category.name === ALL_PLANT_CATEGORY_NAME
    && category.description === TEMPORARY_CATEGORY_DESCRIPTION
    && arraysEqual(category.applies_to, ['van', 'plant'])
  ) {
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
    && category.description !== TEMPORARY_CATEGORY_DESCRIPTION
  ) {
    return {
      strategy: 'existing',
      category_id: category.id,
      category_name: category.name,
      original_applies_to: category.applies_to,
    };
  }
  throw new Error('Owned Plant category does not match an expected fixture category state.');
}

function numberRow(row: Record<string, string>): DependencyCounts {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)])
  ) as unknown as DependencyCounts;
}

async function loadDependencyCounts(
  client: Client,
  fixture: FixtureDefinitions
): Promise<DependencyCounts> {
  const plantIds = allPlantDefinitions(fixture).map((plant) => plant.id);
  const itemIds = allInventoryDefinitions(fixture).map((item) => item.id);
  const result = await client.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*)::text FROM public.actions WHERE plant_id = ANY($1::uuid[])) AS actions,
      (
        SELECT COUNT(*)::text FROM public.asset_maintenance_category_values
        WHERE plant_id = ANY($1::uuid[])
      ) AS custom_maintenance_values,
      (SELECT COUNT(*)::text FROM public.dvla_sync_log WHERE plant_id = ANY($1::uuid[])) AS dvla_sync_logs,
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
        WHERE item_id = ANY($2::uuid[])
      ) AS inventory_checks,
      (
        SELECT COUNT(*)::text FROM public.inventory_item_group_members
        WHERE item_id = ANY($2::uuid[])
      ) AS inventory_groups,
      (
        SELECT COUNT(*)::text FROM public.inventory_item_movements
        WHERE item_id = ANY($2::uuid[])
      ) AS inventory_movements
  `, [plantIds, itemIds]);
  return numberRow(result.rows[0]);
}

async function assertOwnedRowsUnchanged(
  client: Client,
  fixture: FixtureDefinitions,
  yardLocationId: string,
  categoryPlan: CategoryPlan
): Promise<void> {
  const plants = allPlantDefinitions(fixture);
  const plantResult = await client.query<{
    id: string;
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    status: string | null;
    category_id: string;
    reg_number: string | null;
    updated_by: string | null;
  }>(`
    SELECT id, plant_id, nickname, serial_number, status, category_id, reg_number, updated_by
    FROM public.plant
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [plants.map((plant) => plant.id)]);
  const expectedPlantById = new Map(plants.map((plant) => [plant.id, plant]));
  const plantRowsMatch = plantResult.rows.length === plants.length && plantResult.rows.every((row) => {
    const expected = expectedPlantById.get(row.id);
    return Boolean(
      expected
      && row.plant_id === expected.plant_id
      && row.nickname === expected.nickname
      && row.serial_number === expected.serial_number
      && row.status === expected.status
      && row.category_id === categoryPlan.category_id
      && row.reg_number === null
      && row.updated_by === null
    );
  });
  if (!plantRowsMatch) {
    throw new Error('Owned Plant rows are missing or have changed; refusing cleanup.');
  }

  const inventory = allInventoryDefinitions(fixture);
  const inventoryResult = await client.query<{
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
  }>(`
    SELECT
      id, item_number, item_number_normalized, name, category, location_id,
      status, source, source_reference, updated_by
    FROM public.inventory_items
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [inventory.map((item) => item.id)]);
  const expectedInventoryById = new Map(inventory.map((item) => [item.id, item]));
  const inventoryRowsMatch = inventoryResult.rows.length === inventory.length && inventoryResult.rows.every((row) => {
    const expected = expectedInventoryById.get(row.id);
    return Boolean(
      expected
      && row.item_number === expected.item_number
      && row.item_number_normalized === expected.item_number_normalized
      && row.name === expected.name
      && row.category === expected.category
      && row.location_id === yardLocationId
      && row.status === 'active'
      && row.source === expected.source
      && row.source_reference === expected.source_reference
      && row.updated_by === null
    );
  });
  if (!inventoryRowsMatch) {
    throw new Error('Owned Inventory rows are missing or have changed; refusing cleanup.');
  }

  const detailResult = await client.query<{ id: string; inventory_item_id: string; source_plant_id: string | null }>(`
    SELECT id, inventory_item_id, source_plant_id
    FROM public.inventory_minor_plant_details
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [fixture.minor_plant.map((entry) => entry.detail_id)]);
  const expectedDetails = new Map(
    fixture.minor_plant.map((entry) => [
      entry.detail_id,
      { itemId: entry.item.id, plantId: entry.plant.id },
    ])
  );
  const detailsMatch = detailResult.rows.length === fixture.minor_plant.length && detailResult.rows.every((row) => {
    const expected = expectedDetails.get(row.id);
    return expected?.itemId === row.inventory_item_id && expected.plantId === row.source_plant_id;
  });
  if (!detailsMatch) {
    throw new Error('Owned Minor Plant detail rows are missing or have changed; refusing cleanup.');
  }

  const maintenanceResult = await client.query<{
    id: string;
    plant_id: string | null;
    notes: string | null;
    tracker_id: string | null;
  }>(`
    SELECT id, plant_id, notes, tracker_id
    FROM public.vehicle_maintenance
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [fixture.active_plants.map((_, index) => fixtureUuid(301, index + 1))]);
  const expectedMaintenance = new Map(
    fixture.active_plants.map((plant, index) => [fixtureUuid(301, index + 1), plant.id])
  );
  const maintenanceMatches =
    maintenanceResult.rows.length === fixture.active_plants.length
    && maintenanceResult.rows.every((row) =>
      expectedMaintenance.get(row.id) === row.plant_id
      && row.notes === FIXTURE_KEY
      && row.tracker_id === null
    );
  if (!maintenanceMatches) {
    throw new Error('Owned Plant maintenance rows are missing or have changed; refusing cleanup.');
  }
}

async function inspectCleanup(
  client: Client,
  fixture: FixtureDefinitions
): Promise<{
  categoryPlan: CategoryPlan;
  yardLocationId: string;
  counts: VerificationCounts;
  dependencies: DependencyCounts;
}> {
  await assertSchema(client);
  const yardLocationId = await assertInventoryPrerequisites(client);
  const categoryPlan = await loadOwnedCategoryPlan(client, fixture);
  const counts = await verifyFixture(client, fixture);
  const dependencies = await loadDependencyCounts(client, fixture);
  await assertOwnedRowsUnchanged(client, fixture, yardLocationId, categoryPlan);
  if (Object.values(dependencies).some((count) => count > 0)) {
    throw new Error(`Fixture has operational dependencies; refusing cleanup: ${JSON.stringify(dependencies)}`);
  }
  if (categoryPlan.strategy === 'temporary-patch') {
    const ownedPlantIds = allPlantDefinitions(fixture).map((plant) => plant.id);
    const unrelatedUsage = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM public.plant
      WHERE category_id = $1
        AND id <> ALL($2::uuid[])
    `, [categoryPlan.category_id, ownedPlantIds]);
    if (Number(unrelatedUsage.rows[0]?.count || 0) > 0) {
      throw new Error('The temporary All plant category is now used by unrelated Plant; refusing cleanup.');
    }
  }
  return { categoryPlan, yardLocationId, counts, dependencies };
}

async function removeFixture(
  client: Client,
  fixture: FixtureDefinitions,
  categoryPlan: CategoryPlan
): Promise<void> {
  const inventoryIds = allInventoryDefinitions(fixture).map((item) => item.id);
  const plantIds = allPlantDefinitions(fixture).map((plant) => plant.id);
  const maintenanceIds = fixture.active_plants.map((_, index) => fixtureUuid(301, index + 1));

  await client.query(`DELETE FROM public.inventory_items WHERE id = ANY($1::uuid[])`, [inventoryIds]);
  await client.query(`DELETE FROM public.vehicle_maintenance WHERE id = ANY($1::uuid[])`, [maintenanceIds]);
  await client.query(`DELETE FROM public.plant WHERE id = ANY($1::uuid[])`, [plantIds]);

  if (categoryPlan.strategy === 'temporary-patch') {
    const result = await client.query(`
      UPDATE public.van_categories
      SET applies_to = ARRAY['van']::text[],
          description = $2,
          updated_at = NOW()
      WHERE id = $1
        AND name = $3
        AND description = $4
        AND applies_to = ARRAY['van', 'plant']::text[]
        AND NOT EXISTS (SELECT 1 FROM public.plant WHERE category_id = $1)
    `, [
      categoryPlan.category_id,
      ALL_PLANT_CATEGORY_DESCRIPTION,
      ALL_PLANT_CATEGORY_NAME,
      TEMPORARY_CATEGORY_DESCRIPTION,
    ]);
    if (result.rowCount !== 1) {
      throw new Error('Unable to restore the temporary All plant category safely.');
    }
  }

  if (categoryPlan.strategy === 'dedicated') {
    const result = await client.query(`
      DELETE FROM public.van_categories
      WHERE id = $1
        AND name = $2
        AND description = $3
        AND applies_to = ARRAY['plant']::text[]
        AND NOT EXISTS (SELECT 1 FROM public.plant WHERE category_id = $1)
    `, [SAMPLE_CATEGORY_ID, SAMPLE_CATEGORY_NAME, SAMPLE_CATEGORY_DESCRIPTION]);
    if (result.rowCount !== 1) {
      throw new Error('Unable to remove the dedicated sample Plant category safely.');
    }
  }

  const remainingResult = await client.query<{ count: string }>(`
    SELECT (
      (SELECT COUNT(*) FROM public.plant WHERE id = ANY($1::uuid[]))
      + (SELECT COUNT(*) FROM public.inventory_items WHERE id = ANY($2::uuid[]))
      + (SELECT COUNT(*) FROM public.vehicle_maintenance WHERE id = ANY($3::uuid[]))
    )::text AS count
  `, [plantIds, inventoryIds, maintenanceIds]);
  if (Number(remainingResult.rows[0]?.count || 0) !== 0) {
    throw new Error('Fixture cleanup verification failed.');
  }
}

async function cleanupFixture(client: Client, fixture: FixtureDefinitions, isDryRun: boolean): Promise<void> {
  if (isDryRun) await client.query('BEGIN TRANSACTION READ ONLY');
  else await client.query('BEGIN');

  try {
    const inspection = await inspectCleanup(client, fixture);
    console.log('Owned fixture counts:', JSON.stringify(inspection.counts));
    console.log('Operational dependencies:', JSON.stringify(inspection.dependencies));
    console.log('Category strategy:', JSON.stringify(inspection.categoryPlan));
    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run only. No database writes were made.');
      return;
    }
    await removeFixture(client, fixture, inspection.categoryPlan);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function planFixture(
  client: Client,
  projectRef: string,
  fixtureDate: Date
): Promise<FixtureManifest> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const fixture = buildFixtureDefinitions(fixtureDate);
    const { categoryPlan } = await preflight(client, fixture);
    const manifest = createManifest(projectRef, categoryPlan, fixtureDate);
    await client.query('ROLLBACK');
    return manifest;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const mode = (process.argv.find((argument) => argument.startsWith('--mode='))?.split('=')[1] || 'plan') as Mode;
  if (!['plan', 'apply', 'cleanup'].includes(mode)) throw new Error('Invalid mode.');
  const isDryRun = process.argv.includes('--dry-run');
  if ((mode === 'apply' || (mode === 'cleanup' && !isDryRun)) && !process.argv.includes(CONFIRMATION)) {
    throw new Error(`Production confirmation required: ${CONFIRMATION}`);
  }

  const environment = requiredEnvironment();
  const client = createPgClient(environment.connectionString);
  const fixtureDate = new Date();
  const fixture = buildFixtureDefinitions(fixtureDate);
  await client.connect();
  try {
    if (mode === 'plan') {
      const manifest = await planFixture(client, environment.projectRef, fixtureDate);
      writeManifest(manifest);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    if (mode === 'apply') {
      const result = await applyFixture(client, fixture);
      const postCommitCounts = await verifyFixture(client, fixture);
      console.log('Applied fixture counts:', JSON.stringify(postCommitCounts));
      console.log('Category strategy:', JSON.stringify(result.categoryPlan));
      console.log(`Cleanup: npm run fleet-inventory:sample:cleanup -- ${CONFIRMATION}`);
      return;
    }
    await cleanupFixture(client, fixture, isDryRun);
    if (!isDryRun) console.log('SAMPLE Fleet and Inventory fixture removed.');
  } finally {
    await client.end();
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error(`Reference: ${randomUUID()}`);
    process.exitCode = 1;
  });
}
