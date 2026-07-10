import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { templateConfig } from '@/lib/config/template-config';
import { getPrimaryResendEmailConfig } from '@/lib/server/resend-email-config';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send RAMS document via email to the logged-in user
 * POST /api/rams/[id]/email
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await params;
    const supabase = await createClient();

    // Verify the user with Supabase Auth rather than trusting session cookies alone.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if Resend is configured
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const doc = document as {
      id: string;
      title: string;
      description: string | null;
      file_name: string;
      file_path: string;
      file_type: 'pdf' | 'docx';
    };

    // Check if user has access (assigned or is manager/admin)
    const { data: assignment } = await supabase
      .from('rams_assignments')
      .select('*')
      .eq('rams_document_id', documentId)
      .eq('employee_id', user.id)
      .single();

    // Check if user has Org V2 RAMS access
    const canAccessRams = await canEffectiveRoleAccessModule('rams');

    if (!assignment && !canAccessRams) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get user email
    const userEmail = user.email;
    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      );
    }

    // Get signed URL for the document
    const { data: urlData, error: urlError } = await supabase.storage
      .from('rams-documents')
      .createSignedUrl(doc.file_path, 3600); // 1 hour expiry

    if (urlError || !urlData?.signedUrl) {
      return NextResponse.json(
        { error: 'Failed to generate document URL' },
        { status: 500 }
      );
    }

    // Fetch the document file
    const fileResponse = await fetch(urlData.signedUrl);
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch document' },
        { status: 500 }
      );
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    const escapedTitle = escapeHtml(doc.title);
    const escapedDescription = doc.description ? escapeHtml(doc.description) : '';

    // Send email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: getPrimaryResendEmailConfig().fromEmail,
        to: [userEmail],
        subject: `RAMS Document: ${doc.title}`,
        html: `
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
                <h2 style="color: #252525; margin-top: 0;">RAMS Document</h2>
                
                <p>Hello,</p>
                
                <p>You have requested to receive the following RAMS document via email:</p>
                
                <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
                  <h3 style="margin: 0 0 10px 0; color: #252525;">${escapedTitle}</h3>
                  ${escapedDescription ? `<p style="margin: 0; color: #666; font-size: 14px;">${escapedDescription}</p>` : ''}
                </div>
                
                <p>The document is attached to this email. Please review it carefully before signing in the app.</p>
                
                <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                  <p style="margin: 0; font-weight: bold; color: #1e40af;">📋 Next Steps</p>
                  <p style="margin: 5px 0 0 0; color: #1e40af;">After reviewing the document, return to ${templateConfig.branding.shortAppName} to sign and acknowledge that you have read and understood the safety requirements.</p>
                </div>
                
                <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                  If you have any questions about this document, please contact your manager.
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
                <p>© ${new Date().getFullYear()} ${templateConfig.branding.companyName} All rights reserved.</p>
              </div>
            </body>
          </html>
        `,
        attachments: [
          {
            filename: doc.file_name,
            content: fileBase64
          }
        ]
      })
    });

    if (!emailResponse.ok) {
      console.error('Resend API error while sending RAMS document email:', emailResponse.status);
      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Document sent via email successfully'
    });

  } catch (error: unknown) {
    console.error('Error sending RAMS document via email:', error);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}

