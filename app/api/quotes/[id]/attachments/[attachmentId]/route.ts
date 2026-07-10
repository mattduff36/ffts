import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { appendQuoteTimelineEvent, fetchQuoteBundle } from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

interface RouteParams {
  params: Promise<{ id: string; attachmentId: string }>;
}

function buildInlineContentDisposition(fileName: string) {
  const safeFileName = fileName.replace(/["\r\n]/g, '_');
  return `inline; filename="${safeFileName}"`;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, attachmentId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    await fetchQuoteBundle(admin, id);

    const { data: attachment, error: fetchError } = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('quote_id', id)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    const { data: fileData, error: downloadError } = await admin.storage
      .from('quote-attachments')
      .download(attachment.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: 'Unable to open this attachment right now.' }, { status: 500 });
    }

    const fileBuffer = await fileData.arrayBuffer();

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': attachment.content_type || fileData.type || 'application/octet-stream',
        'Content-Disposition': buildInlineContentDisposition(attachment.file_name),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error opening quote attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to open this attachment right now.' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, attachmentId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const bundle = await fetchQuoteBundle(admin, id);
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can be changed.' }, { status: 400 });
    }

    const { data: attachment, error: fetchError } = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('quote_id', id)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from('quote_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('quote_id', id);

    if (deleteError) throw deleteError;

    await supabase.storage.from('quote-attachments').remove([attachment.file_path]);

    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      eventType: 'attachment_removed',
      title: 'Attachment removed',
      description: attachment.file_name,
      actorUserId: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to remove this attachment right now.' },
      { status: 500 }
    );
  }
}
