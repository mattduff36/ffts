import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const sqlFile = (name: string) => readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8');
const migration = sqlFile('20261109151246_launch_function_permissions.sql');
const mutators = [
  ['remove_schedule_job(uuid,uuid)', 'NULL::uuid,NULL::uuid'],
  ['create_project_schedule_job(uuid,uuid,text,text,text,uuid,uuid,text,text,date,date,integer,boolean,uuid[],uuid)', 'NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::date,NULL::date,NULL::integer,NULL::boolean,NULL::uuid[],NULL::uuid'],
  ['run_user_usage_retention(integer)', '180'],
  ['refresh_user_usage_daily_rollups(date,date)', 'CURRENT_DATE,CURRENT_DATE'],
  ['recalculate_financial_year_carryover_for_profile(integer,uuid,uuid)', '2026,NULL::uuid,NULL::uuid'],
  ['snapshot_financial_year_carryovers_before_close(integer,uuid)', '2026,NULL::uuid'],
] as const;
const readers = [
  ['get_absence_secondary_permissions_snapshot(uuid)', 'NULL::uuid'],
  ['get_user_permission_levels(uuid)', 'NULL::uuid'],
  ['get_user_permissions(uuid)', 'NULL::uuid'],
  ['get_latest_absence_close_undo_status()', ''],
] as const;
const pathFunctions = [
  ...mutators.map(([signature]) => signature),
  'sync_vehicle_type_from_category()', 'update_customer_contacts_updated_at()',
  'update_quote_project_numbers_updated_at()', 'update_quote_project_costs_updated_at()',
  'resolve_timesheet_entry_date(date,integer)', 'get_latest_mot_test(uuid)', 'get_latest_passed_mot(uuid)',
  'ffts_job_order_cb3f410d49f8_partial.update_updated_at_column()',
];
const db = new PGlite();
const call = (signature: string, args: string) => `SELECT public.${signature.split('(')[0]}(${args})`;
async function asRole<T>(role: string, callback: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try { return await callback(); } finally { await db.exec('RESET ROLE'); }
}

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT CREATE ON SCHEMA public TO PUBLIC, anon, authenticated;
    CREATE TABLE public.effects (operation text NOT NULL);
    CREATE SCHEMA ffts_job_order_cb3f410d49f8_partial;
    CREATE TABLE ffts_job_order_cb3f410d49f8_partial.keep_data (id integer);
    INSERT INTO ffts_job_order_cb3f410d49f8_partial.keep_data VALUES (1);
    CREATE FUNCTION ffts_job_order_cb3f410d49f8_partial.update_updated_at_column()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  `);
  // Representative business bodies isolate the actual migration's role/ACL contract.
  for (const [signature] of mutators) {
    await db.exec(`CREATE FUNCTION public.${signature} RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$
      INSERT INTO effects VALUES ('${signature.split('(')[0]}'); SELECT 1; $$;
      GRANT EXECUTE ON FUNCTION public.${signature} TO PUBLIC, anon, authenticated;`);
  }
  for (const [signature] of readers) {
    await db.exec(`CREATE FUNCTION public.${signature} RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      GRANT EXECUTE ON FUNCTION public.${signature} TO PUBLIC, anon, authenticated;`);
  }
  for (const name of ['sync_vehicle_type_from_category', 'update_customer_contacts_updated_at', 'update_quote_project_numbers_updated_at', 'update_quote_project_costs_updated_at']) {
    await db.exec(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
  }
  await db.exec(`
    CREATE FUNCTION public.resolve_timesheet_entry_date(date,integer) RETURNS date LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE TABLE public.mot_test_history (van_id uuid, completed_date date, test_result text, expiry_date date);
    INSERT INTO public.mot_test_history VALUES
      ('11111111-1111-4111-8111-111111111111', '2026-11-01', 'PASSED', '2027-11-01'),
      ('22222222-2222-4222-8222-222222222222', '2026-11-02', 'PASSED', '2027-11-02');
    ALTER TABLE public.mot_test_history ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.mot_test_history TO anon, authenticated, service_role;
    CREATE POLICY allowed_vehicle ON public.mot_test_history FOR SELECT TO authenticated
      USING (van_id = '11111111-1111-4111-8111-111111111111'::uuid);
    CREATE POLICY service_read ON public.mot_test_history FOR SELECT TO service_role USING (true);
  `);
  const definitions = sqlFile('20260303_dvla_sync_contract_convergence.sql');
  for (const name of ['get_latest_mot_test', 'get_latest_passed_mot']) {
    const definition = definitions.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ LANGUAGE sql STABLE SECURITY DEFINER;`))?.[0];
    if (!definition) throw new Error(`Missing repository definition: ${name}`);
    await db.exec(definition);
  }
  await db.exec(`
    CREATE FUNCTION public.authorized_close_test() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.recalculate_financial_year_carryover_for_profile(2026,NULL,NULL)
        + public.snapshot_financial_year_carryovers_before_close(2026,NULL); $$;
    REVOKE ALL ON FUNCTION public.authorized_close_test() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.authorized_close_test() TO authenticated;
    CREATE FUNCTION public.authorized_schedule_test() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.remove_schedule_job(NULL,NULL); $$;
    REVOKE ALL ON FUNCTION public.authorized_schedule_test() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.authorized_schedule_test() TO service_role;
  `);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

