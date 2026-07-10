import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendErrorReportEmailToAdmins } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  ERROR_REPORT_SCREENSHOT_BUCKET,
  MAX_ERROR_REPORT_SCREENSHOT_SIZE_BYTES,
  MAX_ERROR_REPORT_SCREENSHOTS,
  isAllowedErrorReportScreenshot,
  mergeAdditionalContextWithScreenshots,
  type ErrorReportScreenshot,
} from '@/lib/utils/error-report-screenshots';
import type { CreateErrorReportResponse } from '@/types/error-reports';

interface ParsedErrorReportPayload {
  title: string | null;
  description: string | null;
  error_code?: string;
  page_url?: string;
  user_agent?: string;
  additional_context?: unknown;
  screenshots: File[];
}

function getOptionalFormValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string') return undefined;

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function parseAdditionalContext(value: string | undefined): unknown {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return { raw_context: value };
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120) || 'screenshot';
}

async function parseErrorReportPayload(request: NextRequest): Promise<ParsedErrorReportPayload> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const title = getOptionalFormValue(formData, 'title') || getOptionalFormValue(formData, 'error_message') || null;
    const description = getOptionalFormValue(formData, 'description') || getOptionalFormValue(formData, 'error_message') || null;
    const screenshots = formData
      .getAll('screenshots')
      .filter((value): value is File => value instanceof File && value.size > 0);

    return {
      title,
      description,
      error_code: getOptionalFormValue(formData, 'error_code'),
      page_url: getOptionalFormValue(formData, 'page_url'),
      user_agent: getOptionalFormValue(formData, 'user_agent'),
      additional_context: parseAdditionalContext(getOptionalFormValue(formData, 'additional_context')),
      screenshots,
    };
  }

  const body = await request.json();

  return {
    title: body.title || body.error_message || null,
    description: body.description || body.error_message || null,
    error_code: body.error_code,
    page_url: body.page_url,
    user_agent: body.user_agent,
    additional_context: body.additional_context,
    screenshots: [],
  };
}

function validateScreenshotFiles(files: File[]): string | null {
  if (files.length > MAX_ERROR_REPORT_SCREENSHOTS) {
    return `You can attach up to ${MAX_ERROR_REPORT_SCREENSHOTS} screenshots.`;
  }

  const oversizedFile = files.find((file) => file.size > MAX_ERROR_REPORT_SCREENSHOT_SIZE_BYTES);
  if (oversizedFile) {
    return `${oversizedFile.name} is too large. Screenshots must be 5MB or smaller.`;
  }

  const unsupportedFile = files.find((file) => !isAllowedErrorReportScreenshot(file));
  if (unsupportedFile) {
    return `${unsupportedFile.name} is not a supported image file.`;
  }

  return null;
}

/**
 * POST /api/errors/report
 * Report an error from a user - persists to database and notifies all admins
 * 
 * Flow:
 * 1. Persists error report to error_reports table
 * 2. Finds all admin users (roles.name = 'admin' OR roles.is_super_admin = true)
 * 3. Creates in-app notification for all admins
 * 4. Sends email notification to all admin email addresses
 * 
 * Accepts both:
 * - Legacy format: { error_message, error_code, page_url, user_agent, additional_context }
 * - New format: { title, description, error_code, page_url, user_agent, additional_context }
 */
