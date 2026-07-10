import { createAdminClient } from '@/lib/supabase/admin';
import { templateConfig } from '@/lib/config/template-config';
import { getPrimaryResendEmailConfig } from '@/lib/server/resend-email-config';

interface AdminProfileRow {
  id: string;
  full_name: string | null;
  super_admin: boolean | null;
  role:
    | {
        name?: string | null;
        role_class?: 'admin' | 'manager' | 'employee' | null;
        is_super_admin?: boolean | null;
      }
    | Array<{
        name?: string | null;
        role_class?: 'admin' | 'manager' | 'employee' | null;
        is_super_admin?: boolean | null;
      }>
    | null;
}

interface NotificationPreferenceRow {
  user_id: string;
  notify_in_app: boolean | null;
  notify_email: boolean | null;
}

interface SensitivePinAdminNotificationParams {
  actorProfileId: string;
  targetProfileId: string;
  targetName: string;
  eventType: 'set' | 'changed' | 'admin_reset';
}

function pickRole(row: AdminProfileRow) {
  return Array.isArray(row.role) ? row.role[0] || null : row.role;
}

function isAdminProfile(row: AdminProfileRow): boolean {
  const role = pickRole(row);
  return (
    row.super_admin === true ||
    role?.is_super_admin === true ||
    role?.role_class === 'admin' ||
    role?.name === 'admin'
  );
}

function getPreferenceForUser(
  preferences: NotificationPreferenceRow[],
  userId: string
): { notifyInApp: boolean; notifyEmail: boolean } {
  const preference = preferences.find((entry) => entry.user_id === userId);
  return {
    notifyInApp: preference?.notify_in_app !== false,
    notifyEmail: preference?.notify_email !== false,
  };
}

function buildSubject(eventType: SensitivePinAdminNotificationParams['eventType']): string {
  if (eventType === 'admin_reset') return 'Sensitive PIN reset by admin';
  return `Sensitive PIN ${eventType === 'set' ? 'set' : 'changed'}`;
}

function buildBody(params: SensitivePinAdminNotificationParams): string {
  if (params.eventType === 'admin_reset') {
    return `${params.targetName}'s sensitive module PIN was reset by an admin. The user must set a new PIN from their profile before opening protected modules.`;
  }

  return `${params.targetName} ${params.eventType === 'set' ? 'set up' : 'changed'} their sensitive module PIN. PIN values are never included in notifications, emails, or logs.`;
}

async function sendSensitivePinEmail(params: {
  to: string[];
  subject: string;
  body: string;
}): Promise<void> {
  if (params.to.length === 0) return;

  const { apiKey, fromEmail } = getPrimaryResendEmailConfig();
  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured; sensitive PIN admin email skipped');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: params.to,
      subject: params.subject,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
            <h2>${params.subject}</h2>
            <p>${params.body}</p>
            <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">This is an automated ${templateConfig.branding.shortAppName} security notification.</p>
          </body>
        </html>
      `,
    }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    console.warn('Sensitive PIN admin email failed:', error?.message || response.statusText);
  }
}

export async function notifyAdminsOfSensitivePinEvent(
  params: SensitivePinAdminNotificationParams
): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select(`
      id,
      full_name,
      super_admin,
      role:roles(name, role_class, is_super_admin)
    `);

  if (profilesError) {
    console.warn('Failed to load admin profiles for sensitive PIN notification:', profilesError.message);
    return;
  }

  const admins = ((profiles || []) as AdminProfileRow[]).filter(isAdminProfile);
  if (admins.length === 0) return;

  const adminIds = admins.map((entry) => entry.id);
  const { data: preferences } = await admin
    .from('notification_preferences')
    .select('user_id, notify_in_app, notify_email')
    .eq('module_key', 'sensitive_pin_security')
    .in('user_id', adminIds);

  const typedPreferences = (preferences || []) as NotificationPreferenceRow[];
  const subject = buildSubject(params.eventType);
  const body = buildBody(params);
  const inAppRecipientIds = admins
    .filter((entry) => getPreferenceForUser(typedPreferences, entry.id).notifyInApp)
    .map((entry) => entry.id);

  if (inAppRecipientIds.length > 0) {
    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        priority: 'HIGH',
        subject,
        body,
        sender_id: params.actorProfileId,
        created_via: 'sensitive_pin_security',
        module_key: 'sensitive_pin_security',
      })
      .select('id')
      .single();

    if (!messageError && message) {
      const { error: recipientsError } = await admin
        .from('message_recipients')
        .insert(inAppRecipientIds.map((recipientId) => ({
          message_id: message.id,
          user_id: recipientId,
          status: 'PENDING',
        })));

      if (recipientsError) {
        console.warn('Failed to create sensitive PIN notification recipients:', recipientsError.message);
      }
    } else {
      console.warn('Failed to create sensitive PIN admin notification:', messageError?.message);
    }
  }

  const emailRecipientIds = admins
    .filter((entry) => getPreferenceForUser(typedPreferences, entry.id).notifyEmail)
    .map((entry) => entry.id);
  const emails: string[] = [];

  for (const userId of emailRecipientIds) {
    const { data } = await admin.auth.admin.getUserById(userId);
    if (data.user?.email) {
      emails.push(data.user.email);
    }
  }

  await sendSensitivePinEmail({ to: emails, subject, body });
}
