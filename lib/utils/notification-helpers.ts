import type { NotificationItem } from '@/types/messages';

/**
 * Resolve which notification to open based on a recipient ID from a deep-link.
 * Returns the matching NotificationItem or null if not found.
 */
export function resolveNotificationToOpen(
  openNotificationId: string | null,
  notifications: NotificationItem[]
): NotificationItem | null {
  if (!openNotificationId || notifications.length === 0) return null;

  return notifications.find((n) => n.id === openNotificationId) ?? null;
}

export function isUnreadNotification(notification: Pick<NotificationItem, 'status' | 'type' | 'priority'>): boolean {
  if (notification.status === 'PENDING') return true;

  // Level 1 Toolbox Talks are internally marked SHOWN when the user chooses
  // read-later so they stop blocking the app, but they still require a later signature.
  return notification.status === 'SHOWN'
    && notification.type === 'TOOLBOX_TALK'
    && notification.priority === 'LOW';
}
