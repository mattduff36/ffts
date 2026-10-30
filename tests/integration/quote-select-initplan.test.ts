import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Captured read-only from FFTS on 2026-10-30. Exact helper bodies, fictional rows only.
// Never uses POSTGRES_URL_NON_POOLING, Supabase credentials or RUN_LIVE_DB_TESTS.
const helperDefinitions: string[] = [
  "CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module text)\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nBEGIN\r\n  IF module = 'reminders' AND auth.uid() IS NOT NULL THEN\r\n    RETURN TRUE;\r\n  END IF;\r\n\r\n  RETURN public.effective_module_access_level(module) > 0;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.effective_is_super_admin()\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nBEGIN\r\n  RETURN EXISTS (\r\n    SELECT 1 FROM roles\r\n    WHERE id = effective_role_id()\r\n      AND is_super_admin = true\r\n  );\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.effective_module_access_level(module text)\n RETURNS integer\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nBEGIN\r\n  IF module = 'reminders' AND auth.uid() IS NOT NULL THEN\r\n    RETURN 5;\r\n  END IF;\r\n\r\n  RETURN public.user_module_access_level(\r\n    auth.uid(),\r\n    public.effective_role_id(),\r\n    public.effective_team_id(),\r\n    module\r\n  );\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.effective_role_id()\n RETURNS uuid\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nDECLARE\r\n  actual_role UUID;\r\n  override_role UUID;\r\nBEGIN\r\n  -- Always fetch the actual role\r\n  SELECT p.role_id INTO actual_role\r\n  FROM profiles p\r\n  WHERE p.id = auth.uid();\r\n\r\n  -- Only super admins may override\r\n  IF NOT is_actual_super_admin() THEN\r\n    RETURN actual_role;\r\n  END IF;\r\n\r\n  override_role := view_as_role_id();\r\n  IF override_role IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE id = override_role) THEN\r\n    RETURN override_role;\r\n  END IF;\r\n\r\n  RETURN actual_role;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.effective_team_id()\n RETURNS text\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nDECLARE\r\n  actual_team_id TEXT;\r\n  override_team_id TEXT;\r\nBEGIN\r\n  SELECT p.team_id\r\n  INTO actual_team_id\r\n  FROM profiles p\r\n  WHERE p.id = auth.uid();\r\n\r\n  IF NOT public.is_actual_super_admin() THEN\r\n    RETURN actual_team_id;\r\n  END IF;\r\n\r\n  override_team_id := public.view_as_team_id();\r\n  IF override_team_id IS NOT NULL\r\n     AND EXISTS (SELECT 1 FROM org_teams WHERE id = override_team_id) THEN\r\n    RETURN override_team_id;\r\n  END IF;\r\n\r\n  RETURN actual_team_id;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.is_actual_super_admin()\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nDECLARE\r\n  result BOOLEAN;\r\nBEGIN\r\n  SELECT COALESCE(p.super_admin, FALSE) OR COALESCE(r.is_super_admin, FALSE)\r\n  INTO result\r\n  FROM profiles p\r\n  LEFT JOIN roles r ON p.role_id = r.id\r\n  WHERE p.id = auth.uid();\r\n  RETURN COALESCE(result, FALSE);\r\nEXCEPTION WHEN OTHERS THEN\r\n  RETURN FALSE;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.role_on_team_module_access_level(target_role_id uuid, target_team_id text, target_module text)\n RETURNS integer\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nDECLARE\r\n  target_role_name TEXT;\r\n  target_role_class TEXT;\r\n  target_is_super_admin BOOLEAN;\r\n  target_rank INTEGER;\r\n  min_rank INTEGER;\r\n  team_enabled BOOLEAN;\r\nBEGIN\r\n  IF target_module = 'reminders' AND target_role_id IS NOT NULL THEN\r\n    RETURN 5;\r\n  END IF;\r\n\r\n  IF target_role_id IS NULL THEN\r\n    RETURN 0;\r\n  END IF;\r\n\r\n  SELECT\r\n    r.name,\r\n    r.role_class,\r\n    r.is_super_admin,\r\n    r.hierarchy_rank\r\n  INTO\r\n    target_role_name,\r\n    target_role_class,\r\n    target_is_super_admin,\r\n    target_rank\r\n  FROM public.roles r\r\n  WHERE r.id = target_role_id;\r\n\r\n  IF target_is_super_admin = TRUE OR target_role_name = 'admin' OR target_role_class = 'admin' THEN\r\n    RETURN 5;\r\n  END IF;\r\n\r\n  IF target_team_id IS NULL OR target_rank IS NULL THEN\r\n    RETURN 0;\r\n  END IF;\r\n\r\n  IF public.module_requires_full_access_role(target_module) THEN\r\n    RETURN 0;\r\n  END IF;\r\n\r\n  min_rank := public.module_enforced_minimum_access_level(target_module);\r\n\r\n  IF min_rank <= 0 THEN\r\n    RETURN 0;\r\n  END IF;\r\n\r\n  SELECT tmp.enabled\r\n  INTO team_enabled\r\n  FROM public.team_module_permissions tmp\r\n  WHERE tmp.team_id = target_team_id\r\n    AND tmp.module_name = target_module;\r\n\r\n  IF COALESCE(team_enabled, FALSE) AND target_rank >= min_rank THEN\r\n    RETURN LEAST(GREATEST(target_rank, 1), 4);\r\n  END IF;\r\n\r\n  RETURN 0;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.user_module_access_level(target_user_id uuid, target_role_id uuid, target_team_id text, target_module text)\n RETURNS integer\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nDECLARE\r\n  role_level INTEGER;\r\n  override_level INTEGER;\r\nBEGIN\r\n  IF target_module = 'reminders'\r\n    AND target_user_id IS NOT NULL\r\n    AND EXISTS (\r\n      SELECT 1\r\n      FROM public.profiles p\r\n      WHERE p.id = target_user_id\r\n    )\r\n  THEN\r\n    RETURN 5;\r\n  END IF;\r\n\r\n  role_level := public.role_on_team_module_access_level(target_role_id, target_team_id, target_module);\r\n\r\n  IF role_level = 5 THEN\r\n    RETURN 5;\r\n  END IF;\r\n\r\n  IF target_user_id IS NULL THEN\r\n    RETURN role_level;\r\n  END IF;\r\n\r\n  SELECT ump.access_level\r\n  INTO override_level\r\n  FROM public.user_module_permissions ump\r\n  WHERE ump.user_id = target_user_id\r\n    AND ump.module_name = target_module;\r\n\r\n  IF override_level IS NOT NULL THEN\r\n    IF public.module_requires_full_access_role(target_module) THEN\r\n      RETURN 0;\r\n    END IF;\r\n\r\n    override_level := LEAST(GREATEST(override_level, 0), 5);\r\n\r\n    IF override_level > 0 AND override_level < public.module_enforced_minimum_access_level(target_module) THEN\r\n      RETURN 0;\r\n    END IF;\r\n\r\n    RETURN override_level;\r\n  END IF;\r\n\r\n  RETURN role_level;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.view_as_role_id()\n RETURNS uuid\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nDECLARE\r\n  headers_json TEXT;\r\n  role_id_str  TEXT;\r\nBEGIN\r\n  headers_json := current_setting('request.headers', true);\r\n  IF headers_json IS NULL OR headers_json = '' THEN\r\n    RETURN NULL;\r\n  END IF;\r\n  role_id_str := headers_json::json ->> 'x-view-as-role-id';\r\n  IF role_id_str IS NULL OR role_id_str = '' THEN\r\n    RETURN NULL;\r\n  END IF;\r\n  RETURN role_id_str::uuid;\r\nEXCEPTION WHEN OTHERS THEN\r\n  RETURN NULL;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.view_as_team_id()\n RETURNS text\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nDECLARE\r\n  headers_json TEXT;\r\n  team_id_str TEXT;\r\nBEGIN\r\n  headers_json := current_setting('request.headers', true);\r\n  IF headers_json IS NULL OR headers_json = '' THEN\r\n    RETURN NULL;\r\n  END IF;\r\n\r\n  team_id_str := headers_json::json ->> 'x-view-as-team-id';\r\n  IF team_id_str IS NULL OR team_id_str = '' THEN\r\n    RETURN NULL;\r\n  END IF;\r\n\r\n  RETURN team_id_str;\r\nEXCEPTION WHEN OTHERS THEN\r\n  RETURN NULL;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.module_enforced_minimum_access_level(target_module text)\n RETURNS integer\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nDECLARE\r\n  configured_min_rank INTEGER;\r\n  hard_rule_min_rank INTEGER;\r\nBEGIN\r\n  SELECT r.hierarchy_rank\r\n  INTO configured_min_rank\r\n  FROM public.permission_modules pm\r\n  JOIN public.roles r ON r.id = pm.minimum_role_id\r\n  WHERE pm.module_name = target_module;\r\n\r\n  hard_rule_min_rank := CASE target_module\r\n    WHEN 'toolbox-talks' THEN 4\r\n    WHEN 'admin-settings' THEN 4\r\n    ELSE NULL\r\n  END;\r\n\r\n  configured_min_rank := COALESCE(configured_min_rank, 0);\r\n\r\n  IF hard_rule_min_rank IS NOT NULL AND hard_rule_min_rank > configured_min_rank THEN\r\n    configured_min_rank := hard_rule_min_rank;\r\n  END IF;\r\n\r\n  RETURN LEAST(GREATEST(configured_min_rank, 0), 5);\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION public.module_requires_full_access_role(target_module text)\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nBEGIN\r\n  RETURN FALSE;\r\nEND;\r\n$function$\n",
  "CREATE OR REPLACE FUNCTION auth.uid()\n RETURNS uuid\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$function$\n"
];

