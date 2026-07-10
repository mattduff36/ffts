import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateSecurePassword } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { logServerError } from '@/lib/utils/server-error-logger';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const userId = (await params).id;

    // Get server client for profile operations
    const supabase = await createServerClient();

    // Get target user's profile
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, role_id')
      .eq('id', userId)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (targetProfile.role_id) {
      const canManageTargetRole = await canEffectiveRoleAssignRole(targetProfile.role_id);
      if (!canManageTargetRole) {
        return NextResponse.json(
          { error: 'Forbidden: you cannot reset password for this role' },
          { status: 403 }
        );
      }
    }

    // Get user's email from auth and update password
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (authError || !authUser.user || !authUser.user.email) {
      return NextResponse.json({ error: 'User email not found' }, { status: 404 });
    }

    // Generate new temporary password
    const temporaryPassword = generateSecurePassword();
    console.log('Generated temporary password for', authUser.user.email);

    // Update password using admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        password: temporaryPassword,
      }
    );

    if (updateError) {
      console.error('Password update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to reset password' },
        { status: 500 }
      );
    }

    // Set must_change_password flag
    const { error: flagError } = await supabase
      .from('profiles')
      .update({
        must_change_password: true,
      })
      .eq('id', userId);

    if (flagError) {
      console.error('Flag update error:', flagError);
      // Password was changed but flag update failed - log but don't fail
      console.warn('Password reset successful but failed to set must_change_password flag');
    }

    // Send email to user with new temporary password
    const emailResult = await sendPasswordEmail({
      to: authUser.user.email,
      userName: targetProfile.full_name!,
      temporaryPassword,
      isReset: true,
    });

    if (!emailResult.success) {
      console.warn('Failed to send password reset email:', emailResult.error);
      // Don't fail the reset if email fails - just log it
    }

    return NextResponse.json({
      success: true,
      temporaryPassword, // Return password to show admin
      emailSent: emailResult.success,
    });
  } catch (error) {
    console.error('Error resetting password:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users/[id]/reset-password',
      additionalData: {
        endpoint: '/api/admin/users/[id]/reset-password',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

