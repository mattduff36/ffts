/**
 * One-off script to seed 3 test error reports for template-admin@example.com
 * and transition their statuses so in-app notifications are generated.
 *
 * Usage: npx tsx scripts/seed-test-error-reports.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TARGET_EMAIL = 'template-admin@example.com';

const TEST_REPORTS = [
  {
    title: 'Timesheet page crashes when selecting week ending',
    description: 'When I tap on the week ending date picker on my phone the page goes blank and I have to reload. Happens every time on Chrome Android.',
    page_url: '/timesheets/new',
    error_code: 'UNHANDLED_CLIENT',
    user_agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    additional_context: { selected_type: 'civils', week_ending: '2026-03-01' },
    transition_to: 'investigating' as const,
    admin_note: 'Looking into the date picker rendering on Android Chrome.',
  },
  {
    title: 'Workshop task photos not uploading',
    description: 'Tried to attach a photo to a workshop task three times but it just spins and never finishes. The task itself saves fine, just the photo upload fails.',
    page_url: '/workshop-tasks',
    error_code: null,
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
    additional_context: { task_id: 'sample-task-uuid', file_size_kb: 4200 },
    transition_to: 'resolved' as const,
    admin_note: 'Fixed — file size limit was too low for mobile camera photos. Deployed.',
  },
  {
    title: 'Fleet page shows wrong MOT date after DVLA sync',
    description: 'BG21 EXH shows MOT due 2025-06-14 but it was renewed last month. The DVLA sync ran yesterday but the date hasn\'t changed.',
    page_url: '/fleet',
    error_code: 'DVLA_SYNC_STALE',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    additional_context: { vehicle_reg: 'BG21 EXH', expected_mot: '2026-06-14', displayed_mot: '2025-06-14' },
    transition_to: 'investigating' as const,
    admin_note: 'Checking DVLA API response cache for this reg.',
  },
];

async function run() {
  // Resolve user ID for target email
  const { data: authList, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authError) { console.error('Failed to list users:', authError); process.exit(1); }

  const targetUser = authList.users.find(u => u.email === TARGET_EMAIL);
  if (!targetUser) { console.error(`User ${TARGET_EMAIL} not found`); process.exit(1); }
  const userId = targetUser.id;
  console.log(`Found user ${TARGET_EMAIL} → ${userId}`);

  // Also find an admin user to act as the status updater
  const { data: adminRoles } = await supabase.from('roles').select('id').is('is_super_admin', true);
  const adminRoleIds = (adminRoles ?? []).map(r => r.id);
  const { data: adminProfiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('role_id', adminRoleIds)
    .limit(1);
  const adminId = adminProfiles?.[0]?.id ?? userId;
  console.log(`Admin actor for status updates: ${adminProfiles?.[0]?.full_name ?? 'self'} (${adminId})`);

  for (const report of TEST_REPORTS) {
    // 1. Insert error report as `new`
    const { data: inserted, error: insertErr } = await supabase
      .from('error_reports')
      .insert({
        created_by: userId,
        title: report.title,
        description: report.description,
        error_code: report.error_code,
        page_url: report.page_url,
        user_agent: report.user_agent,
        additional_context: report.additional_context,
        status: 'new',
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      console.error(`Failed to insert report "${report.title}":`, insertErr);
      continue;
    }
    console.log(`  Created report: ${inserted.id} — "${report.title}"`);

    // 2. Transition status (simulates the admin PATCH flow)
    const oldStatus = 'new';
    const newStatus = report.transition_to;

    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
      updateData.resolved_by = adminId;
    }

    const { error: updErr } = await supabase
      .from('error_reports')
      .update(updateData)
      .eq('id', inserted.id);

    if (updErr) { console.error('  Status update failed:', updErr); continue; }

    // 3. Insert history entry
    await supabase.from('error_report_updates').insert({
      error_report_id: inserted.id,
      created_by: adminId,
      old_status: oldStatus,
      new_status: newStatus,
      note: report.admin_note,
    });

    // 4. Create in-app notification for the reporter
    const STATUS_LABELS: Record<string, string> = { new: 'New', investigating: 'Investigating', resolved: 'Resolved' };
    const oldLabel = STATUS_LABELS[oldStatus] ?? oldStatus;
    const newLabel = STATUS_LABELS[newStatus] ?? newStatus;
    const titleTrunc = report.title.substring(0, 60);

    const subject = `Error Report Updated to ${newLabel}`;
    const bodyParts = [
      `Your error report "${titleTrunc}" has been updated.`,
      '',
      `Status: ${oldLabel} → ${newLabel}`,
      '',
    ];
    if (report.admin_note) bodyParts.push(`Admin note: ${report.admin_note}`, '');
    bodyParts.push('---', 'Tip: You can view your reports on the Help page.');

    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        priority: 'HIGH',
        subject,
        body: bodyParts.join('\n'),
        sender_id: adminId,
      })
      .select()
      .single();

    if (msgErr || !msg) { console.error('  Notification insert failed:', msgErr); continue; }

    const { error: recErr } = await supabase
      .from('message_recipients')
      .insert({ message_id: msg.id, user_id: userId, status: 'PENDING' });

    if (recErr) { console.error('  Recipient insert failed:', recErr); continue; }

    console.log(`  Status: ${oldLabel} → ${newLabel} | Notification sent`);
  }

  console.log('\nDone. Check the notification bell for template-admin@example.com.');
}

run().catch(err => { console.error(err); process.exit(1); });