const enabled = process.env.RUN_FFTS_QUOTE_INITPLAN_ISOLATED === '1';
const marker = 'ffts-performance-isolated-20261030';
const draftRoot = resolve(process.cwd(), 'docs_private/performance-drafts');
const applySql = () => readFileSync(resolve(draftRoot, 'quotes-select-initplan.sql'), 'utf8');
const rollbackSql = () => readFileSync(resolve(draftRoot, 'quotes-select-initplan-rollback.sql'), 'utf8');
const uuid = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
const allRows = Array.from({ length: 1250 }, (_, index) => index + 1);
let client: Client | undefined;
let ownsFixture = false;
let ownedFunctionSignatures: string[] = [];

async function db() {
  if (!client) throw new Error('Isolated client not configured');
  return client;
}
async function policySnapshot() {
  return (await (await db()).query(`SELECT polname, polcmd, polpermissive, polroles::text,
    pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS check_expr
    FROM pg_policy WHERE polrelid='public.quotes'::regclass ORDER BY polname`)).rows;
}
async function rowsFor(user: number | null, headers: Record<string, string> = {}) {
  const connection = await db();
  await connection.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims','',false), set_config('request.headers',$2,false)", [user === null ? '' : uuid(user), JSON.stringify(headers)]);
  await connection.query('SET ROLE ffts_perf_reader');
  try { return (await connection.query('SELECT id FROM public.quotes ORDER BY id')).rows.map(row => row.id); }
  finally { await connection.query('RESET ROLE'); }
}

