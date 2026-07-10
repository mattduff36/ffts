import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import {
  fetchSecondaryContactsByCustomerId,
  normalizeCustomerPayload,
  replaceCustomerSecondaryContacts,
} from '@/lib/server/customer-contacts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('customers');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }
      throw error;
    }
    const contactsByCustomerId = await fetchSecondaryContactsByCustomerId(supabase, [id]);

    return NextResponse.json({
      customer: {
        ...data,
        secondary_contacts: contactsByCustomerId.get(id) || [],
      },
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('customers');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json();
    const normalized = normalizeCustomerPayload(body);

    if (Object.keys(normalized.fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: 'Please correct the highlighted fields and try again.',
          field_errors: normalized.fieldErrors,
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('customers')
      .update({ ...normalized.customer, updated_by: user.id })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await replaceCustomerSecondaryContacts(supabase, id, normalized.secondaryContacts, user.id);
    const contactsByCustomerId = await fetchSecondaryContactsByCustomerId(supabase, [id]);

    return NextResponse.json({
      customer: {
        ...data,
        secondary_contacts: contactsByCustomerId.get(id) || [],
      },
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('customers');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 });
  }
}
