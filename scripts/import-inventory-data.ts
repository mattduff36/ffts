import { config } from 'dotenv';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sourceFiles = ['data/COMPLETE LIST 2023.xlsx', 'data/GANGS MINOR PLANT.xlsx'];
const importPolicy = 'dedupe_by_item_number_prefer_most_recent_checked_date_skip_sold_scrap_and_missing_ids';

interface SourceRow {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  source: 'complete-list' | 'gangs-minor-plant';
  itemNumber: string;
  normalizedItemNumber: string;
  name: string;
  location: string;
  checkedDate: Date | null;
  rawDate: string;
  notes: string;
  isSoldOrScrap: boolean;
}

interface ImportException {
  kind: string;
  itemNumber?: string;
  itemName?: string;
  sourceFile: string;
  sourceSheet?: string;
  sourceRow?: number;
  rawPayload: unknown;
  resolution: string;
}

interface DedupedItem extends SourceRow {
  targetBucket: 'Yard' | 'Unknown';
  groupedRows: SourceRow[];
}

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    return JSON.stringify(value);
  }

  return String(value).trim();
}

function parseSpreadsheetDate(value: ExcelJS.CellValue | undefined): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = cellText(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const slashDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!slashDate) return null;

  const [, day, month, year] = slashDate;
  const fullYear = year.length === 2 ? `20${year}` : year;
  const normalized = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);

  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function normalizeItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}

function isMissingItemNumber(normalizedItemNumber: string): boolean {
  return !normalizedItemNumber || normalizedItemNumber === 'NONUMBER';
}

function isSoldOrScrap(row: Pick<SourceRow, 'itemNumber' | 'name' | 'location' | 'rawDate' | 'notes'>): boolean {
  return /\b(sold|scrap|scrapped)\b/i.test(
    [row.itemNumber, row.name, row.location, row.rawDate, row.notes].join(' ')
  );
}

function toDateString(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

async function readCompleteList(): Promise<SourceRow[]> {
  const workbook = new ExcelJS.Workbook();
  const sourceFile = sourceFiles[0];
  await workbook.xlsx.readFile(resolve(process.cwd(), sourceFile));
  const worksheet = workbook.getWorksheet('COMPLETE');
  if (!worksheet) throw new Error('COMPLETE sheet not found in COMPLETE LIST 2023.xlsx');

  const rows: SourceRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const itemNumber = cellText(row.getCell(1).value);
    const name = cellText(row.getCell(2).value);
    const location = cellText(row.getCell(3).value);
    const rawDate = cellText(row.getCell(4).value);
    if (![itemNumber, name, location, rawDate].some(Boolean)) continue;

    const normalizedItemNumber = normalizeItemNumber(itemNumber);
    const sourceRow: SourceRow = {
      sourceFile,
      sourceSheet: 'COMPLETE',
      sourceRow: rowNumber,
      source: 'complete-list',
      itemNumber,
      normalizedItemNumber,
      name,
      location,
      checkedDate: parseSpreadsheetDate(row.getCell(4).value),
      rawDate,
      notes: '',
      isSoldOrScrap: false,
    };

    sourceRow.isSoldOrScrap = isSoldOrScrap(sourceRow);
    rows.push(sourceRow);
  }

  return rows;
}

async function readGangsMinorPlant(): Promise<SourceRow[]> {
  const workbook = new ExcelJS.Workbook();
  const sourceFile = sourceFiles[1];
  await workbook.xlsx.readFile(resolve(process.cwd(), sourceFile));

  const rows: SourceRow[] = [];
  for (const worksheet of workbook.worksheets) {
    if (!worksheet.rowCount) continue;

    const bucket = cellText(worksheet.getRow(1).getCell(2).value) || worksheet.name;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const name = cellText(row.getCell(1).value);
      const itemNumber = cellText(row.getCell(2).value);
      const rawDate = cellText(row.getCell(3).value);
      const notes = cellText(row.getCell(4).value);
      if (![itemNumber, name, rawDate, notes].some(Boolean)) continue;

      const normalizedItemNumber = normalizeItemNumber(itemNumber);
      const sourceRow: SourceRow = {
        sourceFile,
        sourceSheet: worksheet.name,
        sourceRow: rowNumber,
        source: 'gangs-minor-plant',
        itemNumber,
        normalizedItemNumber,
        name,
        location: bucket,
        checkedDate: parseSpreadsheetDate(row.getCell(3).value),
        rawDate,
        notes,
        isSoldOrScrap: false,
      };

      sourceRow.isSoldOrScrap = isSoldOrScrap(sourceRow);
      rows.push(sourceRow);
    }
  }

  return rows;
}