describe('launch migration in an ephemeral PostgreSQL engine', () => {
  it.each(['anon', 'authenticated'])('denies all six direct mutations for %s', async (role) => {
    for (const [signature, args] of mutators) {
      await asRole(role, () => expect(db.query(call(signature, args))).rejects.toThrow(/permission denied for function/iu));
    }
    expect((await db.query('SELECT * FROM public.effects')).rows).toEqual([]);
  });

  it.each(['anon', 'authenticated'])('prevents %s from creating objects on the trusted public path', async (role) => {
    await asRole(role, () => expect(db.exec('CREATE TABLE public.shadow_attempt (id integer)')).rejects.toThrow(/permission denied for schema public/iu));
    const result = await db.query<{ allowed: boolean }>("SELECT has_schema_privilege($1, 'public', 'CREATE') AS allowed", [role]);
    expect(result.rows[0].allowed).toBe(false);
  });

  it('allows service and owner maintenance, including nested definer calls', async () => {
    for (const [signature, args] of mutators) {
      await asRole('service_role', () => db.query(call(signature, args)));
      await db.query(call(signature, args));
    }
    await asRole('authenticated', () => db.query('SELECT public.authorized_close_test()'));
    await asRole('service_role', () => db.query('SELECT public.authorized_schedule_test()'));
    expect((await db.query('SELECT * FROM public.effects')).rows).toHaveLength(15);
  });

  it('denies anonymous metadata but preserves authenticated/service access', async () => {
    for (const [signature, args] of readers) {
      await asRole('anon', () => expect(db.query(call(signature, args))).rejects.toThrow(/permission denied for function/iu));
      for (const role of ['authenticated', 'service_role']) await asRole(role, () => db.query(call(signature, args)));
    }
  });

  it('pins every selected path and preserves the exact leftover schema data', async () => {
    for (const signature of pathFunctions) {
      const result = await db.query<{ proconfig: string[] }>('SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure', [signature]);
      expect(result.rows[0].proconfig).toContain('search_path=pg_catalog, public, pg_temp');
    }
    expect((await db.query('SELECT * FROM ffts_job_order_cb3f410d49f8_partial.keep_data')).rows).toEqual([{ id: 1 }]);
  });

  it('uses real table RLS for both MOT readers: allowed row, denied row and anonymous denial', async () => {
    for (const name of ['get_latest_mot_test', 'get_latest_passed_mot']) {
      await asRole('authenticated', async () => {
        expect((await db.query(`SELECT * FROM public.${name}('11111111-1111-4111-8111-111111111111')`)).rows).toHaveLength(1);
        expect((await db.query(`SELECT * FROM public.${name}('22222222-2222-4222-8222-222222222222')`)).rows).toEqual([]);
      });
      await asRole('anon', async () => {
        expect((await db.query(`SELECT * FROM public.${name}('11111111-1111-4111-8111-111111111111')`)).rows).toEqual([]);
      });
    }
  });

  it('is repeatable with the optional leftover routine present or absent', async () => {
    await db.exec(migration);
    await db.exec('DROP FUNCTION ffts_job_order_cb3f410d49f8_partial.update_updated_at_column()');
    await db.exec(migration);
    for (const role of ['anon', 'authenticated']) {
      for (const [signature, args] of mutators) await asRole(role, () => expect(db.query(call(signature, args))).rejects.toThrow(/permission denied for function/iu));
    }
  });
});
