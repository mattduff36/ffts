import { NextRequest, NextResponse } from 'next/server';
import pg from 'pg';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

const { Client } = pg;

interface MoveFromPlantBody {
  plant_ids?: string[];
}

interface PlantRow {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  reg_number: string | null;
  year: number | null;
  weight_class: string | null;
}

function createPgClient() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('Missing database connection string');

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

function normalizeInventoryItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}

function buildDisplayName(plant: PlantRow): string {
  return [plant.nickname, plant.make, plant.model].filter(Boolean).join(' ').trim() || plant.plant_id;
}

export async function POST(request: NextRequest) {
  let client: pg.Client | null = null;

  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json({ error: 'Fleet admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as MoveFromPlantBody;
    const plantIds = Array.from(new Set((body.plant_ids || []).filter(Boolean)));
    if (plantIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one Plant asset' }, { status: 400 });
    }

    client = createPgClient();
    await client.connect();
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE public.inventory_minor_plant_details
        ADD COLUMN IF NOT EXISTS serial_number TEXT
    `);

    const { rows: plants } = await client.query<PlantRow>(`
      SELECT id, plant_id, nickname, make, model, serial_number, reg_number, year, weight_class
      FROM public.plant
      WHERE id = ANY($1::uuid[])
        AND status = 'active'
      ORDER BY plant_id
    `, [plantIds]);

    const foundIds = new Set(plants.map((plant) => plant.id));
    const skipped = plantIds
      .filter((plantId) => !foundIds.has(plantId))
      .map((plantId) => ({ id: plantId, reason: 'Plant asset was not found or is not active' }));

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
      throw new Error('Unknown inventory location is required before moving Plant assets to inventory');
    }

    const moved: Array<{ id: string; plant_id: string; inventory_item_id: string }> = [];

    for (const plant of plants) {
      const normalizedItemNumber = normalizeInventoryItemNumber(plant.plant_id);
      const existingSource = await client.query<{ id: string; status: string }>(`
        SELECT id, status
        FROM public.inventory_items
        WHERE source = 'fleet_plant'
          AND source_reference = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [plant.id]);

      let inventoryItemId = existingSource.rows[0]?.id;
      if (inventoryItemId) {
        await client.query(`
          UPDATE public.inventory_items
          SET category = 'minor_plant',
              status = 'active',
              name = $2,
              location_id = COALESCE(location_id, $4),
              updated_by = $3,
              updated_at = NOW()
          WHERE id = $1
        `, [inventoryItemId, buildDisplayName(plant), access.userId, unknownLocationId]);
      } else {
        const conflict = await client.query<{ id: string }>(`
          SELECT id
          FROM public.inventory_items
          WHERE item_number_normalized = $1
            AND status = 'active'
          LIMIT 1
        `, [normalizedItemNumber]);

        if (conflict.rows[0]) {
          skipped.push({
            id: plant.id,
            reason: `Inventory item number already exists (${plant.plant_id})`,
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
            source_reference,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, 'minor_plant', $6, NULL, NULL, 'active', 'fleet_plant', $4, $5, $5)
          RETURNING id
        `, [plant.plant_id, normalizedItemNumber, buildDisplayName(plant), plant.id, access.userId, unknownLocationId]);
        inventoryItemId = insertedItem.rows[0]?.id;
      }

      if (!inventoryItemId) {
        skipped.push({ id: plant.id, reason: `Failed to create inventory item for ${plant.plant_id}` });
        continue;
      }

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
          copied_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $10)
        ON CONFLICT (inventory_item_id) DO UPDATE
        SET source_plant_id = EXCLUDED.source_plant_id,
            plant_identifier = EXCLUDED.plant_identifier,
            make = EXCLUDED.make,
            model = EXCLUDED.model,
            reg_number = EXCLUDED.reg_number,
            year = EXCLUDED.year,
            weight_class = EXCLUDED.weight_class,
            serial_number = EXCLUDED.serial_number,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
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
        access.userId,
      ]);

      await client.query(`
        UPDATE public.plant
        SET status = 'inactive',
            updated_by = $2,
            updated_at = NOW()
        WHERE id = $1
      `, [plant.id, access.userId]);

      moved.push({ id: plant.id, plant_id: plant.plant_id, inventory_item_id: inventoryItemId });
    }

    await client.query('COMMIT');
    return NextResponse.json({ moved, skipped, moved_count: moved.length, skipped_count: skipped.length });
  } catch (error) {
    try {
      await client?.query('ROLLBACK');
    } catch {
      // Ignore rollback errors when no transaction was opened.
    }
    console.error('Error moving Plant assets to Minor Plant inventory:', error);
    return NextResponse.json({ error: 'Failed to move Plant assets to Minor Plant inventory' }, { status: 500 });
  } finally {
    await client?.end().catch(() => {});
  }
}
