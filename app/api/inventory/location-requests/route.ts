import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createInventoryLocationRequestNotification } from '@/lib/server/inventory-notifications';

interface CreateLocationRequestBody {
  suggested_name?: string;
  note?: string | null;
}

export async function GET() {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_location_requests')
      .select(`
        *,
        requester:profiles!inventory_location_requests_requester_id_fkey(id, full_name),
        resolved_location:inventory_locations(id, name)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({ requests: data || [] });
  } catch (error) {
    console.error('Error fetching inventory location requests:', error);
    return NextResponse.json({ error: 'Failed to fetch location requests' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as CreateLocationRequestBody;
    const suggestedName = body.suggested_name?.trim();
    const note = body.note?.trim() || null;

    if (!suggestedName) {
      return NextResponse.json({ error: 'Suggested location name is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: existingLocation, error: existingLocationError } = await admin
      .from('inventory_locations')
      .select('id, name')
      .eq('is_active', true)
      .ilike('name', suggestedName)
      .maybeSingle();

    if (existingLocationError) throw existingLocationError;
    if (existingLocation) {
      return NextResponse.json(
        { error: `${existingLocation.name} already exists. Please select it from the location dropdown.` },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from('inventory_location_requests')
      .insert({
        suggested_name: suggestedName,
        note,
        requester_id: access.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'You already have a pending request for this location' }, { status: 400 });
      }
      throw error;
    }

    await createInventoryLocationRequestNotification(admin, {
      requestId: data.id,
      suggestedName,
      note,
      requesterId: access.userId,
    });

    return NextResponse.json({ request: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory location request:', error);
    return NextResponse.json({ error: 'Failed to create location request' }, { status: 500 });
  }
}
