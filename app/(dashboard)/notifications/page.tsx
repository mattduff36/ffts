'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useQueryState } from 'nuqs';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { resolveNotificationToOpen } from '@/lib/utils/notification-helpers';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft,
  Loader2, 
  Bell, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  Settings,
  Users,
  Wrench,
  FileText,
  CheckSquare,
  ClipboardCheck,
  PenLine
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils/date';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';
import type { NotificationPreference, NotificationModuleKey } from '@/types/notifications';
import { NOTIFICATION_MODULES } from '@/types/notifications';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';

// Dynamic imports for modal components
const BlockingMessageModal = dynamic(() => import('@/components/messages/BlockingMessageModal').then(m => ({ default: m.BlockingMessageModal })), { ssr: false });
const ReminderModal = dynamic(() => import('@/components/messages/ReminderModal').then(m => ({ default: m.ReminderModal })), { ssr: false });

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'AlertTriangle': AlertTriangle,
  'Wrench': Wrench,
  'FileText': FileText,
  'CheckSquare': CheckSquare,
  'ClipboardCheck': ClipboardCheck,
};

function isDismissibleNotification(notification: NotificationItem) {
  return notification.type === 'REMINDER' || notification.type === 'NOTIFICATION';
}

interface NotificationDetailPaneProps {
  notification: NotificationItem | null;
  className?: string;
  isMarkingRead: boolean;
  onBack: () => void;
  onSignToolboxTalk: (notification: NotificationItem) => void;
  getStatusBadge: (status: string) => React.ReactNode;
}

