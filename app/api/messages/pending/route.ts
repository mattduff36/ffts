import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import type { GetPendingMessagesResponse } from '@/types/messages';
import type { NotificationModuleKey } from '@/types/notifications';

interface SenderShape {
  full_name?: string | null;
}

interface PendingMessageShape {
  id?: string;
  type?: 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION';
  created_via?: string | null;
  module_key?: NotificationModuleKey | null;
  subject?: string | null;
  body?: string | null;
  priority?: 'HIGH' | 'LOW' | 'URGENT';
  acceptance_delay_minutes?: number | null;
  sender_id?: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
  pdf_file_path?: string | null;
  sender?: SenderShape | SenderShape[] | null;
}

interface RecipientShape {
  id?: string;
  first_shown_at?: string | null;
  messages?: PendingMessageShape | PendingMessageShape[] | null;
}

const TOOLBOX_TALKS_MODULE_KEY: NotificationModuleKey = 'toolbox_talks';
const TOOLBOX_TALKS_CREATED_VIA_PREFIX = 'toolbox-talks';

function pickMessage(messages: RecipientShape['messages']): PendingMessageShape | null {
  if (!messages) return null;
  return Array.isArray(messages) ? messages[0] ?? null : messages;
}

function pickSender(sender: PendingMessageShape['sender']): SenderShape | null {
  if (!sender) return null;
  return Array.isArray(sender) ? sender[0] ?? null : sender;
}

function shouldShowNonBlockingModal(message: PendingMessageShape): boolean {
  if (message.module_key) {
    return message.module_key === TOOLBOX_TALKS_MODULE_KEY
      && (message.type === 'REMINDER' || message.type === 'NOTIFICATION');
  }

  if (message.type === 'REMINDER') {
    return (message.created_via ?? '').startsWith(TOOLBOX_TALKS_CREATED_VIA_PREFIX);
  }

  if (message.type === 'NOTIFICATION') {
    return (message.created_via ?? '').startsWith(TOOLBOX_TALKS_CREATED_VIA_PREFIX);
  }

  return false;
}

/**
 * GET /api/messages/pending
 * Fetch pending Toolbox Talks and Reminders for the current user
 * Used by blocking modal to check what messages need attention
 */
export async function GET() {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();
    const userId = current.profile.id;

    // Fetch pending Toolbox Talks (PENDING status, not soft-deleted)
    const { data: toolboxTalks, error: toolboxError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        first_shown_at,
        messages!inner(
          id,
          type,
          created_via,
          module_key,
          subject,
          body,
          priority,
          acceptance_delay_minutes,
          sender_id,
          created_at,
          deleted_at,
          pdf_file_path,
          sender:profiles!messages_sender_id_fkey(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .eq('messages.type', 'TOOLBOX_TALK')
      .eq('messages.module_key', TOOLBOX_TALKS_MODULE_KEY)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: true }); // Oldest first

    if (toolboxError) {
      console.error('Error fetching toolbox talks:', toolboxError);
      throw toolboxError;
    }

    // Fetch pending non-blocking messages (PENDING status, not soft-deleted)
    const { data: reminders, error: remindersError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        messages!inner(
          id,
          type,
          created_via,
          module_key,
          subject,
          body,
          priority,
          sender_id,
          created_at,
          deleted_at,
          sender:profiles!messages_sender_id_fkey(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .in('messages.type', ['REMINDER', 'NOTIFICATION'])
      .eq('messages.module_key', TOOLBOX_TALKS_MODULE_KEY)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false }); // Newest first

    if (remindersError) {
      console.error('Error fetching reminders:', remindersError);
      throw remindersError;
    }

    // Transform the data to include recipient_id for updates
    const formattedToolboxTalks = (toolboxTalks ?? [])
      .map((rawItem) => {
        const item = rawItem as RecipientShape;
        const message = pickMessage(item.messages);
        if (!message?.id || !message.type || !message.priority || !message.created_at) return null;

        return {
          id: message.id,
          type: message.type,
          subject: message.subject ?? '',
          body: message.body ?? '',
          priority: message.priority,
          sender_id: message.sender_id ?? null,
          created_at: message.created_at,
          updated_at: message.created_at,
          deleted_at: message.deleted_at ?? null,
          created_via: message.created_via ?? 'api',
          module_key: message.module_key ?? TOOLBOX_TALKS_MODULE_KEY,
          pdf_file_path: message.pdf_file_path ?? null,
          acceptance_delay_minutes: message.acceptance_delay_minutes ?? 0,
          sender: {
            id: message.sender_id ?? '',
            full_name: pickSender(message.sender)?.full_name ?? 'Deleted User',
            role: 'unknown',
          },
          recipient_id: item.id ?? '',
          first_shown_at: item.first_shown_at ?? null,
          sender_name: pickSender(message.sender)?.full_name ?? 'Deleted User',
        };
      })
      .filter((item) => item !== null);

    const formattedReminders = (reminders ?? [])
      .map((rawItem) => {
        const item = rawItem as RecipientShape;
        const message = pickMessage(item.messages);
        if (!message?.id || !message.type || !message.priority || !message.created_at) return null;
        if (!shouldShowNonBlockingModal(message)) return null;

        return {
          id: message.id,
          type: message.type,
          subject: message.subject ?? '',
          body: message.body ?? '',
          priority: message.priority,
          sender_id: message.sender_id ?? null,
          created_at: message.created_at,
          updated_at: message.created_at,
          deleted_at: message.deleted_at ?? null,
          created_via: message.created_via ?? 'api',
          module_key: message.module_key ?? TOOLBOX_TALKS_MODULE_KEY,
          pdf_file_path: message.pdf_file_path ?? null,
          acceptance_delay_minutes: message.acceptance_delay_minutes ?? 0,
          sender: {
            id: message.sender_id ?? '',
            full_name: pickSender(message.sender)?.full_name ?? 'Deleted User',
            role: 'unknown',
          },
          recipient_id: item.id ?? '',
          sender_name: pickSender(message.sender)?.full_name ?? 'Deleted User',
        };
      })
      .filter((item) => item !== null);

    const response: GetPendingMessagesResponse = {
      success: true,
      toolbox_talks: formattedToolboxTalks,
      reminders: formattedReminders
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/messages/pending:', error);

    await logServerError({
      error: error as Error,
      componentName: '/api/messages/pending',
      additionalData: {
        endpoint: '/api/messages/pending',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

