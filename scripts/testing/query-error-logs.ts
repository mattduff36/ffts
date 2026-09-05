/**
 * Script to query error_logs table and retrieve all errors
 */

import { config } from 'dotenv';
import { join } from 'path';
import pg from 'pg';

// Load environment variables
config({ path: join(process.cwd(), '.env.local') });

const { Client } = pg;

async function queryErrorLogs() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment variables');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString);
  
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
    console.log('🔍 Querying error_logs table...\n');

    await client.connect();
    console.log('✅ Connected to database\n');

    // Query all errors ordered by timestamp descending
    const result = await client.query(`
      SELECT 
        id,
        timestamp,
        error_message,
        error_stack,
        error_type,
        user_id,
        user_email,
        page_url,
        user_agent,
        component_name,
        additional_data
      FROM error_logs
      WHERE status = 'active'
      ORDER BY timestamp DESC
      LIMIT 100
    `);

    console.log(`📊 Found ${result.rows.length} error log entries\n`);
    
    if (result.rows.length > 0) {
      console.log('='.repeat(100));
      result.rows.forEach((row, index) => {
        console.log(`\n[${index + 1}] ERROR LOG ENTRY`);
        console.log(`ID: ${row.id}`);
        console.log(`Timestamp: ${new Date(row.timestamp).toLocaleString('en-GB')}`);
        console.log(`Type: ${row.error_type}`);
        console.log(`Component: ${row.component_name || 'N/A'}`);
        console.log(`User Email: ${row.user_email || 'Anonymous'}`);
        console.log(`Page URL: ${row.page_url}`);
        console.log(`Error Message: ${row.error_message}`);
        
        if (row.error_stack) {
          console.log(`\nStack Trace:`);
          console.log(row.error_stack);
        }
        
        if (row.additional_data && Object.keys(row.additional_data).length > 0) {
          console.log(`\nAdditional Data:`);
          console.log(JSON.stringify(row.additional_data, null, 2));
        }
        
        console.log('='.repeat(100));
      });
    }

    console.log('\n✅ Query completed successfully\n');
  } catch (error) {
    console.error('❌ Error querying error_logs:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

queryErrorLogs();
