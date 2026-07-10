'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { isUnreadNotification, resolveNotificationToOpen } from '@/lib/utils/notification-helpers';
import {
  getNotificationPreference,
  NotificationPreferencesCard,
} from '@/components/notifications/NotificationPreferencesCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PanelLoader } from '@/components/ui/panel-loader';
import { 
  ArrowLeft,
  Loader2, 
  Bell, 
  BellOff,
  ExternalLink,
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  Settings,
  Users,
  FileText,
  PenLine
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils/date';
import { isNetworkFetchError } from '@/lib/utils/http-error';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';
import type { NotificationModule, NotificationPreference, NotificationModuleKey } from '@/types/notifications';
import { canDisableNotificationModule, getAvailableNotificationModules } from '@/types/notifications';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { ToolboxTalkPdfDialog } from '@/components/messages/ToolboxTalkPdfDialog';

// Dynamic imports for modal components
const BlockingMessageModal = dynamic(() => import('@/components/messages/BlockingMessageModal').then(m => ({ default: m.BlockingMessageModal })), { ssr: false });
const ReminderModal = dynamic(() => import('@/components/messages/ReminderModal').then(m => ({ default: m.ReminderModal })), { ssr: false });

function isDismissibleNotification(notification: NotificationItem) {
  return notification.type === 'REMINDER' || notification.type === 'NOTIFICATION';
}

function buildToolboxTalkPdfUrl(pdfFilePath: string) {
  return `/api/toolbox-talk-pdf/${pdfFilePath}`;
}

function resolveNotificationModuleKey(notification: NotificationItem): NotificationModuleKey {
  if (notification.module_key) return notification.module_key;

  const createdVia = notification.created_via ?? '';

  if (notification.type === 'TOOLBOX_TALK') return 'toolbox_talks';
  if (createdVia.startsWith('toolbox-talks')) return 'toolbox_talks';
  if (createdVia === 'sensitive_pin_security') return 'sensitive_pin_security';
  if (createdVia === 'maintenance_reminder') return 'maintenance';
  if (createdVia.includes('error')) return 'errors';
  if (createdVia.includes('quote')) return 'quotes';
  if (createdVia.startsWith('suggestion:')) return 'suggestions';
  if (createdVia === 'absence_contact_line_manager') return 'absence';
  if (createdVia === 'timesheet_did_not_work_exception' || createdVia === 'timesheet_adjustment' || createdVia === 'timesheet_rejection') {
    return 'timesheets';
  }
  if (createdVia === 'timesheet_training_decline') return 'training';
  if (createdVia === 'inventory_location_request') return 'inventory';
  if (createdVia === 'processed_absence_change' || createdVia === 'processed_absence_timesheet_adjustment') return 'processed_absence';
  if (
    createdVia.startsWith('processed_absence_')
  ) {
    return 'processed_absence';
  }
  if (notification.type === 'REMINDER') return 'reminders';

  return 'general_notifications';
}

function buildProfileNotificationSettingsHref(moduleKey?: NotificationModuleKey) {
  const baseHref = '/profile?tab=settings&settingsTab=notifications';
  return moduleKey ? `${baseHref}#notification-preference-${moduleKey}` : baseHref;
}

interface NotificationPreferencePromptProps {
  module: NotificationModule;
  isSaving: boolean;
  isLoading: boolean;
  isInAppDisabled: boolean;
  onDisable: () => void;
  variant?: 'card' | 'footer';
}

function NotificationPreferencePrompt({
  module,
  isSaving,
  isLoading,
  isInAppDisabled,
  onDisable,
  variant = 'card',
}: NotificationPreferencePromptProps) {
  const isFooter = variant === 'footer';

  return (
    <div className={isFooter ? 'relative' : 'relative overflow-hidden rounded-xl border border-brand-yellow/30 bg-gradient-to-br from-brand-yellow/15 via-slate-50 to-white p-4 shadow-sm dark:from-brand-yellow/10 dark:via-slate-900 dark:to-slate-950'}>
      {!isFooter ? <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-yellow/20 blur-3xl" /> : null}
      <div className={`relative flex flex-col sm:flex-row sm:items-center sm:justify-between ${isFooter ? 'gap-3' : 'gap-4'}`}>
        <div className={`flex min-w-0 ${isFooter ? 'gap-2' : 'gap-3'}`}>
          <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand-yellow/20 text-brand-yellow ring-1 ring-brand-yellow/30 dark:bg-brand-yellow/15 ${isFooter ? 'h-8 w-8' : 'h-10 w-10'}`}>
            <BellOff className={isFooter ? 'h-4 w-4' : 'h-5 w-5'} />
          </div>
          <div className="min-w-0">
            {!isFooter ? (
              <h4 className="text-sm font-semibold text-foreground">
                Want to stop seeing these notifications?
              </h4>
            ) : null}
            <p className={isFooter ? 'mt-0.5 text-xs leading-4 text-muted-foreground' : 'mt-1 text-sm leading-6 text-muted-foreground'}>
              {isInAppDisabled ? (
                <>
                  {module.label} in-app notifications are already disabled. You can manage email and in-app preferences from your profile.
                </>
              ) : (
                <>
                  Disable <span className="font-medium text-foreground">{module.label}</span> in-app notifications now, or review all notification settings in your profile.
                </>
              )}
            </p>
          </div>
        </div>

        <div className={`flex shrink-0 ${isFooter ? 'flex-row gap-2 sm:min-w-0' : 'flex-col gap-2 sm:min-w-48'}`}>
          <Button
            type="button"
            size={isFooter ? 'sm' : 'default'}
            onClick={onDisable}
            disabled={isLoading || isSaving || isInAppDisabled}
            className={`w-full gap-2 bg-brand-yellow text-slate-950 shadow-sm hover:bg-brand-yellow-hover disabled:cursor-not-allowed disabled:opacity-60 ${isFooter ? 'h-7 px-2.5' : ''}`}
          >
            {isSaving ? (
              <>
                <Loader2 className={`${isFooter ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} />
                Saving...
              </>
            ) : isInAppDisabled ? (
              'Already disabled'
            ) : isFooter ? (
              'Disable'
            ) : (
              `Disable ${module.label}`
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size={isFooter ? 'sm' : 'default'}
            asChild
            className={`w-full gap-2 border-border bg-white/70 hover:bg-white dark:bg-slate-950/60 dark:hover:bg-slate-900 ${isFooter ? 'h-7 px-2.5' : ''}`}
          >
            <Link href={buildProfileNotificationSettingsHref(module.key)}>
              {isFooter ? 'Settings' : 'Profile settings'}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

interface NotificationDetailPaneProps {
  notification: NotificationItem | null;
  notificationModule: NotificationModule | null;
  className?: string;
  isMarkingRead: boolean;
  isLoadingPreferences: boolean;
  isSavingPreference: boolean;
  isModuleInAppDisabled: boolean;
  canShowPreferencePrompt: boolean;
  onBack: () => void;
  onDisableModuleNotifications: () => void;
  onSignToolboxTalk: (notification: NotificationItem) => void;
  onViewAttachedPDF: (url: string, title: string) => void;
  getStatusBadge: (notification: NotificationItem) => React.ReactNode;
}

function NotificationDetailPane({
  notification,
  notificationModule,
  className = '',
  isMarkingRead,
  isLoadingPreferences,
  isSavingPreference,
  isModuleInAppDisabled,
  canShowPreferencePrompt,
  onBack,
  onDisableModuleNotifications,
  onSignToolboxTalk,
  onViewAttachedPDF,
  getStatusBadge,
}: NotificationDetailPaneProps) {
  if (!notification) {
    return (
      <Card className={`flex min-h-[42rem] flex-col border-border bg-white dark:bg-slate-900 ${className}`}>
        <CardContent className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 rounded-full bg-blue-100 p-4 dark:bg-blue-950">
            <Bell className="h-8 w-8 text-blue-600" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-foreground">
            Select a notification
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Choose a notification from the list to read it here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isToolboxTalk = notification.type === 'TOOLBOX_TALK';
  const hasSigned = notification.status === 'SIGNED';
  const pdfUrl = notification.pdf_file_path ? buildToolboxTalkPdfUrl(notification.pdf_file_path) : null;
  const preferencePrompt = notificationModule && canShowPreferencePrompt ? (
    <NotificationPreferencePrompt
      module={notificationModule}
      isLoading={isLoadingPreferences}
      isSaving={isSavingPreference}
      isInAppDisabled={isModuleInAppDisabled}
      onDisable={onDisableModuleNotifications}
    />
  ) : null;

  return (
    <Card className={`flex min-h-[42rem] flex-col overflow-hidden border-border bg-white dark:bg-slate-900 md:h-full md:min-h-0 ${className}`}>
      <CardHeader className="shrink-0 border-b border-border">
        <div className="mb-3 md:hidden">
          <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to notifications
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <div className={notification.priority === 'HIGH' || notification.priority === 'URGENT' ? 'rounded bg-red-100 p-2 dark:bg-red-950' : 'rounded bg-blue-100 p-2 dark:bg-blue-950'}>
                {notification.priority === 'HIGH' || notification.priority === 'URGENT' ? (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                ) : (
                  <Bell className="h-5 w-5 text-blue-600" />
                )}
              </div>
              <CardTitle className="text-xl text-foreground">
                {notification.subject}
              </CardTitle>
            </div>
            <CardDescription className="text-muted-foreground">
              From: {notification.sender_name} &middot; {formatDateTime(notification.created_at)}
            </CardDescription>
          </div>
          <div className="shrink-0">
            {getStatusBadge(notification)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 overflow-hidden p-0">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-6 p-6">
          {isMarkingRead && (
            <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-brand-yellow" />
              Marking as read...
            </div>
          )}

          {isToolboxTalk && notification.priority === 'URGENT' && (
            <div className="shrink-0 rounded-lg border border-red-600 bg-red-600 px-4 py-3 text-center font-black uppercase tracking-widest text-white">
              Urgent Toolbox Talk
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-4 pr-5 text-sm leading-6 text-foreground whitespace-pre-wrap">
            {notification.body}
          </div>

          {isToolboxTalk && pdfUrl && (
            <div className="shrink-0 rounded-md border border-border bg-white p-4 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold text-foreground">
                    Attached PDF
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Open the original toolbox talk document uploaded with this message.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onViewAttachedPDF(pdfUrl, notification.subject)}
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  View Attached PDF
                </Button>
              </div>
            </div>
          )}

          {isToolboxTalk && hasSigned && (
            <div className="shrink-0 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h4 className="font-semibold text-green-700 dark:text-green-300">
                    Signed on {notification.signed_at ? formatDateTime(notification.signed_at) : 'recorded date unavailable'}
                  </h4>
                  <p className="text-sm text-green-700/80 dark:text-green-300/80">
                    Toolbox talk complete. No further action is required.
                  </p>
                </div>
                {notification.signature_data && (
                  <div className="w-full rounded-md border border-green-200 bg-white p-3 dark:border-green-900 dark:bg-slate-950 sm:w-56">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-green-700/80 dark:text-green-300/80">
                      Signature
                    </p>
                    <Image
                      src={notification.signature_data}
                      alt="Your saved signature"
                      width={224}
                      height={80}
                      unoptimized
                      className="max-h-20 w-full object-contain"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {isToolboxTalk && !hasSigned && (
            <div className="shrink-0 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold text-red-700 dark:text-red-300">
                    Toolbox Talk signature required
                  </h4>
                  <p className="text-sm text-red-700/80 dark:text-red-300/80">
                    Open the signing flow to complete this required notification.
                  </p>
                </div>
                  <Button
                    type="button"
                    onClick={() => onSignToolboxTalk(notification)}
                    className="gap-2 bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
                  >
                    <PenLine className="h-4 w-4" />
                    Read and sign
                  </Button>
              </div>
            </div>
          )}

          {preferencePrompt && (
            <div className="shrink-0 pt-2 md:hidden">
              {preferencePrompt}
            </div>
          )}
        </div>
      </CardContent>

      {preferencePrompt && (
        <div className="hidden shrink-0 border-t border-border bg-slate-950/20 px-3 py-2 md:block">
          <NotificationPreferencePrompt
            module={notificationModule!}
            isLoading={isLoadingPreferences}
            isSaving={isSavingPreference}
            isInAppDisabled={isModuleInAppDisabled}
            onDisable={onDisableModuleNotifications}
            variant="footer"
          />
        </div>
      )}
    </Card>
  );
}

function NotificationsContent() {
  const { isAdmin, isManager, isSupervisor, isSuperAdmin } = useAuth();
  const { permissionLevels } = usePermissionSnapshot();
  
  // Deep-link query param from notification panel
  const [openNotificationId, setOpenNotificationId] = useQueryState('openNotification', {
    defaultValue: '',
    clearOnDefault: true,
    shallow: true,
  });
  const [tabParam, setTabParam] = useQueryState('tab', {
    defaultValue: 'all',
    clearOnDefault: true,
    shallow: true,
  });

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filteredNotifications, setFilteredNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshingNotifications, setIsRefreshingNotifications] = useState(false);
  const [hasLoadedNotifications, setHasLoadedNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalNotification, setModalNotification] = useState<NotificationItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [pdfDialog, setPdfDialog] = useState<{ url: string; title: string } | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);
  const dismissedNotificationIds = useRef(new Set<string>());
  
  // Preferences state
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefModule, setSavingPrefModule] = useState<NotificationModuleKey | null>(null);
  
  // Admin state
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; role: string }>>([]);
  const [, setLoadingUsers] = useState(false);
  const [adminNotifications, setAdminNotifications] = useState<NotificationItem[]>([]);
  const [loadingAdminNotifications, setLoadingAdminNotifications] = useState(false);

  const activeTab = tabParam === 'preferences' || tabParam === 'all' || (tabParam === 'admin' && isAdmin)
    ? tabParam
    : 'all';

  useEffect(() => {
    if (tabParam === 'admin' && !isAdmin) {
      void setTabParam('all');
    }
  }, [tabParam, isAdmin, setTabParam]);

  // Filter modules based on role and module-level permissions.
  const availableModules = getAvailableNotificationModules({
    isAdmin,
    isManager,
    permissionLevels,
  });
  const canDisableNotificationPreferences = isSupervisor || isManager || isAdmin || isSuperAdmin;

  const fetchNotifications = useCallback(async (keepCurrentListVisible = false) => {
    if (keepCurrentListVisible && hasLoadedNotifications) {
      setIsRefreshingNotifications(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await fetch('/api/messages/notifications?limit=100');
      const data = await response.json();

      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      const errorContextId = 'notifications-fetch-list-error';
      console.error('Error fetching notifications:', error, { errorContextId });
      toast.error('Failed to load notifications', { id: errorContextId });
    } finally {
      setLoading(false);
      setIsRefreshingNotifications(false);
      setHasLoadedNotifications(true);
    }
  }, [hasLoadedNotifications]);

  useEffect(() => {
    fetchNotifications();
    const fetchPreferences = async () => {
      setLoadingPrefs(true);
      try {
        const response = await fetch('/api/notification-preferences');
        const data = await response.json();

        if (data.success) {
          setPreferences(data.preferences || []);
        }
      } catch (error) {
        if (isNetworkFetchError(error)) {
          console.warn('Notification preferences temporarily unavailable:', error);
        } else {
          console.error('Error fetching preferences:', error);
        }
      } finally {
        setLoadingPrefs(false);
      }
    };
    fetchPreferences();
    if (isAdmin) {
      const fetchUsers = async () => {
        setLoadingUsers(true);
        try {
          const profilesData = await fetchUserDirectory({ includeRole: true });
          setUsers(profilesData.map((p) => ({
            id: p.id,
            full_name: p.full_name ?? '',
            role: p.role?.name || 'unknown',
          })));
        } catch (error) {
          console.error('Error fetching users:', error);
        } finally {
          setLoadingUsers(false);
        }
      };
      fetchUsers();
    }
  }, [isAdmin, fetchNotifications]);

  useEffect(() => {
    if (searchQuery) {
      setFilteredNotifications(
        notifications.filter(n =>
          n.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.sender_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.body.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredNotifications(notifications);
    }
  }, [searchQuery, notifications]);

  const selectedNotification = resolveNotificationToOpen(openNotificationId, notifications);

  // Deep-link: select a notification in the reading pane when navigated from the notification panel.
  useEffect(() => {
    if (loading || !hasLoadedNotifications || !openNotificationId) return;

    const match = resolveNotificationToOpen(openNotificationId, notifications);
    if (match) {
      setMobileDetailOpen(true);
    } else {
      void setOpenNotificationId('');
    }
  }, [hasLoadedNotifications, loading, notifications, openNotificationId, setOpenNotificationId]);

  useEffect(() => {
    if (
      activeTab !== 'all'
      || !selectedNotification
      || selectedNotification.status !== 'PENDING'
      || !isDismissibleNotification(selectedNotification)
      || dismissedNotificationIds.current.has(selectedNotification.id)
    ) {
      return;
    }

    const recipientId = selectedNotification.id;
    dismissedNotificationIds.current.add(recipientId);
    setMarkingReadId(recipientId);

    fetch(`/api/messages/${recipientId}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) {
          dismissedNotificationIds.current.delete(recipientId);
          return;
        }

        const firstShownAt = new Date().toISOString();
        setNotifications((prev) => prev.map((notification) => (
          notification.id === recipientId
            ? {
                ...notification,
                status: 'DISMISSED',
                first_shown_at: notification.first_shown_at ?? firstShownAt,
              }
            : notification
        )));
        window.dispatchEvent(new CustomEvent('notification-dismissed'));
      })
      .catch(() => {
        dismissedNotificationIds.current.delete(recipientId);
      })
      .finally(() => {
        setMarkingReadId((currentId) => (currentId === recipientId ? null : currentId));
      });
  }, [activeTab, selectedNotification]);

  const fetchAdminNotifications = async (userId: string) => {
    if (userId === 'all') {
      setAdminNotifications([]);
      return;
    }

    setLoadingAdminNotifications(true);
    try {
      const response = await fetch(`/api/messages/notifications/admin?user_id=${userId}`);
      const data = await response.json();

      if (data.success) {
        setAdminNotifications(data.notifications || []);
      } else {
        throw new Error(data.error || 'Failed to fetch notifications');
      }
    } catch (error) {
      const errorContextId = 'notifications-fetch-admin-list-error';
      console.error('Error fetching admin notifications:', error, { errorContextId });
      toast.error('Failed to load user notifications', { id: errorContextId });
    } finally {
      setLoadingAdminNotifications(false);
    }
  };

  useEffect(() => {
    if (selectedUserId && selectedUserId !== 'all') {
      fetchAdminNotifications(selectedUserId);
    } else {
      setAdminNotifications([]);
    }
  }, [selectedUserId]);

  const updatePreference = async (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    value: boolean
  ) => {
    if (!value && !canDisableNotificationPreferences) {
      toast.error('Only supervisors and above can disable notifications');
      return;
    }
    if (!value && !canDisableNotificationModule(moduleKey)) {
      toast.error('Toolbox Talk notifications cannot be disabled');
      return;
    }

    setSavingPrefModule(moduleKey);
    try {
      // Get current preference to ensure we send both fields
      const currentPref = preferences.find(p => p.module_key === moduleKey);
      
      // Prepare data with both fields
      const updateData = {
        module_key: moduleKey,
        notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
        notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
      };

      const response = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setPreferences(prev => {
          const existing = prev.find(p => p.module_key === moduleKey);
          if (existing) {
            return prev.map(p => p.module_key === moduleKey ? data.preference : p);
          } else {
            return [...prev, data.preference];
          }
        });
        toast.success('Preference updated');
      } else {
        throw new Error(data.error || 'Failed to update preference');
      }
    } catch (error) {
      const errorContextId = 'notifications-update-preference-error';
      console.error('Error updating preference:', error, { errorContextId });
      toast.error('Failed to update preference', { id: errorContextId });
    } finally {
      setSavingPrefModule(null);
    }
  };

  function handleNotificationSelect(notification: NotificationItem) {
    void setOpenNotificationId(notification.id);
    setMobileDetailOpen(true);
  }

  function handleAdminNotificationClick(notification: NotificationItem) {
    setModalNotification(notification);
    setShowModal(true);
  }

  function handleToolboxSignClick(notification: NotificationItem) {
    setModalNotification(notification);
    setShowModal(true);
  }

  function handleModalClose() {
    setShowModal(false);
    setModalNotification(null);
    // Refresh notifications after signing or dismissing in modal flows.
    fetchNotifications(true);
  }

  function getStatusBadge(notification: NotificationItem) {
    if (isUnreadNotification(notification)) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Unread
        </Badge>
      );
    }

    switch (notification.status) {
      case 'SIGNED':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Signed
          </Badge>
        );
      case 'DISMISSED':
        return (
          <Badge variant="secondary" className="gap-1">
            Read
          </Badge>
        );
      case 'SHOWN':
        return (
          <Badge variant="secondary" className="gap-1">
            <Info className="h-3 w-3" />
            Viewed
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Unread
          </Badge>
        );
    }
  }

  const selectedNotificationModuleKey = selectedNotification
    ? resolveNotificationModuleKey(selectedNotification)
    : null;
  const selectedNotificationModule = selectedNotificationModuleKey
    ? availableModules.find((module) => module.key === selectedNotificationModuleKey) ?? null
    : null;
  const selectedNotificationPreference = selectedNotificationModule
    ? getNotificationPreference(preferences, selectedNotificationModule.key)
    : null;

  function handleDisableSelectedModuleNotifications() {
    if (!selectedNotificationModule) return;
    if (!canDisableNotificationPreferences || !canDisableNotificationModule(selectedNotificationModule.key)) return;
    void updatePreference(selectedNotificationModule.key, 'notify_in_app', false);
  }

  const isLoadingNotifications = loading || isRefreshingNotifications;
  const canShowSelectedPreferencePrompt = Boolean(
    selectedNotificationModule &&
    canDisableNotificationPreferences &&
    canDisableNotificationModule(selectedNotificationModule.key)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <Bell className="h-6 w-6 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-1">
              Notifications
            </h1>
            <p className="text-muted-foreground">
              Manage your notifications and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div>
        <Tabs value={activeTab} onValueChange={(value) => void setTabParam(value)} className="w-full">
            <TabsList className="bg-slate-100 dark:bg-slate-800">
              <TabsTrigger value="all" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
                <Bell className="h-4 w-4" />
                All Notifications
              </TabsTrigger>
              <TabsTrigger value="preferences" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
                <Settings className="h-4 w-4" />
                Preferences
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
                  <Users className="h-4 w-4" />
                  Admin
                </TabsTrigger>
              )}
            </TabsList>

            {/* All Notifications Tab */}
            <TabsContent value="all" className="space-y-4 mt-4">
              {/* Search */}
              <Card className={mobileDetailOpen && selectedNotification ? 'hidden md:block' : undefined}>
                <CardContent className="p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search notifications..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-10 text-sm bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Notifications List */}
              {isLoadingNotifications ? (
                <PanelLoader message="Loading notifications..." accent="reminders" className="py-12" />
              ) : filteredNotifications.length === 0 ? (
                <Card className={mobileDetailOpen && selectedNotification ? 'hidden md:block' : undefined}>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Bell className="h-16 w-16 text-muted-foreground dark:text-slate-600 mb-3" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      No notifications found
                    </h3>
                    <p className="text-muted-foreground text-center">
                      {searchQuery ? 'Try adjusting your search' : 'You have no notifications in the last 60 days'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid items-stretch gap-4 md:h-[calc(100dvh-28.5rem)] md:min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Card className={`flex min-h-[42rem] flex-col overflow-hidden border-border bg-white dark:bg-slate-900 md:min-h-0 ${mobileDetailOpen && selectedNotification ? 'hidden md:flex' : ''}`}>
                    <CardHeader className="border-b border-border px-4 py-3">
                      <CardTitle className="text-base text-foreground">
                        Inbox
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {filteredNotifications.length} notification{filteredNotifications.length === 1 ? '' : 's'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">
                      <div className="divide-y divide-border">
                        {filteredNotifications.map((notification) => {
                          const isSelected = selectedNotification?.id === notification.id;
                          const isUnread = isUnreadNotification(notification);
                          const rowStateClass = isSelected
                            ? 'border-l-brand-yellow bg-slate-200/80 shadow-inner hover:bg-slate-200 dark:bg-slate-800/90 dark:hover:bg-slate-800'
                            : isUnread
                              ? 'border-l-brand-yellow bg-brand-yellow/5 hover:bg-brand-yellow/10 dark:bg-brand-yellow/10 dark:hover:bg-brand-yellow/15'
                              : 'border-l-transparent hover:bg-muted/60';

                          return (
                            <button
                              key={notification.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => handleNotificationSelect(notification)}
                              className={`relative flex w-full items-start gap-3 border-l-4 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow ${rowStateClass}`}
                            >
                              <div className="mt-1 shrink-0">
                                {notification.priority === 'HIGH' || notification.priority === 'URGENT' ? (
                                  <div className="rounded bg-red-100 p-2 dark:bg-red-950">
                                    <AlertTriangle className="h-4 w-4 text-red-600" />
                                  </div>
                                ) : (
                                  <div className="rounded bg-blue-100 p-2 dark:bg-blue-950">
                                    <Bell className="h-4 w-4 text-blue-600" />
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-start justify-between gap-2">
                                  <h3 className={`truncate text-sm text-foreground ${isUnread ? 'font-bold' : 'font-semibold'}`}>
                                    {notification.subject}
                                  </h3>
                                  {isUnread && (
                                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-yellow shadow-[0_0_0_3px_rgba(245,222,76,0.18)]" aria-label="Unread" />
                                  )}
                                </div>
                                <p className={`mb-2 line-clamp-2 text-xs ${isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                                  {notification.body}
                                </p>
                                <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${isUnread ? 'font-semibold text-foreground/85' : 'text-muted-foreground'}`}>
                                  <span className="truncate">From: {notification.sender_name}</span>
                                  <span>{formatDateTime(notification.created_at)}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  <NotificationDetailPane
                    notification={selectedNotification}
                    notificationModule={selectedNotificationModule}
                    isMarkingRead={Boolean(selectedNotification && markingReadId === selectedNotification.id)}
                    isLoadingPreferences={loadingPrefs}
                    isSavingPreference={Boolean(
                      selectedNotificationModule && savingPrefModule === selectedNotificationModule.key
                    )}
                    isModuleInAppDisabled={selectedNotificationPreference?.notify_in_app === false}
                    canShowPreferencePrompt={canShowSelectedPreferencePrompt}
                    onBack={() => setMobileDetailOpen(false)}
                    onDisableModuleNotifications={handleDisableSelectedModuleNotifications}
                    onSignToolboxTalk={handleToolboxSignClick}
                    onViewAttachedPDF={(url, title) => setPdfDialog({ url, title })}
                    getStatusBadge={getStatusBadge}
                    className={mobileDetailOpen && selectedNotification ? 'flex' : 'hidden md:flex'}
                  />
                </div>
              )}
            </TabsContent>

            {/* Preferences Tab */}
            <TabsContent value="preferences" className="space-y-4 mt-4">
              <NotificationPreferencesCard
                title="Notification Preferences"
                description="Customize how you receive notifications for different modules."
                modules={availableModules}
                preferences={preferences}
                isLoadingPreferences={loadingPrefs}
                savingPreferenceModules={savingPrefModule ? [savingPrefModule] : []}
                canDisableNotifications={canDisableNotificationPreferences}
                onTogglePreference={updatePreference}
              />
            </TabsContent>

            {/* Admin Tab */}
            {isAdmin && (
              <TabsContent value="admin" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-foreground">Admin Notification Viewer</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Select a user to review their recent notification history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-lg border border-border bg-slate-900/30 p-5 sm:p-4">
                      <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-yellow/30 bg-brand-yellow/10 text-brand-yellow">
                          <Users className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-foreground sm:text-sm">View user notifications</p>
                          <p className="text-sm text-muted-foreground sm:text-xs">
                            Choose a user to inspect their inbox state and recent notification activity.
                          </p>
                        </div>
                      </div>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger className="w-full max-w-md border-border bg-slate-950/50">
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="all">Select a user...</SelectItem>
                          {users.map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.full_name} ({u.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Admin Notifications Display */}
                {selectedUserId === 'all' ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-slate-900/30">
                        <Info className="h-7 w-7 text-muted-foreground" />
                      </div>
                      <p className="font-medium text-foreground">Select a user to view their notifications</p>
                      <p className="mt-1 text-sm">Their notification history will appear here.</p>
                    </CardContent>
                  </Card>
                ) : loadingAdminNotifications ? (
                  <PanelLoader message="Loading user notifications..." accent="reminders" className="py-12" />
                ) : adminNotifications.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-slate-900/30">
                        <Bell className="h-7 w-7 text-muted-foreground" />
                      </div>
                      <p className="font-medium text-foreground">No recent notifications</p>
                      <p className="mt-1 text-sm">This user has no notifications in the last 60 days.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {adminNotifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        className="block w-full rounded-lg border border-border bg-slate-900/30 p-4 text-left transition-colors hover:bg-slate-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow"
                        onClick={() => handleAdminNotificationClick(notification)}
                      >
                        <div className="flex items-start gap-4">
                          <div className="mt-1">
                            {notification.priority === 'HIGH' ? (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-2">
                                <AlertTriangle className="h-5 w-5 text-red-300" />
                              </div>
                            ) : (
                              <div className="rounded-lg border border-sky-500/30 bg-sky-500/15 p-2">
                                <Bell className="h-5 w-5 text-sky-300" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <h3 className="font-semibold text-foreground">
                                {notification.subject}
                              </h3>
                              {getStatusBadge(notification)}
                            </div>

                            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                              {notification.body}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span>From: {notification.sender_name}</span>
                              <span>{formatDateTime(notification.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Modals */}
        {showModal && modalNotification && (
        <>
          {modalNotification.type === 'TOOLBOX_TALK' ? (
            <BlockingMessageModal
              open={showModal}
              message={{
                id: modalNotification.message_id,
                recipient_id: modalNotification.id,
                subject: modalNotification.subject,
                body: modalNotification.body,
                priority: modalNotification.priority,
                acceptance_delay_minutes: modalNotification.acceptance_delay_minutes,
                first_shown_at: modalNotification.first_shown_at,
                sender_name: modalNotification.sender_name,
                created_at: modalNotification.created_at,
                pdf_file_path: modalNotification.pdf_file_path,
              }}
              onSigned={handleModalClose}
              onDeferred={handleModalClose}
              totalPending={1}
              currentIndex={0}
            />
          ) : modalNotification.type === 'REMINDER' || modalNotification.type === 'NOTIFICATION' ? (
            <ReminderModal
              open={showModal}
              onClose={handleModalClose}
              message={{
                id: modalNotification.message_id,
                recipient_id: modalNotification.id,
                created_via: modalNotification.created_via ?? null,
                subject: modalNotification.subject,
                body: modalNotification.body,
                sender_name: modalNotification.sender_name,
                created_at: modalNotification.created_at,
              }}
              onDismissed={handleModalClose}
            />
          ) : null}
        </>
      )}

      <ToolboxTalkPdfDialog
        open={Boolean(pdfDialog)}
        onOpenChange={(open) => {
          if (!open) setPdfDialog(null);
        }}
        url={pdfDialog?.url ?? null}
        title={pdfDialog?.title ?? 'Attached toolbox talk PDF'}
      />
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <NuqsClientAdapter>
      <NotificationsContent />
    </NuqsClientAdapter>
  );
}
