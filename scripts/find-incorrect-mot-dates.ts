/**
 * Find vehicles that might have incorrect MOT due dates
 * based on their registration plate year
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function findIncorrectMotDates() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('🔍 Checking for vehicles with suspicious MOT due dates...');
    console.log('='.repeat(70));

    // Get all vehicles with their MOT data
    const result = await client.query(`
      SELECT 
        v.reg_number,
        v.created_at as vehicle_created,
        vm.mot_due_date,
        vm.last_mot_api_sync,
        vm.mot_api_sync_status
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON v.id = vm.van_id
      WHERE v.status = 'active'
      ORDER BY v.reg_number
    `);

    console.log(`\n📊 Found ${result.rows.length} active vehicles\n`);

    interface SuspiciousVehicle {
      reg: string;
      plateYear: number;
      expectedMotYear: number;
      actualMotYear: number;
      motDue: string;
      yearDiff: number;
      lastSync?: string;
      syncStatus?: string;
    }
    interface NotSyncedVehicle {
      reg: string;
      plateYear: number;
      expectedMotYear: number;
      actualMotYear: number;
      motDue: string;
    }
    const suspicious: SuspiciousVehicle[] = [];
    const notSynced: NotSyncedVehicle[] = [];

    for (const vehicle of result.rows) {
      const reg = vehicle.reg_number;
      const motDue = vehicle.mot_due_date;
      
      if (!motDue) {
        continue; // Skip vehicles without MOT due date
      }

      // Extract plate number (e.g., "24" from "AB12 CDE")
      const plateMatch = reg.match(/[A-Z]{2}(\d{2})/i);
      if (!plateMatch) {
        continue; // Skip non-standard plates
      }

      const plateNumber = parseInt(plateMatch[1]);
      let plateYear;

      // Determine plate year based on format
      if (plateNumber >= 0 && plateNumber <= 49) {
        // March-August format
        plateYear = 2000 + plateNumber;
      } else if (plateNumber >= 50) {
        // September-February format
        plateYear = 2000 + (plateNumber - 50);
      } else {
        continue;
      }

      // Expected MOT due year should be plate year + 3
      const expectedMotYear = plateYear + 3;
      
      // Extract MOT due year from database
      const motDueDate = new Date(motDue);
      const actualMotYear = motDueDate.getFullYear();

      // Check if there's a discrepancy
      if (actualMotYear !== expectedMotYear) {
        suspicious.push({
          reg,
          plateYear,
          expectedMotYear,
          actualMotYear,
          motDue: motDueDate.toISOString().split('T')[0],
          yearDiff: actualMotYear - expectedMotYear,
          lastSync: vehicle.last_mot_api_sync,
          syncStatus: vehicle.mot_api_sync_status
        });
      }

      // Also track vehicles that have never been synced
      if (!vehicle.last_mot_api_sync) {
        notSynced.push({
          reg,
          plateYear,
          expectedMotYear,
          actualMotYear,
          motDue: motDueDate.toISOString().split('T')[0]
        });
      }
    }

    // Report findings
    if (suspicious.length > 0) {
      console.log(`⚠️  Found ${suspicious.length} vehicles with suspicious MOT due dates:\n`);
      
      suspicious.forEach((v, i) => {
        console.log(`${i + 1}. ${v.reg}`);
        console.log(`   Plate year: ${v.plateYear}`);
        console.log(`   Expected MOT due year: ${v.expectedMotYear}`);
        console.log(`   Actual MOT due year: ${v.actualMotYear} (${v.yearDiff > 0 ? '+' : ''}${v.yearDiff} year)`);
        console.log(`   MOT due date: ${v.motDue}`);
        console.log(`   Last sync: ${v.lastSync || 'NEVER'}`);
        console.log(`   Sync status: ${v.syncStatus || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('✅ No vehicles found with suspicious MOT due dates');
    }

    if (notSynced.length > 0) {
      console.log(`\n📋 ${notSynced.length} vehicles have NEVER been synced with MOT API:`);
      notSynced.slice(0, 10).forEach(v => {
        console.log(`   - ${v.reg} (MOT due: ${v.motDue})`);
      });
      if (notSynced.length > 10) {
        console.log(`   ... and ${notSynced.length - 10} more`);
      }
    }

    console.log('\n' + '='.repeat(70));

    if (suspicious.length > 0 || notSynced.length > 0) {
      console.log('\n💡 RECOMMENDATION:');
      console.log('   Run a bulk sync for all vehicles to update MOT data:');
      console.log('   POST /api/maintenance/sync-dvla-scheduled');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

findIncorrectMotDates();

