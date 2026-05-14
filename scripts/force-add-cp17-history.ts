/**
 * Force add history entry for CP17 TKO - Example User Seven's service update
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

async function forceAddHistory() {
  console.log('🔄 Force adding history entry for CP17 TKO service update...\n');

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

    // Get vehicle and Example User Seven
    const { rows: vehicles } = await client.query(`
      SELECT v.id as van_id, v.reg_number, vm.*
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON vm.van_id = v.id
      WHERE v.reg_number = 'CP17 TKO'
    `);

    if (vehicles.length === 0) {
      console.error('❌ Vehicle not found');
      return;
    }

    const vehicle = vehicles[0];

    const { rows: users } = await client.query(`
      SELECT id, full_name
      FROM profiles
      WHERE full_name ILIKE '%andy%hill%'
      LIMIT 1
    `);

    const andy = users.length > 0 ? users[0] : null;

    console.log(`Vehicle: ${vehicle.reg_number}`);
    console.log(`Current next_service_mileage: ${vehicle.next_service_mileage}`);
    console.log(`Last updated: ${new Date(vehicle.updated_at).toLocaleString()}`);
    console.log(`User: ${andy ? andy.full_name : 'Example User Seven'}\n`);

    // Create the history entry
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

    const { rows: inserted } = await client.query(insertQuery, [
      vehicle.van_id,
      'next_service_mileage',
      null, // We don't know the old value
      vehicle.next_service_mileage ? vehicle.next_service_mileage.toString() : null,
      'mileage',
      'Updated service mileage schedule',
      andy ? andy.id : null,
      andy ? andy.full_name : 'Example User Seven',
      vehicle.updated_at // Use the actual update time from the maintenance record
    ]);

    console.log('✅ History entry created!\n');
    console.log('Entry details:');
    console.log(`  Field: ${inserted[0].field_name}`);
    console.log(`  New value: ${inserted[0].new_value} miles`);
    console.log(`  User: ${inserted[0].updated_by_name}`);
    console.log(`  Date: ${new Date(inserted[0].created_at).toLocaleString()}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ History entry added! Client should now see it.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await client.end();
  }
}

forceAddHistory();
