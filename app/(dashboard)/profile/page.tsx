'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { ProfileIdentityCard } from '@/components/profile/ProfileIdentityCard';
import { ProfileModuleSummaries } from '@/components/profile/ProfileModuleSummaries';
import { ProfileQuickLinks } from '@/components/profile/ProfileQuickLinks';
import { ProfileSettingsCard } from '@/components/profile/ProfileSettingsCard';
import { ProfileHelpShortcuts } from '@/components/profile/ProfileHelpShortcuts';
import { AccountSwitcherSettingsCard } from '@/components/account-switch/AccountSwitcherSettingsCard';
import { Card, CardContent } from '@/components/ui/card';
import {
  NOTIFICATION_MODULES,
  type NotificationModuleKey,
  type NotificationPreference,
} from '@/types/notifications';
import type { ProfileOverviewPayload } from '@/types/profile';

function getStoragePathFromPublicAvatarUrl(url: string): string | null {
  const marker = '/storage/v1/object/public/user-avatars/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length);
  return path || null;
}

export default function ProfilePage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile, isAdmin, isManager } = useAuth();

  const [overview, setOverview] = useState<ProfileOverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [savingPreferenceModules, setSavingPreferenceModules] = useState<NotificationModuleKey[]>([]);
  const savingPreferenceModulesRef = useRef<Set<NotificationModuleKey>>(new Set());
  const [savingBasicProfile, setSavingBasicProfile] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [draftFullName, setDraftFullName] = useState('');
  const [draftPhoneNumber, setDraftPhoneNumber] = useState('');

  const availableNotificationModules = useMemo(() => {
    return NOTIFICATION_MODULES.filter((module) => {
      if (module.availableFor === 'all') return true;
      if (module.availableFor === 'admin') return isAdmin;
      if (module.availableFor === 'manager') return isManager || isAdmin;
      return false;
    });
  }, [isAdmin, isManager]);

  const fetchProfileOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const response = await fetch('/api/profile/overview', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load profile overview');
      }

      setOverview(payload as ProfileOverviewPayload);
      setDraftFullName(String(payload.profile?.full_name || ''));
      setDraftPhoneNumber(String(payload.profile?.phone_number || ''));
    } catch (error) {
      const errorContextId = 'profile-load-overview-error';
      console.error('Error loading profile overview:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to load profile', {
        id: errorContextId,
      });
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const fetchNotificationPreferences = useCallback(async () => {
    setLoadingPreferences(true);
    try {
      const response = await fetch('/api/notification-preferences', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load preferences');
      }
      setPreferences(payload.preferences || []);
    } catch (error) {
      const errorContextId = 'profile-load-preferences-error';
      console.error('Error loading profile notification preferences:', error, { errorContextId });
      toast.error('Failed to load notification preferences', { id: errorContextId });
    } finally {
      setLoadingPreferences(false);
    }
  }, []);

  useEffect(() => {
    setOverview(null);
    setPreferences([]);
    void fetchProfileOverview();
    void fetchNotificationPreferences();
  }, [fetchNotificationPreferences, fetchProfileOverview, profile?.id]);

  const canEditBasicFields = Boolean(overview?.can_edit_basic_fields);
  const hasBasicProfileChanges = useMemo(() => {
    if (!overview) return false;
    return (
      draftFullName.trim() !== overview.profile.full_name ||
      (draftPhoneNumber.trim() || '') !== (overview.profile.phone_number || '')
    );
  }, [draftFullName, draftPhoneNumber, overview]);

  async function handleSaveBasicProfile() {
    if (!overview) return;
    if (!canEditBasicFields) {
      toast.error('You do not have permission to edit these fields', {
        id: 'profile-save-basic-forbidden',
      });
      return;
    }

    setSavingBasicProfile(true);
    try {
      const response = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: draftFullName.trim(),
          phone_number: draftPhoneNumber.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save profile');
      }

      setOverview((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          profile: {
            ...previous.profile,
            full_name: payload.profile.full_name,
            phone_number: payload.profile.phone_number,
          },
          can_edit_basic_fields: payload.can_edit_basic_fields ?? previous.can_edit_basic_fields,
        };
      });

      toast.success('Profile details updated');
    } catch (error) {
      const errorContextId = 'profile-save-basic-error';
      console.error('Error saving basic profile details:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to save profile details', {
        id: errorContextId,
      });
    } finally {
      setSavingBasicProfile(false);
    }
  }

  async function updateAvatarUrl(avatarUrl: string | null): Promise<void> {
    const response = await fetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to save avatar');
    }

    setOverview((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        profile: {
          ...previous.profile,
          avatar_url: payload.profile.avatar_url,
        },
      };
    });
  }

  async function handleSelectAvatarFile(file: File) {
    if (!overview || !user?.id) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file', { id: 'profile-avatar-validation-file-type' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Avatar image must be under 5MB', { id: 'profile-avatar-validation-file-size' });
      return;
    }

    setAvatarBusy(true);
    let uploadedPath: string | null = null;
    let didPersistAvatarUrl = false;
    try {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '-');
      const storagePath = `${user.id}/${Date.now()}-${sanitizedName}`;
      uploadedPath = storagePath;

      const { error: uploadError } = await supabase.storage.from('user-avatars').upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('user-avatars').getPublicUrl(storagePath);
      const nextAvatarUrl = publicUrlData.publicUrl;
      await updateAvatarUrl(nextAvatarUrl);
      didPersistAvatarUrl = true;

      const previousAvatarPath = overview.profile.avatar_url
        ? getStoragePathFromPublicAvatarUrl(overview.profile.avatar_url)
        : null;
      if (previousAvatarPath && previousAvatarPath !== storagePath) {
        try {
          const { error: removePreviousError } = await supabase.storage
            .from('user-avatars')
            .remove([previousAvatarPath]);
          if (removePreviousError) {
            console.warn('Failed to remove previous avatar image:', removePreviousError);
          }
        } catch (removePreviousError) {
          console.warn('Unexpected error removing previous avatar image:', removePreviousError);
        }
      }

      toast.success('Avatar updated');
    } catch (error) {
      if (uploadedPath && !didPersistAvatarUrl) {
        try {
          const { error: rollbackError } = await supabase.storage.from('user-avatars').remove([uploadedPath]);
          if (rollbackError) {
            console.warn('Failed to rollback avatar upload after API error:', rollbackError);
          }
        } catch (rollbackError) {
          console.warn('Unexpected error rolling back avatar upload:', rollbackError);
        }
      }

      const errorContextId = 'profile-avatar-upload-error';
      console.error('Error uploading avatar:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to upload avatar', {
        id: errorContextId,
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    if (!overview?.profile.avatar_url) return;

    setAvatarBusy(true);
    try {
      const storagePath = getStoragePathFromPublicAvatarUrl(overview.profile.avatar_url);
      await updateAvatarUrl(null);

      // Best-effort cleanup: DB is already authoritative at this point.
      // If this fails, we prefer an orphaned file over a broken avatar URL.
      if (storagePath) {
        try {
          const { error: removeError } = await supabase.storage.from('user-avatars').remove([storagePath]);
          if (removeError) {
            console.warn('Failed to remove avatar image from storage after profile update:', removeError);
          }
        } catch (removeError) {
          console.warn('Unexpected error removing avatar image from storage:', removeError);
        }
      }

      toast.success('Avatar removed');
    } catch (error) {
      const errorContextId = 'profile-avatar-remove-error';
      console.error('Error removing avatar:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to remove avatar', {
        id: errorContextId,
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleTogglePreference(
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    checked: boolean
  ) {
    if (loadingPreferences) return;
    if (savingPreferenceModulesRef.current.has(moduleKey)) return;

    savingPreferenceModulesRef.current.add(moduleKey);
    setSavingPreferenceModules((previous) =>
      previous.includes(moduleKey) ? previous : [...previous, moduleKey]
    );
    try {
      const currentPreference = preferences.find((preference) => preference.module_key === moduleKey);
      const response = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_key: moduleKey,
          notify_in_app: field === 'notify_in_app' ? checked : currentPreference?.notify_in_app ?? true,
          notify_email: field === 'notify_email' ? checked : currentPreference?.notify_email ?? true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update notification preference');
      }

      setPreferences((previous) => {
        const existing = previous.find((item) => item.module_key === moduleKey);
        if (!existing) {
          return [...previous, payload.preference];
        }
        return previous.map((item) =>
          item.module_key === moduleKey ? { ...item, [field]: checked } : item
        );
      });
    } catch (error) {
      const errorContextId = 'profile-update-preference-error';
      console.error('Error updating notification preference:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to update preference', {
        id: errorContextId,
      });
    } finally {
      savingPreferenceModulesRef.current.delete(moduleKey);
      setSavingPreferenceModules((previous) =>
        previous.filter((savingModuleKey) => savingModuleKey !== moduleKey)
      );
    }
  }

  if (loadingOverview) {
    return (
      <div className="max-w-6xl">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand-yellow" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="max-w-6xl">
        <Card>
          <CardContent className="space-y-3 py-8">
            <p className="text-sm text-muted-foreground">Unable to load profile data right now.</p>
            <button
              type="button"
              onClick={() => void fetchProfileOverview()}
              className="text-sm font-medium text-brand-yellow hover:underline"
            >
              Retry loading profile
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AppPageShell data-prd-epic-id={PROFILE_HUB_PRD_EPIC_ID}>
      <ProfileIdentityCard
        profile={overview.profile}
        onSelectAvatarFile={handleSelectAvatarFile}
        onRemoveAvatar={handleRemoveAvatar}
        isAvatarBusy={avatarBusy}
      />

      <ProfileModuleSummaries
        timesheets={overview.timesheets}
        inspections={overview.inspections}
        absences={overview.absences}
        annualLeaveSummary={overview.annual_leave_summary}
      />

      <ProfileQuickLinks
        recentLinks={overview.quick_links.recent}
        frequentLinks={overview.quick_links.frequent}
      />

      <ProfileSettingsCard
        canEditBasicFields={canEditBasicFields}
        fullName={draftFullName}
        phoneNumber={draftPhoneNumber}
        onFullNameChange={setDraftFullName}
        onPhoneNumberChange={setDraftPhoneNumber}
        onSaveBasicProfile={handleSaveBasicProfile}
        isSavingBasicProfile={savingBasicProfile}
        hasBasicProfileChanges={hasBasicProfileChanges}
        modules={availableNotificationModules}
        preferences={preferences}
        isLoadingPreferences={loadingPreferences}
        savingPreferenceModules={savingPreferenceModules}
        onTogglePreference={handleTogglePreference}
      />

      <AccountSwitcherSettingsCard />

      <ProfileHelpShortcuts />
    </AppPageShell>
  );
}