function NotificationDetailPane({
  notification,
  className = '',
  isMarkingRead,
  onBack,
  onSignToolboxTalk,
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

  return (
    <Card className={`flex min-h-[42rem] flex-col overflow-hidden border-border bg-white dark:bg-slate-900 ${className}`}>
      <CardHeader className="border-b border-border">
        <div className="mb-3 md:hidden">
          <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to notifications
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <div className={notification.priority === 'HIGH' ? 'rounded bg-red-100 p-2 dark:bg-red-950' : 'rounded bg-blue-100 p-2 dark:bg-blue-950'}>
                {notification.priority === 'HIGH' ? (
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
            {getStatusBadge(notification.status)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-0">
        <div className="space-y-6 p-6">
          {isMarkingRead && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-brand-yellow" />
              Marking as read...
            </div>
          )}

          {notification.priority === 'HIGH' && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              High priority notification
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/20 p-4 text-sm leading-6 text-foreground whitespace-pre-wrap">
            {notification.body}
          </div>

          {isToolboxTalk && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold text-red-700 dark:text-red-300">
                    Toolbox Talk signature required
                  </h4>
                  <p className="text-sm text-red-700/80 dark:text-red-300/80">
                    {hasSigned
                      ? `Signed ${notification.signed_at ? formatDateTime(notification.signed_at) : ''}`
                      : 'Open the signing flow to complete this required notification.'}
                  </p>
                </div>
                {!hasSigned && (
                  <Button
                    type="button"
                    onClick={() => onSignToolboxTalk(notification)}
                    className="gap-2 bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
                  >
                    <PenLine className="h-4 w-4" />
                    Read and sign
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationsContent() {
  const { isAdmin, isManager } = useAuth();
  
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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);
  const dismissedNotificationIds = useRef(new Set<string>());
  
  // Preferences state
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefModule, setSavingPrefModule] = useState<string | null>(null);
  
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

  // Filter modules based on user permissions
  const availableModules = NOTIFICATION_MODULES.filter(module => {
    if (module.availableFor === 'all') return true;
    if (module.availableFor === 'admin') return isAdmin;
    if (module.availableFor === 'manager') return isManager || isAdmin;
    return false;
  });

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
        console.error('Error fetching preferences:', error);
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
            return prev.map(p => p.module_key === moduleKey ? { ...p, [field]: value } : p);
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

  function getStatusBadge(status: string) {
    switch (status) {
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

  const getPreference = (moduleKey: NotificationModuleKey) => {
    return preferences.find(p => p.module_key === moduleKey) || {
      notify_in_app: true,
      notify_email: true,
    };
  };

  const getModuleIcon = (iconName: string) => {
    const Icon = MODULE_ICONS[iconName] || Bell;
    return Icon;
  };

  const isLoadingNotifications = loading || isRefreshingNotifications;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <Bell className="h-6 w-6 text-blue-600" />
          </div>
          <div>
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
            <TabsList className="grid w-full max-w-2xl grid-cols-3 bg-slate-100 dark:bg-slate-800 p-0">
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
                <CardContent className="pt-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search notifications..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Notifications List */}
              {isLoadingNotifications ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-yellow" />
                </div>
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
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Card className={`overflow-hidden border-border bg-white dark:bg-slate-900 ${mobileDetailOpen && selectedNotification ? 'hidden md:block' : ''}`}>
                    <CardHeader className="border-b border-border px-4 py-3">
                      <CardTitle className="text-base text-foreground">
                        Inbox
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {filteredNotifications.length} notification{filteredNotifications.length === 1 ? '' : 's'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-[42rem] overflow-y-auto p-0">
                      <div className="divide-y divide-border">
                        {filteredNotifications.map((notification) => {
                          const isSelected = selectedNotification?.id === notification.id;
                          const isUnread = notification.status === 'PENDING';
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
                                {notification.priority === 'HIGH' ? (
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
                    isMarkingRead={Boolean(selectedNotification && markingReadId === selectedNotification.id)}
                    onBack={() => setMobileDetailOpen(false)}
                    onSignToolboxTalk={handleToolboxSignClick}
                    getStatusBadge={getStatusBadge}
                    className={mobileDetailOpen && selectedNotification ? 'block' : 'hidden md:flex'}
                  />
                </div>
              )}
            </TabsContent>

            {/* Preferences Tab */}
            <TabsContent value="preferences" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-foreground">Notification Preferences</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Customize how you receive notifications for different modules
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPrefs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {availableModules.map((module) => {
                        const pref = getPreference(module.key);
                        const Icon = getModuleIcon(module.icon);
                        const isSaving = savingPrefModule === module.key;

                        return (
                          <div key={module.key} className="pb-6 border-b border-border last:border-0 last:pb-0">
                            <div className="flex items-start gap-3 mb-4">
                              <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                              <div className="flex-1">
                                <h3 className="font-medium text-foreground">{module.label}</h3>
                                <p className="text-sm text-muted-foreground">{module.description}</p>
                              </div>
                            </div>

                            <div className="ml-8 space-y-3">
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`${module.key}-in-app`} className="text-sm font-medium text-foreground dark:text-slate-200">
                                  In-App Notifications
                                </Label>
                                <Switch
                                  id={`${module.key}-in-app`}
                                  checked={pref.notify_in_app}
                                  onCheckedChange={(checked) => updatePreference(module.key, 'notify_in_app', checked)}
                                  disabled={isSaving}
                                />
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`${module.key}-email`} className="text-sm font-medium text-foreground dark:text-slate-200">
                                  Email Notifications
                                </Label>
                                <Switch
                                  id={`${module.key}-email`}
                                  checked={pref.notify_email}
                                  onCheckedChange={(checked) => updatePreference(module.key, 'notify_email', checked)}
                                  disabled={isSaving}
                                />
                              </div>

                              {isSaving && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Saving...
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Admin Tab */}
            {isAdmin && (
              <TabsContent value="admin" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-foreground">View Notifications For</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Select a user to view their notification history
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger className="w-full max-w-md">
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
                    <CardContent className="p-8 text-center text-muted-foreground">
                      <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p>Select a user to view their notifications</p>
                    </CardContent>
                  </Card>
                ) : loadingAdminNotifications ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : adminNotifications.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p>This user has no notifications in the last 60 days</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {adminNotifications.map((notification) => (
                      <Card
                        key={notification.id}
                        className="bg-white dark:bg-slate-900 border-border hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => handleAdminNotificationClick(notification)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <div className="mt-1">
                              {notification.priority === 'HIGH' ? (
                                <div className="p-2 bg-red-100 dark:bg-red-950 rounded">
                                  <AlertTriangle className="h-5 w-5 text-red-600" />
                                </div>
                              ) : (
                                <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded">
                                  <Bell className="h-5 w-5 text-blue-600" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h3 className="font-semibold text-foreground">
                                  {notification.subject}
                                </h3>
                                {getStatusBadge(notification.status)}
                              </div>

                              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                                {notification.body}
                              </p>

                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>From: {notification.sender_name}</span>
                                <span>•</span>
                                <span>{formatDateTime(notification.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
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
                sender_name: modalNotification.sender_name,
                created_at: modalNotification.created_at,
              }}
              onSigned={handleModalClose}
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
