'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ClipboardList, IdCard, Settings, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react';
import { useQueryState } from 'nuqs';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { cn } from '@/lib/utils/cn';
import { ProfileIdentityCard } from '@/components/profile/ProfileIdentityCard';
import { type ProfileDetailsDraft, ProfileMyDetailsTab } from '@/components/profile/ProfileMyDetailsTab';
import { ProfileNotificationsTab } from '@/components/profile/ProfileNotificationsTab';
import { ProfileOverviewTab } from '@/components/profile/ProfileOverviewTab';
import { ProfilePermissionsTab } from '@/components/profile/ProfilePermissionsTab';
import { ProfileRecentSubmissionsTab } from '@/components/profile/ProfileRecentSubmissionsTab';
import { ProfileSecurityTab } from '@/components/profile/ProfileSecurityTab';
import { Card, CardContent } from '@/components/ui/card';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createStatusError, getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import {
  canDisableNotificationModule,
  getAvailableNotificationModules,
  type NotificationModuleKey,
  type NotificationPreference,
} from '@/types/notifications';
import type { ProfileOverviewPayload } from '@/types/profile';

type ProfilePageTab = 'overview' | 'recent' | 'settings';
type ProfileSettingsTab = 'my-details' | 'notifications' | 'security' | 'permissions';

const PROFILE_PAGE_TABS: ProfilePageTab[] = ['overview', 'recent', 'settings'];
const PROFILE_SETTINGS_TABS: ProfileSettingsTab[] = [
  'my-details',
  'notifications',
  'security',
  'permissions',
];

const PROFILE_NAV_ITEMS: Array<{
  value: ProfilePageTab;
  label: string;
  icon: typeof IdCard;
}> = [
  { value: 'overview', label: 'Overview', icon: IdCard },
  { value: 'recent', label: 'Recent Submissions', icon: ClipboardList },
  { value: 'settings', label: 'Settings', icon: Settings },
];

const SETTINGS_NAV_ITEMS: Array<{
  value: ProfileSettingsTab;
  label: string;
  icon: typeof UserRound;
  tileClassName: string;
  activeClassName: string;
  iconClassName: string;
}> = [
  {
    value: 'my-details',
    label: 'My details',
    icon: UserRound,
    tileClassName: 'bg-sky-500/[0.06] hover:bg-sky-500/[0.12]',
    activeClassName: 'bg-sky-500/30',
    iconClassName: 'bg-sky-500/15 text-sky-300',
  },
  {
    value: 'notifications',
    label: 'Notifications',
    icon: Bell,
    tileClassName: 'bg-amber-500/[0.06] hover:bg-amber-500/[0.12]',
    activeClassName: 'bg-amber-500/30',
    iconClassName: 'bg-amber-500/15 text-amber-300',
  },
  {
    value: 'security',
    label: 'Security',
    icon: ShieldCheck,
    tileClassName: 'bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]',
    activeClassName: 'bg-emerald-500/30',
    iconClassName: 'bg-emerald-500/15 text-emerald-300',
  },
  {
    value: 'permissions',
    label: 'Permissions',
    icon: SlidersHorizontal,
    tileClassName: 'bg-violet-500/[0.06] hover:bg-violet-500/[0.12]',
    activeClassName: 'bg-violet-500/30',
    iconClassName: 'bg-violet-500/15 text-violet-300',
  },
];

const EMPTY_DETAILS_DRAFT: ProfileDetailsDraft = {
  full_name: '',
  phone_number: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relationship: '',
  secondary_emergency_contact_name: '',
  secondary_emergency_contact_phone: '',
  secondary_emergency_contact_relationship: '',
  employer_profile_notes: '',
};

function getStoragePathFromPublicAvatarUrl(url: string): string | null {
  const marker = '/storage/v1/object/public/user-avatars/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length);
  return path || null;
}

function createDetailsDraft(profile: ProfileOverviewPayload['profile'] | null | undefined): ProfileDetailsDraft {
  if (!profile) return { ...EMPTY_DETAILS_DRAFT };
  return {
    full_name: profile.full_name || '',
    phone_number: profile.phone_number || '',
    emergency_contact_name: profile.emergency_contact_name || '',
    emergency_contact_phone: profile.emergency_contact_phone || '',
    emergency_contact_relationship: profile.emergency_contact_relationship || '',
    secondary_emergency_contact_name: profile.secondary_emergency_contact_name || '',
    secondary_emergency_contact_phone: profile.secondary_emergency_contact_phone || '',
    secondary_emergency_contact_relationship: profile.secondary_emergency_contact_relationship || '',
    employer_profile_notes: profile.employer_profile_notes || '',
  };
}

