import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { sendTimesheetAdjustmentEmail } from '@/lib/utils/email';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { Database } from '@/types/database';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { notifyProcessedAbsenceTimesheetAdjustment } from '@/lib/server/processed-absence-notifications';

function getSupabaseAdmin() {
  return createSupabaseAdmin<Database>(
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
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { id: timesheetId } = await params;
    const { comments, notifyManagerIds } = await request.json();

    if (!comments || typeof comments !== 'string' || comments.trim().length === 0) {
      return NextResponse.json(
        { error: 'Adjustment comments are required' },
        { status: 400 }
      );
    }

    // Get current user and check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const canAdjustTimesheets = await canEffectiveRoleAccessModule('approvals');
    if (!canAdjustTimesheets) {
      return NextResponse.json(
        { error: 'Approvals access required to adjust timesheets' },
        { status: 403 }
      );
    }

    // Fetch profile for downstream use (name, etc.)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', effectiveRole.user_id)
      .single();

    const typedProfile = profile as { id: string; full_name: string } | null;

    // Get timesheet details
    const { data: timesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .select(`
        id,
        user_id,
        week_ending,
        status,
        profiles:user_id (
          id,
          full_name
        )
      `)
      .eq('id', timesheetId)
      .single();

    const typedTimesheet = timesheet as unknown as {
      id: string;
      user_id: string;
      week_ending: string;
      status: string;
      profiles: { id: string; full_name: string };
    } | null;

    if (timesheetError || !typedTimesheet) {
      return NextResponse.json(
        { error: 'Timesheet not found' },
        { status: 404 }
      );
    }

    // Get employee email from auth.users using admin client
    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user: employeeUser }, error: employeeUserError } = await supabaseAdmin.auth.admin.getUserById(typedTimesheet.user_id);
    
    if (employeeUserError) {
      console.error('Error fetching employee email:', employeeUserError);
    }

    const employeeEmail = employeeUser?.email || null;

    if (typedTimesheet.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only approved timesheets can be marked as adjusted' },
        { status: 400 }
      );
    }

    // Update timesheet status
    const { error: updateError } = await db
      .from('timesheets')
      .update({
        status: 'adjusted',
        adjusted_by: effectiveRole.user_id!,
        adjusted_at: new Date().toISOString(),
        adjustment_recipients: notifyManagerIds || [],
        manager_comments: comments.trim(),
      } as never)
      .eq('id', timesheetId);

    if (updateError) {
      console.error('Error updating timesheet:', updateError);
      throw updateError;
    }

    const employeeProfile = typedTimesheet.profiles;
    const weekEnding = new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // Send email to employee
    if (employeeEmail) {
      const emailResult = await sendTimesheetAdjustmentEmail({
        to: employeeEmail,
        recipientName: employeeProfile.full_name,
        employeeName: employeeProfile.full_name,
        weekEnding,
        adjustmentComments: comments.trim(),
        adjustedBy: typedProfile!.full_name,
      });

      if (!emailResult.success) {
        console.error('Failed to send adjustment email to employee:', emailResult.error);
      }
    }

    // Send emails to selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managers } = await db
        .from('profiles')
        .select('id, full_name')
        .in('id', notifyManagerIds);
      const typedManagers = (managers || []) as Array<{ id: string; full_name: string }>;

      if (typedManagers.length > 0) {
        // Get emails from auth.users for these managers
        // Fetch each user by ID to avoid pagination limits of listUsers()
        for (const manager of typedManagers) {
          try {
            const { data: { user: managerUser }, error: managerUserError } = await supabaseAdmin.auth.admin.getUserById(manager.id);
            
            if (!managerUserError && managerUser?.email) {
              await sendTimesheetAdjustmentEmail({
                to: managerUser.email,
                recipientName: manager.full_name,
                employeeName: employeeProfile.full_name,
                weekEnding,
                adjustmentComments: comments.trim(),
                adjustedBy: typedProfile!.full_name,
              });
            } else {
              console.error(`Error fetching email for manager ${manager.id}:`, managerUserError);
            }
          } catch (err) {
            console.error(`Exception fetching email for manager ${manager.id}:`, err);
          }
        }
      }
    }

    // Create in-app notification for employee
    const { data: employeeMessage } = await db
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        subject: 'Your Timesheet Has Been Adjusted',
        body: `Your timesheet for week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })} has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
        priority: 'HIGH',
        sender_id: effectiveRole.user_id!,
        created_via: 'timesheet_adjustment',
        module_key: 'timesheets',
      } satisfies Database['public']['Tables']['messages']['Insert'])
      .select('id')
      .single();

    const typedEmployeeMessage = employeeMessage as unknown as { id: string } | null;

    if (typedEmployeeMessage) {
      await db
        .from('message_recipients')
        .insert({
          message_id: typedEmployeeMessage.id,
          user_id: typedTimesheet.user_id,
          status: 'PENDING' as const,
        });
    }

    // Create in-app notifications for selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managerMessage } = await db
        .from('messages')
        .insert({
          type: 'NOTIFICATION',
          subject: 'Timesheet Adjusted',
          body: `A timesheet for ${employeeProfile.full_name} (week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}) has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
          priority: 'HIGH',
          sender_id: effectiveRole.user_id!,
          created_via: 'timesheet_adjustment',
          module_key: 'timesheets',
        } satisfies Database['public']['Tables']['messages']['Insert'])
        .select('id')
        .single();

      const typedManagerMessage = managerMessage as unknown as { id: string } | null;

      if (typedManagerMessage) {
        const recipients = notifyManagerIds.map((recipientId: string) => ({
          message_id: typedManagerMessage.id,
          user_id: recipientId,
          status: 'PENDING' as const,
        }));

        await db
          .from('message_recipients')
          .insert(recipients);
      }
    }

    try {
      await notifyProcessedAbsenceTimesheetAdjustment(supabaseAdmin, {
        actorUserId: effectiveRole.user_id!,
        employeeProfileId: typedTimesheet.user_id,
        employeeName: employeeProfile.full_name,
        weekEnding: typedTimesheet.week_ending,
        adjustmentComments: comments.trim(),
      });
    } catch (notificationError) {
      console.error('Failed to notify Accounts about processed absence timesheet adjustment:', notificationError);
    }

    return NextResponse.json({
      success: true,
      message: 'Timesheet marked as adjusted and notifications sent',
    });

  } catch (error) {
    console.error('Error adjusting timesheet:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/adjust',
      additionalData: {
        endpoint: '/api/timesheets/[id]/adjust',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

