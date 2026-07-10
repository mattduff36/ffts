import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get current date and week boundaries
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Get statistics in parallel
    const [
      weekTimesheetsResult,
      monthTimesheetsResult,
      pendingTimesheetsResult,
      activeEmployeesResult,
      weekVanInspectionsResult,
      monthVanInspectionsResult,
      weekPlantInspectionsResult,
      monthPlantInspectionsResult,
    ] = await Promise.all([
      // Total hours this week
      db
        .from('timesheets')
        .select('total_hours')
        .eq('status', 'approved')
        .gte('week_ending', startOfWeek.toISOString())
        .lte('week_ending', endOfWeek.toISOString()),
      
      // Total hours this month
      db
        .from('timesheets')
        .select('total_hours')
        .eq('status', 'approved')
        .gte('week_ending', startOfMonth.toISOString())
        .lte('week_ending', endOfMonth.toISOString()),
      
      // Pending timesheet approvals
      db
        .from('timesheets')
        .select('id', { count: 'exact' })
        .eq('status', 'submitted'),
      
      // Active employees (non-admin/manager roles)
      db
        .from('profiles')
        .select('id, roles!inner(is_manager_admin)', { count: 'exact' })
        .eq('roles.is_manager_admin', false),
      
      // Van inspections completed this week
      db
        .from('van_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfWeek.toISOString())
        .lte('inspection_date', endOfWeek.toISOString()),
      
      // Van inspections completed this month
      db
        .from('van_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfMonth.toISOString())
        .lte('inspection_date', endOfMonth.toISOString()),

      // Plant inspections completed this week
      db
        .from('plant_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfWeek.toISOString())
        .lte('inspection_date', endOfWeek.toISOString()),
      
      // Plant inspections completed this month
      db
        .from('plant_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfMonth.toISOString())
        .lte('inspection_date', endOfMonth.toISOString()),
    ]);

    // Calculate total hours
    const weekHours = ((weekTimesheetsResult.data || []) as Array<{ total_hours?: number | null }>)
      .reduce((sum, t) => sum + (t.total_hours || 0), 0);
    const monthHours = ((monthTimesheetsResult.data || []) as Array<{ total_hours?: number | null }>)
      .reduce((sum, t) => sum + (t.total_hours || 0), 0);

    // Get inspection pass/fail statistics for this month (van inspections)
    const { data: inspectionItems } = await db
      .from('inspection_items')
      .select(`
        status,
        inspection:van_inspections!inner (
          inspection_date
        )
      `)
      .gte('inspection.inspection_date', startOfMonth.toISOString())
      .lte('inspection.inspection_date', endOfMonth.toISOString());

    const typedInspectionItems = (inspectionItems || []) as Array<{ status?: string | null }>;
    const passCount = typedInspectionItems.filter((i) => i.status === 'ok').length;
    const failCount = typedInspectionItems.filter((i) => i.status === 'attention' || i.status === 'defect').length;
    const totalItems = passCount + failCount;
    const passRate = totalItems > 0 ? ((passCount / totalItems) * 100).toFixed(1) : 0;

    // Get defects requiring attention (failed items from last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentDefects } = await db
      .from('inspection_items')
      .select(`
        id,
        inspection:van_inspections!inner (
          inspection_date,
          status
        )
      `)
      .in('status', ['attention', 'defect'])
      .gte('inspection.inspection_date', thirtyDaysAgo.toISOString());

    const outstandingDefects = ((recentDefects || []) as Array<{ inspection?: { status?: string | null } | null }>)
      .filter((d) => d.inspection?.status !== 'approved').length;

    // Return statistics
    return NextResponse.json({
      timesheets: {
        weekHours: Math.round(weekHours * 100) / 100,
        monthHours: Math.round(monthHours * 100) / 100,
        pendingApprovals: pendingTimesheetsResult.count || 0,
      },
      inspections: {
        weekCompleted: (weekVanInspectionsResult.count || 0) + (weekPlantInspectionsResult.count || 0),
        monthCompleted: (monthVanInspectionsResult.count || 0) + (monthPlantInspectionsResult.count || 0),
        pendingApprovals: 0,
        passRate: typeof passRate === 'string' ? Number.parseFloat(passRate) : passRate,
        outstandingDefects,
      },
      employees: {
        active: activeEmployeesResult.count || 0,
      },
      summary: {
        totalPendingApprovals: (pendingTimesheetsResult.count || 0),
        needsAttention: outstandingDefects,
      },
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/stats',
      additionalData: {
        endpoint: '/api/reports/stats',
      },
    });
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}