function buildDedupedItems(rows: SourceRow[]): {
  items: DedupedItem[];
  exceptions: ImportException[];
} {
  const exceptions: ImportException[] = [];
  const candidateRows: SourceRow[] = [];

  for (const row of rows) {
    if (row.isSoldOrScrap) {
      exceptions.push({
        kind: 'skipped_sold_scrap',
        itemNumber: row.itemNumber,
        itemName: row.name,
        sourceFile: row.sourceFile,
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        rawPayload: row,
        resolution: 'Skipped because the row is marked sold/scrap.',
      });
      continue;
    }

    if (isMissingItemNumber(row.normalizedItemNumber)) {
      exceptions.push({
        kind: 'skipped_missing_id',
        itemNumber: row.itemNumber || undefined,
        itemName: row.name,
        sourceFile: row.sourceFile,
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        rawPayload: row,
        resolution: 'Skipped because the row has no usable item number.',
      });
      continue;
    }

    candidateRows.push(row);
  }

  const rowsByItemNumber = new Map<string, SourceRow[]>();
  for (const row of candidateRows) {
    const existing = rowsByItemNumber.get(row.normalizedItemNumber) || [];
    existing.push(row);
    rowsByItemNumber.set(row.normalizedItemNumber, existing);
  }

  const items: DedupedItem[] = [];
  for (const [normalizedItemNumber, groupedRows] of rowsByItemNumber.entries()) {
    const sortedRows = [...groupedRows].sort((a, b) => {
      if (a.checkedDate && b.checkedDate) return b.checkedDate.getTime() - a.checkedDate.getTime();
      if (a.checkedDate) return -1;
      if (b.checkedDate) return 1;
      return a.sourceRow - b.sourceRow;
    });

    const chosen = sortedRows[0];
    const hasYardLocation = groupedRows.some((row) => row.location.trim().toLowerCase() === 'yard');
    const item: DedupedItem = {
      ...chosen,
      targetBucket: hasYardLocation ? 'Yard' : 'Unknown',
      groupedRows,
    };

    items.push(item);

    if (groupedRows.length > 1) {
      exceptions.push({
        kind: 'duplicate_item_number',
        itemNumber: normalizedItemNumber,
        itemName: chosen.name,
        sourceFile: chosen.sourceFile,
        sourceSheet: chosen.sourceSheet,
        sourceRow: chosen.sourceRow,
        rawPayload: {
          chosen,
          groupedRows,
        },
        resolution: 'Imported one record for the item number, preferring the most recent valid checked date.',
      });
    }

    if (!chosen.checkedDate) {
      exceptions.push({
        kind: 'missing_checked_date',
        itemNumber: normalizedItemNumber,
        itemName: chosen.name,
        sourceFile: chosen.sourceFile,
        sourceSheet: chosen.sourceSheet,
        sourceRow: chosen.sourceRow,
        rawPayload: chosen,
        resolution: 'Imported with a blank last checked date so it appears as Needs Check.',
      });
    }
  }

  return { items, exceptions };
}

