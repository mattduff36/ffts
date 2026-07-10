import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isToolboxTalksOverviewMessage } from '@/app/api/messages/reports/route';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('toolbox talk standardisation', () => {
  it('stores urgent priority and acceptance delay for toolbox talks', () => {
    const route = read('app/api/messages/route.ts');
    const migration = read('supabase/migrations/20260604_toolbox_talk_priorities.sql');

    expect(route).toContain("['LOW', 'HIGH', 'URGENT']");
    expect(route).toContain('acceptance_delay_minutes: acceptanceDelayMinutes');
    expect(route).toContain("type === 'REMINDER'");
    expect(route).toContain('toolbox-talks_reminder');
    expect(migration).toContain("priority IN ('LOW', 'HIGH', 'URGENT')");
    expect(migration).toContain('acceptance_delay_minutes');
  });

  it('keeps new notifications in the non-blocking pending queue', () => {
    const pendingRoute = read('app/api/messages/pending/route.ts');
    const formattedToolboxTalksBlock = pendingRoute.slice(
      pendingRoute.indexOf('const formattedToolboxTalks'),
      pendingRoute.indexOf('const formattedReminders')
    );
    const formattedRemindersBlock = pendingRoute.slice(pendingRoute.indexOf('const formattedReminders'));

    expect(pendingRoute).toContain(".in('messages.type', ['REMINDER', 'NOTIFICATION'])");
    expect(pendingRoute).toContain("const TOOLBOX_TALKS_CREATED_VIA_PREFIX = 'toolbox-talks'");
    expect(pendingRoute).toContain('shouldShowNonBlockingModal');
    expect(formattedToolboxTalksBlock).not.toContain('shouldShowNonBlockingModal(message)');
    expect(formattedRemindersBlock).toContain('shouldShowNonBlockingModal(message)');
  });

  it('filters Toolbox Talks overview to module-owned messages only', () => {
    const reportsRoute = read('app/api/messages/reports/route.ts');
    const migration = read('supabase/migrations/20260604_message_module_keys.sql');

    expect(reportsRoute).toContain("const TOOLBOX_TALKS_MODULE_KEY");
    expect(reportsRoute).toContain(".eq('module_key', TOOLBOX_TALKS_MODULE_KEY)");
    expect(reportsRoute).toContain("TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY");
    expect(reportsRoute).toContain(".from('reminders')");
    expect(reportsRoute).toContain("type: 'REMINDER'");
    expect(reportsRoute).toContain("mapReminderPriority(action.priority)");
    expect(reportsRoute).toContain('.filter(isToolboxTalksOverviewMessage)');
    expect(migration).toContain("module_key = 'toolbox_talks'");
    expect(migration).toContain("type = 'NOTIFICATION'");
  });

  it('filters overview messages by module_key when available', () => {
    expect(isToolboxTalksOverviewMessage({ type: 'TOOLBOX_TALK', module_key: 'toolbox_talks', created_via: 'web' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', module_key: 'toolbox_talks', created_via: 'web' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'REMINDER', module_key: 'toolbox_talks', created_via: 'toolbox-talks_reminder' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', module_key: 'quotes', created_via: 'toolbox-talks_notification' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'REMINDER', module_key: 'maintenance', created_via: 'toolbox-talks_reminder' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: null, module_key: 'toolbox_talks', created_via: 'web' })).toBe(false);
  });

  it('keeps defensive created_via compatibility for pre-migration rows', () => {
    expect(isToolboxTalksOverviewMessage({ type: 'TOOLBOX_TALK', created_via: 'web' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: null })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'REMINDER', created_via: 'toolbox-talks_reminder' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: 'toolbox-talks_notification' })).toBe(true);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: 'quote_invoice_workflow' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: 'absence_contact_line_manager' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: 'processed_absence_change' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'NOTIFICATION', created_via: 'suggestion:abc' })).toBe(false);
    expect(isToolboxTalksOverviewMessage({ type: 'REMINDER', created_via: 'maintenance_reminder' })).toBe(false);
  });

  it('enforces urgent acceptance delay before signing', () => {
    const signRoute = read('app/api/messages/[id]/sign/route.ts');

    expect(signRoute).toContain("recipient.messages.priority === 'URGENT'");
    expect(signRoute).toContain('remaining_seconds');
    expect(signRoute).toContain('status: 409');
  });

  it('supports low priority read-later toolbox talks', () => {
    const deferRoute = read('app/api/messages/[id]/defer/route.ts');
    const modal = read('components/messages/BlockingMessageModal.tsx');

    expect(deferRoute).toContain("recipient.messages.priority !== 'LOW'");
    expect(deferRoute).toContain("status: 'SHOWN'");
    expect(modal).toContain('Read later from Notifications');
  });

  it('creates generic reminders in the Reminders module', () => {
    const manualRoute = read('app/api/reminders/manual/route.ts');
    const remindersPage = read('app/(dashboard)/reminders/page.tsx');
    const universalPermissionsMigration = read('supabase/migrations/20260604_reminders_universal_permissions.sql');

    expect(manualRoute).toContain('TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY');
    expect(manualRoute).toContain("getUsersWithModuleAccess('reminders'");
    expect(remindersPage).toContain('Dismiss reminder');
    expect(universalPermissionsMigration).toContain("target_module = 'reminders'");
    expect(universalPermissionsMigration).toContain("module = 'reminders'");
    expect(universalPermissionsMigration).toContain('RETURN 5');
  });
});
