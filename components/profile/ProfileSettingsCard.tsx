'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { NotificationModule, NotificationModuleKey, NotificationPreference } from '@/types/notifications';

interface ProfileSettingsCardProps {
  canEditBasicFields: boolean;
  fullName: string;
  phoneNumber: string;
  onFullNameChange: (value: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onSaveBasicProfile: () => void;
  isSavingBasicProfile: boolean;
  hasBasicProfileChanges: boolean;
  modules: NotificationModule[];
  preferences: NotificationPreference[];
  isLoadingPreferences: boolean;
  savingPreferenceModules: NotificationModuleKey[];
  onTogglePreference: (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    checked: boolean
  ) => void;
}

function getPreference(
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

export function ProfileSettingsCard({
  canEditBasicFields,
  fullName,
  phoneNumber,
  onFullNameChange,
  onPhoneNumberChange,
  onSaveBasicProfile,
  isSavingBasicProfile,
  hasBasicProfileChanges,
  modules,
  preferences,
  isLoadingPreferences,
  savingPreferenceModules,
  onTogglePreference,
}: ProfileSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Manage the profile and notification settings you can access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Basic profile details</h3>
            {!canEditBasicFields ? (
              <p className="text-xs text-muted-foreground">Read-only for your role</p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-full-name">Full name</Label>
              <Input
                id="profile-full-name"
                value={fullName}
                readOnly={!canEditBasicFields}
                onChange={(event) => onFullNameChange(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone-number">Phone number</Label>
              <Input
                id="profile-phone-number"
                value={phoneNumber}
                readOnly={!canEditBasicFields}
                onChange={(event) => onPhoneNumberChange(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={onSaveBasicProfile}
              disabled={!canEditBasicFields || !hasBasicProfileChanges || isSavingBasicProfile}
              className="bg-brand-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
            >
              {isSavingBasicProfile ? 'Saving...' : 'Save profile changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-border bg-slate-900/40 text-foreground hover:bg-slate-800"
              asChild
            >
              <Link href="/change-password">Change password</Link>
            </Button>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-[hsl(var(--brand-yellow)/0.3)] bg-[hsl(var(--brand-yellow)/0.08)] p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Notification preferences</h3>
            <p className="text-xs text-muted-foreground">
              Inline controls reuse the same notification preference workflow used on the Notifications page.
            </p>
            {isLoadingPreferences ? (
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading saved preferences...</span>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {modules.map((module) => {
              const preference = getPreference(preferences, module.key);
              const isSaving = savingPreferenceModules.includes(module.key);
              const isDisabled = isLoadingPreferences || isSaving;

              return (
                <div
                  key={module.key}
                  className="rounded-md border border-border bg-[hsl(var(--card))] p-3"
                >
                  <p className="text-sm font-medium text-foreground">{module.label}</p>
                  <p className="mb-3 text-xs text-muted-foreground">{module.description}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-md border border-border bg-[hsl(var(--card))] px-3 py-2">
                      <Label htmlFor={`profile-notify-in-app-${module.key}`} className="text-xs">
                        In-app
                      </Label>
                      <Switch
                        id={`profile-notify-in-app-${module.key}`}
                        checked={preference.notify_in_app}
                        disabled={isDisabled}
                        onCheckedChange={(checked) =>
                          onTogglePreference(module.key, 'notify_in_app', checked)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border bg-[hsl(var(--card))] px-3 py-2">
                      <Label htmlFor={`profile-notify-email-${module.key}`} className="text-xs">
                        Email
                      </Label>
                      <Switch
                        id={`profile-notify-email-${module.key}`}
                        checked={preference.notify_email}
                        disabled={isDisabled}
                        onCheckedChange={(checked) =>
                          onTogglePreference(module.key, 'notify_email', checked)
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

