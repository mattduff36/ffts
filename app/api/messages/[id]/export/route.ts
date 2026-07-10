import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { renderToBuffer } from '@react-pdf/renderer';
import { ToolboxTalkExportDocument } from '@/lib/pdf/ToolboxTalkExportDocument';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';

interface SenderProfileShape {
  full_name?: string | null;
}

function pickSenderProfile(
  sender: SenderProfileShape | SenderProfileShape[] | null | undefined
): SenderProfileShape | null {
  if (!sender) return null;
  return Array.isArray(sender) ? sender[0] ?? null : sender;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check Org V2 module access
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    const canExportToolboxTalks = await canEffectiveRoleAccessModule('toolbox-talks');
    if (!canExportToolboxTalks) {
      return NextResponse.json(
        { error: 'Toolbox Talks access required' },
        { status: 403 }
      );
    }

    // Fetch message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        subject,
        body,
        type,
        created_at,
        pdf_file_path,
        sender:profiles!messages_sender_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Only allow exporting toolbox talks (not reminders)
    if (message.type !== 'TOOLBOX_TALK') {
      return NextResponse.json(
        { error: 'Only toolbox talk messages can be exported' },
        { status: 400 }
      );
    }

    // Fetch all recipients with their signature status
    const { data: recipients, error: recipientsError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        user_id,
        status,
        signed_at,
        signature_data,
        user:profiles!message_recipients_user_id_fkey(
          id,
          full_name,
          role,
          employee_id
        )
      `)
      .eq('message_id', id)
      .order('signed_at', { ascending: false, nullsFirst: false });

    if (recipientsError) {
      console.error('Error fetching recipients:', recipientsError);
      return NextResponse.json(
        { error: 'Failed to fetch recipients' },
        { status: 500 }
      );
    }

    const logoUrl = await loadTemplateLogoDataUrl();
    if (!logoUrl) {
      throw new Error('Configured branding logo could not be loaded');
    }

    // Generate PDF
    const messageSender = pickSenderProfile(
      message.sender as SenderProfileShape | SenderProfileShape[] | null
    );
    const pdfDocument = ToolboxTalkExportDocument({
      message: {
        id: message.id,
        subject: message.subject,
        body: message.body,
        created_at: message.created_at ?? '',
        sender_name: messageSender?.full_name ?? 'Unknown',
        pdf_file_path: message.pdf_file_path,
      },
      recipients: (recipients || []).map((recipient) => {
        const recipientUser = Array.isArray(recipient.user) ? recipient.user[0] : recipient.user;
        return {
          id: recipient.id,
          status: recipient.status === 'SIGNED' ? 'SIGNED' : 'PENDING',
          signed_at: recipient.signed_at,
          signature_data: recipient.signature_data,
          user: recipientUser
            ? {
                full_name: recipientUser.full_name || 'Unknown',
                role: recipientUser.role || 'unknown',
                employee_id: recipientUser.employee_id,
              }
            : null,
        };
      }),
      logoUrl,
    });

    const pdfBuffer = await renderToBuffer(pdfDocument);

    // Return PDF
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Toolbox_Talk_${message.subject.replace(/[^a-z0-9]/gi, '_')}_Report.pdf"`,
      },
    });
  } catch (error) {
    console.error('Unexpected error in export:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/[id]/export',
      additionalData: {
        endpoint: '/api/messages/[id]/export',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

