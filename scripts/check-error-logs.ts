/**
 * Check Error Logs
 * 
 * Fetches and displays recent error logs from the error_logs table
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

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

function formatDateTime(value: Date | string | number): string {
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

async function checkErrorLogs() {
  console.log('🔍 CHECKING ERROR LOGS');
  console.log('======================\n');

  try {
    const { data: errors, error } = await supabase
      .from('error_logs')
      .select('*')
      .eq('status', 'active')
      .order('timestamp', { ascending: false })
      .limit(50);

    if (error) {
      console.error('❌ Error fetching logs:', error.message);
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        console.log('\n✅ error_logs table does not exist or is empty - this is fine for fresh installs');
      }
      return;
    }

    if (!errors || errors.length === 0) {
      console.log('✅ No errors in database - error log is clean!\n');
      return;
    }

    console.log(`Found ${errors.length} error log entries\n`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Group errors by type
    interface ErrorLogEntry {
      timestamp?: string | number | Date;
      error_message?: string;
      page_url?: string;
      component_name?: string;
      user_id?: string;
      error_stack?: string;
      additional_data?: unknown;
    }
    const errorsByType: Record<string, ErrorLogEntry[]> = {};
    errors.forEach((err: ErrorLogEntry & { error_type?: string }) => {
      const type = err.error_type || 'Unknown';
      if (!errorsByType[type]) {
        errorsByType[type] = [];
      }
      errorsByType[type].push(err);
    });

    // Display grouped errors
    for (const [type, typeErrors] of Object.entries(errorsByType)) {
      console.log(`\n📋 ${type} (${typeErrors.length} occurrences)`);
      console.log('─'.repeat(60));
      
      // Show first 3 of each type
      typeErrors.slice(0, 3).forEach((err, idx) => {
        const date = new Date(err.timestamp ?? Date.now());
        
        console.log(`\n  [${idx + 1}] ${formatDateTime(date)}`);
        console.log(`      Message: ${(err.error_message || '').substring(0, 200)}${(err.error_message || '').length > 200 ? '...' : ''}`);
        console.log(`      Page: ${err.page_url || 'Unknown'}`);
        if (err.component_name) {
          console.log(`      Component: ${err.component_name}`);
        }
        if (err.user_id) {
          console.log(`      User ID: ${err.user_id}`);
        }
        
        // Show stack trace first few lines if available
        if (err.error_stack) {
          const stackLines = err.error_stack.split('\n').slice(0, 3);
          console.log(`      Stack:`);
          stackLines.forEach((line: string) => {
            console.log(`        ${line.substring(0, 100)}`);
          });
        }
        
        // Show additional data if available
        if (err.additional_data) {
          console.log(`      Additional Data: ${JSON.stringify(err.additional_data).substring(0, 100)}`);
        }
      });
      
      if (typeErrors.length > 3) {
        console.log(`\n  ... and ${typeErrors.length - 3} more of this type`);
      }
    }

    // Check for test-related errors
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('TEST-RELATED ERRORS CHECK');
    console.log('═══════════════════════════════════════════════════════════\n');

    const testErrors = errors.filter(err => {
      const msg = (err.error_message || '').toLowerCase();
      const url = (err.page_url || '').toLowerCase();
      return msg.includes('test') || 
             msg.includes('te57') || 
             url.includes('test') ||
             url.includes('localhost:') ||
             msg.includes('999999') ||
             msg.includes('mock');
    });

    if (testErrors.length > 0) {
      console.log(`⚠️  Found ${testErrors.length} test-related errors:`);
      testErrors.forEach((err, idx) => {
        console.log(`\n  [${idx + 1}] ${err.error_type}`);
        console.log(`      ${err.error_message.substring(0, 100)}`);
        console.log(`      Page: ${err.page_url}`);
      });
    } else {
      console.log('✅ No test-related errors found');
    }

    // Summary
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Errors: ${errors.length}`);
    console.log(`Error Types: ${Object.keys(errorsByType).length}`);
    console.log(`Test-Related: ${testErrors.length}`);
    console.log(`Real Bugs: ${errors.length - testErrors.length} (estimated)`);
    
    // Oldest and newest
    const oldest = new Date(errors[errors.length - 1]?.timestamp);
    const newest = new Date(errors[0]?.timestamp);
    console.log(`\nDate Range:`);
    console.log(`  Oldest: ${oldest.toLocaleString()}`);
    console.log(`  Newest: ${newest.toLocaleString()}`);
    
    console.log('\n');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

checkErrorLogs()
  .then(() => {
    console.log('Check complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
