import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipientId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: recipient, error: fetchError } = await supabase
      .from('message_recipients')
      .select(`
        *,
        messages!inner(
          id,
          type,
          priority,
          deleted_at
        )
      `)
      .eq('id', recipientId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !recipient) {
      return NextResponse.json({ error: 'Message recipient not found or unauthorized' }, { status: 404 });
    }

    if (recipient.messages.deleted_at) {
      return NextResponse.json({ error: 'This message has been deleted' }, { status: 410 });
    }

    if (recipient.messages.type !== 'TOOLBOX_TALK' || recipient.messages.priority !== 'LOW') {
      return NextResponse.json({ error: 'Only low priority Toolbox Talks can be read later' }, { status: 400 });
    }

    if (recipient.status === 'SIGNED') {
      return NextResponse.json({ error: 'This message has already been signed' }, { status: 400 });
    }

    const { data: updatedRecipient, error: updateError } = await supabase
      .from('message_recipients')
      .update({
        status: 'SHOWN',
        first_shown_at: recipient.first_shown_at || new Date().toISOString(),
      })
      .eq('id', recipientId)
      .select()
      .single();

    if (updateError || !updatedRecipient) {
      return NextResponse.json({ error: 'Failed to defer message' }, { status: 500 });
    }

    return NextResponse.json({ success: true, recipient: updatedRecipient });
  } catch (error) {
    console.error('Error in POST /api/messages/[id]/defer:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/[id]/defer',
      additionalData: {
        endpoint: '/api/messages/[id]/defer',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
