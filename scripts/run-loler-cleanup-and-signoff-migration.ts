import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = [
  'supabase/migrations/20260515_remove_lo',
  'lor_and_publish_loler_signoff.sql',
].join('');
const LEGACY_LOLER_TYPO = ['LOLO', 'R'].join('');

interface DbColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function countRemainingLegacyLolerTypo(client: pg.Client) {
  const { rows: columns } = await client.query<DbColumn>(`
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
      AND c.is_generated = 'NEVER'
    ORDER BY c.table_name, c.column_name;
  `);

  let total = 0;
  const hits: string[] = [];

  for (const column of columns) {
    const tableName = `${quoteIdentifier(column.table_schema)}.${quoteIdentifier(column.table_name)}`;
    const columnName = quoteIdentifier(column.column_name);
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE ${columnName}::text ILIKE $1`,
      [`%${LEGACY_LOLER_TYPO}%`],
    );
    const count = Number(rows[0]?.count || '0');
    if (count > 0) {
      total += count;
      hits.push(`${column.table_schema}.${column.table_name}.${column.column_name}: ${count}`);
    }
  }

  return { total, hits };
}

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const remaining = await countRemainingLegacyLolerTypo(client);
    if (remaining.total > 0) {
      throw new Error(`Verification failed: remaining legacy LOLER typo values found:\n${remaining.hits.join('\n')}`);
    }

    const { rows } = await client.query<{
      template_count: string;
      signoff_count: string;
      pending_snapshot_count: string;
      pending_snapshot_with_signoff_count: string;
    }>(`
      WITH loler_templates AS (
        SELECT id
        FROM public.workshop_attachment_templates
        WHERE LOWER(name) = 'loler thorough examination'
      ),
      latest_published AS (
        SELECT DISTINCT ON (v.template_id) v.id, v.template_id
        FROM public.workshop_attachment_template_versions v
        INNER JOIN loler_templates t ON t.id = v.template_id
        WHERE v.status = 'published'
        ORDER BY v.template_id, v.version_number DESC
      ),
      required_signoff AS (
        SELECT lp.template_id
        FROM latest_published lp
        WHERE EXISTS (
          SELECT 1
          FROM public.workshop_attachment_template_sections s
          INNER JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE s.version_id = lp.id
            AND f.field_key = 'inspector_name'
            AND f.field_type = 'text'
            AND f.is_required = TRUE
        )
        AND EXISTS (
          SELECT 1
          FROM public.workshop_attachment_template_sections s
          INNER JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE s.version_id = lp.id
            AND f.field_key = 'inspector_signature'
            AND f.field_type = 'signature'
            AND f.is_required = TRUE
        )
      ),
      pending_snapshots AS (
        SELECT snapshot.id, snapshot.snapshot_json
        FROM public.workshop_attachment_schema_snapshots snapshot
        INNER JOIN public.workshop_task_attachments attachment
          ON attachment.id = snapshot.attachment_id
        INNER JOIN loler_templates template
          ON template.id = attachment.template_id
        WHERE attachment.status <> 'completed'
      )
      SELECT
        (SELECT COUNT(*)::text FROM loler_templates) AS template_count,
        (SELECT COUNT(*)::text FROM required_signoff) AS signoff_count,
        (SELECT COUNT(*)::text FROM pending_snapshots) AS pending_snapshot_count,
        (
          SELECT COUNT(*)::text
          FROM pending_snapshots
          WHERE snapshot_json::text ILIKE '%inspector_signature%'
        ) AS pending_snapshot_with_signoff_count;
    `);

    const verification = rows[0];
    if (!verification || Number(verification.template_count) < 1) {
      throw new Error('Verification failed: LOLER THOROUGH EXAMINATION template was not found');
    }
    if (Number(verification.signoff_count) !== Number(verification.template_count)) {
      throw new Error('Verification failed: latest LOLER template is missing required inspector sign-off fields');
    }
    if (Number(verification.pending_snapshot_count) !== Number(verification.pending_snapshot_with_signoff_count)) {
      throw new Error('Verification failed: at least one pending LOLER snapshot is missing inspector sign-off fields');
    }

    console.log('LOLER cleanup and sign-off migration verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
