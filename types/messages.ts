import type { NotificationModuleKey } from '@/types/notifications';

/**
 * Internal Messages and Notifications System Types
 * Supports Toolbox Talks (high priority, blocking) and Reminders (low priority, non-blocking)
 */

export type MessageType = 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION';
export type MessagePriority = 'HIGH' | 'LOW' | 'URGENT';
export type MessageDisplayPriority = MessagePriority | 'MEDIUM';
export type MessageRecipientStatus = 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED';

// Base message interface
export interface Message {
  id: string;
  type: MessageType;
  subject: string;
  body: string;
  priority: MessagePriority;
  sender_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_via: string;
  module_key: NotificationModuleKey;
  pdf_file_path: string | null;
  acceptance_delay_minutes: number;
}

// Message recipient (per-user assignment)
export interface MessageRecipient {
  id: string;
  message_id: string;
  user_id: string;
  status: MessageRecipientStatus;
  signed_at: string | null;
  first_shown_at: string | null;
  cleared_from_inbox_at: string | null;
  signature_data: string | null;
  created_at: string;
  updated_at: string;
}

// Extended types with joins for UI display

export interface MessageWithSender extends Message {
  sender: {
    id: string;
    full_name: string;
    role: string;
  } | null;
}

export interface MessageWithRecipients extends MessageWithSender {
  recipients: (MessageRecipient & {
    user: {
      id: string;
      full_name: string;
      role: string;
      email?: string;
    };
  })[];
  total_recipients: number;
  total_signed: number;
  total_pending: number;
}

export interface NotificationItem {
  id: string;
  message_id: string;
  type: MessageType;
  priority: MessagePriority;
  created_via: string | null;
  module_key: NotificationModuleKey;
  subject: string;
  body: string;
  pdf_file_path: string | null;
  acceptance_delay_minutes: number;
  sender_name: string;
  sender_id: string | null;
  status: MessageRecipientStatus;
  created_at: string;
  signed_at: string | null;
  first_shown_at: string | null;
  signature_data: string | null;
}

// Form input types

export interface CreateMessageInput {
  type: MessageType;
  subject: string;
  body: string;
  recipient_type: 'individual' | 'role' | 'all_staff';
  priority?: MessagePriority;
  acceptance_delay_minutes?: number;
  // For 'individual': array of user IDs
  recipient_user_ids?: string[];
  // For 'role': array of roles
  recipient_roles?: string[];
}

export interface SignMessageInput {
  recipient_id: string;
  signature_data: string;
}

export interface DismissMessageInput {
  recipient_id: string;
}

// API Response types

export interface CreateMessageResponse {
  success: boolean;
  message?: Message;
  recipients_created?: number;
  error?: string;
}

export interface GetPendingMessagesResponse {
  success: boolean;
  toolbox_talks?: MessageWithSender[];
  reminders?: MessageWithSender[];
  error?: string;
}

export interface GetNotificationsResponse {
  success: boolean;
  notifications?: NotificationItem[];
  unread_count?: number;
  error?: string;
}

export interface SignMessageResponse {
  success: boolean;
  recipient?: MessageRecipient;
  error?: string;
}

export interface MessageReportMessage extends Omit<MessageWithSender, 'priority'> {
  priority: MessageDisplayPriority;
}

export interface MessageReportData {
  message: MessageReportMessage;
  recipients: (MessageRecipient & {
    user: {
      full_name: string;
      role: string;
      employee_id: string | null;
    } | null;
  })[];
  total_assigned: number;
  total_signed: number;
  total_pending: number;
  compliance_rate: number;
}

export interface GetReportsResponse {
  success: boolean;
  messages?: MessageReportData[];
  error?: string;
}

// Filter types for reporting

export interface MessageReportFilters {
  dateFrom?: string;
  dateTo?: string;
  sender_id?: string;
  type?: MessageType;
  status?: 'all' | 'signed' | 'pending';
  recipient_role?: string;
}

