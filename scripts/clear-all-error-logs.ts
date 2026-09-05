/**
 * Untrusted debug helper: archive every active error_logs row.
 * Not snapshot-bound. Not part of fixerrors-exact-snapshot-v4.
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

async function clearAllErrorLogs() {
  console.log('UNTRUSTED ARCHIVE OF ACTIVE ERROR LOGS');
  console.log('======================================\n');

  try {
    const { data: current, error: countError } = await supabase
      .from('error_logs')
      .select('id')
      .eq('status', 'active');

    if (countError) {
      console.error('Error counting active logs:', countError);
      process.exit(1);
    }

    const currentCount = current?.length || 0;

    if (currentCount === 0) {
      console.log('No active error logs to archive.\n');
      return;
    }

    console.log(`Found ${currentCount} active error log entries\n`);

    const { error } = await supabase
      .from('error_logs')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
      })
      .eq('status', 'active');

    if (error) {
      console.error('Error archiving logs:', error);
      process.exit(1);
    }

    console.log(`Archived ${currentCount} active error log entries\n`);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

clearAllErrorLogs()
  .then(() => {
    console.log('Complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
