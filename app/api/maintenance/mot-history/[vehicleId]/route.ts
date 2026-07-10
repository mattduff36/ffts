// API Route: Get MOT History for a Vehicle (from Database)
// GET /api/maintenance/mot-history/[vehicleId]
// Note: This endpoint reads from stored database data only (no API calls)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Test vehicles that are excluded from DVLA sync
const TEST_VEHICLES = ['ZZ99VAN', 'ZZ99HGV'];

interface MotTestRecord {
  completedDate?: string;
  testResult?: string;
  expiryDate?: string;
  odometerValue?: number | string | null;
  odometerUnit?: string | null;
  testStationName?: string | null;
  testStationPcode?: string | null;
  defects?: unknown[];
  motTestNumber?: string;
}

interface MotHistoryRecord {
  registration?: string;
  make?: string | null;
  model?: string | null;
  fuelType?: string | null;
  primaryColour?: string | null;
  firstUsedDate?: string | null;
  registrationDate?: string | null;
  motTestDueDate?: string | null;
  motTests?: MotTestRecord[];
}

interface MaintenanceRecord {
  mot_raw_data?: MotHistoryRecord | null;
  dvla_raw_data?: unknown;
  ves_month_of_first_registration?: string | null;
  mot_first_used_date?: string | null;
  mot_api_sync_status?: string | null;
  dvla_sync_status?: string | null;
  mot_due_date?: string | null;
  mot_expiry_date?: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { vehicleId } = await params;

    // Resolve asset from vans first, then hgvs
    const { data: van, error: vanError } = await supabase
      .from('vans')
      .select('reg_number')
      .eq('id', vehicleId)
      .single();

    let assetType: 'van' | 'hgv' = 'van';
    let registrationNumber: string | null = van?.reg_number ?? null;

    if (vanError || !van) {
      const { data: hgv, error: hgvError } = await supabase
        .from('hgvs')
        .select('reg_number')
        .eq('id', vehicleId)
        .single();

      if (hgvError || !hgv) {
        return NextResponse.json(
          { error: 'Vehicle not found' },
          { status: 404 }
        );
      }

      assetType = 'hgv';
      registrationNumber = hgv.reg_number ?? null;
    }

    // Check if this is a test vehicle
    const cleanReg = (registrationNumber || '').replace(/\s+/g, '').toUpperCase();
    const isTestVehicle = TEST_VEHICLES.includes(cleanReg);

    // Get MOT history from database (mot_raw_data field)
    const maintenanceQuery = supabase
      .from('vehicle_maintenance')
      .select(`
        mot_raw_data, 
        mot_expiry_date, 
        mot_api_sync_status, 
        last_mot_api_sync,
        mot_api_sync_error,
        mot_due_date,
        mot_first_used_date,
        ves_month_of_first_registration,
        dvla_sync_status,
        dvla_raw_data
      `);

    const { data: maintenanceData, error: maintenanceError } = await (
      assetType === 'hgv'
        ? maintenanceQuery.eq('hgv_id', vehicleId).single()
        : maintenanceQuery.eq('van_id', vehicleId).single()
    ) as { data: MaintenanceRecord | null; error: unknown };

    if (maintenanceError || !maintenanceData) {
      // No maintenance record exists
      if (isTestVehicle) {
        return NextResponse.json({
          success: false,
          error: 'No MOT data found',
          message: `Vehicle registration ${registrationNumber || vehicleId} not found in the DVLA database. This is a test vehicle.`,
          vehicleNotFound: true,
        }, { status: 404 });
      }
      
      return NextResponse.json({
        success: false,
        error: 'No MOT data found',
        message: `No MOT history available for ${registrationNumber || vehicleId}. Vehicle data has not been synced yet.`,
        vehicleNotFound: false,
      }, { status: 404 });
    }

