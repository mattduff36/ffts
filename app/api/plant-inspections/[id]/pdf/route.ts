import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { PlantInspectionPDF } from '@/lib/pdf/plant-inspection-pdf';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

interface PlantInspectionWithRelations {
  id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  inspector_comments: string | null;
  signature_data: string | null;
  signed_at: string | null;
  is_hired_plant: boolean;
  hired_plant_id_serial: string | null;
  hired_plant_description: string | null;
  hired_plant_hiring_company: string | null;
  plant?: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    van_categories: { name: string } | null;
  } | null;
  profile?: {
    full_name: string;
  } | null;
}

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

    // Fetch inspection with plant and employee details
    const { data: inspection, error: inspectionError } = await supabase
      .from('plant_inspections')
      .select(`
        *,
        plant (
          plant_id,
          nickname,
          serial_number,
          van_categories(name)
        ),
        profile:profiles!plant_inspections_user_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Plant inspection not found' }, { status: 404 });
    }

    // Fetch inspection items
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError) {
      console.error('Items error:', itemsError);
      return NextResponse.json({ error: 'Failed to fetch inspection items', details: itemsError.message }, { status: 500 });
    }

    if (!items || items.length === 0) {
      console.error('No items found for inspection:', id);
      return NextResponse.json({ error: 'Inspection items not found' }, { status: 404 });
    }

    // Fetch daily hours
    const { data: dailyHours, error: hoursError } = await supabase
      .from('inspection_daily_hours')
      .select('*')
      .eq('inspection_id', id)
      .order('day_of_week', { ascending: true });

    if (hoursError) {
      console.error('Daily hours error:', hoursError);
      return NextResponse.json({ error: 'Failed to fetch daily hours', details: hoursError.message }, { status: 500 });
    }

    // Check authorization - user must be owner, manager/admin, or supervisor
    const profile = await getProfileWithRole(user.id);

    const isOwner = inspection.user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;
    const isSupervisor = (profile?.role?.name || '').trim().toLowerCase() === 'supervisor';

    if (!isOwner && !isManager && !isSupervisor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const inspectionWithRelations = inspection as unknown as PlantInspectionWithRelations;
    const isHired = inspectionWithRelations.is_hired_plant === true;

    // Generate PDF
    const pdfComponent = PlantInspectionPDF({
      inspection: {
        id: inspectionWithRelations.id,
        inspection_date: inspectionWithRelations.inspection_date,
        inspection_end_date: inspectionWithRelations.inspection_end_date,
        current_mileage: inspectionWithRelations.current_mileage,
        inspector_comments: inspectionWithRelations.inspector_comments,
        signature_data: inspectionWithRelations.signature_data,
        signed_at: inspectionWithRelations.signed_at,
      },
      plant: isHired
        ? {
            plant_id: inspectionWithRelations.hired_plant_id_serial || 'Unknown',
            nickname: inspectionWithRelations.hired_plant_description || null,
            serial_number: null,
            van_categories: null,
            isHired: true,
            hiringCompany: inspectionWithRelations.hired_plant_hiring_company || null,
          }
        : {
            plant_id: inspectionWithRelations.plant?.plant_id || 'Unknown',
            nickname: inspectionWithRelations.plant?.nickname || null,
            serial_number: inspectionWithRelations.plant?.serial_number || null,
            van_categories: inspectionWithRelations.plant?.van_categories || null,
          },
      operator: {
        full_name: inspectionWithRelations.profile?.full_name || 'Unknown',
      },
      items: items.map(item => ({
        item_number: item.item_number,
        item_description: item.item_description || `Item ${item.item_number}`,
        day_of_week: item.day_of_week,
        status: item.status as 'ok' | 'attention' | 'na',
        comments: item.comments,
      })),
      dailyHours: (dailyHours || []).map(h => ({
        day_of_week: h.day_of_week,
        hours: h.hours,
      })),
    });
    
    const stream = await renderToStream(pdfComponent);

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const plantId = isHired
      ? (inspectionWithRelations.hired_plant_id_serial || 'hired').replace(/[^a-zA-Z0-9-_]/g, '')
      : (inspectionWithRelations.plant?.plant_id || 'unknown');
    const date = inspectionWithRelations.inspection_end_date.replace(/-/g, '');

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="plant-inspection-${plantId}-${date}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/plant-inspections/[id]/pdf',
      additionalData: {
        endpoint: '/api/plant-inspections/[id]/pdf',
      },
    });
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
