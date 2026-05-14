'use client';

import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Bell, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/utils/date';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

function getIsUnread(notification: NotificationItem): boolean {
  return notification.status === 'PENDING';
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open]);

  async function fetchNotifications() {
    setLoading(true);
    try {
      const response = await fetch('/api/messages/notifications?limit=25');
      const data = await response.json();

      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      try {
        toast.error('Failed to load notifications');
      } catch {
        console.error('Failed to load notifications (toast unavailable)');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      const response = await fetch('/api/messages/clear-all', {
        method: 'POST'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clear notifications');
      }

      try {
        toast.success('All notifications cleared');
      } catch {
        console.error('All notifications cleared (toast unavailable)');
      }
      setNotifications([]);
      onClose();
    } catch (error) {
      console.error('Error clearing notifications:', error);
      try {
        toast.error(error instanceof Error ? error.message : 'Failed to clear notifications');
      } catch {
        console.error('Failed to clear notifications (toast unavailable)');
      }
    } finally {
      setClearing(false);
    }
  }

  function handleNotificationClick(notification: NotificationItem) {
    onClose();
    router.push(`/notifications?openNotification=${notification.id}`);
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel — mobile: near-full width, desktop: 420px right-aligned */}
      <div className="fixed top-16 left-2 right-2 z-50 sm:left-auto sm:right-4 sm:w-[420px] bg-slate-900 rounded-lg shadow-2xl border border-slate-700 animate-in slide-in-from-top-2 duration-200 flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-slate-400" />
            <h3 className="font-semibold text-white text-base">Notifications</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bell className="h-10 w-10 text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">No notifications</p>
            <p className="text-xs text-slate-500 mt-1">
              You&apos;re all caught up!
            </p>
            <Link href="/notifications" onClick={onClose}>
              <Button variant="outline" size="sm" className="mt-4 text-xs">
                Notification Settings
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 overflow-auto">
              <div className="divide-y divide-slate-700/50">
                {notifications.map((notification) => {
                  const isUnread = getIsUnread(notification);
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 transition-colors text-left min-h-[52px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-inset"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      {/* Unread dot */}
                      <span
                        className={`flex-shrink-0 h-2.5 w-2.5 rounded-full ${
                          isUnread ? 'bg-brand-yellow' : 'bg-transparent'
                        }`}
                        aria-label={isUnread ? 'Unread' : 'Read'}
                      />

                      {/* Subject + time */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-tight line-clamp-1 ${
                          isUnread ? 'font-semibold text-white' : 'font-normal text-slate-300'
                        }`}>
                          {notification.subject}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDateTime(notification.created_at)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-800/50 rounded-b-lg">
              <div className="flex items-center justify-between">
                <Link href="/notifications" onClick={onClose}>
                  <Button variant="ghost" size="sm" className="text-xs text-slate-400 hover:text-white">
                    See all notifications
                  </Button>
                </Link>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={clearing}
                  className="text-xs text-slate-500 hover:text-white"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    'Clear all'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
