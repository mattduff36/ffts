import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { ERROR_REPORT_STATUS_LABELS } from '@/types/error-reports';
import type { 
  GetErrorReportDetailResponse, 
  UpdateErrorReportRequest,
  UpdateErrorReportResponse,
  ErrorReportWithUser,
  ErrorReportUpdateWithUser
} from '@/types/error-reports';

type ErrorReportRow = Omit<ErrorReportWithUser, 'user'>;
type ErrorReportUpdateRow = Omit<ErrorReportUpdateWithUser, 'user'>;

/**
 * GET /api/management/error-reports/[id]
 * Get error report details with update history (admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessErrorReports = await canEffectiveRoleAccessModule('error-reports');
    if (!canAccessErrorReports) {
      return NextResponse.json({ error: 'Forbidden: error-reports access required' }, { status: 403 });
    }

    // Fetch error report
    const { data: report, error: reportError } = await supabase
      .from('error_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return NextResponse.json({ error: 'Error report not found' }, { status: 404 });
    }

    // Fetch update history
    const { data: updates, error: updatesError } = await supabase
      .from('error_report_updates')
      .select('*')
      .eq('error_report_id', id)
      .order('created_at', { ascending: false });

    if (updatesError) {
      console.error('Error fetching updates:', updatesError);
    }

    const reportRow = report as ErrorReportRow;
    const updateRows = (updates || []) as ErrorReportUpdateRow[];
    const creatorIds = [...new Set([
      reportRow.created_by,
      ...updateRows.map((update) => update.created_by),
    ].filter(Boolean))];
    let profileMap = new Map<string, { id: string; full_name: string | null }>();

    if (creatorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', creatorIds);
      if (profilesError) throw profilesError;
      if (profiles) {
        profileMap = new Map(
          profiles.map((profile: { id: string; full_name: string | null }) => [profile.id, profile])
        );
      }
    }

    const response: GetErrorReportDetailResponse = {
      success: true,
      report: (() => {
        const creator = profileMap.get(reportRow.created_by);
        return {
          ...reportRow,
          user: creator
            ? {
              id: creator.id,
              full_name: creator.full_name || 'Unknown',
            }
            : null,
        } as ErrorReportWithUser;
      })(),
      updates: updateRows.map((update) => ({
        ...update,
        user: (() => {
          const creator = profileMap.get(update.created_by);
          return creator
            ? {
              id: creator.id,
              full_name: creator.full_name || 'Unknown',
            }
            : null;
        })(),
      })) as ErrorReportUpdateWithUser[],
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/management/error-reports/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/error-reports/[id]',
      additionalData: { endpoint: '/api/management/error-reports/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/management/error-reports/[id]
 * Update error report status/notes and create update history (admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessErrorReports = await canEffectiveRoleAccessModule('error-reports');
    if (!canAccessErrorReports) {
      return NextResponse.json({ error: 'Forbidden: error-reports access required' }, { status: 403 });
    }

    // Parse request body
    const body: UpdateErrorReportRequest = await request.json();
    const { status, admin_notes, note } = body;

    // Fetch current report
    const { data: currentReport, error: fetchError } = await supabase
      .from('error_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentReport) {
      return NextResponse.json({ error: 'Error report not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    
    if (status !== undefined) {
      updateData.status = status;
      
      // If marking as resolved, record who resolved it and when
      if (status === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user.id;
      }
    }
    
    if (admin_notes !== undefined) {
      updateData.admin_notes = admin_notes;
    }

    // Update error report
    const { data: updatedReport, error: updateError } = await supabase
      .from('error_reports')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating report:', updateError);
      throw updateError;
    }

    // Create update history entry if status changed or note provided
    const statusChanged = Boolean(status && status !== currentReport.status);
    const trimmedNote = note?.trim() || '';
    const hasResponseNote = trimmedNote.length > 0;
    if (statusChanged || hasResponseNote) {
      const { error: historyError } = await supabase
        .from('error_report_updates')
        .insert({
          error_report_id: id,
          created_by: user.id,
          old_status: currentReport.status,
          new_status: status || currentReport.status,
          note: trimmedNote || undefined,
        });

      if (historyError) {
        console.error('Error creating update history:', historyError);
      }
    }

    // Send in-app notification to both the reporter and responder.
    // This lets the responder verify the exact user-facing notification copy.
    if ((statusChanged || hasResponseNote) && currentReport.created_by) {
      try {
        const adminSupabase = createAdminClient();
        const oldLabel = ERROR_REPORT_STATUS_LABELS[currentReport.status as keyof typeof ERROR_REPORT_STATUS_LABELS] || currentReport.status;
        const newLabel = ERROR_REPORT_STATUS_LABELS[status as keyof typeof ERROR_REPORT_STATUS_LABELS] || status;
        const reportTitle = currentReport.title?.substring(0, 60) || 'Your error report';

        const subject = statusChanged
          ? `Error Report Updated to ${newLabel}`
          : 'Error Report Response Added';
        const bodyParts = [
          `Your error report "${reportTitle}" has been updated.`,
          '',
        ];
        if (statusChanged) {
          bodyParts.push(`Status: ${oldLabel} -> ${newLabel}`, '');
        }
        if (hasResponseNote) bodyParts.push(`Admin note: ${trimmedNote}`, '');
        bodyParts.push('---', 'Tip: You can view your reports on the Help page.');

        const { data: message, error: msgError } = await adminSupabase
          .from('messages')
          .insert({
            type: 'NOTIFICATION',
            priority: 'HIGH',
            subject,
            body: bodyParts.join('\n'),
            sender_id: user.id,
            created_via: 'error_report_response',
            module_key: 'errors',
          })
          .select()
          .single();

        if (msgError) throw msgError;

        const recipientIds = Array.from(new Set([currentReport.created_by, user.id].filter(Boolean)));
        if (recipientIds.length > 0) {
          const { error: recipientError } = await adminSupabase
            .from('message_recipients')
            .insert(
              recipientIds.map((recipientId) => ({
                message_id: message.id,
                user_id: recipientId,
                status: 'PENDING' as const,
              }))
            );

          if (recipientError) throw recipientError;
        }
      } catch (notifyError) {
        console.error('Failed to send status-change notification to reporter/responder:', notifyError);
      }
    }

    const response: UpdateErrorReportResponse = {
      success: true,
      report: {
        ...updatedReport,
        status: updatedReport.status ?? 'new',
        created_at: updatedReport.created_at ?? '',
        updated_at: updatedReport.updated_at ?? '',
      },
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in PATCH /api/management/error-reports/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/error-reports/[id]',
      additionalData: { endpoint: '/api/management/error-reports/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
