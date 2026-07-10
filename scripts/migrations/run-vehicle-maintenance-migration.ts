import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251218_create_vehicle_maintenance_system.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Vehicle Maintenance & Service System Migration...\n');
  console.log('📋 This migration creates:');
  console.log('   • maintenance_categories table (configurable thresholds)');
  console.log('   • vehicle_maintenance table (tracks all maintenance)');
  console.log('   • maintenance_history table (audit trail)');
  console.log('   • van_archive table (soft delete)');
  console.log('   • Auto-mileage update trigger');
  console.log('   • RBAC permissions');
  console.log('   • 5 default maintenance categories\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString as string);
  
  const client = new Client({
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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Verify tables were created
    console.log('🔍 Verifying database changes...\n');
    
    const verificationQueries = [
      { name: 'maintenance_categories', query: "SELECT COUNT(*) as count FROM maintenance_categories" },
      { name: 'vehicle_maintenance', query: "SELECT COUNT(*) as count FROM vehicle_maintenance" },
      { name: 'maintenance_history', query: "SELECT COUNT(*) as count FROM maintenance_history" },
      { name: 'van_archive', query: "SELECT COUNT(*) as count FROM van_archive" },
    ];

    for (const { name, query } of verificationQueries) {
      try {
        const result = await client.query(query);
        const count = result.rows[0].count;
        console.log(`   ✓ ${name}: ${count} records`);
      } catch {
        console.log(`   ❌ ${name}: Table not found or inaccessible`);
      }
    }

    console.log('\n📊 Database changes applied:');
    console.log('   ✓ Created 4 new tables for maintenance tracking');
    console.log('   ✓ Added RLS policies with RBAC integration');
    console.log('   ✓ Created auto-mileage update trigger');
    console.log('   ✓ Seeded 5 default maintenance categories:');
    console.log('      - Tax Due Date (30 days alert)');
    console.log('      - MOT Due Date (30 days alert)');
    console.log('      - Service Due (1000 miles alert)');
    console.log('      - Cambelt Replacement (5000 miles alert)');
    console.log('      - First Aid Kit Expiry (30 days alert)');
    console.log('   ✓ Added "maintenance" permission to admin/manager roles\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Next Steps:');
    console.log('   1. Run npm run db:validate');
    console.log('   2. Verify maintenance categories and permissions in the app');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err: unknown) {
    const pgErr = err as { message: string; detail?: string; hint?: string };
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', pgErr.message);
    if (pgErr.detail) {
      console.error('Details:', pgErr.detail);
    }
    if (pgErr.hint) {
      console.error('Hint:', pgErr.hint);
    }
    
    // Check if tables already exist
    if (pgErr.message?.includes('already exists')) {
      console.log('\n✅ Tables already exist - migration may have run before!');
      console.log('   If you need to re-run, drop the tables first.\n');
      process.exit(0);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check your .env.local has POSTGRES_URL_NON_POOLING');
    console.error('   2. Verify database connection string is correct');
    console.error('   3. Ensure you have database permissions');
    console.error('   4. Check the migration SQL for syntax errors\n');
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('📡 Database connection closed.\n');
  }
}

runMigration().catch(console.error);
