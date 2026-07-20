/**
 * Email sending utilities using Resend
 * Documentation: https://resend.com/docs/send-with-nextjs
 */

import { templateConfig } from '@/lib/config/template-config';
import { getTemplateEmailConfig } from '@/lib/config/template-server-config';
import {
  emailButton,
  emailCallout,
  emailChangeTable,
  emailCodeBlock,
  emailCredential,
  emailDetailTable,
  emailParagraph,
  emailSteps,
  escapeEmailHtml,
  renderOperationalEmail,
} from '@/lib/email/operational-email-shell';
import { sendResendEmail, type ResendEmailPayload } from '@/lib/server/resend';

function getPrimaryEmailSettings() {
  return getTemplateEmailConfig();
}

function sendProductionResendEmail(apiKey: string, payload: ResendEmailPayload): Promise<Response> {
  return sendResendEmail({ apiKey, payload });
}

interface SendPasswordEmailParams {
  to: string;
  userName: string;
  temporaryPassword: string;
  isReset?: boolean;
}

/**
 * Send temporary password email to user
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendPasswordEmail(params: SendPasswordEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, userName, temporaryPassword, isReset = false } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const subject = isReset
      ? `Your Password Has Been Reset - ${templateConfig.branding.appName}`
      : `Welcome to ${templateConfig.branding.appName} - Your Login Details`;

    const htmlContent = isReset
      ? renderOperationalEmail({
          title: 'Password reset',
          preheader: 'Your temporary password is ready',
          tone: 'neutral',
          bodyHtml: [
            emailParagraph(`Hello ${userName},`),
            emailParagraph(
              'Your password has been reset by an administrator. Use the temporary password below to sign in.'
            ),
            emailCredential([{ label: 'Temporary password', value: temporaryPassword, emphasize: true }]),
            emailCallout({
              title: 'Password change required',
              body: 'You will be asked to choose a new password when you first log in.',
              tone: 'notice',
            }),
            emailSteps('Next steps', [
              `Go to ${templateConfig.branding.publicUrl} or open the app`,
              'Enter your email address and the temporary password above',
              'Create a new password when prompted',
            ]),
            emailParagraph(
              'If you did not expect this reset, contact your administrator immediately.',
              { muted: true }
            ),
          ].join(''),
        })
      : renderOperationalEmail({
          title: 'Your account has been created',
          preheader: 'Your login details for ' + templateConfig.branding.shortAppName,
          tone: 'neutral',
          bodyHtml: [
            emailParagraph(`Hello ${userName},`),
            emailParagraph(
              `Welcome to ${templateConfig.branding.appName}. Your account is ready — use the details below to sign in.`
            ),
            emailCredential([
              { label: 'Email address', value: to },
              { label: 'Temporary password', value: temporaryPassword, emphasize: true },
            ]),
            emailCallout({
              title: 'Password change required',
              body: 'You will be asked to choose a new password when you first log in.',
              tone: 'notice',
            }),
            emailSteps('Getting started', [
              `Go to ${templateConfig.branding.publicUrl} or open the app`,
              'Enter your email address and the temporary password above',
              'Create a new password when prompted',
            ]),
            emailParagraph('If you have any questions, contact your administrator.', { muted: true }),
          ].join(''),
        });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`,
      };
    }

    const data = await response.json();
    console.log('Email sent successfully:', data);

    return {
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error sending password email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Test email configuration
 * Useful for verifying Resend setup
 */
export async function testEmailConfiguration(): Promise<{
  configured: boolean;
  message: string;
}> {
  const emailConfig = getPrimaryEmailSettings();
  const apiKey = emailConfig.primaryApiKey;
  const fromEmail = emailConfig.primaryFromEmail;

  if (!apiKey) {
    return {
      configured: false,
      message: 'RESEND_API_KEY environment variable is not set',
    };
  }

  if (!fromEmail) {
    return {
      configured: true,
      message: 'Resend configured (using default from address)',
    };
  }

  return {
    configured: true,
    message: `Resend configured with from address: ${fromEmail}`,
  };
}

