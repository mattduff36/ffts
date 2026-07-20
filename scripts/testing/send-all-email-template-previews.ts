/**
 * Send a sample of every outbound email template to a single address for visual review.
 *
 * Usage:
 *   npx tsx scripts/testing/send-all-email-template-previews.ts
 *   npx tsx scripts/testing/send-all-email-template-previews.ts --to someone@example.com
 *   npx tsx scripts/testing/send-all-email-template-previews.ts --operational-only
 */

import { config } from 'dotenv';
import { createRequire } from 'module';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const require = createRequire(import.meta.url);
const Module = require('module') as typeof import('module') & {
  prototype: { require: (...args: unknown[]) => unknown };
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(this: unknown, id: string) {
  if (id === 'server-only') return {};
  return originalRequire.apply(this, [id]);
} as typeof Module.prototype.require;

const PREVIEW_PREFIX = '[TEMPLATE PREVIEW]';
const DEFAULT_TO = 'admin@mpdee.co.uk';
const DELAY_MS = 600;

function parseToAddress(): string {
  const toFlagIndex = process.argv.indexOf('--to');
  if (toFlagIndex >= 0 && process.argv[toFlagIndex + 1]) {
    return process.argv[toFlagIndex + 1].trim();
  }
  return DEFAULT_TO;
}

function isOperationalOnly(): boolean {
  return process.argv.includes('--operational-only');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderQuoteWorkflowEmailHtml(bodyHtml: string, heading?: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
        ${heading ? `<h2 style="margin-bottom: 16px;">${escapeHtml(heading)}</h2>` : ''}
        <div>${bodyHtml}</div>
      </body>
    </html>
  `;
}

async function sendRawEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: `${PREVIEW_PREFIX} ${params.subject}`,
      html: params.html,
    }),
  });

  const body = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) {
    return { ok: false, error: body?.message || response.statusText };
  }
  return { ok: true, id: body?.id };
}

async function main() {
  const to = parseToAddress();
  const operationalOnly = isOperationalOnly();

  const { getTemplateEmailConfig } = await import('../../lib/config/template-server-config');
  const { templateConfig } = await import('../../lib/config/template-config');
  const emailUtils = await import('../../lib/utils/email');

  const emailConfig = getTemplateEmailConfig();
  if (!emailConfig.primaryApiKey) {
    console.error('RESEND_API_KEY is not configured in .env.local');
    process.exit(1);
  }

  const primaryApiKey = emailConfig.primaryApiKey;
  const primaryFrom = emailConfig.primaryFromEmail;
  const quotesApiKey = emailConfig.quotesApiKey || primaryApiKey;
  const quotesFrom = emailConfig.quotesFromEmail || primaryFrom;
  const appName = templateConfig.branding.appName;
  const shortAppName = templateConfig.branding.shortAppName;
  const companyName = templateConfig.branding.companyName;

  console.log(`Sending email template previews to: ${to}`);
  console.log(`Mode: ${operationalOnly ? 'operational only' : 'all templates'}`);
  console.log(`Primary from: ${primaryFrom}`);
  if (!operationalOnly) {
    console.log(`Quotes from: ${quotesFrom}`);
  }
  console.log('');

  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

  async function record(
    name: string,
    result: { success?: boolean; ok?: boolean; error?: string; id?: string }
  ) {
    const ok = result.success === true || result.ok === true;
    results.push({ name, ok, detail: ok ? result.id : result.error });
    console.log(`${ok ? '✓' : '✗'} ${name}${result.error ? ` — ${result.error}` : result.id ? ` (${result.id})` : ''}`);
    await sleep(DELAY_MS);
  }

  // --- Operational templates (lib/utils/email.ts) ---
  await record(
    'password-welcome',
    await emailUtils.sendPasswordEmail({
      to,
      userName: 'Alex Preview',
      temporaryPassword: 'TempPass-Preview-123',
      isReset: false,
    })
  );

  await record(
    'password-reset',
    await emailUtils.sendPasswordEmail({
      to,
      userName: 'Alex Preview',
      temporaryPassword: 'TempPass-Preview-456',
      isReset: true,
    })
  );

  await record(
    'profile-update',
    await emailUtils.sendProfileUpdateEmail({
      to,
      userName: 'Alex Preview',
      changes: {
        email: { old: 'alex.old@example.com', new: 'alex.preview@example.com' },
        full_name: { old: 'Alex Old', new: 'Alex Preview' },
        phone_number: { old: '07700 900000', new: '07700 900123' },
        role: { old: 'employee', new: 'manager' },
        employee_id: { old: 'EMP-1000', new: 'EMP-1001' },
      },
    })
  );

  await record(
    'toolbox-talk',
    await emailUtils.sendToolboxTalkEmail({
      to,
      senderName: 'Example Manager',
      subject: 'Working at Height — Weekly Briefing',
    })
  );

  await record(
    'maintenance-reminder',
    await emailUtils.sendMaintenanceReminderEmail({
      to,
      senderName: 'Fleet Admin',
      subject: 'Service due soon',
      vehicleReg: 'AB12 CDE',
      categoryName: 'Annual Service',
      dueInfo: 'Due in 7 days (27 Jul 2026)',
    })
  );

  await record(
    'timesheet-rejection',
    await emailUtils.sendTimesheetRejectionEmail({
      to,
      employeeName: 'John Smith',
      weekEnding: 'Sunday, 19th July 2026',
      managerComments:
        'Please correct the hours for Wednesday - they do not match the job sheet records. Also, the Friday entry is missing break times.',
    })
  );

  await record(
    'timesheet-adjustment',
    await emailUtils.sendTimesheetAdjustmentEmail({
      to,
      recipientName: 'Admin',
      employeeName: 'Jane Doe',
      weekEnding: 'Sunday, 19th July 2026',
      adjustmentComments:
        'Adjusted Thursday hours from 9.5 to 8.0 hours to match the confirmed job completion time with the client.',
      adjustedBy: 'Example Manager',
    })
  );

  await record(
    'training-booking-declined',
    await emailUtils.sendTrainingBookingDeclinedEmail({
      to,
      recipientName: 'Alex Preview',
      employeeName: 'Sam Trainee',
      trainingDate: 'Friday, 24th July 2026',
      declinedBy: 'Example Manager',
    })
  );

  await record(
    'error-report-to-admins',
    await emailUtils.sendErrorReportEmailToAdmins({
      to: [to],
      reportId: 'preview-report-001',
      title: 'Unable to save timesheet on mobile',
      description: 'Tapping Save does nothing after editing Friday hours. This is sample preview content.',
      errorCode: 'TS-SAVE-001',
      userName: 'Alex Preview',
      userEmail: to,
      pageUrl: `${templateConfig.branding.publicUrl}/timesheets`,
      userAgent: 'Mozilla/5.0 (Preview Script)',
      additionalContext: { source: 'email-template-preview', route: '/timesheets' },
    })
  );

  if (!operationalOnly) {
  const {
    QUOTE_EMAIL_TEMPLATE_DEFINITIONS,
    renderQuoteEmailTemplate,
  } = await import('../../lib/server/quote-email-templates');

  // --- Quote templates (defaults + sample_context) ---
  const quoteHeadings: Record<string, string | undefined> = {
    customer_quote: 'Quotation 40001-EX',
    po_request: undefined,
    approval_request: 'Quote approval required',
    rams_request: 'RAMS requested',
    start_alert: 'Job start reminder',
    quote_returned: 'Quote returned',
    invoice_request: 'Ready to invoice',
    invoice_added: 'Invoice details added',
    start_alert_copy: 'Job start reminder',
  };

  for (const definition of QUOTE_EMAIL_TEMPLATE_DEFINITIONS) {
    const rendered = renderQuoteEmailTemplate(
      {
        subject_template: definition.default_subject_template,
        body_template: definition.default_body_template,
      },
      definition.sample_context
    );

    const result = await sendRawEmail({
      apiKey: quotesApiKey,
      from: quotesFrom,
      to,
      subject: `quote:${definition.template_key} — ${rendered.subject}`,
      html: renderQuoteWorkflowEmailHtml(rendered.bodyHtml, quoteHeadings[definition.template_key]),
    });
    await record(`quote:${definition.template_key}`, result);
  }

  // --- Sensitive PIN verification ---
  {
    const code = '847291';
    const result = await sendRawEmail({
      apiKey: primaryApiKey,
      from: primaryFrom,
      to,
      subject: 'Sensitive access PIN verification',
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
            <h2>Sensitive access PIN verification</h2>
            <p>Hello Alex Preview,</p>
            <p>Use this verification code to set up your sensitive access PIN:</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; padding: 16px; border: 2px solid #F1D64A; display: inline-block;">${code}</div>
            <p>This code expires in 15 minutes.</p>
            <p style="color: #6b7280; font-size: 14px;">If you did not request this, contact an admin immediately.</p>
          </body>
        </html>
      `,
    });
    await record('sensitive-pin-verification', result);
  }

  // --- Sensitive PIN admin alerts (set / changed / admin_reset) ---
  const pinAdminEvents: Array<{ subject: string; body: string }> = [
    {
      subject: 'Sensitive PIN set',
      body: 'Alex Preview set up their sensitive module PIN. PIN values are never included in notifications, emails, or logs.',
    },
    {
      subject: 'Sensitive PIN changed',
      body: 'Alex Preview changed their sensitive module PIN. PIN values are never included in notifications, emails, or logs.',
    },
    {
      subject: 'Sensitive PIN reset by admin',
      body: "Alex Preview's sensitive module PIN was reset by an admin. The user must set a new PIN from their profile before opening protected modules.",
    },
  ];

  for (const event of pinAdminEvents) {
    const result = await sendRawEmail({
      apiKey: primaryApiKey,
      from: primaryFrom,
      to,
      subject: event.subject,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
            <h2>${escapeHtml(event.subject)}</h2>
            <p>${escapeHtml(event.body)}</p>
            <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">This is an automated ${escapeHtml(shortAppName)} security notification.</p>
          </body>
        </html>
      `,
    });
    await record(`sensitive-pin-admin:${event.subject}`, result);
  }

  // --- RAMS document email (no attachment in preview) ---
  {
    const result = await sendRawEmail({
      apiKey: primaryApiKey,
      from: primaryFrom,
      to,
      subject: 'RAMS Document: Example Site Induction RAMS',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #252525;">${escapeHtml(appName)}</h1>
            </div>
            
            <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #252525; margin-top: 0;">RAMS Document</h2>
              
              <p>Hello,</p>
              
              <p>You have requested to receive the following RAMS document via email:</p>
              
              <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #252525;">Example Site Induction RAMS</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">Sample preview document description for template review.</p>
              </div>
              
              <p>The document is attached to this email. Please review it carefully before signing in the app.</p>
              <p style="color: #92400e; font-size: 13px;"><em>(Preview note: attachment omitted for this template review send.)</em></p>
              
              <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #1e40af;">📋 Next Steps</p>
                <p style="margin: 5px 0 0 0; color: #1e40af;">After reviewing the document, return to ${escapeHtml(shortAppName)} to sign and acknowledge that you have read and understood the safety requirements.</p>
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                If you have any questions about this document, please contact your manager.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
              <p>© ${new Date().getFullYear()} ${escapeHtml(companyName)} All rights reserved.</p>
            </div>
          </body>
        </html>
      `,
    });
    await record('rams-document', result);
  }

  // --- Daily error summary (sample data) ---
  {
    const dateStr = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const result = await sendRawEmail({
      apiKey: primaryApiKey,
      from: primaryFrom,
      to,
      subject: `🚨 Daily Error Summary - 12 errors on ${dateStr}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Error Summary</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  <div style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 28px;">🚨 Daily Error Summary</h1>
    <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.95;">${escapeHtml(dateStr)}</p>
  </div>
  <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; margin-bottom: 30px; border-radius: 5px;">
      <h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 20px;">📊 Summary</h2>
      <p style="margin: 5px 0; font-size: 24px; font-weight: bold; color: #dc2626;">12 Total Errors</p>
      <p style="margin: 5px 0; color: #666;">Sample preview content for template review.</p>
    </div>
    <h3 style="color: #333;">Top error types</h3>
    <ul>
      <li>client_error — 7</li>
      <li>server_error — 4</li>
      <li>api_error — 1</li>
    </ul>
    <h3 style="color: #333;">Latest errors</h3>
    <div style="border: 1px solid #eee; border-radius: 8px; padding: 15px; margin-bottom: 12px;">
      <p style="margin: 8px 0; font-weight: 500; color: #dc2626;">Failed to load scheduling board</p>
      <p style="margin: 5px 0; font-size: 13px; color: #666;">👤 User: alex.preview@example.com</p>
      <p style="margin: 5px 0; font-size: 13px; color: #666;">📄 Page: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 11px;">/scheduling</code></p>
    </div>
    <div style="text-align: center; margin-top: 30px; padding-top: 30px; border-top: 2px solid #eee;">
      <a href="${escapeHtml(templateConfig.branding.publicUrl)}/debug"
         style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
        🔍 View Full Error Log
      </a>
    </div>
  </div>
  <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 13px;">
    <p style="margin: 0;">This is an automated daily error summary for ${escapeHtml(appName)}</p>
    <p style="margin: 5px 0 0 0;">Generated on ${escapeHtml(new Date().toLocaleString('en-GB'))}</p>
  </div>
</body>
</html>
      `.trim(),
    });
    await record('daily-error-summary', result);
  }
  } // end !operationalOnly

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log('');
  console.log(`Done. ${passed} sent, ${failed} failed (of ${results.length}).`);
  console.log(`Inbox filter tip: subject contains "${PREVIEW_PREFIX}"`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
