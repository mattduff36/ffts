import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVehicleCategoryName } from '@/lib/utils/deprecation-logger';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { buildSafeReportFilename, parseReportDateRange, validateRequiredReportDateRange } from '@/lib/server/report-date-range';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { 
  generateExcelFile, 
  formatExcelDate, 
  formatExcelStatus
} from '@/lib/utils/excel';
import type { ModuleName } from '@/types/roles';

type VanVehicleRow = {
  reg_number?: string | null;
  vehicle_type?: string | null;
  van_categories?: { name: string } | null;
};

type PlantAssetRow = {
  plant_id?: string | null;
  nickname?: string | null;
  van_categories?: { name: string } | null;
};

type HgvAssetRow = {
  reg_number?: string | null;
  nickname?: string | null;
  hgv_categories?: { name: string } | null;
};

type InspectorRow = {
  full_name?: string | null;
  employee_id?: string | null;
};

type VanInspectionRow = {
  id: string;
  user_id: string;
  vehicle?: VanVehicleRow | null;
  inspector?: InspectorRow | null;
  inspection_date: string;
  inspection_end_date?: string | null;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
};

type PlantInspectionRow = {
  id: string;
  user_id: string;
  plant?: PlantAssetRow | null;
  inspector?: InspectorRow | null;
  inspection_date: string;
  inspection_end_date?: string | null;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  is_hired_plant?: boolean | null;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
};

type HgvInspectionRow = {
  id: string;
  user_id: string;
  hgv?: HgvAssetRow | null;
  inspector?: InspectorRow | null;
  inspection_date: string;
  inspection_end_date?: string | null;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
};

type UnifiedDailyCheckRow = {
  source: 'van' | 'plant' | 'hgv';
  assetReference: string;
  assetType: string;
  inspectorName: string;
  inspectorEmployeeId: string;
  inspectionDate: string;
  inspectionEndDate?: string | null;
  status: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
};

