/**
 * Add Manual History Entry for CP17 TKO
 * 
 * Creates a maintenance_history entry for Example User Seven's recent service date update
 * that was missed due to the .single() bug.
 * 
 * Run with: npx tsx scripts/add-cp17-history-entry.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function addHistoryEntry() {
  console.log('🔄 Adding manual history entry for CP17 TKO...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Find CP17 TKO vehicle and maintenance record
    const vehicleQuery = `
      SELECT 
        v.id as van_id,
        v.reg_number,
        vm.*
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON vm.van_id = v.id
      WHERE v.reg_number = 'CP17 TKO'
    `;

    // Separate query to find Example User Seven's user ID
    const andyQuery = `
      SELECT id, full_name
      FROM profiles
      WHERE full_name ILIKE '%andy%hill%'
      LIMIT 1
    `;

    const { rows } = await client.query(vehicleQuery);
    
    if (rows.length === 0) {
      console.error('❌ Vehicle CP17 TKO not found');
      return;
    }

    const vehicle = rows[0];
    
    // Find Example User Seven
    const { rows: andyRows } = await client.query(andyQuery);
    const andy = andyRows.length > 0 ? andyRows[0] : null;
    
    console.log(`📋 Vehicle: ${vehicle.reg_number}`);
    console.log(`   Vehicle ID: ${vehicle.van_id}`);
    console.log(`   Current next_service_mileage: ${vehicle.next_service_mileage || 'Not set'}`);
    console.log(`   Last updated: ${vehicle.updated_at ? new Date(vehicle.updated_at).toLocaleString() : 'Never'}`);
    console.log(`   User: ${andy ? andy.full_name : 'Unknown'}\n`);

    if (!andy) {
      console.warn('⚠️  Warning: Example User Seven user not found, using generic name');
    }

    // Get the most recent update time from vehicle_maintenance
    // We'll use this as the timestamp for the history entry
    const updateTime = vehicle.updated_at || new Date().toISOString();

    // Check what fields have been updated recently
    // Since we don't have the old values, we'll create a generic history entry
    console.log('📝 Creating history entry for recent service date update...\n');

    // Check if a recent history entry already exists
    const checkQuery = `
      SELECT id FROM maintenance_history
      WHERE van_id = $1
        AND created_at >= NOW() - INTERVAL '1 day'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const { rows: recentHistory } = await client.query(checkQuery, [vehicle.van_id]);

    if (recentHistory.length > 0) {
      console.log('ℹ️  Recent history entry already exists (within last 24 hours)');
      console.log('   If you need to add more entries, please check the maintenance_history table.\n');
      return;
    }

    // Insert a history entry for the service date update
    const insertQuery = `
      INSERT INTO maintenance_history (
        van_id,
        field_name,
        old_value,
        new_value,
        value_type,
        comment,
        updated_by,
        updated_by_name,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    // We'll create an entry for the service mileage update
    const { rows: inserted } = await client.query(insertQuery, [
      vehicle.van_id,
      'next_service_mileage',
      null, // Old value unknown due to bug
      vehicle.next_service_mileage ? vehicle.next_service_mileage.toString() : null,
      'mileage',
      'Service date updated (manually backfilled - exact previous value not recorded due to system issue)',
      andy ? andy.id : null,
      andy ? andy.full_name : 'Example User Seven',
      updateTime
    ]);

    console.log('✅ History entry created successfully!\n');
    console.log('📋 Entry details:');
    console.log(`   ID: ${inserted[0].id}`);
    console.log(`   Field: ${inserted[0].field_name}`);
    console.log(`   New value: ${inserted[0].new_value}`);
    console.log(`   User: ${inserted[0].updated_by_name}`);
    console.log(`   Date: ${new Date(inserted[0].created_at).toLocaleString()}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Manual history entry added successfully!');
    console.log('   The client should now see this change in the history modal.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    console.error('\n❌ Failed to add history entry:', error instanceof Error ? error.message : String(error));
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
addHistoryEntry().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
