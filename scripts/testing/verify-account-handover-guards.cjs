'use strict';
// Real PostgreSQL regression, restricted to the NAS. All DDL and fixtures roll back.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
require('tsx/cjs');
const { Client } = require('pg');
const { requireDevelopmentTarget } = require('../../lib/utils/development-target.ts');
const { developmentPgOptions } = require('../../lib/utils/development-pg-options.ts');
const root = path.resolve(__dirname, '../..');
const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(root, '.env.development.local'))) };
const target = requireDevelopmentTarget(env);
const migration = path.join(root, 'supabase/migrations/20261109190808_staff_account_handover_guards.sql');
const client = new Client({ ...developmentPgOptions(env), connectionTimeoutMillis: 5000, statement_timeout: 20000 });
const employeeId = crypto.randomUUID();
const adminId = crypto.randomUUID();
const checks = [];
const checked = (name) => checks.push(name);
async function asActor(id) {
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub: id, role: 'authenticated' }), id]);
  await client.query('SET LOCAL ROLE authenticated');
}
async function denied(name, sql, params) {
  await client.query('SAVEPOINT denied_operation');
  let code;
  try { await client.query(sql, params); } catch (error) { code = error.code; }
  await client.query('ROLLBACK TO SAVEPOINT denied_operation');
  assert.equal(code, '42501', name + ' must fail with insufficient_privilege');
  checked(name);
}
(async () => {
  const response = await fetch(target.appOrigin + '/api/development/target', { redirect: 'error' });
  const running = await response.json();
  assert.equal(response.status, 200);
  assert.equal(running.projectId, target.projectId);
  assert.equal(running.apiOrigin, target.apiOrigin);
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(fs.readFileSync(migration, 'utf8'));
  const roles = (await client.query("SELECT id, name FROM public.roles WHERE name IN ('admin', 'employee')")).rows;
  const roleId = (name) => roles.find((r) => r.name === name).id;
  for (const id of [employeeId, adminId]) {
    await client.query("INSERT INTO auth.users(id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) VALUES ($1, 'authenticated', 'authenticated', $2, $3, '{}', now(), now())",
      [id, 'handover-guard-' + id + '@ffts.test', JSON.stringify({ full_name: 'FFTS permission regression fixture', role: 'admin', role_id: roleId('admin'), super_admin: true, must_change_password: false })]);
  }
  const initial = (await client.query('SELECT role, role_id, super_admin, must_change_password FROM public.profiles WHERE id=$1', [employeeId])).rows[0];
  assert.deepEqual(initial, { role: 'employee', role_id: null, super_admin: false, must_change_password: true });
  checked('signup metadata cannot grant authority or bypass onboarding');
  await client.query("UPDATE public.profiles SET role_id=$2, role='employee', team_id=(SELECT team_id FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE r.name='employee' AND NOT p.is_placeholder LIMIT 1) WHERE id=$1", [employeeId, roleId('employee')]);
  await client.query("UPDATE public.profiles SET role_id=$2, role='admin', team_id=(SELECT team_id FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE r.name='admin' AND NOT p.is_placeholder LIMIT 1) WHERE id=$1", [adminId, roleId('admin')]);
  await asActor(employeeId);
  for (const [column, value] of [
    ['role', 'admin'], ['role_id', roleId('admin')], ['super_admin', true],
    ['must_change_password', false], ['team_id', null], ['line_manager_id', adminId],
    ['secondary_manager_id', adminId], ['employee_id', 'HANDOVER-PROBE'],
    ['is_placeholder', true], ['placeholder_key', 'handover-probe'], ['id', crypto.randomUUID()]
  ]) {
    await denied('deny direct update of ' + column, 'UPDATE public.profiles SET "' + column + '"=$2 WHERE id=$1', [employeeId, value]);
  }
  await denied('deny direct profile insert', "INSERT INTO public.profiles(id, full_name) VALUES ($1, 'probe')", [crypto.randomUUID()]);
  await denied('deny direct profile delete', 'DELETE FROM public.profiles WHERE id=$1', [employeeId]);
  const basic = await client.query("UPDATE public.profiles SET phone_number='07000000000' WHERE id=$1", [employeeId]);
  assert.equal(basic.rowCount, 1);
  checked('self-service contact field still updates');
  assert.equal((await client.query('SELECT public.can_actor_edit_absence_allowances($1,$1) AS allowed', [employeeId])).rows[0].allowed, false);
  await denied('deny employee holiday allowance escalation', 'UPDATE public.profiles SET annual_holiday_allowance_days=99 WHERE id=$1', [employeeId]);
  await asActor(adminId);
  assert.equal((await client.query('SELECT public.can_actor_edit_absence_allowances($1,$2) AS allowed', [adminId, employeeId])).rows[0].allowed, true);
  assert.equal((await client.query('UPDATE public.profiles SET annual_holiday_allowance_days=29 WHERE id=$1', [employeeId])).rowCount, 1);
  checked('authorised admin holiday allowance update remains available');
  await denied('admin client cannot directly clear onboarding', 'UPDATE public.profiles SET must_change_password=false WHERE id=$1', [employeeId]);
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true), set_config('request.jwt.claim.role', 'service_role', true)");
  await client.query('SET LOCAL ROLE service_role');
  assert.equal((await client.query('UPDATE public.profiles SET must_change_password=false, role_id=$2 WHERE id=$1', [employeeId, roleId('employee')])).rowCount, 1);
  checked('checked service actions can complete onboarding and manage roles');
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ passed: true, target: target.projectId, rollback: true, checks }, null, 2));
})().catch(async (error) => {
  await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ passed: false, code: error.code, error: error.message, completed: checks }));
  process.exitCode = 1;
}).finally(() => client.end());
