import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function backupDatabase() {
  console.log('🔒 Starting Full Database Backup...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const url = new URL(connectionString!);
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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFileName = `database-backup-${timestamp}.sql`;
    const backupPath = resolve(process.cwd(), 'backups', backupFileName);

    let backupSQL = `-- ========================================\n`;
    backupSQL += `-- FIELDOPS TEMPLATE DATABASE BACKUP\n`;
    backupSQL += `-- Created: ${new Date().toISOString()}\n`;
    backupSQL += `-- ========================================\n\n`;

    // List of all tables to backup
    const tables = [
      'profiles',
      'timesheets',
      'timesheet_entries',
      'van_inspections',
      'plant_inspections',
      'inspection_categories',
      'inspection_items',
      'actions',
      'absences',
      'absence_reasons',
      'absence_allowances',
      'rams_documents',
      'rams_assignments',
      'messages',
      'message_recipients',
      'vehicles'
    ];

    console.log('📊 Backing up tables:\n');

    for (const table of tables) {
      try {
        console.log(`   📦 Backing up: ${table}...`);
        
        // Get table structure
        await client.query(`
          SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `, [table]);

        // Get row count
        const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
        const rowCount = parseInt(countResult.rows[0].count);

        backupSQL += `-- ========================================\n`;
        backupSQL += `-- Table: ${table} (${rowCount} rows)\n`;
        backupSQL += `-- ========================================\n\n`;

        // Get all data
        const dataResult = await client.query(`SELECT * FROM ${table}`);
        
        if (dataResult.rows.length > 0) {
          // Get column names
          const columns = Object.keys(dataResult.rows[0]);
          
          backupSQL += `-- Data for ${table}\n`;
          backupSQL += `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
          
          dataResult.rows.forEach((row, index) => {
            const values = columns.map(col => {
              const val = row[col];
              if (val === null) return 'NULL';
              if (typeof val === 'string') {
                // Escape single quotes
                return `'${val.replace(/'/g, "''")}'`;
              }
              if (val instanceof Date) {
                return `'${val.toISOString()}'`;
              }
              if (typeof val === 'boolean') {
                return val ? 'TRUE' : 'FALSE';
              }
              if (typeof val === 'object') {
                return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
              }
              return val;
            });
            
            const isLast = index === dataResult.rows.length - 1;
            backupSQL += `  (${values.join(', ')})${isLast ? ';\n\n' : ',\n'}`;
          });
        } else {
          backupSQL += `-- No data in ${table}\n\n`;
        }

        console.log(`   ✅ ${table}: ${rowCount} rows backed up`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`   ⚠️  ${table}: Table not found or error - ${msg}`);
        backupSQL += `-- Table ${table} could not be backed up: ${msg}\n\n`;
      }
    }

    // Get database statistics
    console.log('\n📈 Gathering database statistics...');
    
    backupSQL += `-- ========================================\n`;
    backupSQL += `-- DATABASE STATISTICS\n`;
    backupSQL += `-- ========================================\n\n`;

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        const count = result.rows[0].count;
        backupSQL += `-- ${table}: ${count} rows\n`;
      } catch (_err: unknown) {
        // Table doesn't exist, skip
      }
    }

    backupSQL += `\n-- End of backup\n`;

    // Create backups directory if it doesn't exist
    const { mkdirSync } = await import('fs');
    try {
      mkdirSync(resolve(process.cwd(), 'backups'), { recursive: true });
    } catch (_err: unknown) {
      // Directory already exists
    }

    // Write backup file
    writeFileSync(backupPath, backupSQL, 'utf-8');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ BACKUP COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📁 Backup file created:');
    console.log(`   ${backupPath}\n`);
    
    console.log('💾 File size:', (backupSQL.length / 1024 / 1024).toFixed(2), 'MB\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 NEXT STEPS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('1. Download the backup file from the backups/ directory');
    console.log('2. Store it in a safe location (external drive, cloud storage)');
    console.log('3. Verify the file can be opened and contains data');
    console.log('4. Only after confirming backup, proceed with migration\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  DO NOT PROCEED WITH MIGRATION UNTIL BACKUP IS VERIFIED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err: unknown) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ BACKUP FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error:', msg);
    if (err instanceof Error && err.stack) {
      console.error('Stack:', err.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

backupDatabase().catch(console.error);

