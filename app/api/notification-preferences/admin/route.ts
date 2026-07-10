import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import type {
  GetAllNotificationPreferencesResponse,
  AdminUpdatePreferenceRequest,
  UpdateNotificationPreferenceResponse,
} from '@/types/notifications';
import { canDisableNotificationModule, NOTIFICATION_MODULE_KEYS } from '@/types/notifications';
import { isEffectiveSupervisorOrHigherRole } from '@/lib/utils/role-access';

function isDisablePreferenceRequest(input: {
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}): boolean {
  return input.enabled === false || input.notify_in_app === false || input.notify_email === false;
}

/**
 * GET /api/notification-preferences/admin
 * Fetch all users' notification preferences (debug access only)
 */
export async function GET(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check effective role and shared debug access (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!canAccessDebugConsole({
      email: current.profile.email,
      isActualSuperAdmin: effectiveRole.is_actual_super_admin,
      isViewingAs: effectiveRole.is_viewing_as,
    })) {
      return NextResponse.json({ error: 'Forbidden: Debug access required' }, { status: 403 });
    }

    // Use admin client to bypass RLS for fetching all users and preferences
    const adminClient = createAdminClient();

    // Fetch all users with their preferences
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        full_name,
        employee_id,
        is_placeholder,
        role:roles(name, display_name, role_class, is_super_admin)
      `)
      .order('full_name');

    if (profilesError) {
      throw profilesError;
    }

    // Fetch all notification preferences
    const { data: allPrefs, error: prefsError } = await adminClient
      .from('notification_preferences')
      .select('*');

    if (prefsError) {
      throw prefsError;
    }

    // Build response with users and their preferences
    const visibleProfiles = await filterHiddenSystemTestAccountProfiles(adminClient, profiles || []);

    const users = visibleProfiles.map(p => {
      const role = p.role as {
        name?: string | null;
        display_name?: string | null;
        role_class?: 'admin' | 'manager' | 'employee' | null;
        is_super_admin?: boolean | null;
      } | null;

      return {
      user_id: p.id,
      full_name: p.full_name,
      role_name: role?.name || 'unknown',
      role_display_name: role?.display_name || role?.name || 'Unknown',
      role_class: role?.role_class || null,
      is_super_admin: role?.is_super_admin === true,
      preferences: (allPrefs || []).filter(pref => pref.user_id === p.id),
      };
    });

    const response: GetAllNotificationPreferencesResponse = {
      success: true,
      users,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/notification-preferences/admin:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences/admin',
      additionalData: { endpoint: '/api/notification-preferences/admin', method: 'GET' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/notification-preferences/admin
 * Update any user's notification preference (debug access override)
 */
export async function PUT(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check effective role and shared debug access (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!canAccessDebugConsole({
      email: current.profile.email,
      isActualSuperAdmin: effectiveRole.is_actual_super_admin,
      isViewingAs: effectiveRole.is_viewing_as,
    })) {
      return NextResponse.json({ error: 'Forbidden: Debug access required' }, { status: 403 });
    }

    // Parse request body
    const body: AdminUpdatePreferenceRequest = await request.json();
    const { user_id, module_key, enabled, notify_in_app, notify_email } = body;

    if (!user_id || !module_key) {
      return NextResponse.json({ 
        error: 'Missing user_id or module_key' 
      }, { status: 400 });
    }

    if (!NOTIFICATION_MODULE_KEYS.includes(module_key)) {
      return NextResponse.json({ 
        error: `Invalid module_key. Must be one of: ${NOTIFICATION_MODULE_KEYS.join(', ')}`
      }, { status: 400 });
    }

    const isDisableRequest = isDisablePreferenceRequest({ enabled, notify_in_app, notify_email });
    if (isDisableRequest && !canDisableNotificationModule(module_key)) {
      return NextResponse.json({ error: 'Toolbox Talk notifications cannot be disabled' }, { status: 400 });
    }

    if (isDisableRequest && !isEffectiveSupervisorOrHigherRole(effectiveRole)) {
      return NextResponse.json({ error: 'Only supervisors and above can disable notifications' }, { status: 403 });
    }

    // Build upsert data
    const upsertData: Record<string, unknown> = {
      user_id,
      module_key,
    };

    if (enabled !== undefined) upsertData.enabled = enabled;
    if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
    if (notify_email !== undefined) upsertData.notify_email = notify_email;

    // Use admin client to bypass RLS for upserting
    const adminClient = createAdminClient();
    
    // Upsert preference
    const { data: pref, error } = await adminClient
      .from('notification_preferences')
      .upsert(upsertData, { onConflict: 'user_id,module_key' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const response: UpdateNotificationPreferenceResponse = {
      success: true,
      preference: pref,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in PUT /api/notification-preferences/admin:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences/admin',
      additionalData: { endpoint: '/api/notification-preferences/admin', method: 'PUT' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
