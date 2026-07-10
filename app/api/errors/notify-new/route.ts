import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { sendErrorReportEmailToAdmins } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getProfileWithRole } from '@/lib/utils/permissions';

/**
 * POST /api/errors/notify-new
 * Notify admins of new error log entries from /debug
 * 
 * This endpoint is called by the debug page when new errors are detected.
 * It creates in-app notifications and sends emails to opted-in admins.
 * Uses error_log_alerts table to prevent duplicate notifications.
 * 
 * Request body: { error_log_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the user is authenticated and is an admin
    const authClient = await createServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin (only admins can trigger debug notifications)
    const profile = await getProfileWithRole(user.id);
    if (!profile?.role || (profile.role.name !== 'admin' && !profile.role.is_super_admin)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Use service role client for database operations
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const body = await request.json();
    const { error_log_id } = body;

    if (!error_log_id) {
      return NextResponse.json({ error: 'Missing error_log_id' }, { status: 400 });
    }

    // Check if this error has already been notified
    const { data: existingAlert } = await supabase
      .from('error_log_alerts')
      .select('error_log_id')
      .eq('error_log_id', error_log_id)
      .single();

    if (existingAlert) {
      return NextResponse.json({ 
        success: true, 
        already_notified: true,
        message: 'This error has already been notified'
      });
    }

    // Fetch the error log entry
    const { data: errorLog, error: errorLogError } = await supabase
      .from('error_logs')
      .select('*')
      .eq('id', error_log_id)
      .single();

    if (errorLogError || !errorLog) {
      return NextResponse.json({ error: 'Error log entry not found' }, { status: 404 });
    }

    // Only notify super-admins (not regular admins or manager-admins)
    const { data: adminRoles, error: adminRolesError } = await supabase
      .from('roles')
      .select('id')
      .is('is_super_admin', true);

    if (adminRolesError) {
      console.error('Error finding admin roles:', adminRolesError);
      return NextResponse.json({ 
        success: false,
        error: 'No admin users found to notify',
      }, { status: 500 });
    }

    const adminRoleIds = (adminRoles ?? []).map(r => r.id);
    
    // Check for empty admin roles before querying profiles
    if (adminRoleIds.length === 0) {
      console.warn('No admin roles found - cannot notify admins');
      return NextResponse.json({ 
        success: false,
        error: 'No admin users found to notify',
      }, { status: 500 });
    }

    const { data: adminProfiles, error: adminProfilesError } = await supabase
      .from('profiles')
      .select('id, full_name, role_id')
      .in('role_id', adminRoleIds);

    if (adminProfilesError || !adminProfiles || adminProfiles.length === 0) {
      console.error('Error finding admin users:', adminProfilesError);
      return NextResponse.json({ 
        success: false,
        error: 'No admin users found to notify',
      }, { status: 500 });
    }

    const adminUserIds = adminProfiles.map(p => p.id);
    console.log(`Found ${adminUserIds.length} admin users`);

    // Fetch admin notification preferences
    const { data: allPrefs } = await supabase
      .from('admin_error_notification_prefs')
      .select('*')
      .in('user_id', adminUserIds);
    
    // Build preference maps
    const inAppPrefs = new Map<string, boolean>();
    const emailPrefs = new Map<string, boolean>();
    
    adminUserIds.forEach(id => {
      const pref = allPrefs?.find(p => p.user_id === id);
      inAppPrefs.set(id, pref?.notify_in_app ?? true);
      emailPrefs.set(id, pref?.notify_email ?? true);
    });
    
    const inAppAdminIds = adminUserIds.filter(id => inAppPrefs.get(id) === true);
    const emailAdminIds = adminUserIds.filter(id => emailPrefs.get(id) === true);
    
    console.log(`${inAppAdminIds.length} admins opted in for in-app, ${emailAdminIds.length} for email`);

    // Create in-app notifications for opted-in admins
    let notificationSuccess = false;
    let notificationMessageId: string | null = null;

    if (inAppAdminIds.length > 0) {
      try {
        // Build error summary
        const errorSummary = `
**Error Type:** ${errorLog.error_type}
**Component:** ${errorLog.component_name || 'Unknown'}
**Page:** ${errorLog.page_url}
**User:** ${errorLog.user_email || 'Anonymous'}

**Error Message:**
${errorLog.error_message}

${errorLog.error_stack ? `**Stack Trace:**\n\`\`\`\n${errorLog.error_stack.substring(0, 500)}${errorLog.error_stack.length > 500 ? '...' : ''}\n\`\`\`` : ''}

---
*This error was automatically detected by the error logging system. View full details in the Debug console.*
        `.trim();

        // Create message
        const { data: message, error: messageError } = await supabase
          .from('messages')
          .insert({
            type: 'NOTIFICATION',
            priority: 'HIGH',
            subject: `🚨 New Error Detected: ${errorLog.error_message.substring(0, 50)}${errorLog.error_message.length > 50 ? '...' : ''}`,
            body: errorSummary,
            sender_id: user.id,
            created_via: 'error_notify_new',
            module_key: 'errors',
          })
          .select()
          .single();

        if (messageError) {
          console.error('Error creating message:', messageError);
          throw messageError;
        }

        notificationMessageId = message.id;

        // Create recipient entries for opted-in admins
        const recipientRecords = inAppAdminIds.map(adminId => ({
          message_id: message.id,
          user_id: adminId,
          status: 'PENDING' as const
        }));

        const { error: recipientsError } = await supabase
          .from('message_recipients')
          .insert(recipientRecords);

        if (recipientsError) {
          console.error('Error creating recipients:', recipientsError);
          throw recipientsError;
        }

        notificationSuccess = true;
        console.log(`In-app notifications created for ${inAppAdminIds.length} admins`);
      } catch (notificationError) {
        console.error('Failed to create in-app notifications:', notificationError);
      }
    }

    // Send email notifications to opted-in admins
    let emailSuccess = false;
    let emailSent = 0;
    let emailFailed = 0;

    if (emailAdminIds.length > 0) {
      try {
        // Fetch email addresses for opted-in admins
        const adminEmails: string[] = [];
        for (const adminId of emailAdminIds) {
          const { data: authUser } = await supabase.auth.admin.getUserById(adminId);
          if (authUser?.user?.email) {
            adminEmails.push(authUser.user.email);
          }
        }

        if (adminEmails.length > 0) {
          const emailResult = await sendErrorReportEmailToAdmins({
            to: adminEmails,
            reportId: error_log_id,
            title: `Error Detected: ${errorLog.error_type}`,
            description: errorLog.error_message,
            errorCode: errorLog.error_type,
            userName: errorLog.user_email || 'Anonymous',
            userEmail: errorLog.user_email || 'Unknown',
            pageUrl: errorLog.page_url,
            userAgent: errorLog.user_agent,
            additionalContext: errorLog.additional_data as Record<string, unknown> | undefined
          });

          emailSuccess = emailResult.success;
          emailSent = emailResult.sent || 0;
          emailFailed = emailResult.failed || 0;

          console.log(`Emails sent: ${emailSent}, failed: ${emailFailed}`);
        }
      } catch (emailError) {
        console.error('Failed to send email notifications:', emailError);
      }
    }

    // Record that this error has been notified
    const { error: alertError } = await supabase
      .from('error_log_alerts')
      .insert({
        error_log_id,
        message_id: notificationMessageId,
        admin_count: inAppAdminIds.length + emailAdminIds.length,
      });

    if (alertError) {
      console.error('Error recording alert:', alertError);
      // Don't fail the request if alert recording fails
    }

    return NextResponse.json({
      success: true,
      notification_sent: notificationSuccess,
      email_sent: emailSuccess,
      admins_notified: inAppAdminIds.length + emailAdminIds.length,
    });

  } catch (error) {
    console.error('Error in POST /api/errors/notify-new:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/errors/notify-new',
      additionalData: {
        endpoint: '/api/errors/notify-new',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