    // Check if MOT data exists
    const motHistory = maintenanceData.mot_raw_data;
    if (!motHistory || !motHistory.registration) {
      // Determine if vehicle doesn't exist in DVLA vs. too new for MOT
      const hasVehicleData = maintenanceData.dvla_raw_data || 
                            maintenanceData.ves_month_of_first_registration || 
                            maintenanceData.mot_first_used_date;
      
      // Vehicle is not found if:
      // 1. It's a test vehicle, OR
      // 2. Has no vehicle data AND both sync attempts failed
      const vehicleNotFound = isTestVehicle || (
        !hasVehicleData && 
        maintenanceData.mot_api_sync_status === 'error' &&
        maintenanceData.dvla_sync_status === 'error'
      );
      
      let motDueMessage = `No MOT history available for ${registrationNumber || vehicleId}.`;
      
      if (vehicleNotFound) {
        if (isTestVehicle) {
          motDueMessage = `Vehicle registration ${registrationNumber || vehicleId} not found in the DVLA database. This is a test vehicle.`;
        } else {
          motDueMessage = `Vehicle registration ${registrationNumber || vehicleId} not found in the DVLA database. This may be an invalid registration or a vehicle not yet registered.`;
        }
      } else if (maintenanceData.mot_due_date || maintenanceData.ves_month_of_first_registration) {
        const ageNote = assetType === 'hgv'
          ? 'This vehicle may not yet have had its first annual test.'
          : 'This vehicle may be less than 3 years old and not yet required to have an MOT.';
        motDueMessage = `No MOT history available for ${registrationNumber || vehicleId}. ${ageNote}`;
      }
      
      return NextResponse.json({
        success: false,
        error: 'No MOT history',
        message: motDueMessage,
        vehicleNotFound,
      }, { status: 404 });
    }

    // Transform the stored data to match UI expectations
    const sortedTests = (motHistory.motTests || []).sort(
      (a, b) =>
        new Date(b.completedDate ?? '').getTime() - new Date(a.completedDate ?? '').getTime()
    );

    // Calculate MOT expiry status and days remaining
    const passResults = new Set(['PASSED', 'PASS', 'PRS']);
    const latestPassedTest = sortedTests.find((test) => passResults.has((test.testResult ?? '').toUpperCase()));
    const motExpiryDate = maintenanceData.mot_expiry_date || latestPassedTest?.expiryDate || motHistory.motTestDueDate || null;
    let motStatus = 'Unknown';
    let daysRemaining = null;

    if (motExpiryDate) {
      const expiryDate = new Date(motExpiryDate);
      const now = new Date();
      daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysRemaining > 0) {
        motStatus = 'Valid';
      } else {
        motStatus = 'Expired';
      }
    } else if (sortedTests.length === 0) {
      motStatus = 'No MOT History';
    }

    const lastTest = sortedTests[0];

    return NextResponse.json({
      success: true,
      data: {
        registrationNumber: motHistory.registration || registrationNumber,
        make: motHistory.make || null,
        model: motHistory.model || null,
        fuelType: motHistory.fuelType || null,
        primaryColour: motHistory.primaryColour || null,
        firstUsedDate: motHistory.firstUsedDate || motHistory.registrationDate || null,
        currentStatus: {
          expiryDate: motExpiryDate,
          status: motStatus,
          daysRemaining,
          lastTestDate: lastTest?.completedDate || null,
          lastTestResult: lastTest?.testResult || null,
          motExpiryDate: motExpiryDate, // For backward compatibility
        },
        tests: sortedTests.map((test) => {
          const rawOdometer = test.odometerValue;
          const odometerValue =
            rawOdometer === null || rawOdometer === undefined || rawOdometer === ''
              ? null
              : (() => {
                  const parsed =
                    typeof rawOdometer === 'number'
                      ? rawOdometer
                      : parseInt(String(rawOdometer), 10);
                  return Number.isFinite(parsed) ? parsed : null;
                })();

          return {
            motTestNumber: test.motTestNumber,
            completedDate: test.completedDate,
            testResult: test.testResult,
            expiryDate: test.expiryDate,
            odometerValue,
            odometerUnit: test.odometerUnit ?? null,
            testStationName: test.testStationName ?? null,
            testStationPcode: test.testStationPcode ?? null,
            defects: Array.isArray(test.defects) ? test.defects : [],
          };
        }),
      },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('MOT history route error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: errorMessage },
      { status: 500 }
    );
  }
}

