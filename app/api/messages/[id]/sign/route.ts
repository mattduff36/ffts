import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { SignMessageResponse } from '@/types/messages';

/**
 * POST /api/messages/[id]/sign
 * Record signature for a Toolbox Talk message
 * Updates recipient status to SIGNED with signature data and timestamp
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

    // Parse request body
    const body = await request.json();
    const { signature_data } = body;

    if (!signature_data) {
      return NextResponse.json({ error: 'Signature data is required' }, { status: 400 });
    }

    // Fetch the recipient record to verify ownership and status
    const { data: recipient, error: fetchError } = await supabase
      .from('message_recipients')
      .select(`
        *,
        messages!inner(
          id,
          type,
          priority,
          acceptance_delay_minutes,
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

    // Verify this is a Toolbox Talk
    if (recipient.messages.type !== 'TOOLBOX_TALK') {
      return NextResponse.json({ 
        error: 'Only Toolbox Talk messages require signatures' 
      }, { status: 400 });
    }

    // Check if already signed
    if (recipient.status === 'SIGNED') {
      return NextResponse.json({ 
        error: 'This message has already been signed' 
      }, { status: 400 });
    }

    if (recipient.messages.priority === 'URGENT') {
      const delayMinutes = recipient.messages.acceptance_delay_minutes || 0;
      const firstShownAt = recipient.first_shown_at ? new Date(recipient.first_shown_at).getTime() : NaN;
      const elapsedMs = Number.isFinite(firstShownAt) ? Date.now() - firstShownAt : 0;
      const requiredMs = delayMinutes * 60 * 1000;

      if (requiredMs > 0 && elapsedMs < requiredMs) {
        const remainingSeconds = Math.ceil((requiredMs - elapsedMs) / 1000);
        return NextResponse.json(
          {
            error: 'This urgent Toolbox Talk cannot be signed yet',
            remaining_seconds: remainingSeconds,
          },
          { status: 409 }
        );
      }
    }

    // Update recipient status to SIGNED
    const { data: updatedRecipient, error: updateError } = await supabase
      .from('message_recipients')
      .update({
        status: 'SIGNED',
        signature_data,
        signed_at: new Date().toISOString(),
        first_shown_at: recipient.first_shown_at || new Date().toISOString()
      })
      .eq('id', recipientId)
      .select()
      .single();

    if (updateError || !updatedRecipient) {
      console.error('Error updating recipient:', updateError);
      return NextResponse.json({ 
        error: 'Failed to record signature' 
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
    console.error('Error in POST /api/messages/[id]/sign:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/[id]/sign',
      additionalData: {
        endpoint: '/api/messages/[id]/sign',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

