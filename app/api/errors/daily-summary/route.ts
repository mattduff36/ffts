import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { templateConfig } from '@/lib/config/template-config';
import { getTemplateEmailConfig } from '@/lib/config/template-server-config';
import { sendResendEmail } from '@/lib/server/resend';
import { logServerError } from '@/lib/utils/server-error-logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get yesterday's date range (from midnight to midnight)
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Query error logs from yesterday
    const { data: errors, error: queryError } = await supabase
      .from('error_logs')
      .select('*')
      .gte('timestamp', yesterday.toISOString())
      .lte('timestamp', yesterdayEnd.toISOString())
      .order('timestamp', { ascending: false });

    if (queryError) {
      console.error('Error querying error logs:', queryError);
      return NextResponse.json({ error: 'Failed to query error logs' }, { status: 500 });
    }

    if (!errors || errors.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No errors to report for yesterday',
        errors_count: 0 
      });
    }

    // Analyze errors
    const errorsByType: Record<string, number> = {};
    const errorsByComponent: Record<string, number> = {};
    const errorsByUser: Record<string, number> = {};
    const uniqueMessages = new Map<string, number>();

    errors.forEach(error => {
      // Count by type
      errorsByType[error.error_type] = (errorsByType[error.error_type] || 0) + 1;
      
      // Count by component
      const component = error.component_name || 'Unknown';
      errorsByComponent[component] = (errorsByComponent[component] || 0) + 1;
      
      // Count by user (anonymous vs authenticated)
      const userKey = error.user_email || 'Anonymous';
      errorsByUser[userKey] = (errorsByUser[userKey] || 0) + 1;
      
      // Track unique error messages
      uniqueMessages.set(error.error_message, (uniqueMessages.get(error.error_message) || 0) + 1);
    });

    // Get top 10 most frequent error messages
    const topErrors = Array.from(uniqueMessages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    // Get top 5 by type
    const topErrorTypes = Object.entries(errorsByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Get top 5 by component
    const topComponents = Object.entries(errorsByComponent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Get top 5 affected users
    const topUsers = Object.entries(errorsByUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Get latest 5 errors for details
    const latestErrors = errors.slice(0, 5);

    // Build email HTML
    const dateStr = yesterday.toLocaleDateString('en-GB', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Error Summary</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 28px;">🚨 Daily Error Summary</h1>
    <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.95;">${dateStr}</p>
  </div>

  <!-- Main Content -->
  <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    
    <!-- Summary Stats -->
    <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; margin-bottom: 30px; border-radius: 5px;">
      <h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 20px;">📊 Summary</h2>
      <p style="margin: 5px 0; font-size: 24px; font-weight: bold; color: #dc2626;">${errors.length} Total Errors</p>
      <p style="margin: 5px 0; color: #666; font-size: 14px;">${uniqueMessages.size} unique error messages</p>
    </div>

    <!-- Error Breakdown by Type -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #333; border-bottom: 2px solid #f1d64a; padding-bottom: 10px; margin-bottom: 15px;">🏷️ Errors by Type</h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${topErrorTypes.map(([type, count]) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: 500;">${type}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">
              <span style="background: #dc2626; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: bold;">${count}</span>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>

    <!-- Error Breakdown by Component -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #333; border-bottom: 2px solid #f1d64a; padding-bottom: 10px; margin-bottom: 15px;">🧩 Errors by Component</h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${topComponents.map(([component, count]) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: 500;">${component}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">
              <span style="background: #ea580c; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: bold;">${count}</span>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>

    <!-- Top Affected Users -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #333; border-bottom: 2px solid #f1d64a; padding-bottom: 10px; margin-bottom: 15px;">👥 Most Affected Users</h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${topUsers.map(([user, count]) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: 500; ${user === 'Anonymous' ? 'color: #999; font-style: italic;' : ''}">${user}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">
              <span style="background: #6366f1; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: bold;">${count}</span>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>

    <!-- Top 10 Most Frequent Errors -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #333; border-bottom: 2px solid #f1d64a; padding-bottom: 10px; margin-bottom: 15px;">🔝 Most Frequent Errors</h3>
      <div style="background: #f9fafb; padding: 15px; border-radius: 5px;">
        ${topErrors.map((error, index) => `
          <div style="margin-bottom: ${index < topErrors.length - 1 ? '15px' : '0'}; padding-bottom: ${index < topErrors.length - 1 ? '15px' : '0'}; border-bottom: ${index < topErrors.length - 1 ? '1px solid #e5e7eb' : 'none'};">
            <div style="display: flex; align-items: start; gap: 10px;">
              <span style="background: #dc2626; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; flex-shrink: 0;">${index + 1}</span>
              <div style="flex: 1;">
                <p style="margin: 0; font-weight: 500; color: #111;">${error.message}</p>
                <p style="margin: 5px 0 0 0; font-size: 13px; color: #666;">Occurred ${error.count} time${error.count > 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Latest Errors (Detailed) -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #333; border-bottom: 2px solid #f1d64a; padding-bottom: 10px; margin-bottom: 15px;">🕐 Latest Errors (Last 5)</h3>
      ${latestErrors.map((error, index) => {
        const timestamp = new Date(error.timestamp).toLocaleString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        return `
          <div style="background: #fef2f2; padding: 15px; border-left: 3px solid #dc2626; margin-bottom: ${index < latestErrors.length - 1 ? '15px' : '0'}; border-radius: 5px;">
            <div style="margin-bottom: 8px;">
              <span style="background: #dc2626; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase;">${error.error_type}</span>
              ${error.component_name ? `<span style="background: #6366f1; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-left: 5px;">${error.component_name}</span>` : ''}
              <span style="color: #666; font-size: 12px; margin-left: 10px;">⏰ ${timestamp}</span>
            </div>
            <p style="margin: 8px 0; font-weight: 500; color: #dc2626;">${error.error_message}</p>
            ${error.user_email ? `<p style="margin: 5px 0; font-size: 13px; color: #666;">👤 User: ${error.user_email}</p>` : '<p style="margin: 5px 0; font-size: 13px; color: #999; font-style: italic;">👤 Anonymous user</p>'}
            <p style="margin: 5px 0; font-size: 13px; color: #666;">📄 Page: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${error.page_url}</code></p>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Action Button -->
    <div style="text-align: center; margin-top: 30px; padding-top: 30px; border-top: 2px solid #eee;">
      <a href="${templateConfig.branding.publicUrl}/debug"
         style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(220, 38, 38, 0.3);">
        🔍 View Full Error Log
      </a>
    </div>

  </div>

  <!-- Footer -->
  <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 13px;">
    <p style="margin: 0;">This is an automated daily error summary for ${templateConfig.branding.appName}</p>
    <p style="margin: 5px 0 0 0;">Generated on ${new Date().toLocaleString('en-GB')}</p>
  </div>

</body>
</html>
    `.trim();

    // Send email using Resend API
    const emailConfig = getTemplateEmailConfig();
    const resendApiKey = emailConfig.primaryApiKey;
    
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
    }

    const fromEmail = emailConfig.primaryFromEmail;
    const adminEmail = emailConfig.adminEmail;

    const emailResponse = await sendResendEmail({
      apiKey: resendApiKey,
      payload: {
        from: fromEmail,
        to: [adminEmail],
        subject: `🚨 Daily Error Summary - ${errors.length} errors on ${dateStr}`,
        html: emailHtml,
      },
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.text();
      console.error('Failed to send email:', errorData);
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    const emailResult = await emailResponse.json();

    return NextResponse.json({
      success: true,
      message: 'Daily error summary sent successfully',
      errors_count: errors.length,
      email_id: emailResult.id,
      summary: {
        total_errors: errors.length,
        unique_messages: uniqueMessages.size,
        top_error_type: topErrorTypes[0]?.[0] || 'N/A',
        top_component: topComponents[0]?.[0] || 'N/A',
      }
    });

  } catch (error) {
    console.error('Error in daily summary API:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/errors/daily-summary',
      additionalData: {
        endpoint: '/api/errors/daily-summary',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