export async function POST(request: NextRequest) {
  try {
    // First verify the user is authenticated using their session
    const authClient = await createServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for database/storage operations to bypass RLS on trusted server code.
    const supabase = createAdminClient();

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const payload = await parseErrorReportPayload(request);
    const { title, description, error_code, page_url, user_agent } = payload;

    if (!title || !description) {
      return NextResponse.json({ error: 'Missing title or description' }, { status: 400 });
    }

    const screenshotValidationError = validateScreenshotFiles(payload.screenshots);
    if (screenshotValidationError) {
      return NextResponse.json({ error: screenshotValidationError }, { status: 400 });
    }

    const reportId = crypto.randomUUID();
    const uploadedScreenshots: ErrorReportScreenshot[] = [];

    try {
      for (const file of payload.screenshots) {
        const filePath = `${user.id}/${reportId}/${Date.now()}_${crypto.randomUUID()}_${sanitizeFileName(file.name)}`;
        const fileBuffer = await file.arrayBuffer();
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(ERROR_REPORT_SCREENSHOT_BUCKET)
          .upload(filePath, fileBuffer, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        uploadedScreenshots.push({
          id: crypto.randomUUID(),
          file_name: file.name,
          file_path: uploadData.path,
          content_type: file.type || null,
          file_size: file.size,
        });
      }
    } catch (uploadError) {
      if (uploadedScreenshots.length > 0) {
        await supabase.storage
          .from(ERROR_REPORT_SCREENSHOT_BUCKET)
          .remove(uploadedScreenshots.map((screenshot) => screenshot.file_path));
      }

      console.error('Error uploading error report screenshots:', uploadError);
      return NextResponse.json({ error: 'Failed to upload screenshots' }, { status: 500 });
    }

    const additional_context = mergeAdditionalContextWithScreenshots(
      payload.additional_context,
      uploadedScreenshots
    );

    // 1. Persist the validated report. Notification failures below must not block creation.
    const { data: errorReport, error: reportError } = await supabase
      .from('error_reports')
      .insert({
        id: reportId,
        created_by: user.id,
        title: title.substring(0, 500), // Limit title length
        description,
        error_code,
        page_url,
        user_agent,
        additional_context,
        status: 'new'
      })
      .select()
      .single();

    if (reportError || !errorReport) {
      if (uploadedScreenshots.length > 0) {
        await supabase.storage
          .from(ERROR_REPORT_SCREENSHOT_BUCKET)
          .remove(uploadedScreenshots.map((screenshot) => screenshot.file_path));
      }

      console.error('Error creating error report:', reportError);
      return NextResponse.json({ 
        error: 'Failed to save error report' 
      }, { status: 500 });
    }

    console.log(`Error report created: ${errorReport.id}`);

    // 2. Try to notify admins (graceful failure - don't block report creation)
    let notificationSuccess = false;
    let emailSuccess = false;

    try {
      // Only notify super-admins (not regular admins or manager-admins)
      const { data: adminRoles, error: adminRolesError } = await supabase
        .from('roles')
        .select('id')
        .is('is_super_admin', true);

      if (adminRolesError) {
        console.error('Error finding admin roles for notification:', adminRolesError);
        throw new Error(`Failed to find admin users: ${adminRolesError.message}`);
      }

      const adminRoleIds = (adminRoles ?? []).map(r => r.id);
      if (adminRoleIds.length === 0) {
        console.warn('No super-admin roles found for notification - skipping alerts');
      } else {
        const { data: adminProfiles, error: adminProfilesError } = await supabase
          .from('profiles')
          .select('id, full_name, role_id')
          .in('role_id', adminRoleIds);

        if (adminProfilesError) {
          console.error('Error finding super-admin profiles for notification:', adminProfilesError);
          throw new Error(`Failed to find super-admin profiles: ${adminProfilesError.message}`);
        }

        if (!adminProfiles || adminProfiles.length === 0) {
          console.warn('No super-admin profiles found for notification - skipping alerts');
        } else {

          const adminUserIds = adminProfiles.map(p => p.id);
          console.log(`Found ${adminUserIds.length} super-admin users for notification:`, adminUserIds);

          // Fetch admin notification preferences
          const { data: allPrefs } = await supabase
            .from('admin_error_notification_prefs')
            .select('*')
            .in('user_id', adminUserIds);
          
          // Build preference maps (default to true if no preference record exists)
          const inAppPrefs = new Map<string, boolean>();
          const emailPrefs = new Map<string, boolean>();
          
          adminUserIds.forEach(id => {
            const pref = allPrefs?.find(p => p.user_id === id);
            inAppPrefs.set(id, pref?.notify_in_app ?? true);
            emailPrefs.set(id, pref?.notify_email ?? true);
          });
          
          // Filter admins who want in-app notifications
          const inAppAdminIds = adminUserIds.filter(id => inAppPrefs.get(id) === true);
          console.log(`${inAppAdminIds.length} admins opted in for in-app notifications`);
          
          // Filter admins who want email notifications
          const emailAdminIds = adminUserIds.filter(id => emailPrefs.get(id) === true);
          console.log(`${emailAdminIds.length} admins opted in for email notifications`);

          // Create in-app notifications for opted-in admins
          if (inAppAdminIds.length > 0) {
            try {
              // Create message
              const { data: message, error: messageError } = await supabase
                .from('messages')
                .insert({
                  type: 'NOTIFICATION',
                  priority: 'HIGH',
                  subject: `🐛 Error Report: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`,
                  body: `**User:** ${profile?.full_name || 'Unknown'} (${user.email})

**Title:** ${title}

**Description:** ${description}

${error_code ? `**Error Code:** ${error_code}\n` : ''}
**Page:** ${page_url || 'Unknown'}

**User Agent:** ${user_agent || 'Unknown'}

${additional_context ? `**Additional Context:**\n${JSON.stringify(additional_context, null, 2)}` : ''}

---
*View and manage this error report in the Errors Management section.*`,
                  sender_id: user.id,
                  created_via: 'error_report',
                  module_key: 'errors',
                })
                .select()
                .single();

              if (messageError) {
                console.error('Error creating message:', messageError);
                throw messageError;
              }

              // Create recipient entries for opted-in admins only
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

              // Update error report with notification message ID
              await supabase
                .from('error_reports')
                .update({ notification_message_id: message.id })
                .eq('id', errorReport.id);

              notificationSuccess = true;
              console.log(`In-app notifications created for ${inAppAdminIds.length} admins`);
            } catch (notificationError) {
              console.error('Failed to create in-app notifications:', notificationError);
            }
          }

          // Send email notifications to opted-in admins
          let emailSent = 0;
          let emailFailed = 0;

          if (emailAdminIds.length > 0) {
            try {
              // Fetch email addresses for opted-in admins only
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
                  reportId: errorReport.id,
                  title,
                  description,
                  errorCode: error_code,
                  userName: profile?.full_name || 'Unknown',
                  userEmail: user.email || 'Unknown',
                  pageUrl: page_url,
                  userAgent: user_agent,
                  additionalContext: additional_context ?? undefined
                });

                emailSuccess = emailResult.success;
                emailSent = emailResult.sent || 0;
                emailFailed = emailResult.failed || 0;

                console.log(`Emails sent: ${emailSent}, failed: ${emailFailed}`);
              } else {
                console.warn('No admin email addresses found');
              }
            } catch (emailError) {
              console.error('Failed to send email notifications:', emailError);
            }
          }
        }
      }

    } catch (notificationError) {
      console.error('Failed to send admin notifications:', notificationError);
      // Continue - don't fail the request due to notification issues
    }

    // Return success since the report was created successfully
    const response: CreateErrorReportResponse = {
      success: true,
      report_id: errorReport.id,
      notification_sent: notificationSuccess,
      email_sent: emailSuccess
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/errors/report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/errors/report',
      additionalData: {
        endpoint: '/api/errors/report',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