interface ProfileUpdateChanges {
  email?: { old: string; new: string };
  full_name?: { old: string; new: string };
  phone_number?: { old: string; new: string };
  role?: { old: string; new: string };
  employee_id?: { old: string; new: string };
}

interface SendProfileUpdateEmailParams {
  to: string;
  userName: string;
  changes: ProfileUpdateChanges;
}

/**
 * Send profile update notification email to user
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendProfileUpdateEmail(params: SendProfileUpdateEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, userName, changes } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const changeRows = Object.entries(changes).map(([field, change]) => ({
      field: field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      previous: change.old || '-',
      next: change.new || '-',
    }));

    const htmlContent = renderOperationalEmail({
      title: 'Your profile has been updated',
      preheader: 'An administrator updated your profile',
      tone: 'neutral',
      bodyHtml: [
        emailParagraph(`Hello ${userName},`),
        emailParagraph('An administrator has updated your profile. The changes are listed below.'),
        emailChangeTable(changeRows),
        changes.email
          ? emailCallout({
              title: 'Email address changed',
              body: `Use ${changes.email.new} to log in from now on.`,
              tone: 'notice',
            })
          : '',
        emailParagraph(
          'If you did not expect these changes, contact your administrator.',
          { muted: true }
        ),
      ].join(''),
    });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject: `Your ${templateConfig.branding.appName} Profile Has Been Updated`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`,
      };
    }

    const data = await response.json();
    console.log('Profile update email sent successfully:', data);

    return {
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error sending profile update email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Send Toolbox Talk notification email to recipient(s)
 * @param params Email parameters
 * @returns Promise with success status and counts
 */
interface SendToolboxTalkEmailParams {
  to: string | string[];
  senderName: string;
  subject: string;
  // Note: We don't include message body in email for GDPR reasons
}

