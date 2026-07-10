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
};

type InspectionItemRow = {
  status?: string | null;
  item_number?: string | number | null;
  item_description?: string | null;
  comments?: string | null;
};

type VanInspectionRow = {
  id: string;
  user_id: string;
  vehicle?: VanVehicleRow | null;
  inspector?: InspectorRow | null;
  inspection_date: string;
  status: string;
  inspection_items?: InspectionItemRow[] | null;
};

type PlantInspectionRow = {
  id: string;
  user_id: string;
  inspection_date: string;
  status: string;
  plant?: PlantAssetRow | null;
  is_hired_plant?: boolean | null;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  inspector?: InspectorRow | null;
  inspection_items?: InspectionItemRow[] | null;
};

type HgvInspectionRow = {
  id: string;
  user_id: string;
  inspection_date: string;
  status: string;
  hgv?: HgvAssetRow | null;
  inspector?: InspectorRow | null;
  inspection_items?: InspectionItemRow[] | null;
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
      return NextResponse.json({ error: 'No defects found for the specified criteria' }, { status: 404 });
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
                status,
                vehicle:vans (
                  reg_number,
                  vehicle_type,
                  van_categories(name)
                ),
                inspector:profiles!van_inspections_user_id_fkey (
                  full_name
                ),
                inspection_items!inner (
                  item_number,
                  item_description,
                  status,
                  comments
                )
              `)
              .in('inspection_items.status', ['attention', 'defect'])
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
                status,
                is_hired_plant,
                hired_plant_id_serial,
                hired_plant_description,
                plant (
                  plant_id,
                  nickname,
                  van_categories(name)
                ),
                inspector:profiles!plant_inspections_user_id_fkey (
                  full_name
                ),
                inspection_items!inner (
                  item_number,
                  item_description,
                  status,
                  comments
                )
              `)
              .in('inspection_items.status', ['attention', 'defect'])
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
                status,
                hgv:hgvs!hgv_inspections_hgv_id_fkey (
                  reg_number,
                  nickname,
                  hgv_categories(name)
                ),
                inspector:profiles!hgv_inspections_user_id_fkey (
                  full_name
                ),
                inspection_items!inner (
                  item_number,
                  item_description,
                  status,
                  comments
                )
              `)
              .in('inspection_items.status', ['attention', 'defect'])
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

    // Transform data for Excel - one row per defect
    const excelData: Array<Record<string, string>> = [];

    const allInspections = [
      ...((vanResult.data || []) as VanInspectionRow[]).map((row) => ({ source: 'VAN' as const, row })),
      ...((plantResult.data || []) as PlantInspectionRow[]).map((row) => ({ source: 'PLANT' as const, row })),
      ...((hgvResult.data || []) as HgvInspectionRow[]).map((row) => ({ source: 'HGV' as const, row })),
    ];

    if (allInspections.length === 0) {
      return NextResponse.json({ error: 'No defects found for the specified criteria' }, { status: 404 });
    }

    allInspections.forEach(({ source, row }) => {
      const inspection = row as VanInspectionRow | PlantInspectionRow | HgvInspectionRow;
      const defectItems = (inspection.inspection_items || []).filter(
        (item) => item.status === 'attention' || item.status === 'defect'
      );
      
      defectItems.forEach((item) => {
        let assetReference = '-';
        let assetType: string = source;

        if (source === 'VAN') {
          const vanInspection = inspection as VanInspectionRow;
          assetReference = vanInspection.vehicle?.reg_number || '-';
          assetType = vanInspection.vehicle ? getVehicleCategoryName(vanInspection.vehicle) : 'Van';
        } else if (source === 'PLANT') {
          const plantInspection = inspection as PlantInspectionRow;
          assetReference =
            plantInspection.is_hired_plant
              ? plantInspection.hired_plant_id_serial || plantInspection.hired_plant_description || 'Hired Plant'
              : plantInspection.plant?.plant_id || 'Plant';
          assetType = plantInspection.plant?.van_categories?.name || 'Plant';
        } else {
          const hgvInspection = inspection as HgvInspectionRow;
          assetReference = hgvInspection.hgv?.reg_number || 'HGV';
          assetType = hgvInspection.hgv?.hgv_categories?.name || 'HGV';
        }

        excelData.push({
          'Check Type': source,
          'Asset Reference': assetReference,
          'Asset Category': assetType,
          'Inspector': inspection.inspector?.full_name || 'Unknown',
          'Inspection Date': formatExcelDate(inspection.inspection_date),
          'Item #': String(item.item_number ?? ''),
          'Item Description': item.item_description || '-',
          'Defect Comments': item.comments || '-',
          'Inspection Status': formatExcelStatus(inspection.status),
        });
      });
    });

    // Add summary
    const totalDefects = excelData.length;
    const uniqueAssets = new Set(excelData.map((row) => row['Asset Reference'])).size;

    excelData.push({
      'Check Type': '',
      'Asset Reference': '',
      'Asset Category': '',
      'Inspector': '',
      'Inspection Date': '',
      'Item #': '',
      'Item Description': '',
      'Defect Comments': '',
      'Inspection Status': '',
    });

    excelData.push({
      'Check Type': 'SUMMARY',
      'Asset Reference': '',
      'Asset Category': '',
      'Inspector': '',
      'Inspection Date': `Total Defects: ${totalDefects}`,
      'Item #': '',
      'Item Description': `Affected Assets: ${uniqueAssets}`,
      'Defect Comments': '',
      'Inspection Status': '',
    });

    // Generate Excel file
    const buffer = await generateExcelFile([
      {
        sheetName: 'Daily Checks Defects',
        columns: [
          { header: 'Check Type', key: 'Check Type', width: 11 },
          { header: 'Asset Reference', key: 'Asset Reference', width: 18 },
          { header: 'Asset Category', key: 'Asset Category', width: 15 },
          { header: 'Inspector', key: 'Inspector', width: 20 },
          { header: 'Inspection Date', key: 'Inspection Date', width: 14 },
          { header: 'Item #', key: 'Item #', width: 8 },
          { header: 'Item Description', key: 'Item Description', width: 30 },
          { header: 'Defect Comments', key: 'Defect Comments', width: 40 },
          { header: 'Inspection Status', key: 'Inspection Status', width: 12 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const filename = buildSafeReportFilename('Daily_Checks_Defects', range.filenameDateRange, 'xlsx');

    // Return Excel file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating defects report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/inspections/defects',
      additionalData: {
        endpoint: '/api/reports/inspections/defects',
      },
    });
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
