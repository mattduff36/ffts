import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { VanInspectionPDF } from '@/lib/pdf/van-inspection-pdf';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch inspection with items and employee details
    const { data: inspection, error: inspectionError } = await supabase
      .from('van_inspections')
      .select(`
        *,
        vehicle:vans(
          reg_number, 
          vehicle_type,
          van_categories(name)
        ),
        profile:profiles!van_inspections_user_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    // Guard: vehicle must exist with category data for PDF generation
    if (!(inspection as { vehicle?: unknown }).vehicle) {
      return NextResponse.json(
        { error: 'Vehicle data not found for this inspection. The vehicle may have been deleted.' },
        { status: 404 }
      );
    }

    // Fetch inspection items
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError) {
      await logServerError({
        error: new Error(`Failed to fetch inspection items: ${itemsError.message}`),
        request,
        componentName: '/api/van-inspections/[id]/pdf',
        additionalData: {
          inspectionId: id,
          supabaseError: {
            code: (itemsError as { code?: string }).code,
            message: itemsError.message,
            details: (itemsError as { details?: string }).details,
            hint: (itemsError as { hint?: string }).hint,
          },
        },
      });
      return NextResponse.json({ error: 'Failed to fetch inspection items' }, { status: 500 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Inspection items not found' }, { status: 404 });
    }

    // Check authorization - user must be owner, manager/admin, or supervisor
    const profile = await getProfileWithRole(user.id);

    const isOwner = (inspection as { user_id?: string | null }).user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;
    const isSupervisor = (profile?.role?.name || '').trim().toLowerCase() === 'supervisor';

    if (!isOwner && !isManager && !isSupervisor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    type InspectionWithVehicle = {
      vehicle?: { van_categories?: { name: string } | null; vehicle_type?: string | null; reg_number?: string | null };
      profile?: { full_name?: string | null };
    };
    const pdfComponent = VanInspectionPDF({
      inspection: {
        ...inspection,
        van_id: inspection.van_id ?? '',
        status: inspection.status ?? 'draft',
        inspection_end_date: inspection.inspection_end_date ?? inspection.inspection_date,
        created_at: inspection.created_at ?? '',
        updated_at: inspection.updated_at ?? '',
      },
      items: items.map((item) => ({
        ...item,
        item_description: item.item_description || `Item ${item.item_number}`,
        status: item.status as 'ok' | 'attention' | 'defect' | 'na',
        created_at: item.created_at ?? '',
      })),
      vehicleReg: (inspection as InspectionWithVehicle).vehicle?.reg_number || 'Unknown',
      employeeName: (inspection as InspectionWithVehicle).profile?.full_name || 'Unknown',
    });
    
    const stream = await renderToStream(pdfComponent);

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inspection-${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/van-inspections/[id]/pdf',
      additionalData: {
        endpoint: '/api/van-inspections/[id]/pdf',
      },
    });
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

