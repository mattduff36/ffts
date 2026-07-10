import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { logServerError } from '@/lib/utils/server-error-logger';
import { parseReportDateRange } from '@/lib/server/report-date-range';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import type { GetReportsResponse, MessageDisplayPriority, MessageRecipientStatus, MessageReportData } from '@/types/messages';
import type { MessageType } from '@/types/messages';
import type { NotificationModuleKey } from '@/types/notifications';

const TOOLBOX_TALKS_MODULE_KEY: NotificationModuleKey = 'toolbox_talks';
const TOOLBOX_TALKS_CREATED_VIA_PREFIX = 'toolbox-talks';
const TOOLBOX_OVERVIEW_TYPES: MessageType[] = ['TOOLBOX_TALK', 'NOTIFICATION', 'REMINDER'];

interface ProfileShape {
  id?: string;
  full_name?: string | null;
  role?: string | null;
  employee_id?: string | null;
}

interface ReminderActionShape {
  id?: string;
  workflow_key?: string | null;
  title?: string | null;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  creator?: ProfileShape | ProfileShape[] | null;
}

interface ManualReminderShape {
  id?: string;
  action_id?: string;
  assigned_to?: string;
  assigned_by?: string | null;
  status?: 'pending' | 'actioned' | 'cancelled' | null;
  actioned_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assignee?: ProfileShape | ProfileShape[] | null;
  action?: ReminderActionShape | ReminderActionShape[] | null;
}

function pickProfile(
  profile: ProfileShape | ProfileShape[] | null | undefined
): ProfileShape | null {
  if (!profile) return null;
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

function pickReminderAction(action: ManualReminderShape['action']): ReminderActionShape | null {
  if (!action) return null;
  return Array.isArray(action) ? action[0] ?? null : action;
}

function mapReminderPriority(priority: ReminderActionShape['priority']): MessageDisplayPriority {
  if (priority === 'urgent') return 'URGENT';
  if (priority === 'high') return 'HIGH';
  if (priority === 'medium') return 'MEDIUM';
  return 'LOW';
}

function mapReminderRecipientStatus(status: ManualReminderShape['status']): MessageRecipientStatus {
  if (status === 'actioned') return 'SIGNED';
  if (status === 'cancelled') return 'DISMISSED';
  return 'PENDING';
}

function isWithinDateRange(value: string | null | undefined, dateFrom: string | null, dateTo: string | null): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  if (dateFrom && timestamp < new Date(`${dateFrom}T00:00:00.000Z`).getTime()) return false;
  if (dateTo && timestamp > new Date(`${dateTo}T23:59:59.999Z`).getTime()) return false;
  return true;
}

function isAllowedType(value: string | null): value is MessageType {
  return value === 'TOOLBOX_TALK' || value === 'REMINDER' || value === 'NOTIFICATION';
}

export function isToolboxTalksOverviewMessage(message: {
  type?: MessageType | null;
  module_key?: NotificationModuleKey | null;
  created_via?: string | null;
}): boolean {
  if (!message.type || !TOOLBOX_OVERVIEW_TYPES.includes(message.type)) return false;

  if (message.module_key) {
    return message.module_key === TOOLBOX_TALKS_MODULE_KEY;
  }

  const createdVia = message.created_via ?? '';
  if (message.type === 'TOOLBOX_TALK') return true;

  if (message.type === 'NOTIFICATION' || message.type === 'REMINDER') {
    return createdVia.startsWith(TOOLBOX_TALKS_CREATED_VIA_PREFIX);
  }

  return false;
}

