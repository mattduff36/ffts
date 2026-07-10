/**
 * Static Guard: No runtime references to vehicle_inspections + stale labels
 *
 * Scans app/, lib/, components/ for forbidden references to the old
 * vehicle_inspections table AND stale "Vehicle" UI labels that should
 * now say "Van" or "Asset" after the inspections split.
 *
 * Allowlisted patterns:
 * - FK constraint hint names (!vehicle_inspections_*_fkey) are expected
 * - Supabase PostgREST uses original constraint names after table rename
 * - Fleet/maintenance code correctly uses "Vehicle" for fleet domain entities
 *
 * Usage: node scripts/guards/no-vehicle-inspections.mjs
 */
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const checks = [
  {
    name: "from('vehicle_inspections')",
    pattern: "from\\(['\"]vehicle_inspections['\"]\\)",
    dirs: ['app/', 'lib/', 'components/'],
  },
  {
    name: "Tables['vehicle_inspections']",
    pattern: "Tables\\[.vehicle_inspections.\\]",
    dirs: ['app/', 'lib/', 'components/'],
  },
  {
    name: '"Vehicle Tasks" UI label',
    pattern: 'Vehicle Tasks',
    dirs: ['app/', 'lib/', 'components/'],
    glob: '!*.test.*',
  },
  {
    name: '"Vehicle Inspection(s)" UI text',
    pattern: 'Vehicle Inspections?',
    dirs: ['app/', 'lib/', 'components/'],
    glob: '!*.test.*',
  },
  {
    name: '"Unknown Vehicle" fallback text',
    pattern: 'Unknown Vehicle',
    dirs: ['app/', 'lib/', 'components/'],
    glob: '!*.test.*',
  },
];

let failed = false;

for (const check of checks) {
  const args = [
    check.pattern,
    '-l',
    ...(check.glob ? ['--glob', check.glob] : []),
    ...check.dirs,
  ];
  const result = spawnSync('rg', args, {
    cwd: ROOT,
    encoding: 'utf-8',
  });

  if (result.error || (result.status !== 0 && result.status !== 1)) {
    console.error(`❌ GUARD ERROR: ${check.name} could not be checked.`);
    if (result.error) console.error(`   ${result.error.message}`);
    if (result.stderr?.trim()) console.error(`   ${result.stderr.trim()}`);
    failed = true;
    continue;
  }

  const files = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (files.length > 0) {
    console.error(`❌ GUARD FAILED: ${check.name} found in:`);
    files.forEach(f => console.error(`   ${f}`));
    failed = true;
  } else {
    console.log(`✅ ${check.name}: clean`);
  }
}

if (failed) {
  console.error('\n❌ Static guard FAILED. Fix forbidden references before pushing.');
  process.exit(1);
} else {
  console.log('\n✅ All static guards passed.');
  process.exit(0);
}
