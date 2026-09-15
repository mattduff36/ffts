import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import {
  formatScheduleAssignmentTargetLog,
  resolveScheduleAssignmentTarget,
} from './schedule-assignment-target-gate';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile =
  'supabase/rollbacks/20260914233000_schedule_assignment_same_visit_idempotent.rollback.sql';

function readConfirmToken(argv: string[]): string | null {
  const confirmIndex = argv.indexOf('--confirm');
  if (confirmIndex !== -1) return argv[confirmIndex + 1] ?? null;
  const equals = argv.find((arg) => arg.startsWith('--confirm='));
  if (equals) return equals.slice('--confirm='.length);
  const legacyIndex = argv.indexOf('--confirm-non-production');
  if (legacyIndex !== -1) return argv[legacyIndex + 1] ?? null;
  const legacyEquals = argv.find((arg) => arg.startsWith('--confirm-non-production='));
  if (legacyEquals) return legacyEquals.slice('--confirm-non-production='.length);
  return null;
}

export async function rollbackScheduleAssignmentSameVisitMigration(params: {
  connectionString: string;
  appSupabaseUrl?: string;
  confirmToken?: string | null;
  sqlPath?: string;
}): Promise<void> {
  const decision = resolveScheduleAssignmentTarget({
    connectionString: params.connectionString,
    appSupabaseUrl: params.appSupabaseUrl,
    confirmToken: params.confirmToken,
  });
  process.stdout.write(`${formatScheduleAssignmentTargetLog(decision)}\n`);
  if (!decision.ok) {
    throw new Error(decision.message);
  }

  const url = new URL(params.connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//u, '')) || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      readFileSync(params.sqlPath ?? resolve(process.cwd(), sqlFile), 'utf8')
        .replace(/^\s*BEGIN;\s*/gmu, '')
        .replace(/^\s*COMMIT;\s*/gmu, '')
    );
    const { rows } = await client.query<{ definition: string | null }>(`
      SELECT pg_get_functiondef(
        'public.create_schedule_assignment_v1(uuid, uuid, text, uuid, date, text, boolean, text[], uuid)'::regprocedure
      ) AS definition
    `);
    const definition = rows[0]?.definition || '';
    if (definition.includes('assignment.visit_id IS DISTINCT FROM p_visit_id')) {
      throw new Error('create_schedule_assignment_v1 rollback verification failed.');
    }
    if (!definition.includes('RESOURCE_OVERLAP')) {
      throw new Error('create_schedule_assignment_v1 rollback verification failed.');
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    if (error instanceof Error && error.message.startsWith('create_schedule_assignment_v1')) {
      throw error;
    }
    throw new Error('Same-visit assignment rollback failed.');
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (!connectionString) {
    process.stderr.write('Missing database connection string\n');
    process.exit(1);
  }
  try {
    await rollbackScheduleAssignmentSameVisitMigration({
      connectionString,
      appSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      confirmToken: readConfirmToken(process.argv.slice(2)),
    });
    process.stdout.write('Rollback complete.\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Same-visit assignment rollback failed.'}\n`
    );
    process.exit(error instanceof Error && error.message.includes('Refusing') ? 2 : 1);
  }
}

if (
  process.argv[1]
  && process.argv[1].replace(/\\/g, '/').endsWith('rollback-schedule-assignment-same-visit-idempotent.ts')
) {
  void main();
}