/**
 * GET /api/messages/reports
 * Fetch Toolbox Talk reporting data for managers/admins
 * Includes message details, recipient lists, and compliance statistics
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [canAccessReports, canAccessToolboxTalks] = await Promise.all([
      canEffectiveRoleAccessModule('reports'),
      canEffectiveRoleAccessModule('toolbox-talks'),
    ]);

    if (!canAccessReports || !canAccessToolboxTalks) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters for filtering
    const { searchParams } = new URL(request.url);
    const { range, error: dateRangeError } = parseReportDateRange(searchParams);
    if (dateRangeError || !range) {
      return NextResponse.json({ error: dateRangeError || 'Invalid date range.' }, { status: 400 });
    }

    const { dateFrom, dateTo } = range;
    const senderId = searchParams.get('sender_id');
    const type = searchParams.get('type'); // 'TOOLBOX_TALK', 'REMINDER', or 'NOTIFICATION'
    const status = searchParams.get('status'); // 'all', 'signed', 'pending'

    if (type && !isAllowedType(type)) {
      return NextResponse.json({ error: 'Invalid message type.' }, { status: 400 });
    }
    const messageType = type && isAllowedType(type) ? type : null;

    if (status && !['all', 'signed', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 });
    }

    const scopeContext = await getReportScopeContext();
    const scopedProfileIds = await getScopedProfileIdsForModule('toolbox-talks', scopeContext);
    if (scopedProfileIds && scopedProfileIds.size === 0) {
      return NextResponse.json({ success: true, messages: [] } satisfies GetReportsResponse);
    }

    // Build query for messages
    let messagesQuery = supabase
      .from('messages')
      .select(`
        id,
        type,
        subject,
        body,
        priority,
        sender_id,
        pdf_file_path,
        acceptance_delay_minutes,
        created_via,
        module_key,
        created_at,
        updated_at,
        deleted_at,
        sender:profiles!messages_sender_id_fkey(
          id,
          full_name
        )
      `)
      .is('deleted_at', null)
      .eq('module_key', TOOLBOX_TALKS_MODULE_KEY)
      .order('created_at', { ascending: false });

    // Apply filters
    if (dateFrom) {
      messagesQuery = messagesQuery.gte('created_at', `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      messagesQuery = messagesQuery.lte('created_at', `${dateTo}T23:59:59.999Z`);
    }
    if (senderId) {
      messagesQuery = messagesQuery.eq('sender_id', senderId);
    }
    
    // Type filter keeps the query bounded; module-origin filtering below removes
    // notifications/reminders created by other modules.
    if (messageType) {
      messagesQuery = messagesQuery.eq('type', messageType);
    } else {
      messagesQuery = messagesQuery.in('type', TOOLBOX_OVERVIEW_TYPES);
    }

    const { data: messages, error: messagesError } = await messagesQuery;

    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      throw messagesError;
    }

    // For each message, fetch recipient details
    const reportsData: MessageReportData[] = [];
    const overviewMessages = (messages || []).filter(isToolboxTalksOverviewMessage);

    for (const message of overviewMessages) {
      // Fetch all recipients for this message
      let recipientsQuery = supabase
        .from('message_recipients')
        .select(`
          id,
          user_id,
          status,
          signed_at,
          created_at,
          user:profiles!message_recipients_user_id_fkey(
            full_name,
            role,
            employee_id
          )
        `)
        .eq('message_id', message.id)
        .order('created_at', { ascending: true });

      if (scopedProfileIds) {
        recipientsQuery = recipientsQuery.in('user_id', Array.from(scopedProfileIds));
      }

      const { data: recipients, error: recipientsError } = await recipientsQuery;

      if (recipientsError) {
        console.error('Error fetching recipients:', recipientsError);
        continue;
      }

      const normalizedRecipients =
        (recipients ?? []).map((recipient) => ({
          ...recipient,
          user: pickProfile(recipient.user as ProfileShape | ProfileShape[] | null),
        }));

      const totalAssigned = normalizedRecipients.length;
      const totalSigned = message.type === 'TOOLBOX_TALK'
        ? normalizedRecipients.filter((r) => r.status === 'SIGNED').length
        : normalizedRecipients.filter((r) => r.status === 'DISMISSED').length;
      const totalPending = normalizedRecipients.filter(
        (r) => r.status === 'PENDING' || r.status === 'SHOWN'
      ).length;
      const complianceRate = totalAssigned > 0 ? Math.round((totalSigned / totalAssigned) * 100) : 0;

      // Apply status filter at the report level
      if (status === 'signed' && totalPending > 0) {
        continue; // Skip if not fully signed
      }
      if (status === 'pending' && totalPending === 0) {
        continue; // Skip if fully signed
      }

      const sender = pickProfile(message.sender as ProfileShape | ProfileShape[] | null);
      const messageCreatedAt = message.created_at ?? new Date(0).toISOString();
      reportsData.push({
        message: {
          ...message,
          id: message.id,
          sender_id: message.sender_id ?? null,
          created_at: messageCreatedAt,
          updated_at: message.updated_at ?? messageCreatedAt,
          deleted_at: message.deleted_at ?? null,
          created_via: message.created_via ?? 'api',
          module_key: (message.module_key ?? TOOLBOX_TALKS_MODULE_KEY) as NotificationModuleKey,
          pdf_file_path: message.pdf_file_path ?? null,
          acceptance_delay_minutes: message.acceptance_delay_minutes ?? 0,
          sender: sender
            ? {
                id: sender.id ?? '',
                full_name: sender.full_name ?? 'Deleted User',
                role: sender.role ?? 'unknown',
              }
            : null,
        },
        recipients: normalizedRecipients.map((recipient) => ({
          ...recipient,
          id: recipient.id ?? `${message.id}:${recipient.user_id}`,
          message_id: message.id,
          user_id: recipient.user_id ?? '',
          status: recipient.status ?? 'PENDING',
          signed_at: recipient.signed_at ?? null,
          first_shown_at: null,
          cleared_from_inbox_at: null,
          signature_data: null,
          created_at: recipient.created_at ?? messageCreatedAt,
          updated_at: recipient.created_at ?? messageCreatedAt,
          user: recipient.user
            ? {
                full_name: recipient.user.full_name ?? 'Unknown',
                role: recipient.user.role ?? 'unknown',
                employee_id: recipient.user.employee_id ?? null,
              }
            : null,
        })),
        total_assigned: totalAssigned,
        total_signed: totalSigned,
        total_pending: totalPending,
        compliance_rate: complianceRate
      });
    }

    if (!type || type === 'REMINDER') {
      let manualReminderQuery = admin
        .from('reminders')
        .select(`
          id,
          action_id,
          assigned_to,
          assigned_by,
          status,
          actioned_at,
          created_at,
          updated_at,
          assignee:profiles!reminders_assigned_to_fkey(
            full_name,
            role,
            employee_id
          ),
          action:reminder_actions!inner(
            id,
            workflow_key,
            title,
            description,
            priority,
            created_by,
            created_at,
            updated_at,
            creator:profiles!reminder_actions_created_by_fkey(
              id,
              full_name
            )
          )
        `)
        .eq('action.workflow_key', TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY)
        .order('created_at', { ascending: true });

      if (scopedProfileIds) {
        manualReminderQuery = manualReminderQuery.in('assigned_to', Array.from(scopedProfileIds));
      }

      const { data: manualReminderRows, error: manualReminderError } = await manualReminderQuery;
      if (manualReminderError) {
        console.error('Error fetching manual reminders:', manualReminderError);
        throw manualReminderError;
      }

      const remindersByActionId = new Map<string, ManualReminderShape[]>();
      for (const row of (manualReminderRows || []) as ManualReminderShape[]) {
        const action = pickReminderAction(row.action);
        if (!action?.id) continue;
        if (!isWithinDateRange(action.created_at ?? row.created_at, dateFrom, dateTo)) continue;
        if (senderId && action.created_by !== senderId) continue;

        const existing = remindersByActionId.get(action.id) || [];
        existing.push(row);
        remindersByActionId.set(action.id, existing);
      }

      for (const [actionId, reminders] of remindersByActionId) {
        const firstReminder = reminders[0];
        const action = pickReminderAction(firstReminder?.action);
        if (!firstReminder || !action) continue;

        const normalizedRecipients = reminders.map((reminder) => {
          const recipientStatus = mapReminderRecipientStatus(reminder.status);
          return {
            id: reminder.id ?? `${actionId}:${reminder.assigned_to}`,
            message_id: `reminder-action:${actionId}`,
            user_id: reminder.assigned_to ?? '',
            status: recipientStatus,
            signed_at: recipientStatus === 'SIGNED' ? reminder.actioned_at ?? null : null,
            first_shown_at: null,
            cleared_from_inbox_at: null,
            signature_data: null,
            created_at: reminder.created_at ?? action.created_at ?? new Date(0).toISOString(),
            updated_at: reminder.updated_at ?? reminder.created_at ?? action.updated_at ?? action.created_at ?? new Date(0).toISOString(),
            user: pickProfile(reminder.assignee),
          };
        });

        const totalAssigned = normalizedRecipients.length;
        const totalSigned = normalizedRecipients.filter((recipient) => recipient.status === 'SIGNED').length;
        const totalPending = normalizedRecipients.filter((recipient) => recipient.status === 'PENDING').length;
        const complianceRate = totalAssigned > 0 ? Math.round((totalSigned / totalAssigned) * 100) : 0;

        if (status === 'signed' && totalPending > 0) {
          continue;
        }
        if (status === 'pending' && totalPending === 0) {
          continue;
        }

        const sender = pickProfile(action.creator);
        reportsData.push({
          message: {
            id: `reminder-action:${actionId}`,
            type: 'REMINDER',
            subject: action.title ?? 'Manual reminder',
            body: action.description ?? '',
            priority: mapReminderPriority(action.priority),
            sender_id: action.created_by ?? null,
            created_at: action.created_at ?? firstReminder.created_at ?? new Date(0).toISOString(),
            updated_at: action.updated_at ?? action.created_at ?? firstReminder.updated_at ?? firstReminder.created_at ?? new Date(0).toISOString(),
            deleted_at: null,
            created_via: 'toolbox-talks_manual_reminder',
            module_key: TOOLBOX_TALKS_MODULE_KEY,
            pdf_file_path: null,
            acceptance_delay_minutes: 0,
            sender: sender
              ? {
                  id: sender.id ?? action.created_by ?? '',
                  full_name: sender.full_name ?? 'Deleted User',
                  role: sender.role ?? 'unknown',
                }
              : null,
          },
          recipients: normalizedRecipients.map((recipient) => ({
            ...recipient,
            user: recipient.user
              ? {
                  full_name: recipient.user.full_name ?? 'Unknown',
                  role: recipient.user.role ?? 'unknown',
                  employee_id: recipient.user.employee_id ?? null,
                }
              : null,
          })),
          total_assigned: totalAssigned,
          total_signed: totalSigned,
          total_pending: totalPending,
          compliance_rate: complianceRate,
        });
      }
    }

    reportsData.sort((a, b) => new Date(b.message.created_at).getTime() - new Date(a.message.created_at).getTime());

    const response: GetReportsResponse = {
      success: true,
      messages: reportsData
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/messages/reports:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/reports',
      additionalData: {
        endpoint: '/api/messages/reports',
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

