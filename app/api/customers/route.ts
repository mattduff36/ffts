import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getPermissionMapForUser } from '@/lib/server/team-permissions';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import {
  attachSecondaryContacts,
  fetchSecondaryContactsByCustomerId,
  normalizeCustomerPayload,
  replaceCustomerSecondaryContacts,
} from '@/lib/server/customer-contacts';

interface EffectiveRoleSnapshot {
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_super_admin: boolean;
  is_actual_super_admin: boolean;
  is_viewing_as: boolean;
}

function hasFullCustomerAccess(effectiveRole: EffectiveRoleSnapshot): boolean {
  return (
    effectiveRole.is_super_admin
    || effectiveRole.role_name === 'admin'
    || effectiveRole.role_class === 'admin'
    || (effectiveRole.is_actual_super_admin && !effectiveRole.is_viewing_as)
  );
}

async function canReadCustomersModule(): Promise<{ allowed: boolean } | null> {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return null;
  }

  const effectiveRole = await getEffectiveRole();
  if (hasFullCustomerAccess(effectiveRole)) {
    return { allowed: true };
  }

  const permissions = await getPermissionMapForUser(
    current.profile.id,
    effectiveRole.role_id,
    createAdminClient(),
    effectiveRole.team_id,
    { includeUserOverrides: effectiveRole.is_viewing_as !== true }
  );

  return { allowed: permissions.customers === true };
}

export async function GET(request: NextRequest) {
  try {
    const access = await canReadCustomersModule();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('customers');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 500);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('customers')
      .select('*')
      .order('company_name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const customers = data || [];
    const contactsByCustomerId = await fetchSecondaryContactsByCustomerId(
      admin,
      customers.map(customer => customer.id)
    );

    return NextResponse.json({
      customers: attachSecondaryContacts(customers, contactsByCustomerId),
      pagination: {
        offset,
        limit,
        has_more: customers.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
      .insert({
        ...normalized.customer,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;
    await replaceCustomerSecondaryContacts(supabase, data.id, normalized.secondaryContacts, user.id);
    const contactsByCustomerId = await fetchSecondaryContactsByCustomerId(supabase, [data.id]);

    return NextResponse.json({
      customer: {
        ...data,
        secondary_contacts: contactsByCustomerId.get(data.id) || [],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
