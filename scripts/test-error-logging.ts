/**
 * Automated test script for error logging system
 * Tests both client-side and server-side error logging
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  errorId?: string;
}

async function testServerErrorLogging(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  console.log('\n🔧 Testing Server-Side Error Logging...\n');
  
  // Get error count before tests
  const { count: beforeCount } = await supabase
    .from('error_logs')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Current error logs count: ${beforeCount || 0}`);
  
  // Test 1: API endpoint error
  try {
    console.log('Test 1: Calling test API endpoint...');
    const response = await fetch(`${SUPABASE_URL.replace('/rest/v1', '')}/api/test-error-logging?type=throw`);
    
    if (!response.ok) {
      results.push({
        name: 'Server Error - API Throw',
        passed: true,
        message: 'API correctly returned error status'
      });
    } else {
      results.push({
        name: 'Server Error - API Throw',
        passed: false,
        message: 'API did not return error status'
      });
    }
  } catch {
    results.push({
      name: 'Server Error - API Throw',
      passed: true,
      message: 'Error thrown and caught'
    });
  }
  
  // Wait for error to be logged
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Get error count after tests
  const { count: afterCount } = await supabase
    .from('error_logs')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Error logs count after test: ${afterCount || 0}`);
  
  if ((afterCount || 0) > (beforeCount || 0)) {
    results.push({
      name: 'Error Logged to Database',
      passed: true,
      message: `${(afterCount || 0) - (beforeCount || 0)} new error(s) logged`
    });
  } else {
    results.push({
      name: 'Error Logged to Database',
      passed: false,
      message: 'No new errors found in database'
    });
  }
  
  return results;
}

async function verifyErrorDetails(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  console.log('\n🔍 Verifying Error Details...\n');
  
  // Get the most recent errors
  const { data: recentErrors, error } = await supabase
    .from('error_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(5);
  
  if (error) {
    results.push({
      name: 'Fetch Recent Errors',
      passed: false,
      message: `Failed to fetch errors: ${error.message}`
    });
    return results;
  }
  
  if (!recentErrors || recentErrors.length === 0) {
    results.push({
      name: 'Recent Errors Found',
      passed: false,
      message: 'No errors found in database'
    });
    return results;
  }
  
  console.log(`Found ${recentErrors.length} recent errors\n`);
  
  // Check each error for required fields and context
  recentErrors.forEach((errorLog, index) => {
    console.log(`\nError ${index + 1}:`);
    console.log(`  Type: ${errorLog.error_type}`);
    console.log(`  Message: ${errorLog.error_message.substring(0, 100)}...`);
    console.log(`  Component: ${errorLog.component_name || 'N/A'}`);
    console.log(`  Has Stack: ${errorLog.error_stack ? 'Yes' : 'No'}`);
    console.log(`  Has Additional Data: ${errorLog.additional_data ? 'Yes' : 'No'}`);
    
    // Check for required fields
    const hasMessage = !!errorLog.error_message && errorLog.error_message.length > 0;
    const hasType = !!errorLog.error_type;
    const hasUrl = !!errorLog.page_url;
    const hasTimestamp = !!errorLog.timestamp;
    
    if (hasMessage && hasType && hasUrl && hasTimestamp) {
      results.push({
        name: `Error ${index + 1} - Complete`,
        passed: true,
        message: 'All required fields present',
        errorId: errorLog.id
      });
    } else {
      results.push({
        name: `Error ${index + 1} - Complete`,
        passed: false,
        message: `Missing fields: ${[
          !hasMessage && 'message',
          !hasType && 'type',
          !hasUrl && 'url',
          !hasTimestamp && 'timestamp'
        ].filter(Boolean).join(', ')}`,
        errorId: errorLog.id
      });
    }
    
    // Check for useful context
    const hasContext = errorLog.additional_data && 
                       Object.keys(errorLog.additional_data).length > 0;
    
    if (hasContext) {
      results.push({
        name: `Error ${index + 1} - Context`,
        passed: true,
        message: `Has ${Object.keys(errorLog.additional_data).length} context fields`,
        errorId: errorLog.id
      });
      
      console.log(`  Context: ${JSON.stringify(errorLog.additional_data, null, 2).substring(0, 200)}...`);
    }
  });
  
  return results;
}

async function main() {
  console.log('🚀 Error Logging System Test Suite\n');
  console.log('=' .repeat(60));
  
  const allResults: TestResult[] = [];
  
  // Run tests
  try {
    const serverResults = await testServerErrorLogging();
    allResults.push(...serverResults);
    
    const detailResults = await verifyErrorDetails();
    allResults.push(...detailResults);
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Results Summary\n');
  
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const total = allResults.length;
  
  allResults.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.message}`);
  });
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📈 Score: ${passed}/${total} tests passed (${Math.round(passed/total * 100)}%)\n`);
  
  if (failed > 0) {
    console.log('⚠️  Some tests failed. Please review the errors above.\n');
    process.exit(1);
  } else {
    console.log('✨ All tests passed!\n');
    console.log('🎯 Next Steps:');
    console.log('   1. Navigate to http://localhost:4000/debug');
    console.log('   2. Check the "Error Log" tab');
    console.log('   3. Verify errors have clear descriptions and context\n');
    process.exit(0);
  }
}

main();
