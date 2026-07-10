import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { appendQuoteTimelineEvent, fetchQuoteBundle } from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { data, error } = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ attachments: data || [] });
  } catch (error) {
    console.error('Error fetching quote attachments:', error);
    return NextResponse.json({ error: 'Unable to load attachments right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    const formData = await request.formData();
    const file = formData.get('file');
    const isClientVisible = formData.get('is_client_visible') === 'true';
    const requestedAttachmentPurpose = String(formData.get('attachment_purpose') || (isClientVisible ? 'client_supporting' : 'internal'));
    const attachmentPurpose = ['internal', 'client_pricing', 'client_supporting'].includes(requestedAttachmentPurpose)
      ? requestedAttachmentPurpose as 'internal' | 'client_pricing' | 'client_supporting'
      : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
    }

    if (!attachmentPurpose) {
      return NextResponse.json({ error: 'Unsupported attachment purpose.' }, { status: 400 });
    }

    const sanitizedFilename = file.name.replace(/[^a-z0-9_.-]/gi, '_');
    const filePath = `${id}/${Date.now()}_${sanitizedFilename}`;
    const fileBuffer = await file.arrayBuffer();

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('quote-attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: attachment, error: insertError } = await supabase
      .from('quote_attachments')
      .insert({
        quote_id: id,
        file_name: file.name,
        file_path: uploadData.path,
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by: user.id,
        is_client_visible: isClientVisible,
        attachment_purpose: attachmentPurpose,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from('quote-attachments').remove([uploadData.path]);
      throw insertError;
    }

    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      eventType: 'attachment_uploaded',
      title: 'Attachment uploaded',
      description: file.name,
      actorUserId: user.id,
      createdAt: attachment.created_at,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('Error uploading quote attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to upload this attachment right now.' },
      { status: 500 }
    );
  }
}