// Default suite discovery is inert; every identity/target guard runs before fixture writes.
describe.runIf(enabled)('quotes SELECT InitPlan on explicitly isolated real PostgreSQL', () => {
  beforeAll(async () => {
    const target = process.env.FFTS_INITPLAN_TEST_URL;
    const expectedSystem = process.env.FFTS_INITPLAN_TEST_SYSTEM_ID;
    if (!target || !expectedSystem) throw new Error('Explicit isolated URL and cluster identity are required');
    const parsed = new URL(target);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55439'
      || parsed.pathname !== '/ffts_perf_isolated' || parsed.username !== 'ffts_perf_owner'
      || parsed.search || parsed.hash) throw new Error('Refusing non-dedicated isolated target');
    client = new Client({ connectionString: target, ssl: false, connectionTimeoutMillis: 5000 });
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS name,
      shobj_description(oid,'pg_database') AS marker,
      (SELECT system_identifier::text FROM pg_control_system()) AS system_id,
      current_setting('data_directory') AS data_path
      FROM pg_database WHERE datname=current_database()`)).rows[0];
    if (identity.name !== 'ffts_perf_isolated' || identity.marker !== marker
      || identity.system_id !== expectedSystem || !String(identity.data_path).replaceAll('\\','/').endsWith('/06-pg-data')) {
      throw new Error('Isolated database marker/cluster/path mismatch; refusing all writes');
    }
    const existing = await client.query("SELECT to_regclass('public.quotes') AS quotes, EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace) AS functions, EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ffts_perf_reader') AS reader");
    if (existing.rows[0].quotes || existing.rows[0].functions || existing.rows[0].reader) throw new Error('Dedicated fixture target is not empty');
    await client.query(`BEGIN;
      CREATE ROLE ffts_perf_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE public.roles(id uuid PRIMARY KEY,name text,role_class text,is_super_admin boolean,hierarchy_rank integer);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,role_id uuid,team_id text,super_admin boolean DEFAULT false);
      CREATE TABLE public.org_teams(id text PRIMARY KEY);
      CREATE TABLE public.permission_modules(module_name text PRIMARY KEY,minimum_role_id uuid);
      CREATE TABLE public.team_module_permissions(team_id text,module_name text,enabled boolean);
      CREATE TABLE public.user_module_permissions(user_id uuid,module_name text,access_level integer);
      CREATE TABLE public.quotes(id integer PRIMARY KEY);
      INSERT INTO public.quotes SELECT generate_series(1,1250);
      GRANT USAGE ON SCHEMA public,auth TO ffts_perf_reader;
      GRANT SELECT ON public.quotes TO ffts_perf_reader;
      ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
      `);
    for (const definition of helperDefinitions) await client.query(definition);
    ownedFunctionSignatures = (await client.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows.map(row => row.signature);
    await client.query(`
      INSERT INTO public.roles VALUES
      ('00000000-0000-0000-0000-000000000101','manager','manager',false,3),('00000000-0000-0000-0000-000000000102','operative','employee',false,1),
      ('00000000-0000-0000-0000-000000000103','admin','admin',false,5),('00000000-0000-0000-0000-000000000104','super','admin',true,5);
      INSERT INTO public.org_teams VALUES('north'),('south');
      INSERT INTO public.team_module_permissions VALUES('north','quotes',true),('south','quotes',false);
      INSERT INTO public.roles VALUES('00000000-0000-0000-0000-000000000105','minimum','employee',false,2);
      INSERT INTO public.permission_modules VALUES('quotes','00000000-0000-0000-0000-000000000105');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','north');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000101','south');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000103','north');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000104','north');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000102','south');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000101','north');
      INSERT INTO public.profiles(id,role_id,team_id) VALUES('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000103','north');
      INSERT INTO public.user_module_permissions VALUES('00000000-0000-0000-0000-000000000005','quotes',3),('00000000-0000-0000-0000-000000000006','quotes',0),('00000000-0000-0000-0000-000000000007','quotes',0);

      CREATE POLICY quotes_select ON public.quotes FOR SELECT TO PUBLIC USING (public.effective_has_module_permission('quotes'::text));
      CREATE POLICY quotes_insert ON public.quotes FOR INSERT WITH CHECK (public.effective_has_module_permission('quotes'::text));
      CREATE POLICY quotes_update ON public.quotes FOR UPDATE USING (public.effective_has_module_permission('quotes'::text)) WITH CHECK (public.effective_has_module_permission('quotes'::text));
      -- Isolated sentinel only: draft must preserve every non-SELECT policy.
      CREATE POLICY quotes_delete ON public.quotes FOR DELETE USING (false);
      COMMIT;`).catch(async error => { await client!.query('ROLLBACK'); throw error; });
    ownsFixture = true;
  });

  afterAll(async () => {
    if (!client) return;
    try {
      await client.query('ROLLBACK');
      await client.query('RESET ROLE');
      if (ownsFixture) {
        await client.query('DROP TABLE public.quotes, public.profiles, public.roles, public.org_teams, public.permission_modules, public.team_module_permissions, public.user_module_permissions');
        for (const signature of ownedFunctionSignatures) await client.query(`DROP FUNCTION ${signature}`);
        await client.query(`DROP SCHEMA auth CASCADE;
          REVOKE ALL ON SCHEMA public FROM ffts_perf_reader;
          DROP ROLE ffts_perf_reader;`);
      }
    } finally { await client.end(); }
  });

  const cases: [string, number | null, Record<string,string>, boolean][] = [
    ['allowed role/team', 1, {}, true], ['denied team', 2, {}, false], ['no user', null, {}, false],
    ['admin', 3, {}, true], ['superadmin', 4, {}, true],
    ['View As allowed role/team', 4, { 'x-view-as-role-id': uuid(101), 'x-view-as-team-id': 'north' }, true],
    ['View As denied team', 4, { 'x-view-as-role-id': uuid(101), 'x-view-as-team-id': 'south' }, false],
    ['View As denied rank', 4, { 'x-view-as-role-id': uuid(102), 'x-view-as-team-id': 'north' }, false],
    ['non-superadmin override ignored', 2, { 'x-view-as-role-id': uuid(103), 'x-view-as-team-id': 'north' }, false],
    ['explicit user allow', 5, {}, true], ['explicit user deny', 6, {}, false],
    ['admin bypasses user deny per actual helper', 7, {}, true],
  ];
  it.each(cases)('%s has identical old/new/rollback row sets', async (_name,user,headers,allowed) => {
    const connection = await db();
    const before = await policySnapshot();
    const old = await rowsFor(user,headers);
    await connection.query(applySql());
    const next = await rowsFor(user,headers);
    expect(next).toEqual(old); expect(next).toEqual(allowed ? allRows : []);
    const after = await policySnapshot();
    expect(after.filter(row => row.polname !== 'quotes_select')).toEqual(before.filter(row => row.polname !== 'quotes_select'));
    expect(after.map(({qual: _qual,...rest}) => rest)).toEqual(before.map(({qual: _qual,...rest}) => rest));
    await connection.query(rollbackSql());
    expect(await rowsFor(user,headers)).toEqual(old);
    expect(await policySnapshot()).toEqual(before);
  });

  it('observes role and explicit override changes between statements under the new policy', async () => {
    const connection = await db(); await connection.query(applySql());
    expect(await rowsFor(1)).toEqual(allRows);
    await connection.query('UPDATE public.profiles SET role_id=$1 WHERE id=$2',[uuid(102),uuid(1)]);
    expect(await rowsFor(1)).toEqual([]);
    await connection.query('UPDATE public.profiles SET role_id=$1 WHERE id=$2',[uuid(101),uuid(1)]);
    expect(await rowsFor(1)).toEqual(allRows);
    await connection.query('INSERT INTO public.user_module_permissions VALUES($1,$2,0)',[uuid(4),'quotes']);
    expect(await rowsFor(4,{'x-view-as-role-id':uuid(101),'x-view-as-team-id':'north'})).toEqual([]);
    await connection.query('DELETE FROM public.user_module_permissions WHERE user_id=$1',[uuid(4)]);
    expect(await rowsFor(4,{'x-view-as-role-id':uuid(101),'x-view-as-team-id':'north'})).toEqual(allRows);
    await connection.query(rollbackSql());
  });

  it('uses a real InitPlan and one helper call instead of per-row evaluation', async () => {
    const connection = await db();
    await rowsFor(1); // Configure request identity.
    async function plan() {
      await connection.query("BEGIN; SET LOCAL track_functions='all'; SET LOCAL ROLE ffts_perf_reader");
      try {
        const before = Number((await connection.query("SELECT COALESCE(sum(calls),0) AS n FROM pg_stat_xact_user_functions WHERE funcid='public.effective_has_module_permission(text)'::regprocedure")).rows[0].n);
        const estimated = (await connection.query('EXPLAIN (FORMAT JSON) SELECT id FROM public.quotes')).rows[0]['QUERY PLAN'];
        const actual = (await connection.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM public.quotes')).rows[0]['QUERY PLAN'];
        await connection.query('RESET ROLE');
        const after = Number((await connection.query("SELECT COALESCE(sum(calls),0) AS n FROM pg_stat_xact_user_functions WHERE funcid='public.effective_has_module_permission(text)'::regprocedure")).rows[0].n);
        return { estimated, actual, calls: after-before };
      } finally { await connection.query('ROLLBACK'); }
    }
    const old = await plan(); await connection.query(applySql()); const next = await plan();
    expect(JSON.stringify(old.estimated)).not.toContain('InitPlan');
    expect(JSON.stringify(next.estimated)).toContain('InitPlan');
    expect(JSON.stringify(next.actual)).toContain('InitPlan');
    expect(old.calls).toBe(1250); expect(next.calls).toBe(1);
    expect(old.actual[0].Plan['Actual Rows']).toBe(1250); expect(next.actual[0].Plan['Actual Rows']).toBe(1250);
    console.log(`Isolated quote helper calls: old=${old.calls}, new=${next.calls}; old/new rows=1250; InitPlan verified`);
    console.log('Isolated old/new estimated and analysed plans:', JSON.stringify({old,next}));
    await connection.query(rollbackSql());
  });

  it('refuses missing policy in both directions', async () => {
    const connection = await db();
    await connection.query('DROP POLICY quotes_select ON public.quotes');
    for (const script of [applySql(), rollbackSql()]) {
      await expect(connection.query(script)).rejects.toThrow('policy is missing');
      await connection.query('ROLLBACK');
      expect((await policySnapshot()).some(row => row.polname === 'quotes_select')).toBe(false);
    }
    await connection.query("CREATE POLICY quotes_select ON public.quotes FOR SELECT TO PUBLIC USING (public.effective_has_module_permission('quotes'::text))");
  });

  it('refuses repeated application, premature rollback and rollback expression drift', async () => {
    const connection = await db();
    await expect(connection.query(rollbackSql())).rejects.toThrow('drift');
    await connection.query('ROLLBACK');
    await connection.query(applySql());
    await expect(connection.query(applySql())).rejects.toThrow('drift');
    await connection.query('ROLLBACK');
    await connection.query('ALTER POLICY quotes_select ON public.quotes USING (true)');
    const drifted = await policySnapshot();
    await expect(connection.query(rollbackSql())).rejects.toThrow('drift');
    await connection.query('ROLLBACK');
    expect(await policySnapshot()).toEqual(drifted);
    // Explicit repair of this synthetic local fixture, never a draft fallback.
    await connection.query("ALTER POLICY quotes_select ON public.quotes USING (public.effective_has_module_permission('quotes'::text))");
  });

  it.each(['expression','command','roles','permissiveness','with-check'] as const)('fails closed on %s drift without applying the draft', async drift => {
    const connection = await db();
    await connection.query('DROP POLICY quotes_select ON public.quotes');
    const command = drift==='command' || drift==='with-check' ? 'ALL' : 'SELECT';
    const restrictive = drift==='permissiveness' ? 'AS RESTRICTIVE' : '';
    const role = drift==='roles' ? 'ffts_perf_reader' : 'PUBLIC';
    const expression = drift==='expression' ? 'true' : "public.effective_has_module_permission('quotes'::text)";
    await connection.query(`CREATE POLICY quotes_select ON public.quotes ${restrictive} FOR ${command} TO ${role} USING (${expression}) ${drift==='with-check'?'WITH CHECK (true)':''}`);
    const before=await policySnapshot();
    await expect(connection.query(applySql())).rejects.toThrow('drift'); await connection.query('ROLLBACK');
    expect(await policySnapshot()).toEqual(before);
    await connection.query('DROP POLICY quotes_select ON public.quotes');
    await connection.query("CREATE POLICY quotes_select ON public.quotes FOR SELECT TO PUBLIC USING (public.effective_has_module_permission('quotes'::text))");
  });
});
