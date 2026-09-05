/**
 * Analyze Production Errors
 * 
 * Detailed analysis of remaining production errors
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

async function analyzeProductionErrors() {
  console.log('🔍 DETAILED PRODUCTION ERROR ANALYSIS');
  console.log('======================================\n');

  try {
    const { data: errors } = await supabase
      .from('error_logs')
      .select('*')
      .eq('status', 'active')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (!errors || errors.length === 0) {
      console.log('✅ No errors in database!\n');
      return;
    }

    // Analyze subcategory deletion error
    const subcategoryErrors = errors.filter(e => 
      e.error_message?.includes('delete subcategory') || 
      e.error_message?.includes('Cannot delete')
    );

    if (subcategoryErrors.length > 0) {
      console.log('🔴 SUBCATEGORY DELETION ERROR');
      console.log('─'.repeat(60));
      const err = subcategoryErrors[0];
      console.log('Time:', new Date(err.timestamp).toLocaleString());
      console.log('Full Message:', err.error_message);
      console.log('Page:', err.page_url);
      console.log('Component:', err.component_name || 'Unknown');
      console.log('User ID:', err.user_id || 'Unknown');
      
      if (err.error_stack) {
        console.log('\nStack Trace:');
        err.error_stack.split('\n').slice(0, 10).forEach((line: string) => {
          console.log('  ', line);
        });
      }
      
      if (err.additional_data) {
        console.log('\nAdditional Data:', JSON.stringify(err.additional_data, null, 2));
      }
      console.log('\n');
    }

    // Analyze message dismissal errors
    const messageErrors = errors.filter(e => 
      e.error_message?.includes('dismiss') || 
      e.error_message?.includes('Failed to dismiss message')
    );

    if (messageErrors.length > 0) {
      console.log('🟡 MESSAGE DISMISSAL ERRORS');
      console.log('─'.repeat(60));
      console.log(`Total occurrences: ${messageErrors.length}`);
      console.log(`All occurred: ${new Date(messageErrors[messageErrors.length - 1].timestamp).toLocaleString()} - ${new Date(messageErrors[0].timestamp).toLocaleString()}`);
      console.log('\nFirst occurrence details:');
      const err = messageErrors[0];
      console.log('Full Message:', err.error_message);
      console.log('Page:', err.page_url);
      
      if (err.error_stack) {
        console.log('\nStack Trace:');
        err.error_stack.split('\n').slice(0, 10).forEach((line: string) => {
          console.log('  ', line);
        });
      }
      
      if (err.additional_data) {
        console.log('\nAdditional Data:', JSON.stringify(err.additional_data, null, 2));
      }
      console.log('\n');
    }

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Production Errors: ${errors.length}`);
    console.log(`Subcategory Deletion Errors: ${subcategoryErrors.length}`);
    console.log(`Message Dismissal Errors: ${messageErrors.length}`);
    console.log('\n');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

analyzeProductionErrors()
  .then(() => {
    console.log('Analysis complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