function isProfilePageTab(value: string): value is ProfilePageTab {
  return PROFILE_PAGE_TABS.includes(value as ProfilePageTab);
}

function isProfileSettingsTab(value: string): value is ProfileSettingsTab {
  return PROFILE_SETTINGS_TABS.includes(value as ProfileSettingsTab);
}

function ProfilePageContent() {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile, isAdmin, isManager, isSupervisor, isSuperAdmin } = useAuth();
  const [tabParam, setTabParam] = useQueryState('tab', {
    defaultValue: 'overview',
    clearOnDefault: true,
    shallow: true,
  });
  const [settingsTabParam, setSettingsTabParam] = useQueryState('settingsTab', {
    defaultValue: 'my-details',
    clearOnDefault: true,
    shallow: true,
  });

  const [overview, setOverview] = useState<ProfileOverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [savingPreferenceModules, setSavingPreferenceModules] = useState<NotificationModuleKey[]>([]);
  const savingPreferenceModulesRef = useRef<Set<NotificationModuleKey>>(new Set());
  const [savingProfileDetails, setSavingProfileDetails] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<ProfileDetailsDraft>(EMPTY_DETAILS_DRAFT);
  const activeTab = isProfilePageTab(tabParam) ? tabParam : 'overview';
  const activeSettingsTab = isProfileSettingsTab(settingsTabParam) ? settingsTabParam : 'my-details';

  const availableNotificationModules = useMemo(() => {
    const permissionLevels = Object.fromEntries(
      (overview?.permission_summary.modules || []).map((module) => [module.module_name, module.access_level])
    );

    return getAvailableNotificationModules({
      isAdmin,
      isManager,
      permissionLevels,
    });
  }, [isAdmin, isManager, overview?.permission_summary.modules]);
  const canDisableNotificationPreferences = isSupervisor || isManager || isAdmin || isSuperAdmin;

  const fetchProfileOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const response = await fetch('/api/profile/overview', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as (ProfileOverviewPayload & { error?: string }) | null;
      if (!response.ok) {
        throw createStatusError(
          payload?.error || `Failed to load profile overview (${response.status})`,
          response.status
        );
      }
      if (!payload) {
        throw createStatusError('Failed to load profile overview', response.status);
      }

      setOverview(payload);
      setDetailsDraft(createDetailsDraft(payload.profile));
    } catch (error) {
      const errorContextId = 'profile-load-overview-error';
      const errorStatus = getErrorStatus(error);
      if (!isAuthErrorStatus(errorStatus) && !isNetworkFetchError(error)) {
        console.error('Error loading profile overview:', error, { errorContextId });
      }
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
  const hasProfileDetailsChanges = useMemo(() => {
    if (!overview) return false;
    const currentDraft = createDetailsDraft(overview.profile);
    return Object.keys(currentDraft).some((key) => {
      const field = key as keyof ProfileDetailsDraft;
      return detailsDraft[field].trim() !== currentDraft[field];
    });
  }, [detailsDraft, overview]);

  function handleDetailsDraftChange(field: keyof ProfileDetailsDraft, value: string) {
    setDetailsDraft((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSaveProfileDetails() {
    if (!overview) return;

    setSavingProfileDetails(true);
    try {
      const body = {
        ...(canEditBasicFields
          ? {
              full_name: detailsDraft.full_name.trim(),
              phone_number: detailsDraft.phone_number.trim() || null,
            }
          : {}),
        emergency_contact_name: detailsDraft.emergency_contact_name.trim() || null,
        emergency_contact_phone: detailsDraft.emergency_contact_phone.trim() || null,
        emergency_contact_relationship: detailsDraft.emergency_contact_relationship.trim() || null,
        secondary_emergency_contact_name: detailsDraft.secondary_emergency_contact_name.trim() || null,
        secondary_emergency_contact_phone: detailsDraft.secondary_emergency_contact_phone.trim() || null,
        secondary_emergency_contact_relationship:
          detailsDraft.secondary_emergency_contact_relationship.trim() || null,
        employer_profile_notes: detailsDraft.employer_profile_notes.trim() || null,
      };
      const response = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            ...payload.profile,
          },
          can_edit_basic_fields: payload.can_edit_basic_fields ?? previous.can_edit_basic_fields,
        };
      });
      setDetailsDraft(createDetailsDraft(payload.profile));

      toast.success('Profile details updated');
    } catch (error) {
      const errorContextId = 'profile-save-basic-error';
      console.error('Error saving basic profile details:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to save profile details', {
        id: errorContextId,
      });
    } finally {
      setSavingProfileDetails(false);
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
    if (!checked && !canDisableNotificationPreferences) {
      toast.error('Only supervisors and above can disable notifications');
      return;
    }
    if (!checked && !canDisableNotificationModule(moduleKey)) {
      toast.error('Toolbox Talk notifications cannot be disabled');
      return;
    }
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
          <CardContent>
            <PanelLoader message="Loading profile..." className="py-12" />
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

  const sensitiveModules = overview.permission_summary.modules.filter((module) => module.requires_sensitive_pin);

  return (
    <AppPageShell width="wide" data-prd-epic-id={PROFILE_HUB_PRD_EPIC_ID}>
      <ProfileIdentityCard
        profile={overview.profile}
        description="Review your account, recent submissions, settings, permissions, and support options."
        onSelectAvatarFile={handleSelectAvatarFile}
        onRemoveAvatar={handleRemoveAvatar}
        isAvatarBusy={avatarBusy}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (isProfilePageTab(value)) {
            void setTabParam(value);
          }
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-700/70 bg-slate-700/70 sm:hidden">
          {PROFILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.value;

            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => void setTabParam(item.value)}
                className={cn(
                  'flex min-h-16 items-center justify-center gap-2 bg-slate-800/80 px-3 py-4 text-center text-base font-semibold text-white transition-colors hover:bg-slate-700/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-inset',
                  isActive && 'bg-brand-yellow text-slate-950 hover:bg-brand-yellow/90'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>

        <TabsList className="hidden w-full justify-start sm:flex">
          <TabsTrigger value="overview" className="gap-2">
            <IdCard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="recent" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Recent Submissions
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <ProfileOverviewTab
            profile={overview.profile}
            managers={overview.managers}
            annualLeaveSummary={overview.annual_leave_summary}
            permissionModules={overview.permission_summary.modules}
            helpShortcuts={overview.help_shortcuts}
            currentFleetAssignment={overview.current_fleet_assignment}
          />
        </TabsContent>

        <TabsContent value="recent" className="mt-0">
          <ProfileRecentSubmissionsTab
            timesheets={overview.timesheets}
            inspections={overview.inspections}
            absences={overview.absences}
            annualLeaveSummary={overview.annual_leave_summary}
            projectAssignments={overview.project_assignments}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <Tabs
            value={activeSettingsTab}
            onValueChange={(value) => {
              if (isProfileSettingsTab(value)) {
                void setTabParam('settings');
                void setSettingsTabParam(value);
              }
            }}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
              <div className="min-w-0">
                <TabsContent value="my-details" className="mt-0">
                  <ProfileMyDetailsTab
                    canEditBasicFields={canEditBasicFields}
                    draft={detailsDraft}
                    onDraftChange={handleDetailsDraftChange}
                    onSave={handleSaveProfileDetails}
                    isSaving={savingProfileDetails}
                    hasChanges={hasProfileDetailsChanges}
                  />
                </TabsContent>

                <TabsContent value="notifications" className="mt-0">
                  <ProfileNotificationsTab
                    modules={availableNotificationModules}
                    preferences={preferences}
                    isLoadingPreferences={loadingPreferences}
                    savingPreferenceModules={savingPreferenceModules}
                    canDisableNotifications={canDisableNotificationPreferences}
                    onTogglePreference={handleTogglePreference}
                  />
                </TabsContent>

                <TabsContent value="security" className="mt-0">
                  <ProfileSecurityTab sensitiveModules={sensitiveModules} />
                </TabsContent>

                <TabsContent value="permissions" className="mt-0">
                  <ProfilePermissionsTab permissionSummary={overview.permission_summary} />
                </TabsContent>
              </div>

              <div className="order-first grid h-auto w-full grid-cols-4 overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/40 lg:order-none lg:sticky lg:top-4 lg:grid-cols-1">
                {SETTINGS_NAV_ITEMS.map((item, index) => {
                  const Icon = item.icon;
                  const isActive = activeSettingsTab === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        void setTabParam('settings');
                        void setSettingsTabParam(item.value);
                      }}
                      className={cn(
                        'group relative flex min-h-16 flex-col items-center justify-center gap-1 border-slate-700/70 p-2 text-center text-[10px] font-semibold text-slate-100 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-inset sm:min-h-20 sm:gap-2 sm:text-sm lg:w-full',
                        index < SETTINGS_NAV_ITEMS.length - 1 && 'border-r lg:border-b lg:border-r-0',
                        item.tileClassName,
                        isActive && item.activeClassName
                      )}
                    >
                      <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105 sm:h-9 sm:w-9 ${item.iconClassName}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="relative z-10 hidden whitespace-nowrap leading-tight min-[390px]:block lg:block">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Tabs>
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

export default function ProfilePage() {
  return (
    <NuqsClientAdapter>
      <ProfilePageContent />
    </NuqsClientAdapter>
  );
}

