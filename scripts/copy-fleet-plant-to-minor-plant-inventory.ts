import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const fleetSmartBaseUrl = process.env.FLEETSMART_BASE_URL ?? 'https://www.fleetsmartlive.com';
const fleetSmartClientId = process.env.FLEETSMART_CLIENT_ID ?? '';
const fleetSmartApiKey = process.env.FLEETSMART_API_KEY ?? '';
const dryRun = process.argv.includes('--dry-run');

const MIN_FLEETSMART_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface PlantCandidate {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  reg_number: string | null;
  year: number | null;
  weight_class: string | null;
  loler_due_date: string | null;
  tax_due_date: string | null;
  next_service_hours: number | null;
}

interface FleetSmartVehicle {
  id: string;
  name: string;
  vrn: string;
}

interface CopySummaryItem {
  plant_id: string;
  id: string;
  name: string;
  reasons?: string[];
}

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

if (!fleetSmartClientId || !fleetSmartApiKey) {
  console.error('Missing FleetSmart credentials. Cannot determine live map matches safely.');
  process.exit(1);
}

function normalizeInventoryItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}

function normalizeRegistration(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

function buildDisplayName(plant: PlantCandidate): string {
  return [plant.nickname, plant.make, plant.model].filter(Boolean).join(' ').trim() || plant.plant_id;
}

function fleetSmartHeaders(): HeadersInit {
  return {
    'X-CLIENT-ID': fleetSmartClientId,
    'X-API-KEY': fleetSmartApiKey,
    'Content-Type': 'application/vnd.api+json',
  };
}

function matchFleetSmartAsset(
  vehicles: FleetSmartVehicle[],
  plantId: string,
  regNumber: string | null
): FleetSmartVehicle | null {
  for (const vehicle of vehicles) {
    if (
      plantId &&
      (vehicle.name?.endsWith(`/${plantId}`) || vehicle.name?.includes(`/${plantId}`))
    ) {
      return vehicle;
    }

    if (
      regNumber &&
      (normalizeRegistration(vehicle.vrn || '') === normalizeRegistration(regNumber) ||
        normalizeRegistration(vehicle.name || '') === normalizeRegistration(regNumber))
    ) {
      return vehicle;
    }
  }

  return null;
}

let lastFleetSmartRequestAt = 0;
async function throttleFleetSmartRequest() {
  const elapsed = Date.now() - lastFleetSmartRequestAt;
  if (elapsed < MIN_FLEETSMART_INTERVAL_MS) {
    await new Promise((resolveThrottle) => setTimeout(resolveThrottle, MIN_FLEETSMART_INTERVAL_MS - elapsed));
  }
  lastFleetSmartRequestAt = Date.now();
}

async function fetchFleetSmartJson(url: string): Promise<unknown> {
  await throttleFleetSmartRequest();
  const response = await fetch(url, {
    headers: fleetSmartHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`FleetSmart request failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchFleetSmartVehicles(): Promise<FleetSmartVehicle[]> {
  const json = await fetchFleetSmartJson(`${fleetSmartBaseUrl}/api/vehicles.json?page%5Bsize%5D=200`);
  if (!json || typeof json !== 'object') return [];
  const payload = json as { data?: FleetSmartVehicle[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function hasLatestFleetSmartLocation(vehicleId: string): Promise<boolean> {
  const json = await fetchFleetSmartJson(
    `${fleetSmartBaseUrl}/api/vehicle_locations?filter%5Bvehicle_id%5D=${vehicleId}&sort=-date_time&page%5Bsize%5D=1`
  );

  if (!json || typeof json !== 'object') return false;
  const payload = json as { data?: Array<{ attributes?: { latitude?: string; longitude?: string } }> };
  const latest = Array.isArray(payload.data) ? payload.data[0] : null;
  if (!latest?.attributes) return false;

  const lat = Number.parseFloat(latest.attributes.latitude || '');
  const lng = Number.parseFloat(latest.attributes.longitude || '');
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function getDueFieldReasons(plant: PlantCandidate): string[] {
  const reasons: string[] = [];
  if (plant.next_service_hours !== null) reasons.push('Service Due is set');
  if (plant.tax_due_date) reasons.push('Tax Due Date is set');
  if (plant.loler_due_date) reasons.push('LOLER Due is set');
  return reasons;
}

async function ensureSerialNumberColumn(client: pg.Client, shouldCreate: boolean) {
  if (!shouldCreate) return false;

  await client.query(`
    ALTER TABLE public.inventory_minor_plant_details
      ADD COLUMN IF NOT EXISTS serial_number TEXT
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS inventory_minor_plant_details_serial_number_idx
      ON public.inventory_minor_plant_details (serial_number)
      WHERE serial_number IS NOT NULL
  `);

  await client.query(`
    COMMENT ON COLUMN public.inventory_minor_plant_details.serial_number
      IS 'Copied Fleet Plant serial number for Minor Plant inventory records'
  `);

  return true;
}

async function main() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  const copied: CopySummaryItem[] = [];
  const alreadyCopied: CopySummaryItem[] = [];
  const hasMap: CopySummaryItem[] = [];
  const manualReview: CopySummaryItem[] = [];
  const itemNumberConflicts: CopySummaryItem[] = [];

  try {
    await client.connect();

    const { rows: plantRows } = await client.query<PlantCandidate>(`
      SELECT
        p.id,
        p.plant_id,
        p.nickname,
        p.make,
        p.model,
        p.serial_number,
        p.reg_number,
        p.year,
        p.weight_class,
        p.loler_due_date,
        vm.tax_due_date,
        vm.next_service_hours
      FROM public.plant p
      LEFT JOIN LATERAL (
        SELECT tax_due_date, next_service_hours
        FROM public.vehicle_maintenance
        WHERE plant_id = p.id
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      ) vm ON TRUE
      WHERE p.status = 'active'
      ORDER BY p.plant_id
    `);

    console.log(`Loaded ${plantRows.length} active Fleet Plant assets.`);
    console.log('Fetching FleetSmart vehicle list...');
    const fleetSmartVehicles = await fetchFleetSmartVehicles();
    console.log(`Loaded ${fleetSmartVehicles.length} FleetSmart vehicles.`);

    const noMapCandidates: PlantCandidate[] = [];

    for (const plant of plantRows) {
      const displayName = buildDisplayName(plant);
      const matched = matchFleetSmartAsset(fleetSmartVehicles, plant.plant_id, plant.reg_number);
      if (!matched) {
        noMapCandidates.push(plant);
        continue;
      }

      const hasLocation = await hasLatestFleetSmartLocation(matched.id);
      if (hasLocation) {
        hasMap.push({ id: plant.id, plant_id: plant.plant_id, name: displayName });
      } else {
        noMapCandidates.push(plant);
      }
    }

    console.log(`${noMapCandidates.length} active Plant assets have no live map pin.`);

    const eligible = noMapCandidates.filter((plant) => {
      const reasons = getDueFieldReasons(plant);
      if (reasons.length > 0) {
        manualReview.push({
          id: plant.id,
          plant_id: plant.plant_id,
          name: buildDisplayName(plant),
          reasons,
        });
        return false;
      }
      return true;
    });

    const hasCopiedSerialNumbers = eligible.some((plant) => Boolean(plant.serial_number?.trim()));
    console.log(`${eligible.length} Plant assets are eligible to copy after due-field checks.`);
    console.log(`Serial number detail column needed: ${hasCopiedSerialNumbers ? 'yes' : 'no'}`);

    if (dryRun) {
      console.log('Dry run only. No database writes were made.');
    } else {
      await client.query('BEGIN');
      const serialNumberColumnCreated = await ensureSerialNumberColumn(client, hasCopiedSerialNumbers);

      const { rows: existingRows } = await client.query<{
        id: string;
        item_number_normalized: string;
        source: string | null;
        source_reference: string | null;
      }>(`
        SELECT id, item_number_normalized, source, source_reference
        FROM public.inventory_items
        WHERE status = 'active'
      `);

      const existingByNormalizedNumber = new Map(existingRows.map((row) => [row.item_number_normalized, row]));
      const existingFleetPlantSourceRefs = new Set(
        existingRows
          .filter((row) => row.source === 'fleet_plant' && row.source_reference)
          .map((row) => row.source_reference)
      );
      const { rows: unknownLocationRows } = await client.query<{ id: string }>(`
        SELECT id
        FROM public.inventory_locations
        WHERE LOWER(BTRIM(name)) = 'unknown'
          AND is_active = TRUE
        ORDER BY created_at
        LIMIT 1
      `);
      const unknownLocationId = unknownLocationRows[0]?.id;
      if (!unknownLocationId) {
        throw new Error('Unknown inventory location is required before copying Fleet Plant into inventory');
      }

      for (const plant of eligible) {
        const displayName = buildDisplayName(plant);
        const normalizedItemNumber = normalizeInventoryItemNumber(plant.plant_id);

        if (existingFleetPlantSourceRefs.has(plant.id)) {
          alreadyCopied.push({ id: plant.id, plant_id: plant.plant_id, name: displayName });
          continue;
        }

        const existingItem = existingByNormalizedNumber.get(normalizedItemNumber);
        if (existingItem) {
          itemNumberConflicts.push({
            id: plant.id,
            plant_id: plant.plant_id,
            name: displayName,
            reasons: [`Inventory item number already exists (${plant.plant_id})`],
          });
          continue;
        }

        const insertedItem = await client.query<{ id: string }>(`
          INSERT INTO public.inventory_items (
            item_number,
            item_number_normalized,
            name,
            category,
            location_id,
            last_checked_at,
            check_interval_days,
            status,
            source,
            source_reference
          )
          VALUES ($1, $2, $3, 'minor_plant', $5, NULL, NULL, 'active', 'fleet_plant', $4)
          RETURNING id
        `, [plant.plant_id, normalizedItemNumber, displayName, plant.id, unknownLocationId]);

        const inventoryItemId = insertedItem.rows[0]?.id;
        if (!inventoryItemId) {
          throw new Error(`Failed to insert inventory item for ${plant.plant_id}`);
        }

        if (serialNumberColumnCreated) {
          await client.query(`
            INSERT INTO public.inventory_minor_plant_details (
              inventory_item_id,
              source_plant_id,
              plant_identifier,
              make,
              model,
              reg_number,
              year,
              weight_class,
              serial_number,
              copied_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          `, [
            inventoryItemId,
            plant.id,
            plant.plant_id,
            plant.make,
            plant.model,
            plant.reg_number,
            plant.year,
            plant.weight_class,
            plant.serial_number?.trim() || null,
          ]);
        } else {
          await client.query(`
            INSERT INTO public.inventory_minor_plant_details (
              inventory_item_id,
              source_plant_id,
              plant_identifier,
              make,
              model,
              reg_number,
              year,
              weight_class,
              copied_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `, [
            inventoryItemId,
            plant.id,
            plant.plant_id,
            plant.make,
            plant.model,
            plant.reg_number,
            plant.year,
            plant.weight_class,
          ]);
        }

        copied.push({ id: plant.id, plant_id: plant.plant_id, name: displayName });
        existingByNormalizedNumber.set(normalizedItemNumber, {
          id: inventoryItemId,
          item_number_normalized: normalizedItemNumber,
          source: 'fleet_plant',
          source_reference: plant.id,
        });
        existingFleetPlantSourceRefs.add(plant.id);
      }

      await client.query('COMMIT');
    }

    console.log('\nMinor Plant copy summary');
    console.log(JSON.stringify({
      dry_run: dryRun,
      active_plant_count: plantRows.length,
      has_live_map_pin_count: hasMap.length,
      no_live_map_pin_count: noMapCandidates.length,
      eligible_count: eligible.length,
      copied_count: copied.length,
      already_copied_count: alreadyCopied.length,
      item_number_conflict_count: itemNumberConflicts.length,
      manual_review_count: manualReview.length,
      serial_number_column_needed: hasCopiedSerialNumbers,
      copied,
      already_copied: alreadyCopied,
      item_number_conflicts: itemNumberConflicts,
      manual_review: manualReview,
    }, null, 2));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors when no transaction is open.
    }
    console.error('Fleet Plant to Minor Plant copy failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
