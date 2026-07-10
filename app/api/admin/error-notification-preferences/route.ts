import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { isEffectiveSupervisorOrHigherRole } from '@/lib/utils/role-access';

export interface ErrorNotificationPreferences {
  user_id: string;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/admin/error-notification-preferences
 * Fetch current admin's error notification preferences
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessErrorReports = await canEffectiveRoleAccessModule('error-reports');
    if (!canAccessErrorReports) {
      return NextResponse.json({ error: 'Forbidden: Error Reports access required' }, { status: 403 });
    }

    // Fetch or create preferences
    let prefs;
    const { data, error: fetchError } = await supabase
      .from('admin_error_notification_prefs')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // If no preferences exist, create default ones
    if (fetchError && fetchError.code === 'PGRST116') {
      const { data: newPrefs, error: insertError } = await supabase
        .from('admin_error_notification_prefs')
        .insert({
          user_id: user.id,
          notify_in_app: true,
          notify_email: true,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }
      prefs = newPrefs;
    } else if (fetchError) {
      throw fetchError;
    } else {
      prefs = data;
    }

    return NextResponse.json({
      success: true,
      preferences: prefs as ErrorNotificationPreferences,
    });

  } catch (error) {
    console.error('Error in GET /api/admin/error-notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/error-notification-preferences',
      additionalData: { endpoint: '/api/admin/error-notification-preferences', method: 'GET' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/admin/error-notification-preferences
 * Update current admin's error notification preferences
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessErrorReports = await canEffectiveRoleAccessModule('error-reports');
    if (!canAccessErrorReports) {
      return NextResponse.json({ error: 'Forbidden: Error Reports access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { notify_in_app, notify_email } = body;

    if (typeof notify_in_app !== 'boolean' || typeof notify_email !== 'boolean') {
      return NextResponse.json({ 
        error: 'Invalid request: notify_in_app and notify_email must be boolean' 
      }, { status: 400 });
    }

    if (notify_in_app === false || notify_email === false) {
      const effectiveRole = await getEffectiveRole();
      if (!isEffectiveSupervisorOrHigherRole(effectiveRole)) {
        return NextResponse.json({ error: 'Only supervisors and above can disable notifications' }, { status: 403 });
      }
    }

    // Upsert preferences
    const { data: prefs, error } = await supabase
      .from('admin_error_notification_prefs')
      .upsert({
        user_id: user.id,
        notify_in_app,
        notify_email,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      preferences: prefs as ErrorNotificationPreferences,
    });

  } catch (error) {
    console.error('Error in PUT /api/admin/error-notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/error-notification-preferences',
      additionalData: { endpoint: '/api/admin/error-notification-preferences', method: 'PUT' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
