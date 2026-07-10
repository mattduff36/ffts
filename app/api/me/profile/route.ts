import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

function isValidAvatarUrl(value: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  try {
    const avatarUrl = new URL(value);
    const expectedOrigin = new URL(supabaseUrl).origin;
    const expectedPathPrefix = '/storage/v1/object/public/user-avatars/';

    return avatarUrl.origin === expectedOrigin && avatarUrl.pathname.startsWith(expectedPathPrefix);
  } catch {
    return false;
  }
}

function normalizeOptionalProfileText(
  value: string | null | undefined,
  maxLength: number,
  fieldLabel: string
): string | null | NextResponse {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maxLength) {
    return NextResponse.json({ error: `${fieldLabel} is too long` }, { status: 400 });
  }
  return normalized;
}

async function getCurrentUserProfile(userId: string, email: string | null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      full_name,
      phone_number,
      employee_id,
      avatar_url,
      must_change_password,
      annual_holiday_allowance_days,
      super_admin,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_relationship,
      secondary_emergency_contact_name,
      secondary_emergency_contact_phone,
      secondary_emergency_contact_relationship,
      employer_profile_notes,
      team:org_teams!profiles_team_id_fkey(id, name),
      role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)
    `)
    .eq('id', userId)
    .single();

  if (error) throw error;

  const teamValue = Array.isArray(data.team) ? data.team[0] || null : data.team || null;
  const roleValue = Array.isArray(data.role) ? data.role[0] || null : data.role || null;

  return {
    ...data,
    team: teamValue,
    role: roleValue,
    email,
  };
}

export async function GET() {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const response = NextResponse.json({
      success: true,
      prd_epic_id: PROFILE_HUB_PRD_EPIC_ID,
      profile: current.profile,
      can_edit_basic_fields: canEditOwnBasicProfileFields(current.profile),
    });
    applyValidationCookieIfNeeded(response, current.validation);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load profile' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      full_name?: string;
      phone_number?: string | null;
      avatar_url?: string | null;
      emergency_contact_name?: string | null;
      emergency_contact_phone?: string | null;
      emergency_contact_relationship?: string | null;
      secondary_emergency_contact_name?: string | null;
      secondary_emergency_contact_phone?: string | null;
      secondary_emergency_contact_relationship?: string | null;
      employer_profile_notes?: string | null;
    };

    const currentProfile = current.profile;
    const canEditBasics = canEditOwnBasicProfileFields(currentProfile);
    const nextValues: Record<string, string | null> = {};

    if (body.full_name !== undefined || body.phone_number !== undefined) {
      if (!canEditBasics) {
        return NextResponse.json(
          { error: 'You do not have permission to edit basic profile fields' },
          { status: 403 }
        );
      }
    }

    if (body.full_name !== undefined) {
      const normalizedName = body.full_name.trim();
      if (!normalizedName) {
        return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
      }
      if (normalizedName.length > 120) {
        return NextResponse.json({ error: 'Full name is too long' }, { status: 400 });
      }
      nextValues.full_name = normalizedName;
    }

    if (body.phone_number !== undefined) {
      const normalizedPhone = body.phone_number?.trim() || null;
      if (normalizedPhone && normalizedPhone.length > 50) {
        return NextResponse.json({ error: 'Phone number is too long' }, { status: 400 });
      }
      nextValues.phone_number = normalizedPhone;
    }

    if (body.avatar_url !== undefined) {
      if (body.avatar_url && !isValidAvatarUrl(body.avatar_url)) {
        return NextResponse.json({ error: 'Invalid avatar URL' }, { status: 400 });
      }
      nextValues.avatar_url = body.avatar_url || null;
    }

    const employerDetailFields = [
      ['emergency_contact_name', 'Emergency contact name', 120],
      ['emergency_contact_phone', 'Emergency contact phone', 50],
      ['emergency_contact_relationship', 'Emergency contact relationship', 80],
      ['secondary_emergency_contact_name', 'Secondary emergency contact name', 120],
      ['secondary_emergency_contact_phone', 'Secondary emergency contact phone', 50],
      ['secondary_emergency_contact_relationship', 'Secondary emergency contact relationship', 80],
      ['employer_profile_notes', 'Additional information', 500],
    ] as const;

    for (const [key, label, maxLength] of employerDetailFields) {
      if (body[key] === undefined) continue;
      const normalized = normalizeOptionalProfileText(body[key], maxLength, label);
      if (normalized instanceof NextResponse) {
        return normalized;
      }
      nextValues[key] = normalized;
    }

    const keysToUpdate = Object.keys(nextValues);
    if (keysToUpdate.length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from('profiles')
      .update(nextValues)
      .eq('id', current.profile.id);

    if (updateError) throw updateError;

    const profile = await getCurrentUserProfile(current.profile.id, current.profile.email || null);

    const response = NextResponse.json({
      success: true,
      prd_epic_id: PROFILE_HUB_PRD_EPIC_ID,
      profile,
      can_edit_basic_fields: canEditOwnBasicProfileFields(profile),
    });
    applyValidationCookieIfNeeded(response, current.validation);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update profile' },
      { status: 500 }
    );
  }
}

