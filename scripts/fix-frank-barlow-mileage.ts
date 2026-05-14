/**
 * Fix Example Vehicle's vehicle mileage issue
 * This script:
 * 1. Finds the vehicle FE24 TVV with nickname "Example Vehicle"
 * 2. Checks current mileage and history
 * 3. Identifies any test inspections that corrupted the data
 * 4. Fixes the mileage to the correct value
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixMileage() {
  console.log('🔧 Fixing Example Vehicle vehicle mileage issue...\n');

  try {
    // 1. Find vehicle with registration AB12 CDE (Example Vehicle)
    console.log('📋 Step 1: Finding vehicle AB12 CDE (Example Vehicle)...');
    const { data: vehicles, error: vehicleError } = await supabase
      .from('vans')
      .select('*')
      .eq('reg_number', 'AB12 CDE');

    if (vehicleError || !vehicles || vehicles.length === 0) {
      console.log('❌ Vehicle not found. Trying variations...');
      
      // Try without space
      const { data: vehicles2 } = await supabase
        .from('vans')
        .select('*')
        .eq('reg_number', 'FE24TVV');
      
      if (!vehicles2 || vehicles2.length === 0) {
        console.log('❌ Still not found. Listing all FE24 vehicles:');
        const { data: allFE24 } = await supabase
          .from('vans')
          .select('*')
          .ilike('reg_number', 'FE24%');
        
        console.log('\nFound FE24 vehicles:');
        allFE24?.forEach(v => {
          console.log(`  - ${v.reg_number} (nickname: ${v.nickname})`);
        });
        
        console.log('\n❌ Cannot proceed without finding the correct vehicle.');
        console.log('Please check the registration number in the screenshot.');
        return;
      }
    }

    const vehicle = vehicles![0];
    console.log('✅ Found vehicle:');
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   Registration: ${vehicle.reg_number}`);
    console.log(`   Nickname: ${vehicle.nickname}`);
    console.log(`   Status: ${vehicle.status}`);

    // 2. Check current maintenance record
    console.log('\n📋 Step 2: Checking current maintenance record...');
    const { data: maintenance } = await supabase
      .from('vehicle_maintenance')
      .select('*')
      .eq('van_id', vehicle.id)
      .single();

    if (!maintenance) {
      console.log('⚠️  No maintenance record found');
    } else {
      console.log('✅ Current maintenance:');
      console.log(`   Current Mileage: ${maintenance.current_mileage}`);
      console.log(`   Last Updated: ${maintenance.last_mileage_update}`);
      console.log(`   Service Due: ${maintenance.next_service_mileage}`);
    }

    // 3. Check all inspections for this vehicle
    console.log('\n📋 Step 3: Checking all inspections...');
    const { data: inspections } = await supabase
      .from('van_inspections')
      .select('*')
      .eq('van_id', vehicle.id)
      .order('created_at', { ascending: false });

    console.log(`\nFound ${inspections?.length || 0} inspections:`);
    
    const suspicious: typeof inspections = [];
    inspections?.forEach((insp, i) => {
      const date = new Date(insp.created_at).toLocaleDateString();
      console.log(`   ${i + 1}. ${date} - ${insp.current_mileage} miles - ${insp.status}`);
      
      if (insp.current_mileage === 50000) {
        suspicious.push(insp);
      }
    });

    if (suspicious.length > 0) {
      console.log(`\n⚠️  FOUND ${suspicious.length} SUSPICIOUS INSPECTIONS WITH 50000 MILES:`);
      suspicious.forEach((insp, i) => {
        console.log(`   ${i + 1}. Created: ${insp.created_at}`);
        console.log(`      ID: ${insp.id}`);
        console.log(`      Status: ${insp.status}`);
      });
      
      console.log('\n🔍 These inspections were likely created by test scripts.');
      console.log('   The database trigger automatically updated the mileage.');
    }

    // 4. Calculate correct mileage
    console.log('\n📋 Step 4: Determining correct mileage...');
    
    const realInspections = inspections?.filter(i => i.current_mileage !== 50000) || [];
    
    if (realInspections.length === 0) {
      console.log('⚠️  No real inspections found (all have 50000 miles)');
      console.log('   Cannot determine correct mileage automatically.');
      console.log('   Please manually specify the correct mileage.');
      return;
    }

    // Get the most recent non-50000 mileage
    const latestRealInspection = realInspections[0];
    const correctMileage = latestRealInspection.current_mileage;
    
    console.log(`✅ Latest real inspection:`);
    console.log(`   Date: ${new Date(latestRealInspection.created_at).toLocaleDateString()}`);
    console.log(`   Mileage: ${correctMileage}`);
    console.log(`\n   This should be the correct mileage (or close to it).`);

    // 5. Delete test inspections
    if (suspicious.length > 0) {
      console.log('\n📋 Step 5: Deleting test inspections...');
      
      for (const insp of suspicious) {
        const { error: deleteError } = await supabase
          .from('van_inspections')
          .delete()
          .eq('id', insp.id);
        
        if (deleteError) {
          console.log(`   ❌ Failed to delete ${insp.id}: ${deleteError.message}`);
        } else {
          console.log(`   ✅ Deleted test inspection ${insp.id}`);
        }
      }
    }

    // 6. Update maintenance record with correct mileage
    console.log('\n📋 Step 6: Updating maintenance record...');
    
    const { error: updateError } = await supabase
      .from('vehicle_maintenance')
      .update({
        current_mileage: correctMileage,
        last_mileage_update: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('van_id', vehicle.id);

    if (updateError) {
      console.log(`❌ Failed to update: ${updateError.message}`);
    } else {
      console.log(`✅ Updated mileage to ${correctMileage}`);
    }

    // 7. Verify fix
    console.log('\n📋 Step 7: Verifying fix...');
    const { data: updatedMaintenance } = await supabase
      .from('vehicle_maintenance')
      .select('*')
      .eq('van_id', vehicle.id)
      .single();

    console.log('✅ Current maintenance record:');
    console.log(`   Current Mileage: ${updatedMaintenance?.current_mileage}`);
    console.log(`   Last Updated: ${updatedMaintenance?.last_mileage_update}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ FIX COMPLETE');
    console.log('='.repeat(60));
    console.log('\nSummary:');
    console.log(`- Deleted ${suspicious.length} test inspections`);
    console.log(`- Restored mileage to ${correctMileage} (from latest real inspection)`);
    console.log('- Maintenance record updated');
    
    console.log('\n⚠️  IMPORTANT:');
    console.log('The test script "test-inspection-draft.ts" should NOT be run');
    console.log('against production data. It uses hardcoded test values (50000 miles)');
    console.log('that corrupt real vehicle data.');
    
  } catch (err: unknown) {
    console.error('\n❌ Fix failed:', err);
    process.exit(1);
  }
}

fixMileage();
