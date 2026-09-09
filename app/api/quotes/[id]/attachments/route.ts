import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildQuoteAttachmentStoragePath } from '@/app/(dashboard)/quotes/quote-attachment-client';
import { appendQuoteTimelineEvent, fetchQuoteBundle } from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

function isDuplicateStorageError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as { message?: unknown; statusCode?: unknown } : null;
  const message = String(record?.message || '');
  const statusCode = String(record?.statusCode || '');
  return statusCode === '409' || /duplicate|already exists/i.test(message);
}

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

    const fileBuffer = await file.arrayBuffer();
    const contentSha256 = createHash('sha256').update(Buffer.from(fileBuffer)).digest('hex');
    const filePath = buildQuoteAttachmentStoragePath(id, file.name, contentSha256);

    const existingResult = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', id)
      .eq('file_path', filePath)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (existingResult.data) {
      return NextResponse.json({ attachment: existingResult.data, replayed: true }, { status: 200 });
    }

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('quote-attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError && !isDuplicateStorageError(uploadError)) {
      throw uploadError;
    }

    const storedPath = uploadData?.path || filePath;
    const { data: attachment, error: insertError } = await supabase
      .from('quote_attachments')
      .insert({
        quote_id: id,
        file_name: file.name,
        file_path: storedPath,
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by: user.id,
        is_client_visible: isClientVisible,
        attachment_purpose: attachmentPurpose,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const replayed = await supabase
          .from('quote_attachments')
          .select('*')
          .eq('quote_id', id)
          .eq('file_path', storedPath)
          .maybeSingle();
        if (replayed.error) throw replayed.error;
        if (replayed.data) {
          return NextResponse.json({ attachment: replayed.data, replayed: true }, { status: 200 });
        }
      }
      if (uploadData?.path) {
        await supabase.storage.from('quote-attachments').remove([uploadData.path]);
      }
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
