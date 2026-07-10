import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  listQuoteManagerOptions,
  listQuoteUserNotificationRecipientOptions,
} from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';

async function requireQuoteSettingsContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: 'You must be signed in to use quote settings.' }, { status: 401 }),
      userId: null,
      canManage: false,
    };
  }

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
  if (sensitiveAccessResponse) {
    return { response: sensitiveAccessResponse, userId: user.id, canManage: false };
  }

  const canManage = await isEffectiveRoleAdminOrSuper();
  return { response: null, userId: user.id, canManage };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizePayload(body: Record<string, unknown>) {
  const profileId = normalizeOptionalString(body.profile_id);
  const initials = normalizeOptionalString(body.initials)?.toUpperCase() || '';
  const numberStart = normalizeRequiredInteger(body.number_start);
  const nextNumber = normalizeRequiredInteger(body.next_number);

  return {
    profile_id: profileId,
    initials,
    number_start: numberStart,
    next_number: nextNumber,
    signoff_name: normalizeOptionalString(body.signoff_name),
    signoff_title: normalizeOptionalString(body.signoff_title),
    manager_email: normalizeOptionalString(body.manager_email),
    approver_profile_id: normalizeOptionalString(body.approver_profile_id),
    is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
  };
}

async function getManagerAuthEmail(admin: ReturnType<typeof createAdminClient>, profileId: string | null) {
  if (!profileId) return null;

  const { data, error } = await admin.auth.admin.getUserById(profileId);
  if (error) throw error;

  return normalizeOptionalString(data.user?.email);
}

async function getManagerSeriesPayload(admin: ReturnType<typeof createAdminClient>, canManage: boolean) {
  const [managerOptions, quoteUsers, approversResult] = await Promise.all([
    listQuoteManagerOptions(),
    listQuoteUserNotificationRecipientOptions(admin),
    admin
      .from('profiles')
      .select('id, full_name, employee_id, is_placeholder')
      .order('full_name'),
  ]);

  if (approversResult.error) throw approversResult.error;
  const approvers = await filterHiddenSystemTestAccountProfiles(admin, approversResult.data || []);

  return {
    can_manage: canManage,
    manager_options: managerOptions,
    quote_users: quoteUsers,
    approvers: approvers.map(approver => ({
      id: approver.id,
      full_name: approver.full_name,
      email: null,
    })),
  };
}

async function applyManagerDefaultsToBlankOpenQuotes(
  admin: ReturnType<typeof createAdminClient>,
  payload: ReturnType<typeof normalizePayload>,
  actorUserId: string
) {
  if (payload.manager_email) {
    const { error } = await admin
      .from('quotes')
      .update({ manager_email: payload.manager_email, updated_by: actorUserId })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .eq('requester_id', payload.profile_id);
    if (error) throw error;
  }

  if (payload.signoff_name) {
    const { error } = await admin
      .from('quotes')
      .update({ signoff_name: payload.signoff_name, updated_by: actorUserId })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .eq('requester_id', payload.profile_id)
      .is('signoff_name', null);
    if (error) throw error;
  }

  if (payload.signoff_title) {
    const { error } = await admin
      .from('quotes')
      .update({ signoff_title: payload.signoff_title, updated_by: actorUserId })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .eq('requester_id', payload.profile_id)
      .is('signoff_title', null);
    if (error) throw error;
  }

  if (payload.approver_profile_id) {
    const { error } = await admin
      .from('quotes')
      .update({ approver_profile_id: payload.approver_profile_id, updated_by: actorUserId })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .eq('requester_id', payload.profile_id)
      .is('approver_profile_id', null);
    if (error) throw error;
  }
}

async function validateManagerPayload(admin: ReturnType<typeof createAdminClient>, payload: ReturnType<typeof normalizePayload>) {
  const fieldErrors: Record<string, string> = {};
  if (!payload.profile_id) fieldErrors.profile_id = 'Select a quote user.';
  if (!payload.initials) fieldErrors.initials = 'Enter quote initials.';
  if (payload.initials.length > 10) fieldErrors.initials = 'Initials must be 10 characters or fewer.';
  if (Number.isNaN(payload.number_start) || payload.number_start < 0) fieldErrors.number_start = 'Enter a valid starting number.';
  if (Number.isNaN(payload.next_number) || payload.next_number < 0) fieldErrors.next_number = 'Enter a valid next number.';

  const quoteUsers = await listQuoteUserNotificationRecipientOptions(admin);
  const quoteUserIds = new Set(quoteUsers.map(user => user.id));
  if (payload.profile_id && !quoteUserIds.has(payload.profile_id)) {
    fieldErrors.profile_id = 'Manager must be a user with Quotes access.';
  }

  return fieldErrors;
}

export async function GET() {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;

    const admin = createAdminClient();
    return NextResponse.json(await getManagerSeriesPayload(admin, context.canManage));
  } catch (error) {
    console.error('Error fetching quote manager settings:', error);
    return NextResponse.json({ error: 'Unable to load quote manager settings right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json({ error: 'Only admins can manage quote manager settings.' }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const payload = normalizePayload(body);
    const admin = createAdminClient();
    const fieldErrors = await validateManagerPayload(admin, payload);

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json({ error: 'Please correct the highlighted fields and try again.', field_errors: fieldErrors }, { status: 400 });
    }

    const managerAuthEmail = await getManagerAuthEmail(admin, payload.profile_id);
    if (!managerAuthEmail) {
      return NextResponse.json({
        error: 'The selected manager must have a valid login email before quote defaults can be saved.',
        field_errors: {
          manager_email: 'Manager email is taken from the selected user account.',
        },
      }, { status: 400 });
    }
    const savePayload = { ...payload, manager_email: managerAuthEmail };

    const { error } = await admin
      .from('quote_manager_series')
      .upsert({
        ...savePayload,
        profile_id: savePayload.profile_id as string,
      }, { onConflict: 'profile_id' });

    if (error) throw error;
    await applyManagerDefaultsToBlankOpenQuotes(admin, savePayload, context.userId);

    return NextResponse.json(await getManagerSeriesPayload(admin, true));
  } catch (error) {
    console.error('Error saving quote manager settings:', error);
    return NextResponse.json({ error: 'Unable to save quote manager settings right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage) {
      return NextResponse.json({ error: 'Only admins can manage quote manager settings.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profile_id');
    if (!profileId) {
      return NextResponse.json({ error: 'Manager profile id is required.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('quote_manager_series')
      .delete()
      .eq('profile_id', profileId);

    if (error) throw error;

    return NextResponse.json(await getManagerSeriesPayload(admin, true));
  } catch (error) {
    console.error('Error deleting quote manager settings:', error);
    return NextResponse.json({ error: 'Unable to delete quote manager settings right now.' }, { status: 500 });
  }
}
