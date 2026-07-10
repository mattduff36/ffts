import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { renderToBuffer } from '@react-pdf/renderer';
import { RAMSExportDocument } from '@/lib/pdf/RAMSExportDocument';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
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

    const canExportRams = await canEffectiveRoleAccessModule('rams');
    if (!canExportRams) {
      return NextResponse.json(
        { error: 'RAMS access required to export documents' },
        { status: 403 }
      );
    }

    // Fetch document
    const { data: document, error: docError } = await db
      .from('rams_documents')
      .select(`
        *,
        uploader:profiles!rams_documents_uploaded_by_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Fetch employee assignments with signatures
    const { data: assignments, error: assignError } = await db
      .from('rams_assignments')
      .select(`
        *,
        employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
      `)
      .eq('rams_document_id', id)
      .order('signed_at', { ascending: false });

    if (assignError) {
      console.error('Error fetching assignments:', assignError);
      return NextResponse.json(
        { error: 'Failed to fetch assignments' },
        { status: 500 }
      );
    }

    // Fetch visitor signatures
    const { data: visitorSignatures, error: visitorError } = await db
      .from('rams_visitor_signatures')
      .select(`
        *,
        recorder:profiles!rams_visitor_signatures_recorded_by_fkey(full_name)
      `)
      .eq('rams_document_id', id)
      .order('signed_at', { ascending: false });

    if (visitorError) {
      console.error('Error fetching visitor signatures:', visitorError);
      return NextResponse.json(
        { error: 'Failed to fetch visitor signatures' },
        { status: 500 }
      );
    }

    const logoUrl = await loadTemplateLogoDataUrl();
    if (!logoUrl) {
      throw new Error('Configured branding logo could not be loaded');
    }

    // Generate PDF
    const typedDocument = document as ({
      id: string;
      title: string;
      description: string | null;
      file_name: string;
      file_size: number;
      file_type: string;
      created_at: string;
      uploader?: { full_name?: string | null } | null;
    } & Record<string, unknown>);
    const pdfDocument = RAMSExportDocument({
      document: {
        id: typedDocument.id,
        title: typedDocument.title,
        description: typedDocument.description,
        file_name: typedDocument.file_name,
        file_size: typedDocument.file_size,
        file_type: typedDocument.file_type,
        created_at: typedDocument.created_at,
        uploader_name: typedDocument.uploader?.full_name || 'Unknown',
      },
      assignments: assignments || [],
      visitorSignatures: visitorSignatures || [],
      logoUrl,
    });

    const pdfBuffer = await renderToBuffer(pdfDocument);

    // Return PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${typedDocument.title.replace(/[^a-z0-9]/gi, '_')}_signatures.pdf"`,
      },
    });
  } catch (error) {
    console.error('Unexpected error in export:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/rams/[id]/export',
      additionalData: {
        endpoint: '/api/rams/[id]/export',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

