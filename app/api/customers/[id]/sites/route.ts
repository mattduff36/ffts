import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { normalizeCustomerSitesPayload } from '@/lib/server/customer-sites';
import { isUuid } from '@/lib/utils/uuid';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';
  return code === '42501'
    || message.includes('row-level security')
    || message.includes('permission denied');
}

function permissionDeniedResponse() {
  return NextResponse.json(
    { error: 'You do not have permission to add a site for this customer.' },
    { status: 403 }
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('customers');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    if (!isUuid(id)) {
      return NextResponse.json({ error: 'A valid customer id is required.' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Enter valid site details.' }, { status: 400 });
    }

    const normalized = normalizeCustomerSitesPayload(body);
    if (Object.keys(normalized.fieldErrors).length > 0 || normalized.sites.length !== 1) {
      return NextResponse.json(
        {
          error: normalized.sites.length === 1
            ? 'Please correct the highlighted fields and try again.'
            : 'Add one site at a time.',
          field_errors: normalized.fieldErrors,
        },
        { status: 400 }
      );
    }

    const siteInput = normalized.sites[0];
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (customerError) {
      if (isPermissionDenied(customerError)) return permissionDeniedResponse();
      throw customerError;
    }
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const { data: site, error: insertError } = await supabase
      .from('customer_sites')
      .insert({
        customer_id: id,
        site_name: siteInput.site_name,
        address_line_1: siteInput.address_line_1,
        address_line_2: siteInput.address_line_2,
        city: siteInput.city,
        county: siteInput.county,
        postcode: siteInput.postcode,
        is_active: true,
        is_default: false,
        notes: siteInput.notes,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('*')
      .single();

    if (insertError) {
      if (isPermissionDenied(insertError)) return permissionDeniedResponse();
      throw insertError;
    }

    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    if (isPermissionDenied(error)) return permissionDeniedResponse();
    console.error('Error creating customer site:', error);
    return NextResponse.json({ error: 'Failed to create customer site' }, { status: 500 });
  }
}
