/**
 * Investigate and Fix Test-Corrupted Vehicle Records
 * 
 * This script identifies vehicles that were corrupted by integration tests
 * and reverts them to their correct mileage based on inspection history.
 * 
 * SAFETY: This script is READ-ONLY by default. Set FIX_MODE=true to apply fixes.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const FIX_MODE = process.env.FIX_MODE === 'true';

// Test mileage values that indicate corruption - Obviously invalid values for easy detection
const SUSPICIOUS_MILEAGE = [999999, 999998, 999997, 999996, 999995, 999994, 999993, 50000, 28000, 27000, 26000, 25000];

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

interface VehicleWithMaintenance {
  id: string;
  reg_number: string;
  nickname: string;
  status: string;
  vehicle_maintenance: Array<{
    id: string;
    current_mileage: number;
    updated_at: string;
  }>;
}

interface Inspection {
  id: string;
  current_mileage: number;
  inspection_date: string;
  status: string;
  created_at: string;
}

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

async function investigateVehicles() {
  console.log('🔍 INVESTIGATING TEST-CORRUPTED VEHICLES');
  console.log('=========================================\n');
  console.log(`Mode: ${FIX_MODE ? '⚠️  FIX MODE (WILL MODIFY DATA)' : '📊 READ-ONLY (NO CHANGES)'}\n`);

  // Get all non-ZZ99 vehicles (real production vehicles)
  const { data: vehicles, error } = await supabase
    .from('vans')
    .select(`
      id,
      reg_number,
      nickname,
      status,
      vehicle_maintenance(id, current_mileage, updated_at)
    `)
    .not('reg_number', 'ilike', 'ZZ99%')
    .neq('status', 'deleted')
    .order('reg_number');

  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles found.');
    return;
  }

  console.log(`Found ${vehicles.length} production vehicles (excluding ZZ99 test vehicles)\n`);

  const corruptedVehicles: Array<{
    vehicle: VehicleWithMaintenance;
    currentMileage: number;
    correctMileage: number;
    lastUpdate: string;
    reason: string;
  }> = [];

  // Check each vehicle for suspicious mileage
  for (const vehicle of vehicles as VehicleWithMaintenance[]) {
    const maintenance = vehicle.vehicle_maintenance?.[0];
    
    if (!maintenance) {
      continue; // No maintenance record
    }

    // Check if current mileage is suspicious
    if (SUSPICIOUS_MILEAGE.includes(maintenance.current_mileage)) {
      // Get inspection history to find correct mileage
      const { data: inspections } = await supabase
        .from('van_inspections')
        .select('id, current_mileage, inspection_date, status, created_at')
        .eq('van_id', vehicle.id)
        .not('current_mileage', 'is', null)
        .order('inspection_date', { ascending: false })
        .limit(10);

      if (!inspections || inspections.length === 0) {
        continue; // No inspections with mileage
      }

      // Filter out inspections with suspicious test mileage
      const realInspections = (inspections as Inspection[]).filter(
        i => i.status === 'submitted' && !SUSPICIOUS_MILEAGE.includes(i.current_mileage)
      );

      if (realInspections.length > 0) {
        const mostRecent = realInspections[0];
        
        // Check if maintenance record was updated in last 48 hours
        const lastUpdateTime = new Date(maintenance.updated_at).getTime();
        const hoursAgo = (Date.now() - lastUpdateTime) / (1000 * 60 * 60);

        if (hoursAgo <= 72) { // Extended to 72 hours for safety
          corruptedVehicles.push({
            vehicle,
            currentMileage: maintenance.current_mileage,
            correctMileage: mostRecent.current_mileage,
            lastUpdate: maintenance.updated_at,
            reason: `Suspicious mileage ${maintenance.current_mileage} (test pattern), should be ${mostRecent.current_mileage} from inspection ${mostRecent.inspection_date}`,
          });
        }
      }
    }
  }

  // Report findings
  if (corruptedVehicles.length === 0) {
    console.log('✅ No corrupted vehicles found in the last 72 hours!');
    console.log('   All production vehicles appear to have correct mileage.\n');
    return;
  }

  console.log(`\n⚠️  FOUND ${corruptedVehicles.length} CORRUPTED VEHICLE(S)\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const corrupted of corruptedVehicles) {
    console.log(`Vehicle: ${corrupted.vehicle.reg_number} (${corrupted.vehicle.nickname || 'No nickname'})`);
    console.log(`  Current Mileage: ${corrupted.currentMileage.toLocaleString()} miles ❌`);
    console.log(`  Correct Mileage: ${corrupted.correctMileage.toLocaleString()} miles ✅`);
    console.log(`  Difference: ${(corrupted.currentMileage - corrupted.correctMileage).toLocaleString()} miles`);
    console.log(`  Last Updated: ${formatDateTime(corrupted.lastUpdate)}`);
    console.log(`  Reason: ${corrupted.reason}`);
    console.log('');
  }

  // Apply fixes if in FIX_MODE
  if (FIX_MODE) {
    console.log('\n🔧 APPLYING FIXES...\n');
    
    let fixedCount = 0;
    for (const corrupted of corruptedVehicles) {
      const maintenanceId = corrupted.vehicle.vehicle_maintenance[0].id;
      
      const { error: updateError } = await supabase
        .from('vehicle_maintenance')
        .update({
          current_mileage: corrupted.correctMileage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', maintenanceId);

      if (updateError) {
        console.error(`❌ Failed to fix ${corrupted.vehicle.reg_number}:`, updateError);
      } else {
        console.log(`✅ Fixed ${corrupted.vehicle.reg_number}: ${corrupted.currentMileage} → ${corrupted.correctMileage} miles`);
        fixedCount++;
      }
    }

    console.log(`\n✅ Successfully fixed ${fixedCount} of ${corruptedVehicles.length} vehicle(s)`);
  } else {
    console.log('\n📊 READ-ONLY MODE - No changes made');
    console.log('   To apply fixes, run: FIX_MODE=true npx tsx scripts/investigate-test-corrupted-vehicles.ts\n');
  }

  // Summary statistics
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total Production Vehicles: ${vehicles.length}`);
  console.log(`Corrupted Vehicles Found: ${corruptedVehicles.length}`);
  console.log(`Test Mileage Patterns: ${SUSPICIOUS_MILEAGE.join(', ')}`);
  console.log(`Time Window: Last 72 hours`);
  
  if (FIX_MODE) {
    console.log('\n⚠️  Database modifications were applied.');
  }
  
  console.log('\n');
}

// Run the investigation
investigateVehicles()
  .then(() => {
    console.log('Investigation complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
