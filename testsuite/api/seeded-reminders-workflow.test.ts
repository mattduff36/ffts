/**
 * @tags @actions @reminders @workflow
 * Seeded reminder completion workflow.
 *
 * NON-DESTRUCTIVE: creates only TESTSUITE-tagged data and cleans it up.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { completeReminderActionForAsset } from '@/lib/server/reminders/complete-reminder-action';
import {
  cleanupTestData,
  createTestReminderAction,
  createTestReminderAssignment,
  createTestVehicle,
  getTestsuiteAdminClient,
} from '../helpers/data';

interface TestUsers {
  admin: { userId: string };
  employee: { userId: string };
}

function loadTestUsers(): TestUsers {
  const stateFile = resolve(process.cwd(), 'testsuite', '.state', 'test-users.json');
  return JSON.parse(readFileSync(stateFile, 'utf-8')) as TestUsers;
}

describe('@actions @reminders @workflow seeded reminder completion', () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it('marks the assigned reminder actioned when the matching daily check completes', async () => {
    const testUsers = loadTestUsers();
    const admin = getTestsuiteAdminClient();
    const vehicle = await createTestVehicle();
    const action = await createTestReminderAction({
      vanId: vehicle.id,
      createdBy: testUsers.admin.userId,
    });
    const reminder = await createTestReminderAssignment({
      actionId: action.id,
      assignedTo: testUsers.employee.userId,
      assignedBy: testUsers.admin.userId,
    });

    const result = await completeReminderActionForAsset({
      admin,
      assetType: 'van',
      assetId: vehicle.id,
      assignedTo: testUsers.employee.userId,
      actionedBy: testUsers.employee.userId,
      nowIso: new Date().toISOString(),
    });

    expect(result.actionedCount).toBe(1);
    expect(result.actionIds).toContain(action.id);

    const { data, error } = await admin
      .from('reminders')
      .select('status, actioned_at, actioned_by')
      .eq('id', reminder.id)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('actioned');
    expect(data?.actioned_at).toBeTruthy();
    expect(data?.actioned_by).toBe(testUsers.employee.userId);
  });
});
