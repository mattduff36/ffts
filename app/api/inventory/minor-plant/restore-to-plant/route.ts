import { NextRequest, NextResponse } from 'next/server';
import pg from 'pg';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

const { Client } = pg;

interface RestoreToPlantBody {
  item_ids?: string[];
}

interface RestoreRow {
  inventory_item_id: string;
  item_number: string;
  source_plant_id: string | null;
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

    const body = (await request.json()) as RestoreToPlantBody;
    const itemIds = Array.from(new Set((body.item_ids || []).filter(Boolean)));
    if (itemIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one Minor Plant inventory item' }, { status: 400 });
    }

    client = createPgClient();
    await client.connect();
    await client.query('BEGIN');

    const { rows } = await client.query<RestoreRow>(`
      SELECT
        i.id AS inventory_item_id,
        i.item_number,
        d.source_plant_id
      FROM public.inventory_items i
      LEFT JOIN public.inventory_minor_plant_details d
        ON d.inventory_item_id = i.id
      WHERE i.id = ANY($1::uuid[])
        AND i.status = 'active'
        AND i.category = 'minor_plant'
    `, [itemIds]);

    const foundItemIds = new Set(rows.map((row) => row.inventory_item_id));
    const skipped = itemIds
      .filter((itemId) => !foundItemIds.has(itemId))
      .map((itemId) => ({ id: itemId, reason: 'Minor Plant inventory item was not found or is not active' }));

    const restored: Array<{ inventory_item_id: string; source_plant_id: string; item_number: string }> = [];

    for (const row of rows) {
      if (!row.source_plant_id) {
        skipped.push({
          id: row.inventory_item_id,
          reason: 'Minor Plant item is not linked to a source Plant asset',
        });
        continue;
      }

      const plantUpdate = await client.query<{ id: string }>(`
        UPDATE public.plant
        SET status = 'active',
            retired_at = NULL,
            retire_reason = NULL,
            updated_by = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `, [row.source_plant_id, access.userId]);

      if (!plantUpdate.rows[0]) {
        skipped.push({
          id: row.inventory_item_id,
          reason: 'Linked source Plant asset was not found',
        });
        continue;
      }

      await client.query(`
        UPDATE public.inventory_items
        SET status = 'retired',
            retired_at = NOW(),
            retire_reason = 'Returned',
            retired_by = $2,
            updated_by = $2,
            updated_at = NOW()
        WHERE id = $1
      `, [row.inventory_item_id, access.userId]);

      restored.push({
        inventory_item_id: row.inventory_item_id,
        source_plant_id: row.source_plant_id,
        item_number: row.item_number,
      });
    }

    await client.query('COMMIT');
    return NextResponse.json({ restored, skipped, restored_count: restored.length, skipped_count: skipped.length });
  } catch (error) {
    try {
      await client?.query('ROLLBACK');
    } catch {
      // Ignore rollback errors when no transaction was opened.
    }
    console.error('Error restoring Minor Plant inventory items to Plant assets:', error);
    return NextResponse.json({ error: 'Failed to restore Minor Plant inventory items to Plant assets' }, { status: 500 });
  } finally {
    await client?.end().catch(() => {});
  }
}
