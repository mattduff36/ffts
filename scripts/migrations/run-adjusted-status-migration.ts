import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as pg from 'pg';
const { Client } = pg;

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
  console.log('🔄 Adding adjusted status to timesheets...\n');

  // Check for required environment variables
  const requiredVars = {
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    console.error('❌ Error: Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    process.exit(1);
  }

  // Read SQL file
  const sqlPath = join(process.cwd(), 'supabase', 'add-adjusted-status-to-timesheets.sql');
  let sql: string;
  
  try {
    sql = readFileSync(sqlPath, 'utf8');
    console.log(`📄 Loaded SQL from: ${sqlPath}\n`);
  } catch (error) {
    console.error('❌ Error: Could not read SQL file');
    console.error(error);
    process.exit(1);
  }

  const client = new Client({
    connectionString: requiredVars.POSTGRES_URL_NON_POOLING,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('🚀 Executing migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully\n');

    // Verify the migration
    console.log('🔍 Verifying migration...');
    
    // Check if new columns exist
    const { rows: columns } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'timesheets' 
      AND column_name IN ('adjusted_by', 'adjusted_at', 'adjustment_recipients', 'processed_at')
      ORDER BY column_name;
    `);

    console.log(`✅ Found ${columns.length} new columns:`);
    columns.forEach(col => console.log(`   - ${col.column_name}`));

    // Check if constraint allows new statuses
    const { rows: constraints } = await client.query(`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name = 'timesheets_status_check';
    `);

    if (constraints.length > 0) {
      console.log('\n✅ Status constraint updated successfully');
      console.log(`   ${constraints[0].check_clause}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('👉 Timesheet statuses now include: draft, submitted, approved, rejected, processed, adjusted');
    
  } catch (error: unknown) {
    console.error('\n❌ Migration failed:');
    if (error instanceof Error) {
      console.error(error.message);
      
      // Check if error is due to constraint already being correct
      if (error.message.includes('already exists') || error.message.includes('does not exist')) {
        console.log('\n💡 Note: This migration may have already been run.');
        console.log('   Verifying current state...\n');
        
        try {
          const { rows } = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'timesheets' 
            AND column_name IN ('adjusted_by', 'adjusted_at', 'adjustment_recipients', 'processed_at');
          `);
          
          if (rows.length === 4) {
            console.log('✅ All columns exist - migration was previously completed');
            process.exit(0);
          }
        } catch {
          console.error('Could not verify migration state');
        }
      }
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();

