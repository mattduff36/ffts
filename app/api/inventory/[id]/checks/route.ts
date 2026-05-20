import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { CHECK_INTERVAL_DAYS } from '@/app/(dashboard)/inventory/utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CreateInventoryCheckBody {
  checked_at?: string;
  note?: string | null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as CreateInventoryCheckBody;
    const checkedAt = body.checked_at?.trim() || new Date().toISOString().slice(0, 10);

    const admin = createAdminClient();
    const { data: item, error: itemError } = await admin
      .from('inventory_items')
      .select('id, check_interval_days, last_checked_at')
      .eq('id', id)
      .single();

    if (itemError) {
      if (itemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw itemError;
    }

    const intervalDays = item.check_interval_days || CHECK_INTERVAL_DAYS;
    const { data: check, error: checkError } = await admin
      .from('inventory_check_history')
      .insert({
        item_id: id,
        checked_at: checkedAt,
        interval_days: intervalDays,
        note: body.note?.trim() || null,
        checked_by: access.userId,
      })
      .select('*')
      .single();

    if (checkError) throw checkError;

    const shouldPromoteLastCheckedAt = !item.last_checked_at || checkedAt >= item.last_checked_at;
    if (shouldPromoteLastCheckedAt) {
      const { error: updateError } = await admin
        .from('inventory_items')
        .update({
          last_checked_at: checkedAt,
          updated_by: access.userId,
        })
        .eq('id', id);

      if (updateError) throw updateError;
    }

    return NextResponse.json({ check }, { status: 201 });
  } catch (error) {
    console.error('Error recording inventory check:', error);
    return NextResponse.json({ error: 'Failed to record inventory check' }, { status: 500 });
  }
}
