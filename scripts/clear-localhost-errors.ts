/**
 * Clear Localhost Development Errors
 * 
 * Removes error logs from localhost development to clean up the error log
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

async function clearLocalhostErrors() {
  console.log('🧹 CLEARING LOCALHOST DEVELOPMENT ERRORS');
  console.log('========================================\n');

  try {
    // First, count how many we have
    const { data: localhostErrors } = await supabase
      .from('error_logs')
      .select('id')
      .eq('status', 'active')
      .ilike('page_url', '%localhost%');

    const localhostCount = localhostErrors?.length || 0;

    if (localhostCount === 0) {
      console.log('✅ No localhost errors found - log is already clean!\n');
      return;
    }

    console.log(`Found ${localhostCount} localhost development errors to clear\n`);

    const { error: archiveError } = await supabase
      .from('error_logs')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
      })
      .eq('status', 'active')
      .ilike('page_url', '%localhost%');

    if (archiveError) {
      console.error('❌ Error archiving logs:', archiveError);
      return;
    }

    console.log(`✅ Archived ${localhostCount} localhost development errors\n`);

    const { data: remaining } = await supabase
      .from('error_logs')
      .select('id, timestamp, error_message, page_url')
      .eq('status', 'active')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (!remaining || remaining.length === 0) {
      console.log('✅ Error log is now completely clean!\n');
    } else {
      console.log(`📋 ${remaining.length} production errors remaining:\n`);
      remaining.forEach((err, idx) => {
        console.log(`  [${idx + 1}] ${new Date(err.timestamp).toLocaleString()}`);
        console.log(`      ${err.error_message.substring(0, 80)}...`);
        console.log(`      ${err.page_url}\n`);
      });
    }

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

clearLocalhostErrors()
  .then(() => {
    console.log('Complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
