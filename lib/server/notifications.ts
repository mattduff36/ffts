import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { NotificationItem } from '@/types/messages';
import type { NotificationModuleKey } from '@/types/notifications';
import { isUnreadNotification } from '@/lib/utils/notification-helpers';

type ServerSupabaseClient = SupabaseClient<Database>;

interface SenderShape {
  full_name?: string | null;
}

interface MessageShape {
  type?: NotificationItem['type'];
  priority?: NotificationItem['priority'];
  created_via?: string | null;
  module_key?: NotificationModuleKey | null;
  subject?: string | null;
  body?: string | null;
  pdf_file_path?: string | null;
  acceptance_delay_minutes?: number | null;
  sender_id?: string | null;
  created_at?: string | null;
  sender?: SenderShape | SenderShape[] | null;
}

interface RecipientShape {
  id?: string;
  message_id?: string;
  status?: NotificationItem['status'];
  signed_at?: string | null;
  first_shown_at?: string | null;
  signature_data?: string | null;
  messages?: MessageShape | MessageShape[] | null;
}

interface RecipientQueryResult {
  data: RecipientShape[] | null;
  error: { message?: string | null } | null;
}

interface NotificationCountQueryResult {
  count: number | null;
  error: { message?: string | null } | null;
}

interface DeferredToolboxTalkCountQueryResult {
  data: Array<{
    status?: NotificationItem['status'] | null;
    messages?: {
      type?: NotificationItem['type'] | null;
      priority?: NotificationItem['priority'] | null;
    } | Array<{
      type?: NotificationItem['type'] | null;
      priority?: NotificationItem['priority'] | null;
    }> | null;
  }> | null;
  error: { message?: string | null } | null;
}

const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 100;
const NOTIFICATION_LOOKBACK_DAYS = 60;

function buildNotificationSinceIso(): string {
  const since = new Date();
  since.setDate(since.getDate() - NOTIFICATION_LOOKBACK_DAYS);
  return since.toISOString();
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|schema cache|bad gateway|502/i.test(message);
}

async function withRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === retries) {
        throw error;
      }
    }
  }

  throw normalizeNotificationError(lastError);
}

export function normalizeNotificationError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Unknown error');
}

function pickMessage(messages: RecipientShape['messages']): MessageShape | null {
  if (!messages) return null;
  return Array.isArray(messages) ? messages[0] ?? null : messages;
}

function pickSender(sender: MessageShape['sender']): SenderShape | null {
  if (!sender) return null;
  return Array.isArray(sender) ? sender[0] ?? null : sender;
}

function pickDeferredCountMessage(
  messages: NonNullable<DeferredToolboxTalkCountQueryResult['data']>[number]['messages']
) {
  if (!messages) return null;
  return Array.isArray(messages) ? messages[0] ?? null : messages;
}

export function parseNotificationLimit(limitParam: string | null): number {
  const parsed = Number.parseInt(limitParam ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_NOTIFICATION_LIMIT;
  }

  return Math.min(parsed, MAX_NOTIFICATION_LIMIT);
}

export async function listNotificationsForUser(
  supabase: ServerSupabaseClient,
  userId: string,
  options?: { limit?: number }
): Promise<NotificationItem[]> {
  const sinceIso = buildNotificationSinceIso();
  const limit = parseNotificationLimit(options?.limit ? String(options.limit) : null);
  const { data: recipients, error: fetchError } = await withRetry<RecipientQueryResult>(async () => {
    const result = (await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        signed_at,
        first_shown_at,
        signature_data,
        created_at,
        messages!inner(
          id,
          type,
          created_via,
          module_key,
          subject,
          body,
          pdf_file_path,
          acceptance_delay_minutes,
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
      .gte('messages.created_at', sinceIso)
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false })
      .limit(limit)) as RecipientQueryResult;

    if (result.error && isTransientFetchError(result.error.message || '')) {
      throw new Error(result.error.message || 'Transient notifications query failure');
    }

    return result;
  });

  if (fetchError) {
    throw new Error(fetchError.message || 'Failed to fetch notifications');
  }

  return (recipients ?? [])
    .map((rawItem) => {
      const item = rawItem as RecipientShape;
      const message = pickMessage(item.messages);
      if (!message?.type || !message.priority || !message.created_at) return null;

      const sender = pickSender(message.sender);
      return {
        id: item.id ?? '',
        message_id: item.message_id ?? '',
        type: message.type,
        priority: message.priority,
        created_via: message.created_via ?? null,
        module_key: message.module_key ?? 'general_notifications',
        subject: message.subject ?? '',
        body: message.body ?? '',
        pdf_file_path: message.pdf_file_path ?? null,
        acceptance_delay_minutes: message.acceptance_delay_minutes ?? 0,
        sender_name: sender?.full_name ?? 'Deleted User',
        sender_id: message.sender_id ?? null,
        status: item.status ?? 'PENDING',
        created_at: message.created_at,
        signed_at: item.signed_at ?? null,
        first_shown_at: item.first_shown_at ?? null,
        signature_data: item.signature_data ?? null,
      };
    })
    .filter((item): item is NotificationItem => item !== null);
}

export async function countUnreadNotificationsForUser(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<number> {
  const sinceIso = buildNotificationSinceIso();
  const { count, error } = await withRetry<NotificationCountQueryResult>(async () => {
    const result = (await supabase
      .from('message_recipients')
      // Keep the badge in sync with the inbox contents. This remains selective
      // because the query hits the partial inbox index for the current user.
      .select('id, messages!inner(id)', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .gte('messages.created_at', sinceIso)
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)) as NotificationCountQueryResult;

    if (result.error && isTransientFetchError(result.error.message || '')) {
      throw new Error(result.error.message || 'Transient notification count failure');
    }

    return result;
  });

  if (error) {
    throw new Error(error.message || 'Failed to count notifications');
  }

  const { data: deferredToolboxTalks, error: deferredFetchError } = await withRetry<DeferredToolboxTalkCountQueryResult>(async () => {
    const result = (await supabase
      .from('message_recipients')
      .select(`
        status,
        messages!inner(
          type,
          priority
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'SHOWN')
      .eq('messages.type', 'TOOLBOX_TALK')
      .eq('messages.priority', 'LOW')
      .gte('messages.created_at', sinceIso)
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)) as DeferredToolboxTalkCountQueryResult;

    if (result.error && isTransientFetchError(result.error.message || '')) {
      throw new Error(result.error.message || 'Transient deferred toolbox talk count failure');
    }

    return result;
  });

  if (deferredFetchError) {
    throw new Error(deferredFetchError.message || 'Failed to count deferred toolbox talks');
  }

  const deferredCount = (deferredToolboxTalks ?? []).filter((recipient) => {
    const message = pickDeferredCountMessage(recipient.messages);
    return isUnreadNotification({
      status: recipient.status ?? 'PENDING',
      type: message?.type ?? 'TOOLBOX_TALK',
      priority: message?.priority ?? 'LOW',
    });
  }).length;

  return (count || 0) + deferredCount;
}
