import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type {
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferenceRequest,
  UpdateNotificationPreferenceResponse,
  NotificationPreference,
} from '@/types/notifications';
import {
  canDisableNotificationModule,
  NOTIFICATION_MODULES,
  NOTIFICATION_MODULE_KEYS,
  type NotificationModuleKey,
} from '@/types/notifications';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { isEffectiveSupervisorOrHigherRole } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';

type NotificationPreferenceRow = Omit<
  NotificationPreference,
  'enabled' | 'notify_in_app' | 'notify_email' | 'created_at' | 'updated_at'
> & {
  enabled: boolean | null;
  notify_in_app: boolean | null;
  notify_email: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeNotificationPreference(pref: NotificationPreferenceRow): NotificationPreference {
  return {
    ...pref,
    enabled: pref.enabled ?? true,
    notify_in_app: pref.notify_in_app ?? true,
    notify_email: pref.notify_email ?? false,
    created_at: pref.created_at ?? '',
    updated_at: pref.updated_at ?? '',
  };
}

function canUseNotificationModule(
  moduleKey: NotificationModuleKey,
  profile: Awaited<ReturnType<typeof getProfileWithRole>>
): boolean {
  const notificationModule = NOTIFICATION_MODULES.find((entry) => entry.key === moduleKey);
  if (!notificationModule) return false;
  if (notificationModule.availableFor === 'all') return true;

  const role = profile?.role;
  const isAdmin = profile?.is_super_admin === true || role?.is_super_admin === true || role?.role_class === 'admin';
  const isManager = role?.is_manager_admin === true || role?.role_class === 'manager';

  if (notificationModule.availableFor === 'admin') return isAdmin;
  if (notificationModule.availableFor === 'manager') return isManager || isAdmin;
  return false;
}

function isDisablePreferenceRequest(input: {
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}): boolean {
  return input.enabled === false || input.notify_in_app === false || input.notify_email === false;
}

/**
 * GET /api/notification-preferences
 * Fetch current user's notification preferences for all modules
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's preferences
    const { data: prefs, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .order('module_key');

    if (error) {
      throw error;
    }

    const response: GetNotificationPreferencesResponse = {
      success: true,
      preferences: (prefs || []).map(normalizeNotificationPreference),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences',
      additionalData: { endpoint: '/api/notification-preferences', method: 'GET' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/notification-preferences
 * Update or create current user's notification preference for a module
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: UpdateNotificationPreferenceRequest = await request.json();
    const { module_key, enabled, notify_in_app, notify_email } = body;

    if (!module_key || !NOTIFICATION_MODULE_KEYS.includes(module_key)) {
      return NextResponse.json({ 
        error: `Invalid module_key. Must be one of: ${NOTIFICATION_MODULE_KEYS.join(', ')}`
      }, { status: 400 });
    }

    const isDisableRequest = isDisablePreferenceRequest({ enabled, notify_in_app, notify_email });
    if (isDisableRequest && !canDisableNotificationModule(module_key)) {
      return NextResponse.json({ error: 'Toolbox Talk notifications cannot be disabled' }, { status: 400 });
    }

    if (isDisableRequest) {
      const effectiveRole = await getEffectiveRole();
      if (!isEffectiveSupervisorOrHigherRole(effectiveRole)) {
        return NextResponse.json({ error: 'Only supervisors and above can disable notifications' }, { status: 403 });
      }
    }

    const profile = await getProfileWithRole(user.id);
    if (!canUseNotificationModule(module_key, profile)) {
      return NextResponse.json({ error: 'Forbidden for this notification module' }, { status: 403 });
    }

    // Build upsert data
    const upsertData: Partial<NotificationPreference> & {
      user_id: string;
      module_key: NotificationModuleKey;
    } = {
      user_id: user.id,
      module_key,
      enabled: true,
    };

    if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
    if (notify_email !== undefined) upsertData.notify_email = notify_email;

    // Upsert preference
    const { data: pref, error } = await supabase
      .from('notification_preferences')
      .upsert(upsertData, { onConflict: 'user_id,module_key' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const response: UpdateNotificationPreferenceResponse = {
      success: true,
      preference: normalizeNotificationPreference(pref),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in PUT /api/notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences',
      additionalData: { endpoint: '/api/notification-preferences', method: 'PUT' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
