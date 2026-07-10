import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendToolboxTalkEmail } from '@/lib/utils/email';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { CreateMessageInput, CreateMessageResponse, MessagePriority, MessageType } from '@/types/messages';
import { normalizeRoleInternalName } from '@/lib/utils/role-name';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';

type StoredMessagePriority = Exclude<MessagePriority, 'MEDIUM'>;

function getToolboxTalksCreatedVia(type: MessageType): string {
  if (type === 'NOTIFICATION') return 'toolbox-talks_notification';
  if (type === 'REMINDER') return 'toolbox-talks_reminder';
  return 'web';
}

/**
 * POST /api/messages
 * Create a new Toolbox Talk or Reminder message
 * Only managers/admins can create messages
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check Org V2 module access
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      console.error('Profile not found for user:', user.id);
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    }

    if (!profile.role) {
      console.error('User has no role assigned:', user.id);
      return NextResponse.json({ error: 'No role assigned to user' }, { status: 403 });
    }

    const canManageToolboxTalks = await canEffectiveRoleAccessModule('toolbox-talks');
    if (!canManageToolboxTalks) {
      console.error('User lacks toolbox-talks access:', user.id, profile.role);
      return NextResponse.json(
        { error: 'Forbidden: Toolbox Talks access required' },
        { status: 403 }
      );
    }

    // Parse request body (could be JSON or FormData)
    const contentType = request.headers.get('content-type') || '';
    let type: string;
    let subject: string;
    let messageBody: string;
    let recipient_type: string;
    let recipient_user_ids: string[] | undefined;
    let recipient_roles: string[] | undefined;
    let requestedPriority: MessagePriority | undefined;
    let requestedAcceptanceDelayMinutes = 0;
    let pdfFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData (with PDF upload)
      const formData = await request.formData();
      type = formData.get('type') as string;
      subject = formData.get('subject') as string;
      messageBody = formData.get('body') as string;
      recipient_type = formData.get('recipient_type') as string;
      
      const recipientUserIdsStr = formData.get('recipient_user_ids') as string | null;
      recipient_user_ids = recipientUserIdsStr ? JSON.parse(recipientUserIdsStr) : undefined;
      
      const recipientRolesStr = formData.get('recipient_roles') as string | null;
      recipient_roles = recipientRolesStr ? JSON.parse(recipientRolesStr) : undefined;
      requestedPriority = (formData.get('priority') as MessagePriority | null) || undefined;
      requestedAcceptanceDelayMinutes = Number.parseInt(
        (formData.get('acceptance_delay_minutes') as string | null) || '0',
        10
      ) || 0;
      
      pdfFile = formData.get('pdf_file') as File | null;
    } else {
      // Handle JSON (for backwards compatibility)
      const body: CreateMessageInput = await request.json();
      type = body.type;
      subject = body.subject;
      messageBody = body.body;
      recipient_type = body.recipient_type;
      recipient_user_ids = body.recipient_user_ids;
      recipient_roles = body.recipient_roles;
      requestedPriority = body.priority;
      requestedAcceptanceDelayMinutes = Number.isFinite(body.acceptance_delay_minutes)
        ? Math.floor(body.acceptance_delay_minutes as number)
        : 0;
    }

    // Validate required fields
    if (!type || !subject || !messageBody || !recipient_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['TOOLBOX_TALK', 'REMINDER', 'NOTIFICATION'].includes(type)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    if (requestedPriority && !['LOW', 'HIGH', 'URGENT'].includes(requestedPriority)) {
      return NextResponse.json({ error: 'Invalid message priority' }, { status: 400 });
    }

    if (requestedAcceptanceDelayMinutes < 0 || requestedAcceptanceDelayMinutes > 1440) {
      return NextResponse.json({ error: 'Acceptance delay must be between 0 and 1440 minutes' }, { status: 400 });
    }

    // Resolve recipients based on selection type
    let recipientUserIds: string[] = [];

    if (recipient_type === 'individual') {
      if (!recipient_user_ids || recipient_user_ids.length === 0) {
        return NextResponse.json({ error: 'No recipients specified' }, { status: 400 });
      }
      recipientUserIds = recipient_user_ids;

    } else if (recipient_type === 'role') {
      if (!recipient_roles || recipient_roles.length === 0) {
        return NextResponse.json({ error: 'No roles specified' }, { status: 400 });
      }

      const selectedTokens = new Set(
        recipient_roles
          .map((value) => normalizeRoleInternalName(value))
          .filter((value) => value.length > 0)
      );

      const { data: roleRows, error: roleLookupError } = await supabase
        .from('roles')
        .select('id, name, display_name');
      if (roleLookupError) throw roleLookupError;

      const roleIds = (roleRows || [])
        .filter((role) => {
          const byName = normalizeRoleInternalName(role.name || '');
          const byDisplay = normalizeRoleInternalName(role.display_name || '');
          return selectedTokens.has(byName) || selectedTokens.has(byDisplay);
        })
        .map((role) => role.id);

      if (roleIds.length === 0) {
        recipientUserIds = [];
      } else {
        const { data: roleUsers, error: roleUsersError } = await supabase
          .from('profiles')
          .select('id, full_name, employee_id, is_placeholder')
          .in('role_id', roleIds);
        if (roleUsersError) throw roleUsersError;
        const visibleRoleUsers = await filterHiddenSystemTestAccountProfiles(admin, roleUsers || []);
        recipientUserIds = visibleRoleUsers.map((u) => u.id);
      }

    } else if (recipient_type === 'all_staff') {
      // Fetch all active users
      const { data: allUsers, error: allError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, is_placeholder');

      if (allError) throw allError;

      const visibleAllUsers = await filterHiddenSystemTestAccountProfiles(admin, allUsers || []);
      recipientUserIds = visibleAllUsers.map(u => u.id);
    }

    if (recipientUserIds.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
    }

    // Set priority based on type. Notifications remain low priority and dismissible.
    const priority: StoredMessagePriority = type === 'TOOLBOX_TALK'
      ? (requestedPriority as StoredMessagePriority | undefined) || 'HIGH'
      : 'LOW';
    const acceptanceDelayMinutes = priority === 'URGENT' ? requestedAcceptanceDelayMinutes : 0;

    if (priority === 'URGENT' && acceptanceDelayMinutes < 1) {
      return NextResponse.json({ error: 'Urgent Toolbox Talks require an acceptance delay' }, { status: 400 });
    }

    // Handle PDF upload if present
    let pdfFilePath: string | null = null;
    if (pdfFile) {
      // Validate PDF file
      if (pdfFile.type !== 'application/pdf') {
        return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
      }

      if (pdfFile.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'PDF file size must be less than 10MB' }, { status: 400 });
      }

      // Generate safe filename
      const timestamp = Date.now();
      const sanitizedFilename = pdfFile.name
        .replace(/[^a-z0-9_.-]/gi, '_')
        .substring(0, 50);
      const fileName = `${user.id}/${timestamp}_${sanitizedFilename}`;

      // Upload to Supabase Storage
      const fileBuffer = await pdfFile.arrayBuffer();
      const { data: uploadData, error: uploadError } = await admin.storage
        .from('toolbox-talk-pdfs')
        .upload(fileName, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        console.error('PDF upload error:', uploadError);
        const message = uploadError.message || 'Failed to upload PDF file';
        const status = /bucket/i.test(message) ? 503 : 500;
        return NextResponse.json({ error: message }, { status });
      }

      pdfFilePath = uploadData.path;
    }

    // Create message with the admin client after explicit module authorization.
    // The authenticated client can be narrower than the app's effective-role access model.
    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        type: type as MessageType,
        subject,
        body: messageBody,
        priority,
        sender_id: user.id,
        created_via: getToolboxTalksCreatedVia(type as MessageType),
        module_key: 'toolbox_talks',
        pdf_file_path: pdfFilePath,
        acceptance_delay_minutes: acceptanceDelayMinutes
      })
      .select()
      .single();

    if (messageError || !message) {
      console.error('Error creating message:', messageError);
      
      // Clean up uploaded PDF if message creation failed
      if (pdfFilePath) {
        await admin.storage.from('toolbox-talk-pdfs').remove([pdfFilePath]);
      }
      
      return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
    }

    // Create message recipients
    const recipientRecords = recipientUserIds.map(userId => ({
      message_id: message.id,
      user_id: userId,
      status: 'PENDING' as const
    }));

    const { error: recipientsError } = await admin
      .from('message_recipients')
      .insert(recipientRecords);

    if (recipientsError) {
      console.error('Error creating recipients:', recipientsError);
      
      // Clean up message and PDF if recipients creation failed
      await admin.from('messages').delete().eq('id', message.id);
      if (pdfFilePath) {
        await admin.storage.from('toolbox-talk-pdfs').remove([pdfFilePath]);
      }
      
      return NextResponse.json({ error: 'Failed to assign recipients' }, { status: 500 });
    }

    // Send email notifications for Toolbox Talks only
    if (type === 'TOOLBOX_TALK') {
      // Fetch recipient profile names
      const { data: recipientProfiles, error: emailError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', recipientUserIds);

      if (!emailError && recipientProfiles) {
        // Extract email addresses
        const recipientEmails: string[] = [];

        for (const userId of recipientUserIds) {
          const { data: authUser } = await admin.auth.admin.getUserById(userId);
          if (authUser?.user?.email) {
            recipientEmails.push(authUser.user.email);
          }
        }

        if (recipientEmails.length > 0) {
          // Send emails (with batching handled inside the function)
          const emailResult = await sendToolboxTalkEmail({
            to: recipientEmails,
            senderName: profile.full_name || 'Unknown User',
            subject
          });

          console.log('Email sending result:', emailResult);
        }
      }
    }

    const response: CreateMessageResponse = {
      success: true,
      message: {
        ...message,
        sender_id: message.sender_id ?? null,
        created_at: message.created_at ?? new Date().toISOString(),
        updated_at: message.updated_at ?? message.created_at ?? new Date().toISOString(),
        deleted_at: message.deleted_at ?? null,
        created_via: message.created_via ?? 'api',
        module_key: message.module_key ?? 'toolbox_talks',
        pdf_file_path: message.pdf_file_path ?? null,
        acceptance_delay_minutes: message.acceptance_delay_minutes ?? 0,
      },
      recipients_created: recipientUserIds.length
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/messages:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages',
      additionalData: {
        endpoint: '/api/messages',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

