import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { SignMessageResponse } from '@/types/messages';

/**
 * POST /api/messages/[id]/dismiss
 * Dismiss a Reminder message (mark as shown/dismissed)
 * Updates recipient status to DISMISSED
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipientId } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch the recipient record to verify ownership
    const { data: recipient, error: fetchError } = await supabase
      .from('message_recipients')
      .select(`
        *,
        messages!inner(
          id,
          type,
          deleted_at
        )
      `)
      .eq('id', recipientId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !recipient) {
      return NextResponse.json({ 
        error: 'Message recipient not found or unauthorized' 
      }, { status: 404 });
    }

    // Check if message has been deleted
    if (recipient.messages.deleted_at) {
      return NextResponse.json({ 
        error: 'This message has been deleted' 
      }, { status: 410 });
    }

    // Verify this is a Reminder or Notification (both use the dismiss flow)
    if (recipient.messages.type !== 'REMINDER' && recipient.messages.type !== 'NOTIFICATION') {
      return NextResponse.json({ 
        error: 'Only Reminder and Notification messages can be dismissed' 
      }, { status: 400 });
    }

    // Update recipient status to DISMISSED
    const { data: updatedRecipient, error: updateError } = await supabase
      .from('message_recipients')
      .update({
        status: 'DISMISSED',
        first_shown_at: recipient.first_shown_at || new Date().toISOString()
      })
      .eq('id', recipientId)
      .select()
      .single();

    if (updateError || !updatedRecipient) {
      console.error('Error updating recipient:', updateError);
      return NextResponse.json({ 
        error: 'Failed to dismiss message' 
      }, { status: 500 });
    }

    const response: SignMessageResponse = {
      success: true,
      recipient: {
        ...updatedRecipient,
        message_id: updatedRecipient.message_id ?? recipient.message_id ?? '',
        user_id: updatedRecipient.user_id ?? user.id,
        created_at: updatedRecipient.created_at ?? '',
        updated_at: updatedRecipient.updated_at ?? '',
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/messages/[id]/dismiss:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/[id]/dismiss',
      additionalData: {
        endpoint: '/api/messages/[id]/dismiss',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

