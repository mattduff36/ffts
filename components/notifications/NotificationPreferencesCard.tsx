'use client';

import { Bell, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  canDisableNotificationModule,
  type NotificationModule,
  type NotificationModuleKey,
  type NotificationPreference,
} from '@/types/notifications';

export interface NotificationPreferencesCardProps {
  title?: string;
  description?: string;
  modules: NotificationModule[];
  preferences: NotificationPreference[];
  isLoadingPreferences: boolean;
  savingPreferenceModules: NotificationModuleKey[];
  canDisableNotifications?: boolean;
  onTogglePreference: (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    checked: boolean
  ) => void;
}

export function getNotificationPreference(
  preferences: NotificationPreference[],
  moduleKey: NotificationModuleKey
): Pick<NotificationPreference, 'notify_in_app' | 'notify_email'> {
  return (
    preferences.find((preference) => preference.module_key === moduleKey) || {
      notify_in_app: true,
      notify_email: true,
    }
  );
}

function channelButtonClassName(isEnabled: boolean, channel: 'in-app' | 'email'): string {
  if (!isEnabled) {
    return 'border-slate-600 bg-slate-950/50 text-slate-300 hover:border-slate-500 hover:bg-slate-900';
  }

  if (channel === 'in-app') {
    return 'border-green-400/70 bg-green-500/20 text-green-100 shadow-lg shadow-green-500/10';
  }

  return 'border-sky-400/70 bg-sky-500/20 text-sky-100 shadow-lg shadow-sky-500/10';
}

export function NotificationPreferencesCard({
  title = 'Notifications',
  description = 'Choose which profile, operational, and role-based alerts reach you in-app or by email.',
  modules,
  preferences,
  isLoadingPreferences,
  savingPreferenceModules,
  canDisableNotifications = true,
  onTogglePreference,
}: NotificationPreferencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {isLoadingPreferences ? (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading saved preferences...</span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2">
          {modules.map((module) => {
            const preference = getNotificationPreference(preferences, module.key);
            const isSaving = savingPreferenceModules.includes(module.key);
            const isDisabled = isLoadingPreferences || isSaving;
            const isRequiredModule = !canDisableNotificationModule(module.key);
            const canToggleModule = canDisableNotifications && !isRequiredModule;

            return (
              <div
                key={module.key}
                id={`notification-preference-${module.key}`}
                className="scroll-mt-24 rounded-lg border border-border bg-slate-900/30 p-5 sm:p-4"
              >
                <div className="mb-4">
                  <p className="text-lg font-semibold text-foreground sm:text-sm">{module.label}</p>
                  <p className="text-sm text-muted-foreground sm:text-xs">{module.description}</p>
                </div>
                {canToggleModule ? (
                  <div className="grid grid-cols-2 gap-3 sm:gap-2">
                  <button
                    type="button"
                    aria-pressed={preference.notify_in_app}
                    disabled={isDisabled}
                    onClick={() => onTogglePreference(module.key, 'notify_in_app', !preference.notify_in_app)}
                    className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-20 ${channelButtonClassName(preference.notify_in_app, 'in-app')}`}
                  >
                    <Bell className={`h-6 w-6 ${preference.notify_in_app ? 'text-green-300' : 'text-slate-400'}`} />
                    <span className="text-base font-semibold leading-tight">In-app</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      preference.notify_in_app ? 'bg-green-500/25 text-green-100' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {preference.notify_in_app ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                      {preference.notify_in_app ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={preference.notify_email}
                    disabled={isDisabled}
                    onClick={() => onTogglePreference(module.key, 'notify_email', !preference.notify_email)}
                    className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-20 ${channelButtonClassName(preference.notify_email, 'email')}`}
                  >
                    <Mail className={`h-6 w-6 ${preference.notify_email ? 'text-sky-300' : 'text-slate-400'}`} />
                    <span className="text-base font-semibold leading-tight">Email</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      preference.notify_email ? 'bg-sky-500/25 text-sky-100' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {preference.notify_email ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                      {preference.notify_email ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-muted-foreground">
                    {isRequiredModule
                      ? `${module.label} notifications are required and cannot be disabled.`
                      : 'Notification preferences can only be changed by supervisors and above.'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