async function getOrCreateLocation(
  client: pg.Client,
  params: {
    name: string;
    description?: string;
    linkedVanId?: string | null;
    linkedHgvId?: string | null;
    linkedPlantId?: string | null;
  }
): Promise<string> {
  if (params.linkedVanId) {
    const existingLinked = await client.query<{ id: string }>(
      'SELECT id FROM public.inventory_locations WHERE linked_van_id = $1 AND is_active = TRUE LIMIT 1',
      [params.linkedVanId]
    );
    if (existingLinked.rowCount) return existingLinked.rows[0].id;
  }

  const existingByName = await client.query<{ id: string }>(
    'SELECT id FROM public.inventory_locations WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($1)) AND is_active = TRUE LIMIT 1',
    [params.name]
  );
  if (existingByName.rowCount) {
    const locationId = existingByName.rows[0].id;
    await client.query(
      `
        UPDATE public.inventory_locations
        SET description = COALESCE($2, description),
            linked_van_id = COALESCE($3, linked_van_id),
            linked_hgv_id = COALESCE($4, linked_hgv_id),
            linked_plant_id = COALESCE($5, linked_plant_id)
        WHERE id = $1
      `,
      [
        locationId,
        params.description || null,
        params.linkedVanId || null,
        params.linkedHgvId || null,
        params.linkedPlantId || null,
      ]
    );
    return locationId;
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO public.inventory_locations (
        name,
        description,
        linked_van_id,
        linked_hgv_id,
        linked_plant_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [
      params.name,
      params.description || null,
      params.linkedVanId || null,
      params.linkedHgvId || null,
      params.linkedPlantId || null,
    ]
  );

  return inserted.rows[0].id;
}

async function createVanBuckets(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{
    id: string;
    reg_number: string;
  }>(`
    SELECT id, reg_number
    FROM public.vans
    WHERE COALESCE(status, 'active') = 'active'
      AND COALESCE(asset_type, 'vehicle') = 'vehicle'
    ORDER BY reg_number
  `);

  for (const van of rows) {
    await getOrCreateLocation(client, {
      name: `Van - ${van.reg_number}`,
      description: `Linked van asset ${van.reg_number}`,
      linkedVanId: van.id,
    });
  }

  return rows.length;
}

async function insertException(client: pg.Client, batchId: string, exception: ImportException) {
  await client.query(
    `
      INSERT INTO public.inventory_import_exceptions (
        batch_id,
        kind,
        item_number,
        item_name,
        source_file,
        source_sheet,
        source_row,
        raw_payload,
        resolution
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    `,
    [
      batchId,
      exception.kind,
      exception.itemNumber || null,
      exception.itemName || null,
      exception.sourceFile,
      exception.sourceSheet || null,
      exception.sourceRow || null,
      JSON.stringify(exception.rawPayload),
      exception.resolution,
    ]
  );
}

async function importInventory() {
  const client = createClient();

  try {
    console.log('Reading inventory spreadsheets...');
    const rows = [...await readCompleteList(), ...await readGangsMinorPlant()];
    const { items, exceptions } = buildDedupedItems(rows);

    await client.connect();
    await client.query('BEGIN');

    const batchResult = await client.query<{ id: string }>(
      `
        INSERT INTO public.inventory_import_batches (source_files, import_policy)
        VALUES ($1::text[], $2)
        RETURNING id
      `,
      [sourceFiles, importPolicy]
    );
    const batchId = batchResult.rows[0].id;

    const yardLocationId = await getOrCreateLocation(client, {
      name: 'Yard',
      description: 'Main yard location bucket.',
    });
    const unknownLocationId = await getOrCreateLocation(client, {
      name: 'Unknown',
      description: 'System location for inventory items that cannot currently be found.',
    });
    const vanBucketCount = await createVanBuckets(client);

    let importedCount = 0;
    for (const item of items) {
      const locationId = item.targetBucket === 'Yard' ? yardLocationId : unknownLocationId;
      await client.query(
        `
          INSERT INTO public.inventory_items (
            item_number,
            item_number_normalized,
            name,
            category,
            location_id,
            last_checked_at,
            status,
            source,
            source_reference
          )
          VALUES ($1, $2, $3, 'minor_plant', $4, $5, 'active', $6, $7)
          ON CONFLICT (item_number_normalized) DO UPDATE
          SET item_number = EXCLUDED.item_number,
              name = EXCLUDED.name,
              category = EXCLUDED.category,
              location_id = EXCLUDED.location_id,
              last_checked_at = EXCLUDED.last_checked_at,
              status = 'active',
              source = EXCLUDED.source,
              source_reference = EXCLUDED.source_reference,
              updated_at = NOW()
        `,
        [
          item.itemNumber,
          item.normalizedItemNumber,
          item.name || item.itemNumber,
          locationId,
          toDateString(item.checkedDate),
          item.source,
          `${item.sourceSheet}#${item.sourceRow}`,
        ]
      );
      importedCount += 1;
    }

    for (const exception of exceptions) {
      await insertException(client, batchId, exception);
    }

    const skippedCount = exceptions.filter((exception) => exception.kind.startsWith('skipped_')).length;
    const duplicateCount = exceptions.filter((exception) => exception.kind === 'duplicate_item_number').length;

    await client.query(
      `
        UPDATE public.inventory_import_batches
        SET imported_count = $2,
            skipped_count = $3,
            duplicate_count = $4,
            exception_count = $5,
            completed_at = NOW()
        WHERE id = $1
      `,
      [batchId, importedCount, skippedCount, duplicateCount, exceptions.length]
    );

    await client.query('COMMIT');

    console.log('Inventory import completed.');
    console.log(`Source rows: ${rows.length}`);
    console.log(`Imported inventory items: ${importedCount}`);
    console.log(`Created/verified van buckets: ${vanBucketCount}`);
    console.log(`Skipped rows: ${skippedCount}`);
    console.log(`Duplicate groups logged: ${duplicateCount}`);
    console.log(`Exceptions logged: ${exceptions.length}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Inventory import failed:', error);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

importInventory();
