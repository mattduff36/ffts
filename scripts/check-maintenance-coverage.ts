import pg from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkMaintenanceCoverage() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString);
  
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check ZZ99 vehicles
    console.log('🔍 Checking ZZ99 vehicles:');
    const zz99Query = await client.query(`
      SELECT 
        v.id,
        v.reg_number,
        v.status,
        CASE WHEN vm.id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_maintenance_record
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON v.id = vm.van_id
      WHERE v.reg_number LIKE 'ZZ99%'
      ORDER BY v.reg_number;
    `);
    console.table(zz99Query.rows);

    // Count all vehicles vs vehicles with maintenance
    console.log('\n📊 Coverage Statistics:');
    const statsQuery = await client.query(`
      SELECT 
        COUNT(v.id) as total_vehicles,
        COUNT(vm.id) as vehicles_with_maintenance,
        COUNT(v.id) - COUNT(vm.id) as vehicles_without_maintenance
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON v.id = vm.van_id
      WHERE v.status = 'active';
    `);
    console.table(statsQuery.rows);

    // List all vehicles without maintenance records
    console.log('\n⚠️  Vehicles WITHOUT maintenance records:');
    const missingQuery = await client.query(`
      SELECT 
        v.id,
        v.reg_number,
        v.status
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON v.id = vm.van_id
      WHERE vm.id IS NULL AND v.status = 'active'
      ORDER BY v.reg_number;
    `);
    console.table(missingQuery.rows);

    await client.end();
    console.log('\n✅ Check complete');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkMaintenanceCoverage();
