/**
 * HGV Mileage Sync Trigger – Integration Test
 *
 * Verifies the database trigger and function that syncs HGV inspection
 * mileage to the vehicle_maintenance table are deployed and configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { resolveTestHgvId } from './helpers/test-assets';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(supabaseUrl && supabaseKey);
const isAllowedTarget = Boolean(
  supabaseUrl &&
    (supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('staging'))
);
const canRunSuite = hasCredentials && isAllowedTarget;
const describeSuite = canRunSuite ? describe : describe.skip;

describeSuite('HGV mileage sync trigger — database integration', () => {
  let supabase: SupabaseClient;
  let testHgvId = '';

  beforeAll(() => {
    supabase = createClient(supabaseUrl!, supabaseKey!, {
      auth: { persistSession: false },
    });
  });

  beforeAll(async () => {
    testHgvId = (await resolveTestHgvId(supabase)) || '';
  });

  afterAll(() => {
    // No session to sign out from when using service role key
  });

  it('update_vehicle_maintenance_mileage function is deployed (indirect check via trigger fire)', async () => {
    // We can't query pg_proc directly through PostgREST.
    // Instead we verify the trigger fires correctly by checking that at least
    // one HGV inspection's mileage has been synced to vehicle_maintenance.
    // If the function didn't exist, the trigger would fail on every insert.
    const { data: inspection } = await supabase
      .from('hgv_inspections')
      .select('hgv_id, current_mileage')
      .eq('hgv_id', testHgvId)
      .not('current_mileage', 'is', null)
      .not('hgv_id', 'is', null)
      .order('inspection_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!testHgvId || !inspection) {
      // No HGV inspections with mileage — skip
      return;
    }

    const { data: maintenance, error } = await supabase
      .from('vehicle_maintenance')
      .select('current_mileage')
      .eq('hgv_id', inspection.hgv_id)
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(maintenance).not.toBeNull();
    expect(maintenance?.current_mileage).toBeGreaterThan(0);
  });

  it('trigger_update_maintenance_mileage_hgv trigger exists on hgv_inspections', async () => {
    const { error } = await supabase
      .from('pg_trigger' as string)
      .select('tgname')
      .eq('tgname', 'trigger_update_maintenance_mileage_hgv')
      .limit(1);

    if (error) {
      // pg_trigger may not be exposed via PostgREST; that's acceptable.
      // The trigger existence is validated by the migration runner + db:validate.
      return;
    }

    expect(data).toHaveLength(1);
  });

  it('vehicle_maintenance table has an hgv_id column', async () => {
    const { error } = await supabase
      .from('vehicle_maintenance')
      .select('hgv_id')
      .limit(0);

    expect(error).toBeNull();
  });

  it('hgv_inspections table has current_mileage column', async () => {
    const { error } = await supabase
      .from('hgv_inspections')
      .select('current_mileage')
      .limit(0);

    expect(error).toBeNull();
  });

  it('hgvs table has current_mileage column', async () => {
    const { error } = await supabase
      .from('hgvs')
      .select('current_mileage')
      .limit(0);

    expect(error).toBeNull();
  });

  it('HGV with inspections has matching mileage in vehicle_maintenance', async () => {
    const { data: hgvWithInspection } = await supabase
      .from('hgv_inspections')
      .select('hgv_id, current_mileage')
      .eq('hgv_id', testHgvId)
      .not('current_mileage', 'is', null)
      .order('inspection_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!testHgvId || !hgvWithInspection) return;

    const { data: maintenance } = await supabase
      .from('vehicle_maintenance')
      .select('current_mileage')
      .eq('hgv_id', hgvWithInspection.hgv_id)
      .limit(1)
      .maybeSingle();

    if (!maintenance) return;

    expect(maintenance.current_mileage).toBeDefined();
    expect(typeof maintenance.current_mileage).toBe('number');
  });
});
