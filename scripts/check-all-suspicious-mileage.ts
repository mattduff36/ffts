/**
 * Check ALL Vehicles for Suspicious Test Mileage Patterns
 * 
 * This script checks EVERY production vehicle for suspicious mileage values
 * that match test patterns, regardless of when they were last updated.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const FIX_MODE = process.env.FIX_MODE === 'true';

// Test mileage values that indicate corruption - Obviously invalid values for easy detection
const SUSPICIOUS_MILEAGE = [999999, 999998, 999997, 999996, 999995, 999994, 999993, 50000, 28000, 27000, 26000, 25000];

type VehicleMaintenanceRow = {
  id: string;
  current_mileage: number;
  updated_at: string;
};

type VehicleRow = {
  id: string;
  reg_number: string;
  nickname: string | null;
  vehicle_maintenance?: VehicleMaintenanceRow[];
};

type InspectionRow = {
  current_mileage: number | null;
  inspection_date: string;
  status: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date
    .toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

async function checkAllVehicles() {
  console.log('🔍 CHECKING ALL VEHICLES FOR SUSPICIOUS MILEAGE PATTERNS');
  console.log('========================================================\n');
  console.log(`Mode: ${FIX_MODE ? '⚠️  FIX MODE (WILL MODIFY DATA)' : '📊 READ-ONLY (NO CHANGES)'}\n`);

  // Get all non-ZZ99 vehicles with maintenance data
  const { data: vehicles, error } = await supabase
    .from('vans')
    .select('id, reg_number, nickname, status, vehicle_maintenance(id, current_mileage, updated_at)')
    .not('reg_number', 'ilike', 'ZZ99%')
    .neq('status', 'deleted')
    .order('reg_number');

  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return;
  }

  console.log(`Checking ${vehicles?.length || 0} production vehicles...\n`);

  const suspiciousVehicles: Array<{
    reg_number: string;
    nickname: string | null;
    currentMileage: number;
    correctMileage: number | null;
    lastUpdate: string;
    daysSinceUpdate: number;
    maintenanceId: string;
  }> = [];

  const vehicleRows = (vehicles ?? []) as VehicleRow[];

  for (const vehicle of vehicleRows) {
    const maintenance = vehicle.vehicle_maintenance?.[0];
    
    if (!maintenance) continue;

    // Check if mileage matches suspicious pattern
    if (SUSPICIOUS_MILEAGE.includes(maintenance.current_mileage)) {
      // Get real inspection history
      const { data: inspections } = await supabase
        .from('van_inspections')
        .select('current_mileage, inspection_date, status')
        .eq('van_id', vehicle.id)
        .not('current_mileage', 'is', null)
        .eq('status', 'submitted')
        .order('inspection_date', { ascending: false })
        .limit(5);

      // Find most recent non-suspicious inspection
      const realInspections = ((inspections ?? []) as InspectionRow[]).filter(
        (inspection) =>
          inspection.current_mileage !== null &&
          !SUSPICIOUS_MILEAGE.includes(inspection.current_mileage)
      );

      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(maintenance.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      suspiciousVehicles.push({
        reg_number: vehicle.reg_number,
        nickname: vehicle.nickname,
        currentMileage: maintenance.current_mileage,
        correctMileage: realInspections[0]?.current_mileage || null,
        lastUpdate: maintenance.updated_at,
        daysSinceUpdate,
        maintenanceId: maintenance.id,
      });
    }
  }

  // Report findings
  if (suspiciousVehicles.length === 0) {
    console.log('✅ NO SUSPICIOUS MILEAGE PATTERNS FOUND!');
    console.log('   All production vehicles have clean mileage values.\n');
    return;
  }

  console.log(`⚠️  FOUND ${suspiciousVehicles.length} VEHICLE(S) WITH SUSPICIOUS MILEAGE\n`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const v of suspiciousVehicles) {
    console.log(`Vehicle: ${v.reg_number} (${v.nickname || 'No nickname'})`);
    console.log(`  Current Mileage: ${v.currentMileage.toLocaleString()} miles ❌ SUSPICIOUS`);
    
    if (v.correctMileage) {
      console.log(`  Correct Mileage: ${v.correctMileage.toLocaleString()} miles (from inspection history)`);
      console.log(`  Difference: ${(v.currentMileage - v.correctMileage).toLocaleString()} miles`);
    } else {
      console.log(`  Correct Mileage: UNKNOWN (no valid inspection history)`);
    }
    
    console.log(`  Last Updated: ${formatDateTime(v.lastUpdate)}`);
    console.log('');
  }

  // Apply fixes if in FIX_MODE
  if (FIX_MODE) {
    console.log('\n🔧 APPLYING FIXES...\n');
    
    let fixedCount = 0;
    let skippedCount = 0;

    for (const v of suspiciousVehicles) {
      if (!v.correctMileage) {
        console.log(`⏭️  Skipped ${v.reg_number}: No valid inspection history to determine correct mileage`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('vehicle_maintenance')
        .update({
          current_mileage: v.correctMileage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', v.maintenanceId);

      if (updateError) {
        console.error(`❌ Failed to fix ${v.reg_number}:`, updateError);
      } else {
        console.log(`✅ Fixed ${v.reg_number}: ${v.currentMileage} → ${v.correctMileage} miles`);
        fixedCount++;
      }
    }

    console.log(`\n✅ Successfully fixed ${fixedCount} vehicle(s)`);
    if (skippedCount > 0) {
      console.log(`⏭️  Skipped ${skippedCount} vehicle(s) (no valid inspection history)`);
    }
  } else {
    console.log('\n📊 READ-ONLY MODE - No changes made');
    console.log('   To apply fixes, run: FIX_MODE=true npx tsx scripts/check-all-suspicious-mileage.ts\n');
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Vehicles Checked: ${vehicles?.length || 0}`);
  console.log(`Suspicious Mileage Found: ${suspiciousVehicles.length}`);
  console.log(`Fixable: ${suspiciousVehicles.filter(v => v.correctMileage).length}`);
  console.log(`Test Patterns: ${SUSPICIOUS_MILEAGE.join(', ')}`);
  console.log('');
}

checkAllVehicles()
  .then(() => {
    console.log('Check complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
