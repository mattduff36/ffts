/**
 * Email sending utilities using Resend
 * Documentation: https://resend.com/docs/send-with-nextjs
 */

import { templateConfig } from '@/lib/config/template-config';
import { getTemplateEmailConfig } from '@/lib/config/template-server-config';
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
    // Check if Resend API key is configured
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }
    
    const subject = isReset 
      ? `Your Password Has Been Reset - ${templateConfig.branding.appName}`
      : `Welcome to ${templateConfig.branding.appName} - Your Login Details`;
    
    const htmlContent = isReset ? `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">${templateConfig.branding.appName}</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Password Reset</h2>
            
            <p>Hello ${userName},</p>
            
            <p>Your password has been reset by an administrator. You can now log in using the temporary password below:</p>
            
            <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Temporary Password</p>
              <p style="margin: 0; font-size: 24px; font-weight: bold; color: #252525; letter-spacing: 1px;">${temporaryPassword}</p>
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">Important</p>
              <p style="margin: 5px 0 0 0; color: #92400e;">You will be required to change this password when you first log in.</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ol style="color: #4b5563;">
              <li>Go to ${templateConfig.branding.publicUrl} or open the app</li>
              <li>Enter your email address and the temporary password above</li>
              <li>Create a new password when prompted</li>
            </ol>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you did not request this password reset, please contact your administrator immediately.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    ` : `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">Welcome to ${templateConfig.branding.appName}</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Your Account Has Been Created</h2>
            
            <p>Hello ${userName},</p>
            
            <p>Welcome to ${templateConfig.branding.appName}! Your account has been created and you can now log in using the credentials below:</p>
            
            <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Email Address</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #252525;">${to}</p>
              
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Temporary Password</p>
              <p style="margin: 0; font-size: 24px; font-weight: bold; color: #252525; letter-spacing: 1px;">${temporaryPassword}</p>
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">Important</p>
              <p style="margin: 5px 0 0 0; color: #92400e;">You will be required to change this password when you first log in.</p>
            </div>
            
            <p><strong>Getting Started:</strong></p>
            <ol style="color: #4b5563;">
              <li>Go to ${templateConfig.branding.publicUrl} or open the app</li>
              <li>Enter your email address and the temporary password above</li>
              <li>Create a new password when prompted</li>
            </ol>
            
            <p style="background-color: #dbeafe; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <strong style="color: #1e40af;">Tip:</strong><br>
              <span style="color: #1e3a8a;">Choose a password that's secure but easy for you to remember. We recommend using a combination of words and numbers.</span>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    // Send email using Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`
      };
    }

    const data = await response.json();
    console.log('Email sent successfully:', data);
    
    return {
      success: true
    };
    
  } catch (error: unknown) {
    console.error('Error sending password email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message
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
      message: 'RESEND_API_KEY environment variable is not set'
    };
  }
  
  if (!fromEmail) {
    return {
      configured: true,
      message: 'Resend configured (using default from address)'
    };
  }
  
  return {
    configured: true,
    message: `Resend configured with from address: ${fromEmail}`
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
    // Check if Resend API key is configured
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }
    
    // Build changes list HTML
    const changesHtml = Object.entries(changes)
      .map(([field, change]) => {
        const fieldName = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #374151;">${fieldName}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">${change.old || '-'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #059669; font-weight: 500;">${change.new || '-'}</td>
          </tr>
        `;
      })
      .join('');
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">${templateConfig.branding.appName}</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Your Profile Has Been Updated</h2>
            
            <p>Hello ${userName},</p>
            
            <p>An administrator has updated your profile information. Here are the changes:</p>
            
            <div style="background-color: #fff; border: 1px solid #e5e7eb; border-radius: 8px; margin: 20px 0; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Field</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Previous Value</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${changesHtml}
                </tbody>
              </table>
            </div>
            
            ${changes.email ? `
              <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #1e40af;">Email Address Changed</p>
                <p style="margin: 5px 0 0 0; color: #1e40af;">Your email address has been updated. Please use <strong>${changes.email.new}</strong> to log in from now on.</p>
              </div>
            ` : ''}
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you did not expect these changes or have any questions, please contact your administrator.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    // Send email using Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject: `Your ${templateConfig.branding.appName} Profile Has Been Updated`,
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`
      };
    }

    const data = await response.json();
    console.log('Profile update email sent successfully:', data);
    
    return {
      success: true
    };
    
  } catch (error: unknown) {
    console.error('Error sending profile update email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return {
      success: false,
      error: message
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
    // Check if Resend API key is configured
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }

    // Convert single email to array for consistent handling
    const recipients = Array.isArray(to) ? to : [to];
    
    // Resend allows up to 100 recipients per call, but we'll batch conservatively
    // to avoid rate limits: 10 emails per batch with delays
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000; // 1 second between batches
    
    let sent = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #DC2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: white;">New Toolbox Talk</h1>
            </div>
            
            <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #252525; margin-top: 0;">Action Required</h2>
              
              <p>Hello,</p>
              
              <p><strong>${senderName}</strong> has sent you an important Toolbox Talk message that requires your immediate attention.</p>
              
              <div style="background-color: #fff; border: 2px solid #DC2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Subject:</p>
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #DC2626;">${subject}</p>
              </div>
              
              <div style="background-color: #fef2f2; border-left: 4px solid #DC2626; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #991b1b;">Important Safety Information</p>
                <p style="margin: 5px 0 0 0; color: #991b1b;">You must read and sign this Toolbox Talk before continuing to use the app. The full message is available when you log in.</p>
              </div>
              
              <p><strong>Next Steps:</strong></p>
              <ol style="color: #4b5563;">
                <li>Open ${templateConfig.branding.appName} or log in at ${templateConfig.branding.publicUrl}</li>
                <li>Read the full Toolbox Talk message</li>
                <li>Sign electronically to confirm you've read and understood it</li>
              </ol>
              
              <div style="background-color: #dbeafe; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #1e40af;"><strong>Note:</strong> For security and privacy reasons, the full message content is only available in the app, not in this email.</p>
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
              <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
            </div>
          </body>
        </html>
      `;

      try {
        // Send emails for this batch
        const promises = batch.map(email =>
          sendProductionResendEmail(apiKey, {
            from: emailConfig.primaryFromEmail,
            to: [email],
            subject: `New Toolbox Talk: ${subject}`,
            html: htmlContent,
          })
        );

        const results = await Promise.allSettled(promises);
        
        // Count successes and failures
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.ok) {
            sent++;
          } else {
            failed++;
            console.error(`Failed to send to ${batch[index]}:`, 
              result.status === 'rejected' ? result.reason : 'API error');
          }
        });

        // Wait before next batch (unless this is the last batch)
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
      failed
    };
    
  } catch (error: unknown) {
    console.error('Error sending Toolbox Talk emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message
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
    // Check if Resend API key is configured
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }

    // Convert single email to array for consistent handling
    const recipients = Array.isArray(to) ? to : [to];
    
    // Resend allows up to 100 recipients per call, but we'll batch conservatively
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000; // 1 second between batches
    
    let sent = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      
      const isOverdue = dueInfo.toLowerCase().includes('overdue');
      const statusColor = isOverdue ? '#DC2626' : '#F59E0B'; // Red for overdue, amber for due soon
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: ${statusColor}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: white;">Maintenance Reminder</h1>
            </div>
            
            <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #252525; margin-top: 0;">${subject}</h2>
              
              <p>Hello,</p>
              
              <p><strong>${senderName}</strong> has flagged a maintenance item that requires your attention.</p>
              
              <div style="background-color: #fff; border: 2px solid ${statusColor}; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Vehicle:</td>
                    <td style="padding: 8px 0; font-weight: bold; color: #252525;">${vehicleReg}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Category:</td>
                    <td style="padding: 8px 0; font-weight: bold; color: #252525;">${categoryName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Status:</td>
                    <td style="padding: 8px 0; font-weight: bold; color: ${statusColor};">${dueInfo}</td>
                  </tr>
                </table>
              </div>
              
              <div style="background-color: ${isOverdue ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: ${isOverdue ? '#991b1b' : '#92400e'};">${isOverdue ? 'Action Required' : 'Reminder'}</p>
                <p style="margin: 5px 0 0 0; color: ${isOverdue ? '#991b1b' : '#92400e'};">Please address this maintenance item promptly.</p>
              </div>
              
              <p><strong>Next Steps:</strong></p>
              <ol style="color: #4b5563;">
                <li>Log in to ${templateConfig.branding.appName} to view full details</li>
                <li>Take the necessary action (renew, service, etc.)</li>
                <li>Update the due date once completed</li>
              </ol>
              
              <div style="background-color: #dbeafe; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #1e40af;"><strong>Note:</strong> For security and privacy reasons, full details are only available in the app.</p>
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
              <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
            </div>
          </body>
        </html>
      `;

      try {
        // Send emails for this batch
        const promises = batch.map(email =>
          sendProductionResendEmail(apiKey, {
            from: emailConfig.primaryFromEmail,
            to: [email],
            subject: `Maintenance Reminder: ${vehicleReg} - ${categoryName}`,
            html: htmlContent,
          })
        );

        const results = await Promise.allSettled(promises);
        
        // Count successes and failures
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.ok) {
            sent++;
          } else {
            failed++;
            console.error(`Failed to send to ${batch[index]}:`, 
              result.status === 'rejected' ? result.reason : 'API error');
          }
        });

        // Wait before next batch (unless this is the last batch)
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
      failed
    };
    
  } catch (error: unknown) {
    console.error('Error sending maintenance reminder emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message
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
        error: 'Email service not configured'
      };
    }
    
    const subject = 'Timesheet Rejected - Action Required';
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">${templateConfig.branding.appName}</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #dc2626; margin-top: 0;">Timesheet Rejected</h2>
            
            <p>Hello ${employeeName},</p>
            
            <p>Your timesheet for <strong>week ending ${weekEnding}</strong> has been rejected by your manager.</p>
            
            ${managerComments ? `
            <div style="background-color: #fff; border-left: 4px solid #dc2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #dc2626;">Manager's Comments:</p>
              <p style="margin: 0; color: #4b5563;">${managerComments}</p>
            </div>
            ` : ''}
            
            <p><strong>What You Need to Do:</strong></p>
            <ol style="color: #4b5563;">
              <li>Log in to ${templateConfig.branding.appName}</li>
              <li>Review the manager's comments</li>
              <li>Make the necessary corrections to your timesheet</li>
              <li>Resubmit for approval</li>
            </ol>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Please log in to ${templateConfig.branding.appName} to make the necessary corrections. If you have questions about the rejection, please contact your manager.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`
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
      error: message
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
        error: 'Email service not configured'
      };
    }
    
    const subject = 'Timesheet Adjusted - Please Review';
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">${templateConfig.branding.appName}</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #f59e0b; margin-top: 0;">Timesheet Adjusted</h2>
            
            <p>Hello ${recipientName},</p>
            
            <p>A timesheet has been adjusted and may require your attention.</p>
            
            <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Employee:</td>
                  <td style="padding: 8px 0; font-weight: bold; color: #252525;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Week Ending:</td>
                  <td style="padding: 8px 0; font-weight: bold; color: #252525;">${weekEnding}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Adjusted By:</td>
                  <td style="padding: 8px 0; font-weight: bold; color: #252525;">${adjustedBy}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #f59e0b;">Adjustment Details:</p>
              <p style="margin: 0; color: #4b5563; white-space: pre-wrap;">${adjustmentComments}</p>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              This is an automated notification. If you have questions about this adjustment, please contact the person who made the adjustment.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailConfig.primaryFromEmail,
        to: [to],
        subject,
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message ?? 'Unknown error'}`
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
      error: message
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

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">${templateConfig.branding.appName}</h1>
          </div>

          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #b45309; margin-top: 0;">Training Booking Removed</h2>

            <p>Hello ${recipientName},</p>

            <p>
              The training booking for <strong>${employeeName}</strong> on
              <strong>${trainingDate}</strong> was removed from their timesheet.
            </p>

            <div style="background-color: #fff; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #b45309;">Reason</p>
              <p style="margin: 0; color: #4b5563;">
                ${employeeName} confirmed they did not attend the booked training. The booking was deleted automatically from the timesheet flow by ${declinedBy}.
              </p>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              This is an automated notification from ${templateConfig.branding.appName}.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

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
  const { to, reportId, title, description, errorCode, userName, userEmail, pageUrl, userAgent, additionalContext } = params;
  
  try {
    // Check if Resend API key is configured
    const emailConfig = getPrimaryEmailSettings();
    const apiKey = emailConfig.primaryApiKey;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }
    
    if (to.length === 0) {
      return {
        success: false,
        error: 'No recipient email addresses provided'
      };
    }
    
    const subject = `🐛 Error Report: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #dc2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #ffffff;">🐛 Error Report</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #dc2626; margin-top: 0;">User-Reported Error</h2>
            
            <p>A user has reported an error in the application that requires your attention.</p>
            
            <div style="background-color: #fff; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #252525;">Error Details</h3>
              
              <p style="margin: 10px 0;"><strong>Reported By:</strong> ${userName} (${userEmail})</p>
              
              <p style="margin: 10px 0;"><strong>Title:</strong></p>
              <p style="margin: 5px 0 10px 0; color: #252525; font-weight: bold;">${title}</p>
              
              <p style="margin: 10px 0;"><strong>Description:</strong></p>
              <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 10px 0;">
                <p style="margin: 0; color: #991b1b; white-space: pre-wrap;">${description}</p>
              </div>
              
              ${errorCode ? `<p style="margin: 10px 0;"><strong>Error Code:</strong> <code style="background-color: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${errorCode}</code></p>` : ''}
              
              <p style="margin: 10px 0;"><strong>Page URL:</strong> <a href="${pageUrl || 'Unknown'}" style="color: #3b82f6; text-decoration: none;">${pageUrl || 'Unknown'}</a></p>
              
              ${userAgent ? `<p style="margin: 10px 0;"><strong>User Agent:</strong> <span style="font-size: 12px; color: #6b7280;">${userAgent}</span></p>` : ''}
              
              ${additionalContext ? `
                <p style="margin: 15px 0 5px 0;"><strong>Additional Context:</strong></p>
                <pre style="background-color: #f3f4f6; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 12px; color: #374151;">${JSON.stringify(additionalContext, null, 2)}</pre>
              ` : ''}
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">⚠️ Action Required</p>
              <p style="margin: 5px 0 0 0; color: #92400e;">Please log in to ${templateConfig.branding.appName} to review and manage this error report. You can update the status and add notes for tracking.</p>
            </div>
            
    <div style="text-align: center; margin: 20px 0;">
      <a href="${templateConfig.branding.publicUrl}/admin/errors/manage" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Manage Error Reports</a>
    </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              <strong>Report ID:</strong> ${reportId}
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    // Send emails (batch if needed)
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
            console.error(`Failed to send to ${batch[index]}:`,
              result.status === 'rejected' ? result.reason : 'API error');
          }
        });

        // Wait before next batch (unless this is the last batch)
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
      failed
    };
    
  } catch (error: unknown) {
    console.error('Error sending error report emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send emails';
    return {
      success: false,
      error: message
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
    // Test rejection email
    const rejectionResult = await sendTimesheetRejectionEmail({
      to: adminEmail,
      employeeName: 'John Smith',
      weekEnding: 'Sunday, 1st December 2024',
      managerComments: 'Please correct the hours for Wednesday - they do not match the job sheet records. Also, the Friday entry is missing break times.'
    });

    if (!rejectionResult.success) {
      return rejectionResult;
    }

    // Wait a moment between emails
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test adjustment email
    const adjustmentResult = await sendTimesheetAdjustmentEmail({
      to: adminEmail,
      recipientName: 'Admin',
      employeeName: 'Jane Doe',
      weekEnding: 'Sunday, 1st December 2024',
      adjustmentComments: 'Adjusted Thursday hours from 9.5 to 8.0 hours to match the confirmed job completion time with the client. Break time was not properly recorded, so this has been corrected.',
      adjustedBy: 'Sarah Manager'
    });

    return adjustmentResult;
    
  } catch (error: unknown) {
    console.error('Error sending test emails:', error);
    const message = error instanceof Error ? error.message : 'Failed to send test emails';
    return {
      success: false,
      error: message
    };
  }
}

