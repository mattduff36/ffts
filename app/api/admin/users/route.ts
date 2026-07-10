import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateSecurePassword } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { logServerError } from '@/lib/utils/server-error-logger';
import { isMissingTeamManagerSchemaError, reconcileProfileHierarchy } from '@/lib/server/team-managers';
import { applyTemplateToProfiles } from '@/lib/server/work-shifts';
import {
  buildFinancialYearBounds,
  getFinancialYearStartYear,
  replayBulkAbsenceBatchesForProfile,
  seedRemainingFinancialYearBankHolidaysForProfiles,
} from '@/lib/services/absence-bank-holiday-sync';
import { roundToNearestHalfDay } from '@/lib/utils/absence-onboarding';

function isMissingHierarchySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  return (
    code === '42703' ||
    code === '42P01' ||
    message.includes('line_manager_id') ||
    message.includes('team_id') ||
    message.includes('column') ||
    message.includes('does not exist')
  );
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function validateHierarchyReferences(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  input: { line_manager_id?: string | null; team_id?: string | null; profile_id?: string }
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { line_manager_id, team_id, profile_id } = input;

  if (profile_id && line_manager_id && profile_id === line_manager_id) {
    return { ok: false, error: 'A user cannot be their own line manager.' };
  }

  if (line_manager_id) {
    const { data: managerRow, error: managerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role:roles(role_class)')
      .eq('id', line_manager_id)
      .single();

    if (managerError || !managerRow) {
      return { ok: false, error: 'Selected line manager does not exist.' };
    }

    const roleClass = (managerRow as { role?: { role_class?: string } | null })?.role?.role_class;
    if (roleClass !== 'manager' && roleClass !== 'admin') {
      return { ok: false, error: 'Selected line manager must have a manager/admin role.' };
    }
  }

  if (team_id) {
    const { data: teamRow, error: teamError } = await supabaseAdmin
      .from('org_teams')
      .select('id')
      .eq('id', team_id)
      .single();

    if (teamError) {
      if (isMissingHierarchySchemaError(teamError)) {
        return { ok: true, warning: 'Team validation skipped because hierarchy schema is not ready yet.' };
      }
      return { ok: false, error: 'Failed to validate selected team.' };
    }
    if (!teamRow) {
      return { ok: false, error: 'Selected team does not exist.' };
    }
  }

  return { ok: true };
}

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    // Get request body
    const body = await request.json();
    const {
      email,
      full_name,
      phone_number,
      employee_id,
      role_id,
      line_manager_id,
      team_id,
      work_shift_template_id,
      annual_allowance_days,
      remaining_leave_days,
      auto_book_bank_holidays,
      auto_apply_bulk_bookings,
      selected_bulk_batch_ids,
    } = body as {
      email?: string;
      full_name?: string;
      phone_number?: string | null;
      employee_id?: string | null;
      role_id?: string;
      line_manager_id?: string | null;
      team_id?: string | null;
      work_shift_template_id?: string;
      annual_allowance_days?: number;
      remaining_leave_days?: number;
      auto_book_bank_holidays?: boolean;
      auto_apply_bulk_bookings?: boolean;
      selected_bulk_batch_ids?: string[];
    };

    // Validate required fields (password is now auto-generated)
    if (!email || !full_name) {
      return NextResponse.json(
        { error: 'Email and full name are required' },
        { status: 400 }
      );
    }

    // Validate role_id
    if (!role_id) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    const normalizedTeamId = typeof team_id === 'string' ? team_id.trim() : '';
    if (!normalizedTeamId) {
      return NextResponse.json({ error: 'Team is required' }, { status: 400 });
    }

    const normalizedTemplateId = typeof work_shift_template_id === 'string' ? work_shift_template_id.trim() : '';
    if (!normalizedTemplateId) {
      return NextResponse.json({ error: 'Work shift template is required' }, { status: 400 });
    }

    if (!Number.isFinite(annual_allowance_days)) {
      return NextResponse.json({ error: 'Total annual leave allowance is required' }, { status: 400 });
    }

    if (!Number.isFinite(remaining_leave_days)) {
      return NextResponse.json({ error: 'Remaining annual leave is required' }, { status: 400 });
    }

    if (typeof auto_book_bank_holidays !== 'boolean') {
      return NextResponse.json({ error: 'Auto-book bank holidays decision is required' }, { status: 400 });
    }

    if (typeof auto_apply_bulk_bookings !== 'boolean') {
      return NextResponse.json({ error: 'Bulk absence selection decision is required' }, { status: 400 });
    }

    if (!Array.isArray(selected_bulk_batch_ids)) {
      return NextResponse.json({ error: 'Bulk absence selection payload is required' }, { status: 400 });
    }
    const normalizedBulkBatchIds = Array.from(new Set(selected_bulk_batch_ids.filter(Boolean)));
    if (auto_apply_bulk_bookings && normalizedBulkBatchIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one bulk absence booking when auto-apply is enabled' },
        { status: 400 }
      );
    }

    const normalizedAnnualAllowanceDays = Number(annual_allowance_days);
    const normalizedRemainingLeaveDays = roundToNearestHalfDay(Number(remaining_leave_days));

    // Validate role_id is a valid UUID and exists in database
    const supabaseAdmin = getSupabaseAdmin();
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .eq('id', role_id)
      .single();

    if (roleError || !roleData) {
      console.error('Invalid role_id:', role_id, roleError);
      return NextResponse.json({ 
        error: 'Invalid role selected. Please select a valid role.',
        details: roleError?.message || 'Role not found'
      }, { status: 400 });
    }

    const canAssignRequestedRole = await canEffectiveRoleAssignRole(role_id);
    if (!canAssignRequestedRole) {
      return NextResponse.json(
        { error: 'Forbidden: you cannot assign this role' },
        { status: 403 }
      );
    }

    const { data: teamRow, error: teamLookupError } = await supabaseAdmin
      .from('org_teams')
      .select('id, manager_1_profile_id, manager_2_profile_id')
      .eq('id', normalizedTeamId)
      .single();

    if (teamLookupError || !teamRow) {
      return NextResponse.json({ error: 'Selected team does not exist.' }, { status: 400 });
    }

    const hasConfiguredManager = Boolean(
      (teamRow as { manager_1_profile_id?: string | null }).manager_1_profile_id ||
      (teamRow as { manager_2_profile_id?: string | null }).manager_2_profile_id
    );
    if (!hasConfiguredManager) {
      return NextResponse.json(
        { error: 'Selected team has no configured manager. Configure Manager 1 or Manager 2 first.' },
        { status: 400 }
      );
    }

    const { data: templateRow, error: templateError } = await supabaseAdmin
      .from('work_shift_templates')
      .select('id')
      .eq('id', normalizedTemplateId)
      .maybeSingle();
    if (templateError || !templateRow) {
      return NextResponse.json({ error: 'Selected work shift template does not exist.' }, { status: 400 });
    }

    const financialYearStartYear = getFinancialYearStartYear(new Date());
    const financialYearBounds = buildFinancialYearBounds(financialYearStartYear);
    const financialYearStartIso = formatIsoDate(financialYearBounds.start);
    const financialYearEndIso = formatIsoDate(financialYearBounds.end);

    if (normalizedBulkBatchIds.length > 0) {
      const { data: bulkBatchRows, error: bulkBatchError } = await supabaseAdmin
        .from('absence_bulk_batches')
        .select('id, start_date, end_date')
        .in('id', normalizedBulkBatchIds);

      if (bulkBatchError) {
        return NextResponse.json(
          { error: 'Failed to validate selected bulk absence bookings.' },
          { status: 500 }
        );
      }

      const bulkRows = (bulkBatchRows || []) as Array<{ id: string; start_date: string; end_date: string }>;
      const foundIds = new Set(bulkRows.map((row) => row.id));
      const missingIds = normalizedBulkBatchIds.filter((id: string) => !foundIds.has(id));
      if (missingIds.length > 0) {
        return NextResponse.json(
          { error: `Some selected bulk absence bookings no longer exist: ${missingIds.join(', ')}` },
          { status: 400 }
        );
      }

      const outOfFinancialYear = bulkRows.filter(
        (row) => row.start_date > financialYearEndIso || row.end_date < financialYearStartIso
      );
      if (outOfFinancialYear.length > 0) {
        return NextResponse.json(
          { error: 'Selected bulk absence bookings must overlap the current financial year.' },
          { status: 400 }
        );
      }
    }

    const hierarchyValidation = await validateHierarchyReferences(supabaseAdmin, {
      line_manager_id: line_manager_id || null,
      team_id: normalizedTeamId,
    });
    if (!hierarchyValidation.ok) {
      return NextResponse.json(
        {
          error: hierarchyValidation.error || 'Invalid hierarchy assignment',
          code: 'INVALID_HIERARCHY_ASSIGNMENT',
        },
        { status: 400 }
      );
    }

    // Generate secure random password
    const temporaryPassword = generateSecurePassword();
    console.log('Generated temporary password for', email);

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
        role_id: role_id, // Pass role_id as string to trigger function
        employee_id: employee_id || null,
      },
    });

    if (authError) {
      console.error('Auth error:', authError);
      console.error('Auth error details:', JSON.stringify(authError, null, 2));
      return NextResponse.json({ 
        error: authError.message || 'Failed to create auth user',
        details: authError.code || 'unknown_error'
      }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }

    const selfManagerValidation = await validateHierarchyReferences(supabaseAdmin, {
      profile_id: authData.user.id,
      line_manager_id: line_manager_id || null,
      team_id: normalizedTeamId,
    });
    if (!selfManagerValidation.ok) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: selfManagerValidation.error || 'Invalid hierarchy assignment', code: 'INVALID_HIERARCHY_ASSIGNMENT' },
        { status: 400 }
      );
    }

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 500));

    // Upsert profile with additional data and set must_change_password flag
    // Use admin client to bypass RLS policies
    // Use upsert in case trigger hasn't created profile yet
    const baseProfilePayload = {
      id: authData.user.id,
      full_name,
      phone_number: phone_number || null,
      employee_id: employee_id || null,
      role_id,
      annual_holiday_allowance_days: normalizedAnnualAllowanceDays,
      must_change_password: true,
    };

    const hierarchyProfilePayload = {
      ...baseProfilePayload,
      line_manager_id: line_manager_id || null,
      team_id: normalizedTeamId,
    };

    let hierarchyFieldsPersisted = true;
    let hierarchyWarning: string | null = null;

    let { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(hierarchyProfilePayload, {
        onConflict: 'id'
      });

    if (profileError && isMissingHierarchySchemaError(profileError)) {
      hierarchyFieldsPersisted = false;
      hierarchyWarning = 'Hierarchy fields were ignored because the database schema is not ready yet.';
      const fallbackResult = await supabaseAdmin
        .from('profiles')
        .upsert(baseProfilePayload, { onConflict: 'id' });
      profileError = fallbackResult.error;
    }

    if (profileError) {
      console.error('Profile error:', profileError);
      console.error('Profile error details:', JSON.stringify(profileError, null, 2));
      // Try to delete the auth user if profile update fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ 
        error: profileError.message || 'Database error creating new user',
        details: profileError.details || 'Failed to create user profile',
        code: profileError.code || profileError.hint || 'unknown_error'
      }, { status: 500 });
    }

    if (hierarchyFieldsPersisted) {
      try {
        await reconcileProfileHierarchy(supabaseAdmin, authData.user.id);
      } catch (error) {
        if (!isMissingTeamManagerSchemaError(error) && !isMissingHierarchySchemaError(error)) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to reconcile hierarchy assignments' },
            { status: 500 }
          );
        }
      }
    }

    const todayIso = formatIsoDate(new Date());
    try {
      const carryoverAdjustmentDays = normalizedRemainingLeaveDays - normalizedAnnualAllowanceDays;
      const carryoverPayload = {
        profile_id: authData.user.id,
        financial_year_start_year: financialYearStartYear,
        source_financial_year_start_year: financialYearStartYear - 1,
        carried_days: carryoverAdjustmentDays,
        auto_generated: false,
        generation_source: 'admin-user-onboarding-adjustment',
        generated_at: new Date().toISOString(),
        generated_by: effectiveRole.user_id,
      };

      const { error: carryoverError } = await supabaseAdmin
        .from('absence_allowance_carryovers')
        .upsert(carryoverPayload, { onConflict: 'profile_id,financial_year_start_year' });

      if (carryoverError) {
        throw carryoverError;
      }

      await applyTemplateToProfiles(supabaseAdmin, normalizedTemplateId, [authData.user.id]);

      const bankHolidayBooking = auto_book_bank_holidays
        ? await seedRemainingFinancialYearBankHolidaysForProfiles({
            supabase: supabaseAdmin,
            profileIds: [authData.user.id],
            financialYearStartYear,
            fromDate: todayIso,
          })
        : null;

      const bulkReplayResult =
        auto_apply_bulk_bookings && normalizedBulkBatchIds.length > 0
          ? await replayBulkAbsenceBatchesForProfile({
              supabase: supabaseAdmin,
              actorProfileId: effectiveRole.user_id,
              profileId: authData.user.id,
              batchIds: normalizedBulkBatchIds,
              financialYearStartYear,
              fromDate: todayIso,
            })
          : null;

      // Send email to user with temporary password
      const emailResult = await sendPasswordEmail({
        to: email,
        userName: full_name,
        temporaryPassword,
        isReset: false,
      });

      if (!emailResult.success) {
        console.warn('Failed to send welcome email:', emailResult.error);
        // Don't fail the user creation if email fails - just log it
      }

      return NextResponse.json({
        success: true,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          full_name,
          employee_id,
          role_id,
          team_id: normalizedTeamId,
          work_shift_template_id: normalizedTemplateId,
        },
        temporaryPassword, // Return password to show admin
        emailSent: emailResult.success,
        hierarchyFieldsPersisted,
        hierarchyWarning: hierarchyWarning || hierarchyValidation.warning || selfManagerValidation.warning || null,
        onboardingActions: {
          annual_allowance_days: normalizedAnnualAllowanceDays,
          remaining_leave_days: normalizedRemainingLeaveDays,
          auto_book_bank_holidays,
          auto_apply_bulk_bookings,
          bankHolidayBooking,
          bulkReplayResult,
        },
      });
    } catch (onboardingError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        {
          error: onboardingError instanceof Error ? onboardingError.message : 'Failed to apply onboarding actions',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error creating user:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users',
      additionalData: {
        endpoint: '/api/admin/users',
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

