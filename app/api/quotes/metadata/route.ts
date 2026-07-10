import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';
import { listQuoteManagerOptions } from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

export async function GET(request: NextRequest) {
  try {
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

    const includeCustomers = request.nextUrl.searchParams.get('include_customers') === 'true';
    const admin = createAdminClient();
    const customersPromise = includeCustomers
      ? admin
        .from('customers')
        .select(`
          id,
          company_name,
          short_name,
          contact_name,
          contact_email,
          address_line_1,
          address_line_2,
          city,
          county,
          postcode,
          default_validity_days,
          secondary_contacts:customer_contacts(*)
        `)
        .order('company_name', { ascending: true })
      : Promise.resolve({ data: [], error: null });

    const [managerOptions, approversResult, customersResult] = await Promise.all([
      listQuoteManagerOptions(),
      admin
        .from('profiles')
        .select('id, full_name, employee_id, is_placeholder')
        .order('full_name'),
      customersPromise,
    ]);

    if (approversResult.error) {
      throw approversResult.error;
    }
    if (customersResult.error) {
      throw customersResult.error;
    }

    const approvers = await filterHiddenSystemTestAccountProfiles(admin, approversResult.data || []);

    const metadata = {
      managerOptions,
      approvers: approvers.map(approver => ({
        ...approver,
        email: null,
      })),
    };

    return NextResponse.json(includeCustomers
      ? { ...metadata, customers: customersResult.data || [] }
      : metadata);
  } catch (error) {
    console.error('Error fetching quote metadata:', error);
    return NextResponse.json({ error: 'Unable to load quote settings right now.' }, { status: 500 });
  }
}
