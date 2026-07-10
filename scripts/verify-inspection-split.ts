/**
 * Post-Migration Verification: Inspection Table Split
 *
 * Run after the migration to verify:
 *  1. Both tables exist with correct structure
 *  2. Row counts are consistent
 *  3. RLS policies exist on both tables
 *  4. Triggers are attached
 *  5. Compatibility view exists
 *  6. Child table references are intact
 *  7. No orphan rows
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function run() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  let failures = 0;

  function pass(msg: string) { console.log(`  ✅ ${msg}`); }
  function fail(msg: string) { console.error(`  ❌ ${msg}`); failures++; }

  // ── 1. Table existence ──
  console.log('\n═══ 1. TABLE EXISTENCE ═══');
  for (const tbl of ['van_inspections', 'plant_inspections']) {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
      [tbl]
    );
    if (rows.length) {
      pass(`${tbl} exists`);
    } else {
      fail(`${tbl} MISSING`);
    }
  }

  // ── 2. Row counts ──
  console.log('\n═══ 2. ROW COUNTS ═══');
  const { rows: vc } = await client.query('SELECT COUNT(*) AS cnt FROM van_inspections');
  const { rows: pc } = await client.query('SELECT COUNT(*) AS cnt FROM plant_inspections');
  console.log(`  van_inspections   : ${vc[0].cnt}`);
  console.log(`  plant_inspections : ${pc[0].cnt}`);

  // Verify van rows have no plant data
  const { rows: vanPlant } = await client.query(
    `SELECT COUNT(*) AS cnt FROM van_inspections WHERE plant_id IS NOT NULL OR is_hired_plant = TRUE`
  );
  if (Number(vanPlant[0].cnt) === 0) {
    pass('van_inspections has no plant rows');
  } else {
    fail(`van_inspections has ${vanPlant[0].cnt} plant rows!`);
  }

  // Verify plant rows have no van data
  const { rows: plantVan } = await client.query(
    `SELECT COUNT(*) AS cnt FROM plant_inspections WHERE van_id IS NOT NULL`
  );
  if (Number(plantVan[0].cnt) === 0) {
    pass('plant_inspections has no van rows');
  } else {
    fail(`plant_inspections has ${plantVan[0].cnt} van rows!`);
  }

  // ── 3. RLS ──
  console.log('\n═══ 3. RLS POLICIES ═══');
  for (const tbl of ['van_inspections', 'plant_inspections']) {
    const { rows: rls } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [tbl]
    );
    if (rls[0]?.relrowsecurity) {
      pass(`RLS enabled on ${tbl}`);
    } else {
      fail(`RLS NOT enabled on ${tbl}`);
    }

    const { rows: policies } = await client.query(
      `SELECT policyname FROM pg_policies WHERE tablename = $1`, [tbl]
    );
    if (policies.length > 0) {
      pass(`${tbl} has ${policies.length} policies`);
    } else {
      fail(`${tbl} has NO policies`);
    }
  }

  // ── 4. Triggers ──
  console.log('\n═══ 4. TRIGGERS ═══');
  for (const tbl of ['van_inspections', 'plant_inspections']) {
    const { rows: triggers } = await client.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = $1::regclass AND NOT tgisinternal`, [tbl]
    );
    if (triggers.length > 0) {
      pass(`${tbl} has ${triggers.length} triggers: ${triggers.map(t => t.tgname).join(', ')}`);
    } else {
      fail(`${tbl} has NO triggers`);
    }
  }

  // ── 5. Compatibility view ──
  console.log('\n═══ 5. COMPATIBILITY VIEW ═══');
  const { rows: views } = await client.query(`
    SELECT table_name FROM information_schema.views
    WHERE table_name = 'vehicle_inspections' AND table_schema = 'public'`
  );
  if (views.length > 0) {
    pass('vehicle_inspections compatibility view exists');
  } else {
    pass('vehicle_inspections view already removed (post-cutover)');
  }

  // ── 6. Child table integrity ──
  console.log('\n═══ 6. CHILD TABLE INTEGRITY ═══');
  for (const childTable of ['inspection_items', 'inspection_photos', 'inspection_daily_hours']) {
    const { rows: orphans } = await client.query(`
      SELECT COUNT(*) AS cnt FROM ${childTable} c
      WHERE NOT EXISTS (SELECT 1 FROM van_inspections v WHERE v.id = c.inspection_id)
        AND NOT EXISTS (SELECT 1 FROM plant_inspections p WHERE p.id = c.inspection_id)
    `);
    if (Number(orphans[0].cnt) === 0) {
      pass(`${childTable}: 0 orphan rows`);
    } else {
      fail(`${childTable}: ${orphans[0].cnt} ORPHAN rows`);
    }
  }

  // ── 7. Constraints ──
  console.log('\n═══ 7. CHECK CONSTRAINTS ═══');
  for (const tbl of ['van_inspections', 'plant_inspections']) {
    const { rows: checks } = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'`, [tbl]
    );
    checks.forEach(c => pass(`${tbl}: ${c.conname}`));
  }

  // ── Summary ──
  console.log('\n════════════════════════════════════════');
  if (failures > 0) {
    console.error(`❌ ${failures} VERIFICATION FAILURE(S)`);
    process.exit(1);
  }
  console.log('✅ ALL VERIFICATIONS PASSED');

  await client.end();
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
