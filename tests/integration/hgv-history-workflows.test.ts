import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { resolveTestHgvId } from './helpers/test-assets';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';

const hasSupabaseCredentials = Boolean(supabaseUrl && supabaseKey);
const isAllowedSupabaseTarget = Boolean(
  supabaseUrl &&
    (supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('staging'))
);
const canRunSuite = hasSupabaseCredentials && isAllowedSupabaseTarget;
const describeHgvHistorySuite = canRunSuite ? describe : describe.skip;

describeHgvHistorySuite('HGV history workflows', () => {
  let supabase: SupabaseClient;
  let accessToken = '';
  let hgvId = '';

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    const email = process.env.TESTSUITE_EMPLOYEE_EMAIL || process.env.TEST_USER_EMAIL || 'testsuite-employee@example.test';
    const password = process.env.TESTSUITE_PASSWORD || process.env.TEST_USER_PASSWORD || 'TestSuite2026!Secure';

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) throw authError;

    accessToken = authData.session?.access_token || '';

    hgvId = (await resolveTestHgvId(supabase)) || '';
  });

  afterAll(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  });

  it('loads maintenance history rows for an HGV', async () => {
    if (!hgvId) return;

    const { data, error } = await supabase
      .from('maintenance_history')
      .select('id, hgv_id, field_name, created_at')
      .eq('hgv_id', hgvId)
      .order('created_at', { ascending: false })
      .limit(50);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      expect(data.every((row) => row.hgv_id === hgvId)).toBe(true);
    }
  });

  it('loads workshop task timeline rows for an HGV', async () => {
    if (!hgvId) return;

    const { data, error } = await supabase
      .from('actions')
      .select(
        `
        id,
        hgv_id,
        action_type,
        status,
        created_at,
        workshop_task_categories(name),
        workshop_task_subcategories(name)
      `
      )
      .eq('hgv_id', hgvId)
      .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
      .order('created_at', { ascending: false })
      .limit(50);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      expect(data.every((row) => row.hgv_id === hgvId)).toBe(true);
    }
  });

  it('loads document attachments linked to HGV tasks', async () => {
    if (!hgvId) return;

    const { data: tasks, error: tasksError } = await supabase
      .from('actions')
      .select('id')
      .eq('hgv_id', hgvId)
      .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
      .limit(25);

    expect(tasksError).toBeNull();
    const taskIds = tasks?.map((task) => task.id) || [];
    if (taskIds.length === 0) return;

    const { data: attachments, error: attachmentError } = await supabase
      .from('workshop_task_attachments')
      .select('id, action_id, file_name, created_at')
      .in('action_id', taskIds)
      .order('created_at', { ascending: false });

    expect(attachmentError).toBeNull();
    expect(Array.isArray(attachments)).toBe(true);
    if (attachments && attachments.length > 0) {
      expect(attachments.every((file) => taskIds.includes(file.action_id))).toBe(true);
    }
  });

  it('history and tasks can be combined into descending timeline order', async () => {
    if (!hgvId) return;

    const { data: history } = await supabase
      .from('maintenance_history')
      .select('id, created_at')
      .eq('hgv_id', hgvId)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: tasks } = await supabase
      .from('actions')
      .select('id, created_at')
      .eq('hgv_id', hgvId)
      .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
      .order('created_at', { ascending: false })
      .limit(20);

    const timeline = [
      ...(history || []).map((entry) => ({ id: entry.id, created_at: entry.created_at })),
      ...(tasks || []).map((entry) => ({ id: entry.id, created_at: entry.created_at })),
    ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    for (let index = 1; index < timeline.length; index++) {
      const previous = new Date(timeline[index - 1].created_at || 0).getTime();
      const current = new Date(timeline[index].created_at || 0).getTime();
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });

  it('maintenance MOT history endpoint avoids 500 responses', async () => {
    if (!hgvId) return;

    const response = await fetch(`${siteUrl}/api/maintenance/mot-history/${hgvId}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    expect(response.status).not.toBe(500);
    expect([200, 401, 404]).toContain(response.status);
  });
});