async function getScopedModuleProfileIds(
  availableModules: ModuleName[],
  scopeContext: Awaited<ReturnType<typeof getReportScopeContext>>
): Promise<Map<ModuleName, Set<string> | null>> {
  const scopedMap = new Map<ModuleName, Set<string> | null>();

  await Promise.all(
    availableModules.map(async (moduleName) => {
      const scopedProfileIds = await getScopedProfileIdsForModule(moduleName, scopeContext);
      scopedMap.set(moduleName, scopedProfileIds);
    })
  );

  return scopedMap;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [canAccessVanChecks, canAccessPlantChecks, canAccessHgvChecks] = await Promise.all([
      canEffectiveRoleAccessModule('inspections'),
      canEffectiveRoleAccessModule('plant-inspections'),
      canEffectiveRoleAccessModule('hgv-inspections'),
    ]);

    const availableModules: ModuleName[] = [];
    if (canAccessVanChecks) availableModules.push('inspections');
    if (canAccessPlantChecks) availableModules.push('plant-inspections');
    if (canAccessHgvChecks) availableModules.push('hgv-inspections');

    if (availableModules.length === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const scopeContext = await getReportScopeContext();
    const scopedModuleIds = await getScopedModuleProfileIds(availableModules, scopeContext);

    const hasAnyScope = availableModules.some((moduleName) => {
      const scoped = scopedModuleIds.get(moduleName);
      return scoped === null || (scoped?.size ?? 0) > 0;
    });
    if (!hasAnyScope) {
      return NextResponse.json({ error: 'No daily checks found for the specified criteria' }, { status: 404 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const { range, error: dateRangeError } = parseReportDateRange(searchParams);
    const requiredRangeError = validateRequiredReportDateRange(range, 366);
    if (dateRangeError || requiredRangeError || !range) {
      return NextResponse.json({ error: dateRangeError || requiredRangeError || 'Invalid date range.' }, { status: 400 });
    }
    const { dateFrom, dateTo } = range;

    const vanScope = scopedModuleIds.get('inspections') || null;
    const plantScope = scopedModuleIds.get('plant-inspections') || null;
    const hgvScope = scopedModuleIds.get('hgv-inspections') || null;

    const [vanResult, plantResult, hgvResult] = await Promise.all([
      canAccessVanChecks
        ? (async () => {
            let query = supabase
              .from('van_inspections')
              .select(`
                id,
                user_id,
                inspection_date,
                inspection_end_date,
                status,
                submitted_at,
                reviewed_at,
                vehicle:vans (
                  reg_number,
                  vehicle_type,
                  van_categories(name)
                ),
                inspector:profiles!van_inspections_user_id_fkey (
                  full_name,
                  employee_id
                )
              `)
              .order('inspection_date', { ascending: false });

            if (dateFrom) query = query.gte('inspection_date', dateFrom);
            if (dateTo) query = query.lte('inspection_date', dateTo);
            if (vanScope) query = query.in('user_id', Array.from(vanScope));

            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
      canAccessPlantChecks
        ? (async () => {
            let query = supabase
              .from('plant_inspections')
              .select(`
                id,
                user_id,
                inspection_date,
                inspection_end_date,
                status,
                submitted_at,
                reviewed_at,
                is_hired_plant,
                hired_plant_id_serial,
                hired_plant_description,
                plant (
                  plant_id,
                  nickname,
                  van_categories(name)
                ),
                inspector:profiles!plant_inspections_user_id_fkey (
                  full_name,
                  employee_id
                )
              `)
              .order('inspection_date', { ascending: false });

            if (dateFrom) query = query.gte('inspection_date', dateFrom);
            if (dateTo) query = query.lte('inspection_date', dateTo);
            if (plantScope) query = query.in('user_id', Array.from(plantScope));

            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
      canAccessHgvChecks
        ? (async () => {
            let query = supabase
              .from('hgv_inspections')
              .select(`
                id,
                user_id,
                inspection_date,
                inspection_end_date,
                status,
                submitted_at,
                reviewed_at,
                hgv:hgvs!hgv_inspections_hgv_id_fkey (
                  reg_number,
                  nickname,
                  hgv_categories(name)
                ),
                inspector:profiles!hgv_inspections_user_id_fkey (
                  full_name,
                  employee_id
                )
              `)
              .order('inspection_date', { ascending: false });

            if (dateFrom) query = query.gte('inspection_date', dateFrom);
            if (dateTo) query = query.lte('inspection_date', dateTo);
            if (hgvScope) query = query.in('user_id', Array.from(hgvScope));

            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (vanResult.error) {
      return NextResponse.json({ error: vanResult.error.message }, { status: 500 });
    }
    if (plantResult.error) {
      return NextResponse.json({ error: plantResult.error.message }, { status: 500 });
    }
    if (hgvResult.error) {
      return NextResponse.json({ error: hgvResult.error.message }, { status: 500 });
    }

    const unifiedRows: UnifiedDailyCheckRow[] = [
      ...((vanResult.data || []) as VanInspectionRow[]).map((inspection) => ({
        source: 'van' as const,
        assetReference: inspection.vehicle?.reg_number || '-',
        assetType: inspection.vehicle ? getVehicleCategoryName(inspection.vehicle) : 'Van',
        inspectorName: inspection.inspector?.full_name || 'Unknown',
        inspectorEmployeeId: inspection.inspector?.employee_id || '-',
        inspectionDate: inspection.inspection_date,
        inspectionEndDate: inspection.inspection_end_date || null,
        status: inspection.status,
        submittedAt: inspection.submitted_at || null,
        reviewedAt: inspection.reviewed_at || null,
      })),
      ...((plantResult.data || []) as PlantInspectionRow[]).map((inspection) => ({
        source: 'plant' as const,
        assetReference:
          inspection.is_hired_plant
            ? inspection.hired_plant_id_serial || inspection.hired_plant_description || 'Hired Plant'
            : inspection.plant?.plant_id || 'Plant',
        assetType: inspection.plant?.van_categories?.name || 'Plant',
        inspectorName: inspection.inspector?.full_name || 'Unknown',
        inspectorEmployeeId: inspection.inspector?.employee_id || '-',
        inspectionDate: inspection.inspection_date,
        inspectionEndDate: inspection.inspection_end_date || null,
        status: inspection.status,
        submittedAt: inspection.submitted_at || null,
        reviewedAt: inspection.reviewed_at || null,
      })),
      ...((hgvResult.data || []) as HgvInspectionRow[]).map((inspection) => ({
        source: 'hgv' as const,
        assetReference: inspection.hgv?.reg_number || 'HGV',
        assetType: inspection.hgv?.hgv_categories?.name || 'HGV',
        inspectorName: inspection.inspector?.full_name || 'Unknown',
        inspectorEmployeeId: inspection.inspector?.employee_id || '-',
        inspectionDate: inspection.inspection_date,
        inspectionEndDate: inspection.inspection_end_date || null,
        status: inspection.status,
        submittedAt: inspection.submitted_at || null,
        reviewedAt: inspection.reviewed_at || null,
      })),
    ].sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));

    if (unifiedRows.length === 0) {
      return NextResponse.json({ error: 'No daily checks found for the specified criteria' }, { status: 404 });
    }

    const excelData = unifiedRows.map((row) => ({
      'Check Type': row.source.toUpperCase(),
      'Asset Reference': row.assetReference,
      'Asset Category': row.assetType,
      'Inspector': row.inspectorName,
      'Employee ID': row.inspectorEmployeeId,
      'Inspection Date': formatExcelDate(row.inspectionDate),
      'End Date': row.inspectionEndDate ? formatExcelDate(row.inspectionEndDate) : '-',
      'Status': formatExcelStatus(row.status),
      'Submitted': row.submittedAt ? formatExcelDate(row.submittedAt) : '-',
      'Reviewed': row.reviewedAt ? formatExcelDate(row.reviewedAt) : '-',
    }));

    const totalChecks = unifiedRows.length;
    const submittedCount = unifiedRows.filter((row) => row.status !== 'draft').length;
    const approvedCount = unifiedRows.filter((row) => row.status === 'approved').length;
    const complianceRate = totalChecks > 0 ? ((submittedCount / totalChecks) * 100).toFixed(1) : '0';

    excelData.push({
      'Check Type': '',
      'Asset Reference': '',
      'Asset Category': '',
      'Inspector': '',
      'Employee ID': '',
      'Inspection Date': '',
      'End Date': '',
      'Status': '',
      'Submitted': '',
      'Reviewed': '',
    });

    excelData.push({
      'Check Type': 'SUMMARY',
      'Asset Reference': '',
      'Asset Category': '',
      'Inspector': '',
      'Employee ID': '',
      'Inspection Date': `Total: ${totalChecks}`,
      'End Date': `Submitted: ${submittedCount}`,
      'Status': `Approved: ${approvedCount}`,
      'Submitted': `Compliance: ${complianceRate}%`,
      'Reviewed': '',
    });

    // Generate Excel file
    const buffer = await generateExcelFile([
      {
        sheetName: 'Daily Checks Compliance',
        columns: [
          { header: 'Check Type', key: 'Check Type', width: 12 },
          { header: 'Asset Reference', key: 'Asset Reference', width: 18 },
          { header: 'Asset Category', key: 'Asset Category', width: 15 },
          { header: 'Inspector', key: 'Inspector', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Inspection Date', key: 'Inspection Date', width: 14 },
          { header: 'End Date', key: 'End Date', width: 14 },
          { header: 'Status', key: 'Status', width: 10 },
          { header: 'Submitted', key: 'Submitted', width: 12 },
          { header: 'Reviewed', key: 'Reviewed', width: 12 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const filename = buildSafeReportFilename('Daily_Checks_Compliance', range.filenameDateRange, 'xlsx');

    // Return Excel file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating compliance report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/inspections/compliance',
      additionalData: {
        endpoint: '/api/reports/inspections/compliance',
      },
    });
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
