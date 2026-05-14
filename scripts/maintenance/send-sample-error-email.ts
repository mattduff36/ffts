/**
 * Send a sample daily error summary email
 * Run with: npx tsx scripts/send-sample-error-email.ts
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TemplateApp <no-reply@your-app.example.com>';
const TO_EMAIL = process.env.ADMIN_EMAIL || 'template-admin@example.com';

async function sendSampleEmail() {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured');
    process.exit(1);
  }

  console.log('🚀 Generating sample error summary email...\n');

  // Sample error data
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const sampleErrors = [
    { id: '1', timestamp: new Date(yesterday.setHours(8, 30, 15)).toISOString(), error_type: 'Error', error_message: 'Network error fetching notifications: {}', component_name: 'Console Error', page_url: 'https://your-app.example.com/rams', user_email: null },
    { id: '2', timestamp: new Date(yesterday.setHours(9, 15, 30)).toISOString(), error_type: 'TypeError', error_message: 'Cannot read property "map" of undefined', component_name: 'RAMS Page', page_url: 'https://your-app.example.com/rams/manage', user_email: 'manager@example.com' },
    { id: '3', timestamp: new Date(yesterday.setHours(10, 45, 12)).toISOString(), error_type: 'Error', error_message: 'Failed to fetch inspection data', component_name: 'Inspections Page', page_url: 'https://your-app.example.com/inspections/abc-123', user_email: 'employee@example.com' },
    { id: '4', timestamp: new Date(yesterday.setHours(11, 20, 45)).toISOString(), error_type: 'Error', error_message: 'Network error fetching notifications: {}', component_name: 'Console Error', page_url: 'https://your-app.example.com/dashboard', user_email: null },
    { id: '5', timestamp: new Date(yesterday.setHours(13, 10, 22)).toISOString(), error_type: 'NetworkError', error_message: 'Request timeout', component_name: 'API Client', page_url: 'https://your-app.example.com/timesheets', user_email: 'timesheet.user@example.com' },
    { id: '6', timestamp: new Date(yesterday.setHours(14, 35, 18)).toISOString(), error_type: 'Error', error_message: 'Document not found or you do not have permission to view it', component_name: 'RAMS Read Page', page_url: 'https://your-app.example.com/rams/doc-456/read', user_email: 'rams.user@example.com' },
    { id: '7', timestamp: new Date(yesterday.setHours(15, 50, 33)).toISOString(), error_type: 'Error', error_message: 'Network error fetching notifications: {}', component_name: 'Console Error', page_url: 'https://your-app.example.com/rams', user_email: null },
    { id: '8', timestamp: new Date(yesterday.setHours(16, 25, 40)).toISOString(), error_type: 'Error', error_message: 'Invalid timesheet data format', component_name: 'Timesheets Page', page_url: 'https://your-app.example.com/timesheets/new', user_email: 'admin.user@example.com' },
  ];

  const uniqueMessages = new Map<string, number>();

  sampleErrors.forEach(error => {
    uniqueMessages.set(error.error_message, (uniqueMessages.get(error.error_message) || 0) + 1);
  });

  const dateStr = yesterday.toLocaleDateString('en-GB', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });

  console.log('📊 Sample Data Generated:');
  console.log(`   - Total Errors: ${sampleErrors.length}`);
  console.log(`   - Unique Messages: ${uniqueMessages.size}`);
  console.log(`   - Date: ${dateStr}\n`);

  // Build email HTML (abbreviated for script)
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily Error Summary - SAMPLE</title></head><body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;"><div style="background: #fbbf24; color: #78350f; padding: 15px; border-radius: 5px; text-align: center; margin-bottom: 20px; font-weight: bold; border: 2px dashed #f59e0b;">⚠️ THIS IS A SAMPLE EMAIL - Using mock error data for preview purposes</div><div style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;"><h1 style="margin: 0; font-size: 28px;">🚨 Daily Error Summary</h1><p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.95;">${dateStr}</p></div><div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);"><div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; margin-bottom: 30px; border-radius: 5px;"><h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 20px;">📊 Summary</h2><p style="margin: 5px 0; font-size: 24px; font-weight: bold; color: #dc2626;">${sampleErrors.length} Total Errors</p><p style="margin: 5px 0; color: #666; font-size: 14px;">${uniqueMessages.size} unique error messages</p></div><div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 13px;"><p style="margin: 0;">This is a SAMPLE automated daily error summary for DigiDocs</p><p style="margin: 5px 0 0 0;">Generated on ${new Date().toLocaleString('en-GB')}</p></div></body></html>`;

  console.log('📧 Sending email via Resend API...');
  console.log(`   From: ${FROM_EMAIL}`);
  console.log(`   To: ${TO_EMAIL}\n`);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        subject: `🚨 SAMPLE - Daily Error Summary - ${sampleErrors.length} errors on ${dateStr}`,
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to send email:');
      console.error(errorText);
      process.exit(1);
    }

    const result = (await response.json()) as { id: string };
    console.log('✅ Email sent successfully!');
    console.log(`   Email ID: ${result.id}`);
    console.log(`\n📬 Check your inbox at: ${TO_EMAIL}`);
    console.log(`\n💡 Tip: Check spam folder if you don't see it in a few minutes.`);

  } catch (err: unknown) {
    console.error('❌ Error sending email:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

sendSampleEmail();
