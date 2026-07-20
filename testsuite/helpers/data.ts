/**
 * Test data helpers — creates TEST-only records and cleans them up.
 *
 * NON-DESTRUCTIVE GUARANTEE:
 * - Every record created is tagged with a unique TESTSUITE prefix.
 * - All mutating operations are scoped ONLY to IDs created in this run.
 * - Cleanup removes only records created by the suite.
 * - We NEVER pick "the first existing record" for mutation.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { TEST_ASSET_PREFIX } from '../../tests/integration/helpers/test-assets';

config({ path: resolve(process.cwd(), '.env.local') });

const RUN_TAG = process.env.TESTSUITE_RUN_TAG || `TESTSUITE-${Date.now()}`;

interface CreatedRecord {
  table: string;
  id: string;
}

const createdRecords: CreatedRecord[] = [];

export function registerCreatedRecord(table: string, id: string): void {
  createdRecords.push({ table, id });
}

function getCleanupErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

export function getTestsuiteAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getRunTag(): string {
  return RUN_TAG;
}

export async function createTestVehicle(overrides?: Record<string, unknown>): Promise<{ id: string; reg_number: string }> {
  const supabase = getTestsuiteAdminClient();
  const regNumber = `${TEST_ASSET_PREFIX}${RUN_TAG.slice(-6)}`;
  const { data: category, error: categoryError } = await supabase
    .from('van_categories')
    .select('id')
    .limit(1)
    .single();

  if (categoryError || !category?.id) {
    throw new Error(`Failed to load vehicle category for test vehicle: ${categoryError?.message || 'no category'}`);
  }

  const { data, error } = await supabase
    .from('vans')
    .insert({
      reg_number: regNumber,
      nickname: `Test Vehicle ${RUN_TAG}`,
      status: 'active',
      category_id: category.id,
      ...overrides,
    })
    .select('id, reg_number')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test vehicle: ${error?.message || 'no data'}`);
  }

  registerCreatedRecord('vans', data.id);
  return data;
}

export async function createTestWorkshopTask(
  vehicleId: string,
  userId: string,
  overrides?: Record<string, unknown>
): Promise<{ id: string }> {
  const supabase = getTestsuiteAdminClient();

  // Get default category
  const { data: category } = await supabase
    .from('workshop_task_categories')
    .select('id')
    .limit(1)
    .single();

  const { data, error } = await supabase
    .from('actions')
    .insert({
      van_id: vehicleId,
      created_by: userId,
      action_type: 'workshop_task',
      description: `Test task ${RUN_TAG}`,
      notes: RUN_TAG,
      status: 'pending',
      workshop_category_id: category?.id || null,
      ...overrides,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test workshop task: ${error?.message || 'no data'}`);
  }

  registerCreatedRecord('actions', data.id);
  return data;
}

export async function createTestReminderAction({
  vanId,
  createdBy,
  overrides,
}: {
  vanId: string;
  createdBy: string;
  overrides?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const supabase = getTestsuiteAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('reminder_actions')
    .insert({
      workflow_key: 'fleet_inspection_overdue',
      source_type: 'system_generated',
      dedupe_key: `${RUN_TAG}:van:${vanId}`,
      status: 'open',
      priority: 'medium',
      title: `Testsuite reminder ${RUN_TAG}`,
      description: `Testsuite reminder action ${RUN_TAG}`,
      asset_type: 'van',
      van_id: vanId,
      metadata: { testsuite: true, runTag: RUN_TAG },
      created_by: createdBy,
      first_detected_at: nowIso,
      last_detected_at: nowIso,
      ...overrides,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test reminder action: ${error?.message || 'no data'}`);
  }

  registerCreatedRecord('reminder_actions', data.id);
  return data;
}

export async function createTestReminderAssignment({
  actionId,
  assignedTo,
  assignedBy,
  overrides,
}: {
  actionId: string;
  assignedTo: string;
  assignedBy: string;
  overrides?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const supabase = getTestsuiteAdminClient();

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      action_id: actionId,
      assigned_to: assignedTo,
      assigned_by: assignedBy,
      status: 'pending',
      ...overrides,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test reminder assignment: ${error?.message || 'no data'}`);
  }

  registerCreatedRecord('reminders', data.id);
  return data;
}

export async function cleanupTestData(): Promise<void> {
  const supabase = getTestsuiteAdminClient();
  const failures: string[] = [];

  // Reverse order to respect FK dependencies
  for (const record of [...createdRecords].reverse()) {
    try {
      if (record.table === 'vans') {
        // Test vehicles are isolated and may be hard-deleted after their dependent fixtures.
        const { error } = await supabase
          .from('vans')
          .delete()
          .eq('id', record.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(record.table)
          .delete()
          .eq('id', record.id);
        if (error) throw error;
      }
    } catch (err) {
      failures.push(
        `${record.table}/${record.id}: ${getCleanupErrorMessage(err)}`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Testsuite cleanup left production fixtures:\n- ${failures.join('\n- ')}`);
  }

  createdRecords.length = 0;
}
