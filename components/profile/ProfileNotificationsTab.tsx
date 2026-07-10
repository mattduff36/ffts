'use client';

import { NotificationPreferencesCard } from '@/components/notifications/NotificationPreferencesCard';
import type { NotificationModule, NotificationModuleKey, NotificationPreference } from '@/types/notifications';

interface ProfileNotificationsTabProps {
  modules: NotificationModule[];
  preferences: NotificationPreference[];
  isLoadingPreferences: boolean;
  savingPreferenceModules: NotificationModuleKey[];
  canDisableNotifications: boolean;
  onTogglePreference: (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    checked: boolean
  ) => void;
}

export function ProfileNotificationsTab({
  modules,
  preferences,
  isLoadingPreferences,
  savingPreferenceModules,
  canDisableNotifications,
  onTogglePreference,
}: ProfileNotificationsTabProps) {
  return (
    <NotificationPreferencesCard
      modules={modules}
      preferences={preferences}
      isLoadingPreferences={isLoadingPreferences}
      savingPreferenceModules={savingPreferenceModules}
      canDisableNotifications={canDisableNotifications}
      onTogglePreference={onTogglePreference}
    />
  );
}