export async function sendToolboxTalkEmail(params: SendToolboxTalkEmailParams): Promise<{
  success: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}> {
  const { to, senderName, subject } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const recipients = Array.isArray(to) ? to : [to];
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000;

    let sent = 0;
    let failed = 0;

    const htmlContent = renderOperationalEmail({
      title: 'Toolbox talk — action required',
      preheader: `New toolbox talk: ${subject}`,
      tone: 'critical',
      bodyHtml: [
        emailParagraph('Hello,'),
        emailParagraph(
          `<strong>${escapeEmailHtml(senderName)}</strong> has sent a toolbox talk that needs your attention before you continue using the app.`,
          { html: true }
        ),
        emailDetailTable([{ label: 'Subject', value: subject }]),
        emailCallout({
          title: 'Read and sign in the app',
          body: 'Open the app to read the full message and sign electronically. The message body is not included in this email.',
          tone: 'critical',
        }),
        emailSteps('Next steps', [
          `Open ${templateConfig.branding.appName} or log in at ${templateConfig.branding.publicUrl}`,
          'Read the full toolbox talk message',
          'Sign electronically to confirm you have read and understood it',
        ]),
        emailParagraph('This is an automated notification. Please do not reply to this email.', {
          muted: true,
        }),
      ].join(''),
    });

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      try {
        const promises = batch.map(email =>
          sendProductionResendEmail(apiKey, {
            from: emailConfig.primaryFromEmail,
            to: [email],
            subject: `New Toolbox Talk: ${subject}`,
            html: htmlContent,
          })
        );

        const results = await Promise.allSettled(promises);

        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.ok) {
            sent++;
          } else {
            failed++;
            console.error(
              `Failed to send to ${batch[index]}:`,
              result.status === 'rejected' ? result.reason : 'API error'
            );
          }
        });

        if (i + BATCH_SIZE < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (batchError) {
        console.error('Batch sending error:', batchError);
        failed += batch.length;
      }
    }

    console.log(`Toolbox Talk emails: ${sent} sent, ${failed} failed`);

    return {
      success: sent > 0,
      sent,
      failed,
    };
  } catch (error: unknown) {
    console.error('Error sending Toolbox Talk emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Send maintenance reminder email to recipient(s)
 * @param params Email parameters
 * @returns Promise with success status and counts
 */
interface SendMaintenanceReminderEmailParams {
  to: string | string[];
  senderName: string;
  subject: string;
  vehicleReg: string;
  categoryName: string;
  dueInfo: string; // e.g., "Overdue by 5 days" or "Due in 3 days"
}

export async function sendMaintenanceReminderEmail(params: SendMaintenanceReminderEmailParams): Promise<{
  success: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}> {
  const { to, senderName, subject, vehicleReg, categoryName, dueInfo } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const recipients = Array.isArray(to) ? to : [to];
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000;

    let sent = 0;
    let failed = 0;

    const isOverdue = dueInfo.toLowerCase().includes('overdue');
    const tone = isOverdue ? 'warning' : 'notice';

    const htmlContent = renderOperationalEmail({
      title: subject || 'Maintenance reminder',
      preheader: `${vehicleReg} — ${categoryName}`,
      tone,
      bodyHtml: [
        emailParagraph('Hello,'),
        emailParagraph(
          `<strong>${escapeEmailHtml(senderName)}</strong> has flagged a maintenance item that needs attention.`,
          { html: true }
        ),
        emailDetailTable([
          { label: 'Vehicle', value: vehicleReg },
          { label: 'Category', value: categoryName },
          { label: 'Status', value: dueInfo },
        ]),
        emailCallout({
          title: isOverdue ? 'Action required' : 'Reminder',
          body: 'Please address this maintenance item promptly. Full details are available in the app.',
          tone,
        }),
        emailSteps('Next steps', [
          `Log in to ${templateConfig.branding.appName} to view full details`,
          'Take the necessary action (renew, service, etc.)',
          'Update the due date once completed',
        ]),
        emailParagraph('This is an automated notification. Please do not reply to this email.', {
          muted: true,
        }),
      ].join(''),
    });

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      try {
        const promises = batch.map(email =>
          sendProductionResendEmail(apiKey, {
            from: emailConfig.primaryFromEmail,
            to: [email],
            subject: `Maintenance Reminder: ${vehicleReg} - ${categoryName}`,
            html: htmlContent,
          })
        );

        const results = await Promise.allSettled(promises);

        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.ok) {
            sent++;
          } else {
            failed++;
            console.error(
              `Failed to send to ${batch[index]}:`,
              result.status === 'rejected' ? result.reason : 'API error'
            );
          }
        });

        if (i + BATCH_SIZE < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (batchError) {
        console.error('Batch sending error:', batchError);
        failed += batch.length;
      }
    }

    console.log(`Maintenance reminder emails: ${sent} sent, ${failed} failed`);

    return {
      success: sent > 0,
      sent,
      failed,
    };
  } catch (error: unknown) {
    console.error('Error sending maintenance reminder emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Timesheet Notification Email Templates
 */

interface SendTimesheetRejectionEmailParams {
  to: string;
  employeeName: string;
  weekEnding: string;
  managerComments: string;
}

/**
 * Send timesheet rejection notification email
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendTimesheetRejectionEmail(params: SendTimesheetRejectionEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, employeeName, weekEnding, managerComments } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const subject = 'Timesheet Rejected - Action Required';

    const htmlContent = renderOperationalEmail({
      title: 'Timesheet rejected',
      preheader: `Week ending ${weekEnding}`,
      tone: 'warning',
      bodyHtml: [
        emailParagraph(`Hello ${employeeName},`),
        emailParagraph(
          `Your timesheet for week ending <strong>${escapeEmailHtml(weekEnding)}</strong> has been rejected by your manager.`,
          { html: true }
        ),
        managerComments
          ? emailCallout({
              title: "Manager's comments",
              body: managerComments,
              tone: 'warning',
            })
          : '',
        emailSteps('What you need to do', [
          `Log in to ${templateConfig.branding.appName}`,
          "Review the manager's comments",
          'Correct your timesheet',
          'Resubmit for approval',
        ]),
        emailParagraph(
          'If you have questions about the rejection, contact your manager.',
          { muted: true }
        ),
      ].join(''),
    });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`,
      };
    }

    const data = await response.json();
    console.log('Timesheet rejection email sent successfully:', data);

    return { success: true };
  } catch (error: unknown) {
    console.error('Error sending timesheet rejection email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message,
    };
  }
}

interface SendTimesheetAdjustmentEmailParams {
  to: string;
  recipientName: string;
  employeeName: string;
  weekEnding: string;
  adjustmentComments: string;
  adjustedBy: string;
}

/**
 * Send timesheet adjustment notification email
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendTimesheetAdjustmentEmail(params: SendTimesheetAdjustmentEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, recipientName, employeeName, weekEnding, adjustmentComments, adjustedBy } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const subject = 'Timesheet Adjusted - Please Review';

    const htmlContent = renderOperationalEmail({
      title: 'Timesheet adjusted',
      preheader: `${employeeName} — week ending ${weekEnding}`,
      tone: 'neutral',
      bodyHtml: [
        emailParagraph(`Hello ${recipientName},`),
        emailParagraph('A timesheet has been adjusted and may need your review.'),
        emailDetailTable([
          { label: 'Employee', value: employeeName },
          { label: 'Week ending', value: weekEnding },
          { label: 'Adjusted by', value: adjustedBy },
        ]),
        emailCallout({
          title: 'Adjustment details',
          body: adjustmentComments,
          tone: 'notice',
        }),
        emailParagraph(
          'If you have questions about this adjustment, contact the person who made it.',
          { muted: true }
        ),
      ].join(''),
    });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`,
      };
    }

    const data = await response.json();
    console.log('Timesheet adjustment email sent successfully:', data);

    return { success: true };
  } catch (error: unknown) {
    console.error('Error sending timesheet adjustment email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message,
    };
  }
}

interface SendTrainingBookingDeclinedEmailParams {
  to: string;
  recipientName: string;
  employeeName: string;
  trainingDate: string;
  declinedBy: string;
}

export async function sendTrainingBookingDeclinedEmail(
  params: SendTrainingBookingDeclinedEmailParams
): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, recipientName, employeeName, trainingDate, declinedBy } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    const subject = 'Training Booking Removed From Timesheet';

    const htmlContent = renderOperationalEmail({
      title: 'Training booking removed',
      preheader: `${employeeName} — ${trainingDate}`,
      tone: 'neutral',
      bodyHtml: [
        emailParagraph(`Hello ${recipientName},`),
        emailParagraph(
          `The training booking for <strong>${escapeEmailHtml(employeeName)}</strong> on <strong>${escapeEmailHtml(trainingDate)}</strong> was removed from their timesheet.`,
          { html: true }
        ),
        emailCallout({
          title: 'Reason',
          body: `${employeeName} confirmed they did not attend the booked training. The booking was deleted automatically from the timesheet flow by ${declinedBy}.`,
          tone: 'notice',
        }),
        emailParagraph(`This is an automated notification from ${templateConfig.branding.appName}.`, {
          muted: true,
        }),
      ].join(''),
    });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`,
      };
    }

    const data = await response.json();
    console.log('Training booking declined email sent successfully:', data);
    return { success: true };
  } catch (error: unknown) {
    console.error('Error sending training booking declined email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Send error report email to admins
 */
interface SendErrorReportEmailToAdminsParams {
  to: string[]; // Multiple admin emails
  reportId: string;
  title: string;
  description: string;
  errorCode?: string;
  userName: string;
  userEmail: string;
  pageUrl?: string;
  userAgent?: string;
  additionalContext?: Record<string, unknown>;
}

export async function sendErrorReportEmailToAdmins(params: SendErrorReportEmailToAdminsParams): Promise<{
  success: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}> {
  const {
    to,
    reportId,
    title,
    description,
    errorCode,
    userName,
    userEmail,
    pageUrl,
    userAgent,
    additionalContext,
  } = params;

  try {
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured',
      };
    }

    if (to.length === 0) {
      return {
        success: false,
        error: 'No recipient email addresses provided',
      };
    }

    const subject = `Error report: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`;

    const detailRows: Array<{ label: string; value: string; valueHtml?: boolean }> = [
      { label: 'Reported by', value: `${userName} (${userEmail})` },
      { label: 'Title', value: title },
      {
        label: 'Page',
        value: pageUrl
          ? `<a href="${escapeEmailHtml(pageUrl)}" style="color: #2563eb; text-decoration: underline;">${escapeEmailHtml(pageUrl)}</a>`
          : 'Unknown',
        valueHtml: true,
      },
    ];

    if (errorCode) {
      detailRows.push({
        label: 'Error code',
        value: `<code style="font-family: Consolas, 'Courier New', monospace; font-size: 13px;">${escapeEmailHtml(errorCode)}</code>`,
        valueHtml: true,
      });
    }

    if (userAgent) {
      detailRows.push({ label: 'User agent', value: userAgent });
    }

    const htmlContent = renderOperationalEmail({
      title: 'User-reported error',
      preheader: title,
      tone: 'critical',
      bodyHtml: [
        emailParagraph('A user reported an error that needs review.'),
        emailDetailTable(detailRows),
        emailParagraph('Description', { muted: true }),
        `<p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.55; color: #27272a; white-space: pre-wrap;">${escapeEmailHtml(description)}</p>`,
        additionalContext
          ? [
              emailParagraph('Additional context', { muted: true }),
              emailCodeBlock(JSON.stringify(additionalContext, null, 2)),
            ].join('')
          : '',
        emailCallout({
          title: 'Action required',
          body: `Log in to ${templateConfig.branding.appName} to review this report, update its status, and add notes.`,
          tone: 'notice',
        }),
        emailButton('Manage error reports', `${templateConfig.branding.publicUrl}/admin/errors/manage`),
        emailParagraph(`Report ID: ${reportId}`, { muted: true }),
      ].join(''),
    });

    const BATCH_SIZE = 10;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < to.length; i += BATCH_SIZE) {
      const batch = to.slice(i, i + BATCH_SIZE);

      try {
        const promises = batch.map(email =>
          sendProductionResendEmail(apiKey, {
            from: emailConfig.primaryFromEmail,
            to: [email],
            subject,
            html: htmlContent,
          })
        );

        const results = await Promise.allSettled(promises);

        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.ok) {
            sent++;
          } else {
            failed++;
            console.error(
              `Failed to send to ${batch[index]}:`,
              result.status === 'rejected' ? result.reason : 'API error'
            );
          }
        });

        if (i + BATCH_SIZE < to.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (batchError) {
        console.error('Batch sending error:', batchError);
        failed += batch.length;
      }
    }

    console.log(`Error report emails: ${sent} sent, ${failed} failed`);

    return {
      success: sent > 0,
      sent,
      failed,
    };
  } catch (error: unknown) {
    console.error('Error sending error report emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Send test emails to admin for template approval
 */
export async function sendTestTimesheetEmails(adminEmail: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const rejectionResult = await sendTimesheetRejectionEmail({
      to: adminEmail,
      employeeName: 'John Smith',
      weekEnding: 'Sunday, 1st December 2024',
      managerComments:
        'Please correct the hours for Wednesday - they do not match the job sheet records. Also, the Friday entry is missing break times.',
    });

    if (!rejectionResult.success) {
      return rejectionResult;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const adjustmentResult = await sendTimesheetAdjustmentEmail({
      to: adminEmail,
      recipientName: 'Admin',
      employeeName: 'Jane Doe',
      weekEnding: 'Sunday, 1st December 2024',
      adjustmentComments:
        'Adjusted Thursday hours from 9.5 to 8.0 hours to match the confirmed job completion time with the client. Break time was not properly recorded, so this has been corrected.',
      adjustedBy: 'Example Manager',
    });

    return adjustmentResult;
  } catch (error: unknown) {
    console.error('Error sending test emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send test emails';
    return {
      success: false,
      error: message,
    };
  }
}
