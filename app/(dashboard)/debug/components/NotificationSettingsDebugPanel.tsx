'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Bell, CheckSquare, Loader2, Mail, Search, Send, ShieldCheck, Users } from 'lucide-react';
import {
  canDisableNotificationModule,
  NOTIFICATION_MODULES,
  type NotificationModuleKey,
} from '@/types/notifications';

interface NotificationSettingsPreference {
  id?: string;
  user_id?: string;
  module_key: NotificationModuleKey;
  enabled: boolean;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at?: string;
  updated_at?: string;
}

interface NotificationSettingsUser {
  user_id: string;
  full_name: string;
  role_name: string;
  role_display_name: string;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_super_admin: boolean;
  preferences: NotificationSettingsPreference[];
}

type ModuleFilter = 'all' | NotificationModuleKey;
type NotificationSummaryTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface NotificationSummaryMetric {
  title: string;
  value: string;
  detail: string;
  tone: NotificationSummaryTone;
  icon: ReactNode;
}

export const DEBUG_NOTIFICATION_SETTINGS_MODULES = NOTIFICATION_MODULES;

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function getNotificationMetricClasses(tone: NotificationSummaryTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-100';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
  }
}

function NotificationSummaryMetricCard({ metric }: { metric: NotificationSummaryMetric }) {
  return (
    <div className={`rounded-xl border p-4 ${getNotificationMetricClasses(metric.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{metric.title}</p>
          <p className="mt-2 text-xl font-bold">{metric.value}</p>
        </div>
        <span className="opacity-85">{metric.icon}</span>
      </div>
      <p className="mt-2 text-sm leading-5 opacity-85">{metric.detail}</p>
    </div>
  );
}

export function NotificationSettingsDebugPanel() {
  const [users, setUsers] = useState<NotificationSettingsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [saving, setSaving] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAllPreferences();
  }, []);

  const fetchAllPreferences = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/notification-preferences/admin');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch preferences');
      }

      if (data.success) {
        setUsers(data.users || []);
      } else {
        throw new Error(data.error || 'Failed to fetch preferences');
      }
    } catch (error) {
      console.error('Error fetching notification preferences:', error);
      const message = error instanceof Error ? error.message : 'Failed to load notification preferences';
      setUsers([]);
      setLoadError(message);
      toast.error('Failed to load notification preferences', {
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const updatePreference = async (
    userId: string,
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    value: boolean
  ) => {
    if (!value && !canDisableNotificationModule(moduleKey)) {
      toast.error('Toolbox Talk notifications cannot be disabled');
      return;
    }

    const saveKey = `${userId}-${moduleKey}-${field}`;
    setSaving(saveKey);
    try {
      const user = users.find(u => u.user_id === userId);
      const currentPref = user?.preferences.find(p => p.module_key === moduleKey);

      const updateData = {
        user_id: userId,
        module_key: moduleKey,
        enabled: currentPref?.enabled ?? true,
        notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
        notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
      };

      const response = await fetch('/api/notification-preferences/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        setUsers(prev => prev.map(u => {
          if (u.user_id === userId) {
            const prefs = u.preferences.map(p =>
              p.module_key === moduleKey ? { ...p, [field]: value } : p
            );
            if (!prefs.find((p: { module_key: string }) => p.module_key === moduleKey)) {
              prefs.push({
                module_key: moduleKey,
                enabled: true,
                notify_in_app: updateData.notify_in_app,
                notify_email: updateData.notify_email,
              });
            }
            return { ...u, preferences: prefs };
          }
          return u;
        }));
        toast.success('Preference updated');
      } else {
        throw new Error(data.error || 'Failed to update');
      }
    } catch (error) {
      console.error('Error updating preference:', error);
      toast.error('Failed to update preference');
    } finally {
      setSaving(null);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role_display_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role_name.toLowerCase() === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  const uniqueRoles = Array.from(new Set(users.map(u => u.role_name))).sort();
  const visibleModules = DEBUG_NOTIFICATION_SETTINGS_MODULES.filter(
    (module) => moduleFilter === 'all' || module.key === moduleFilter
  );
  const visiblePreferenceSlots = filteredUsers.length * visibleModules.length;
  const visibleInAppEnabled = filteredUsers.reduce((total, user) => total + visibleModules.filter((module) => {
    const pref = user.preferences.find((item) => item.module_key === module.key);
    return pref?.notify_in_app ?? true;
  }).length, 0);
  const visibleEmailEnabled = filteredUsers.reduce((total, user) => total + visibleModules.filter((module) => {
    const pref = user.preferences.find((item) => item.module_key === module.key);
    return pref?.notify_email ?? true;
  }).length, 0);
  const selectedModuleLabel = moduleFilter === 'all'
    ? 'All modules'
    : DEBUG_NOTIFICATION_SETTINGS_MODULES.find((module) => module.key === moduleFilter)?.label || moduleFilter;
  const notificationSummaryMetrics: NotificationSummaryMetric[] = [
    {
      title: 'Visible users',
      value: formatNumber(filteredUsers.length),
      detail: users.length === filteredUsers.length ? 'All loaded users are visible.' : `Filtered from ${formatNumber(users.length)} loaded users.`,
      tone: filteredUsers.length > 0 ? 'info' : 'neutral',
      icon: <Users className="h-5 w-5" />,
    },
    {
      title: 'Module scope',
      value: selectedModuleLabel,
      detail: `${formatNumber(visibleModules.length)} notification module${visibleModules.length === 1 ? '' : 's'} shown in this view.`,
      tone: moduleFilter === 'all' ? 'neutral' : 'warning',
      icon: <Bell className="h-5 w-5" />,
    },
    {
      title: 'In-app enabled',
      value: `${formatNumber(visibleInAppEnabled)} / ${formatNumber(visiblePreferenceSlots)}`,
      detail: 'Enabled in-app notification preferences in the current filtered view.',
      tone: visibleInAppEnabled > 0 ? 'success' : 'neutral',
      icon: <ShieldCheck className="h-5 w-5" />,
    },
    {
      title: 'Email enabled',
      value: `${formatNumber(visibleEmailEnabled)} / ${formatNumber(visiblePreferenceSlots)}`,
      detail: 'Enabled email notification preferences in the current filtered view.',
      tone: visibleEmailEnabled > 0 ? 'success' : 'neutral',
      icon: <Mail className="h-5 w-5" />,
    },
  ];

  const batchUpdatePreference = async (
    field: 'notify_in_app' | 'notify_email',
    value: boolean,
    targetModule?: NotificationModuleKey
  ) => {
    if (selectedUsers.size === 0) {
      toast.error('Please select users first');
      return;
    }

    const modulesToUpdate = (targetModule ? [targetModule] : DEBUG_NOTIFICATION_SETTINGS_MODULES.map(m => m.key))
      .filter((moduleKey) => value || canDisableNotificationModule(moduleKey));

    if (modulesToUpdate.length === 0) {
      toast.error('Toolbox Talk notifications cannot be disabled');
      return;
    }

    setSaving('batch');
    try {
      const updates = Array.from(selectedUsers).flatMap(userId =>
        modulesToUpdate.map(moduleKey => ({
          userId,
          moduleKey,
          field,
          value
        }))
      );

      const responses = await Promise.all(updates.map(({ userId, moduleKey }) => {
        const user = users.find(u => u.user_id === userId);
        const currentPref = user?.preferences.find(p => p.module_key === moduleKey);

        const updateData = {
          user_id: userId,
          module_key: moduleKey,
          enabled: currentPref?.enabled ?? true,
          notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
          notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
        };

        return fetch('/api/notification-preferences/admin', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
      }));

      const failedCount = responses.filter(r => !r.ok).length;

      if (failedCount > 0) {
        toast.error(`Failed to update ${failedCount} of ${responses.length} preferences`, {
          description: 'Some updates may have failed. Please check and try again.'
        });
      } else {
        toast.success(`Updated ${selectedUsers.size} user(s)`);
        setSelectedUsers(new Set());
        setBatchMode(false);
      }

      await fetchAllPreferences();
    } catch (error) {
      console.error('Error batch updating:', error);
      toast.error('Failed to batch update');
    } finally {
      setSaving(null);
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelection = new Set(selectedUsers);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUsers(newSelection);
  };

  const selectAll = () => {
    setSelectedUsers(new Set(filteredUsers.map(u => u.user_id)));
  };

  const deselectAll = () => {
    setSelectedUsers(new Set());
  };

  const handleModuleFilterChange = (value: string) => {
    setModuleFilter(value as ModuleFilter);
  };

  const isSupervisorRole = (user: NotificationSettingsUser) => {
    const roleName = user.role_name.trim().toLowerCase();
    const roleDisplayName = user.role_display_name.trim().toLowerCase();
    return roleName === 'supervisor' || roleDisplayName === 'supervisor';
  };

  const getRoleBadgeProps = (user: NotificationSettingsUser): {
    variant: 'destructive' | 'outline' | 'warning' | 'secondary';
    className?: string;
    label: string;
  } => {
    if (user.is_super_admin) {
      return {
        variant: 'destructive',
        label: 'SuperAdmin',
      };
    }

    if (isSupervisorRole(user)) {
      return {
        variant: 'outline',
        className: 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
        label: user.role_display_name || 'Supervisor',
      };
    }

    if (user.role_class === 'admin') {
      return {
        variant: 'destructive',
        label: user.role_display_name || 'Admin',
      };
    }

    if (user.role_class === 'manager') {
      return {
        variant: 'warning',
        label: user.role_display_name || 'Manager',
      };
    }

    return {
      variant: 'secondary',
      label: user.role_display_name || 'No Role',
    };
  };

  return (
    <Card className="overflow-hidden border-brand-yellow/20 bg-slate-950/60">
      <div className="pointer-events-none h-1 bg-gradient-to-r from-orange-500 to-red-600" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5 text-brand-yellow" />
          User Notification Settings
        </CardTitle>
        <CardDescription>
          View and override notification preferences for all users
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-yellow">Notification Summary</p>
            <p className="mt-1 text-sm text-slate-300">
              Review who receives operational alerts and quickly spot gaps in app or email coverage.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {notificationSummaryMetrics.map((metric) => (
              <NotificationSummaryMetricCard key={metric.title} metric={metric} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-900 pl-10"
            />
          </div>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full bg-slate-900 md:w-[200px]">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {uniqueRoles.map(role => (
                <SelectItem key={role} value={role}>{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleFilter} onValueChange={handleModuleFilterChange}>
            <SelectTrigger className="w-full bg-slate-900 md:w-[200px]">
              <SelectValue placeholder="All Modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {DEBUG_NOTIFICATION_SETTINGS_MODULES.map(m => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={batchMode ? "default" : "outline"}
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) {
                setSelectedUsers(new Set());
              }
            }}
            className="whitespace-nowrap"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Batch Mode
          </Button>
        </div>

        {batchMode && (
          <div className="flex flex-wrap gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground w-full mb-2">
              {selectedUsers.size} user(s) selected
              <Button size="sm" variant="ghost" onClick={selectAll}>Select All</Button>
              <Button size="sm" variant="ghost" onClick={deselectAll}>Clear</Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_in_app', true, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Enable In-App
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_in_app', false, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch' || moduleFilter === 'toolbox_talks'}>
              Disable In-App
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_email', true, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Enable Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_email', false, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch' || moduleFilter === 'toolbox_talks'}>
              Disable Email
            </Button>
            {saving === 'batch' && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        )}

        {loading ? (
          <PanelLoader message="Loading notification settings..." accent="debug" className="py-8" />
        ) : loadError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Notification settings failed to load</p>
                  <p className="mt-1 text-sm opacity-90">{loadError}</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={fetchAllPreferences}>
                Retry
              </Button>
            </div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No users match your filters</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-700/70 md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-700/70 bg-slate-900/80">
                    {batchMode && (
                      <th className="p-3 text-left">
                        <input type="checkbox" checked={selectedUsers.size === filteredUsers.length} onChange={() => selectedUsers.size === filteredUsers.length ? deselectAll() : selectAll()} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                      </th>
                    )}
                    <th className="p-3 text-left text-sm font-medium text-foreground">User</th>
                    <th className="p-3 text-left text-sm font-medium text-foreground">Role</th>
                    {visibleModules.map(module => (
                      <th key={module.key} className="p-3 text-center text-sm font-medium text-foreground">
                        <div className="flex flex-col gap-1">
                          <span>{module.label}</span>
                          <div className="flex gap-2 text-xs text-muted-foreground justify-center">
                            <span>App</span>
                            <span>Email</span>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => {
                    const getPref = (moduleKey: NotificationModuleKey) => {
                      return user.preferences.find(p => p.module_key === moduleKey) || {
                        notify_in_app: true,
                        notify_email: true,
                      };
                    };

                    return (
                      <tr key={user.user_id} className="border-b border-slate-700/70 transition-colors hover:bg-orange-500/5">
                        {batchMode && (
                          <td className="p-3">
                            <input type="checkbox" checked={selectedUsers.has(user.user_id)} onChange={() => toggleUserSelection(user.user_id)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                          </td>
                        )}
                        <td className="p-3 text-sm font-medium text-foreground">{user.full_name}</td>
                        <td className="p-3">
                          <Badge
                            variant={getRoleBadgeProps(user).variant}
                            className={getRoleBadgeProps(user).className}
                          >
                            {getRoleBadgeProps(user).label}
                          </Badge>
                        </td>
                        {visibleModules.map(module => {
                          const pref = getPref(module.key);
                          const saveKey = `${user.user_id}-${module.key}`;
                          const isSaving = saving?.startsWith(saveKey) || false;
                          const inAppDisabled = isSaving || (!canDisableNotificationModule(module.key) && pref.notify_in_app);
                          const emailDisabled = isSaving || (!canDisableNotificationModule(module.key) && pref.notify_email);

                          return (
                            <td key={module.key} className="p-3">
                              <div className="flex gap-4 justify-center items-center">
                                <input type="checkbox" checked={pref.notify_in_app} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_in_app', e.target.checked)} disabled={inAppDisabled} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                <input type="checkbox" checked={pref.notify_email} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_email', e.target.checked)} disabled={emailDisabled} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                {isSaving && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-4">
              {filteredUsers.map(user => {
                const getPref = (moduleKey: NotificationModuleKey) => {
                  return user.preferences.find(p => p.module_key === moduleKey) || {
                    notify_in_app: true,
                    notify_email: true,
                  };
                };

                return (
                  <Card key={user.user_id} className="border-slate-700/70 bg-slate-950/45">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">{user.full_name}</CardTitle>
                          <div className="mt-1">
                            <Badge
                              variant={getRoleBadgeProps(user).variant}
                              className={getRoleBadgeProps(user).className}
                            >
                              {getRoleBadgeProps(user).label}
                            </Badge>
                          </div>
                        </div>
                        {batchMode && (
                          <input type="checkbox" checked={selectedUsers.has(user.user_id)} onChange={() => toggleUserSelection(user.user_id)} className="h-5 w-5 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {visibleModules.map(module => {
                          const pref = getPref(module.key);
                          const saveKey = `${user.user_id}-${module.key}`;
                          const isSaving = saving?.startsWith(saveKey) || false;
                          const inAppDisabled = isSaving || (!canDisableNotificationModule(module.key) && pref.notify_in_app);
                          const emailDisabled = isSaving || (!canDisableNotificationModule(module.key) && pref.notify_email);

                          return (
                            <div key={module.key} className="flex items-center justify-between rounded border border-slate-700/70 bg-slate-900/55 p-2">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground dark:text-slate-200">{module.label}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">App</span>
                                  <input type="checkbox" checked={pref.notify_in_app} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_in_app', e.target.checked)} disabled={inAppDisabled} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
                                  <input type="checkbox" checked={pref.notify_email} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_email', e.target.checked)} disabled={emailDisabled} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                </div>
                                {isSaving && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
