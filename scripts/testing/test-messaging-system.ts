/**
 * Comprehensive Automated Test Suite for Internal Messaging System
 * Tests: Database schema, API endpoints, message flow, role-based selection
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
void (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [] as Array<{ name: string; status: 'PASS' | 'FAIL'; message?: string }>
};

function logTest(name: string, passed: boolean, message?: string) {
  if (passed) {
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✅ ${name}`);
  } else {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', message });
    console.log(`❌ ${name}`);
    if (message) console.log(`   ${message}`);
  }
}

async function runTests() {
  console.log('\n🧪 Starting Messaging System Test Suite\n');
  console.log('='.repeat(60));
  console.log('\n📋 PHASE 1: Database Schema Tests\n');

  // Test 1: Verify messages table exists
  try {
    const { error } = await supabase
      .from('messages')
      .select('id')
      .limit(1);
    
    logTest('Messages table exists and is accessible', !error);
  } catch (error) {
    logTest('Messages table exists and is accessible', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Verify message_recipients table exists
  try {
    const { error } = await supabase
      .from('message_recipients')
      .select('id')
      .limit(1);
    
    logTest('Message_recipients table exists and is accessible', !error);
  } catch (error) {
    logTest('Message_recipients table exists and is accessible', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Verify profiles table has required fields
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, email')
      .limit(1);
    
    logTest('Profiles table has required fields for messaging', !error && data !== null);
  } catch (error) {
    logTest('Profiles table has required fields for messaging', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Check for test users (managers and employees)
  try {
    const { data: managers } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin', 'manager'])
      .limit(1);

    const { data: employees } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .like('role', 'employee-%')
      .limit(1);
    
    logTest('Test users exist (managers and employees)', 
      !!managers && managers.length > 0 && !!employees && employees.length > 0,
      !managers || managers.length === 0 ? 'No manager/admin users found' : !employees || employees.length === 0 ? 'No employee users found' : undefined
    );
  } catch (error) {
    logTest('Test users exist (managers and employees)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 2: Types and Enums Tests\n');

  // Test 5: Verify MESSAGE_TYPE enum
  try {
    const { error } = await supabase
      .from('messages')
      .select('type')
      .limit(0);
    
    logTest('MESSAGE_TYPE enum is defined', !error);
  } catch (error) {
    logTest('MESSAGE_TYPE enum is defined', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 6: Verify MESSAGE_PRIORITY enum
  try {
    const { error } = await supabase
      .from('messages')
      .select('priority')
      .limit(0);
    
    logTest('MESSAGE_PRIORITY enum is defined', !error);
  } catch (error) {
    logTest('MESSAGE_PRIORITY enum is defined', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 7: Verify MESSAGE_RECIPIENT_STATUS enum
  try {
    const { error } = await supabase
      .from('message_recipients')
      .select('status')
      .limit(0);
    
    logTest('MESSAGE_RECIPIENT_STATUS enum is defined', !error);
  } catch (error) {
    logTest('MESSAGE_RECIPIENT_STATUS enum is defined', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 3: Data Integrity Tests\n');

  // Test 8: Verify foreign key relationships
  try {
    const { error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        sender:sender_user_id (
          id,
          full_name
        )
      `)
      .not('sender_user_id', 'is', null)
      .limit(1);
    
    logTest('Messages->Profiles foreign key works', !msgError);
  } catch (error) {
    logTest('Messages->Profiles foreign key works', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 9: Verify message_recipients relationships
  try {
    const { error } = await supabase
      .from('message_recipients')
      .select(`
        id,
        message:message_id (id),
        user:user_id (id, full_name)
      `)
      .limit(1);
    
    logTest('Message_recipients relationships work', !error);
  } catch (error) {
    logTest('Message_recipients relationships work', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 4: Message Creation Tests\n');

  // Test 10: Create a test Toolbox Talk message
  let testMessageId: string | null = null;
  let testRecipientId: string | null = null;
  
  try {
    // Get a manager to be the sender
    const { data: manager } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'manager'])
      .limit(1)
      .single();

    if (!manager) {
      logTest('Create test Toolbox Talk message', false, 'No manager found to send message');
    } else {
      const { data: message, error } = await supabase
        .from('messages')
        .insert({
          type: 'TOOLBOX_TALK',
          subject: '[TEST] Automated Test Toolbox Talk',
          body: 'This is an automated test message. Please ignore.',
          priority: 'HIGH',
          sender_user_id: manager.id
        })
        .select()
        .single();

      if (!error && message) {
        testMessageId = message.id;
        logTest('Create test Toolbox Talk message', true);
      } else {
        logTest('Create test Toolbox Talk message', false, error?.message);
      }
    }
  } catch (error) {
    logTest('Create test Toolbox Talk message', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 11: Create test message recipient
  if (testMessageId) {
    try {
      const { data: employee } = await supabase
        .from('profiles')
        .select('id')
        .like('role', 'employee-%')
        .limit(1)
        .single();

      if (!employee) {
        logTest('Create test message recipient', false, 'No employee found');
      } else {
        const { data: recipient, error } = await supabase
          .from('message_recipients')
          .insert({
            message_id: testMessageId,
            user_id: employee.id,
            status: 'PENDING'
          })
          .select()
          .single();

        if (!error && recipient) {
          testRecipientId = recipient.id;
          logTest('Create test message recipient', true);
        } else {
          logTest('Create test message recipient', false, error?.message);
        }
      }
    } catch (error) {
      logTest('Create test message recipient', false, error instanceof Error ? error.message : 'Unknown error');
    }
  } else {
    logTest('Create test message recipient', false, 'Skipped - no test message created');
  }

  // Test 12: Update recipient status
  if (testRecipientId) {
    try {
      const { error } = await supabase
        .from('message_recipients')
        .update({ 
          status: 'SHOWN',
          first_shown_at: new Date().toISOString()
        })
        .eq('id', testRecipientId);

      logTest('Update recipient status', !error, error?.message);
    } catch (error) {
      logTest('Update recipient status', false, error instanceof Error ? error.message : 'Unknown error');
    }
  } else {
    logTest('Update recipient status', false, 'Skipped - no test recipient created');
  }

  // Test 13: Sign message (update to SIGNED)
  if (testRecipientId) {
    try {
      const { error } = await supabase
        .from('message_recipients')
        .update({ 
          status: 'SIGNED',
          signed_at: new Date().toISOString()
        })
        .eq('id', testRecipientId);

      logTest('Sign message (update to SIGNED)', !error, error?.message);
    } catch (error) {
      logTest('Sign message (update to SIGNED)', false, error instanceof Error ? error.message : 'Unknown error');
    }
  } else {
    logTest('Sign message (update to SIGNED)', false, 'Skipped - no test recipient created');
  }

  // Test 14: Create test Reminder message
  try {
    const { data: manager } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'manager'])
      .limit(1)
      .single();

    if (manager) {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          type: 'REMINDER',
          subject: '[TEST] Automated Test Reminder',
          body: 'This is an automated test reminder. Please ignore.',
          priority: 'LOW',
          sender_user_id: manager.id
        })
        .select()
        .single();

      logTest('Create test Reminder message', !error && !!data, error?.message);
    } else {
      logTest('Create test Reminder message', false, 'No manager found');
    }
  } catch (error) {
    logTest('Create test Reminder message', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 5: Query Tests\n');

  // Test 15: Query pending messages for user
  try {
    const { data: employee } = await supabase
      .from('profiles')
      .select('id')
      .like('role', 'employee-%')
      .limit(1)
      .single();

    if (employee) {
      const { error } = await supabase
        .from('message_recipients')
        .select(`
          id,
          status,
          message:message_id (
            id,
            type,
            subject,
            body
          )
        `)
        .eq('user_id', employee.id)
        .in('status', ['PENDING', 'SHOWN'])
        .order('created_at', { ascending: true });

      logTest('Query pending messages for user', !error, error?.message);
    } else {
      logTest('Query pending messages for user', false, 'No employee found');
    }
  } catch (error) {
    logTest('Query pending messages for user', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 16: Query notifications (last 60 days)
  try {
    const { data: employee } = await supabase
      .from('profiles')
      .select('id')
      .like('role', 'employee-%')
      .limit(1)
      .single();

    if (employee) {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const { error } = await supabase
        .from('message_recipients')
        .select(`
          id,
          status,
          signed_at,
          message:message_id (
            id,
            type,
            subject,
            body,
            priority,
            created_at,
            sender:sender_user_id (
              full_name
            )
          )
        `)
        .eq('user_id', employee.id)
        .is('cleared_from_inbox_at', null)
        .gte('created_at', sixtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      logTest('Query notifications (last 60 days)', !error, error?.message);
    } else {
      logTest('Query notifications (last 60 days)', false, 'No employee found');
    }
  } catch (error) {
    logTest('Query notifications (last 60 days)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 17: Query messages for reporting (manager view)
  try {
    const { error } = await supabase
      .from('messages')
      .select(`
        id,
        type,
        subject,
        body,
        priority,
        created_at,
        sender:sender_user_id (
          id,
          full_name
        )
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10);

    logTest('Query messages for reporting (manager view)', !error, error?.message);
  } catch (error) {
    logTest('Query messages for reporting (manager view)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 18: Count recipients by status
  try {
    const { data: messages } = await supabase
      .from('messages')
      .select('id')
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (messages) {
      const { error } = await supabase
        .from('message_recipients')
        .select('id, status')
        .eq('message_id', messages.id);

      logTest('Count recipients by status', !error, error?.message);
    } else {
      logTest('Count recipients by status', false, 'No messages found');
    }
  } catch (error) {
    logTest('Count recipients by status', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 6: Soft Delete Tests\n');

  // Test 19: Soft delete a message
  if (testMessageId) {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', testMessageId);

      logTest('Soft delete a message', !error, error?.message);
    } catch (error) {
      logTest('Soft delete a message', false, error instanceof Error ? error.message : 'Unknown error');
    }
  } else {
    logTest('Soft delete a message', false, 'Skipped - no test message created');
  }

  // Test 20: Verify soft-deleted messages are filtered
  if (testMessageId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .is('deleted_at', null)
        .eq('id', testMessageId);

      logTest('Verify soft-deleted messages are filtered', !error && (!data || data.length === 0), 
        error?.message || (data && data.length > 0 ? 'Soft-deleted message still appears' : undefined)
      );
    } catch (error) {
      logTest('Verify soft-deleted messages are filtered', false, error instanceof Error ? error.message : 'Unknown error');
    }
  } else {
    logTest('Verify soft-deleted messages are filtered', false, 'Skipped - no test message created');
  }

  console.log('\n📋 PHASE 7: Role-Based Query Tests\n');

  // Test 21: Get all users by role (for recipient selection)
  try {
    const { error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('role', 'employee-civils');

    logTest('Get users by specific role (employee-civils)', !error, error?.message);
  } catch (error) {
    logTest('Get users by specific role (employee-civils)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 22: Get all staff (all roles)
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name');

    logTest('Get all staff (all roles)', !error && data && data.length > 0, 
      error?.message || (!data || data.length === 0 ? 'No users found' : undefined)
    );
  } catch (error) {
    logTest('Get all staff (all roles)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 8: File Structure Tests\n');

  // Test 23: Verify types file exists
  try {
    // @ts-expect-error testing file existence
    await import('../types/messages');
    logTest('Types file (types/messages.ts) exists', true);
  } catch {
    logTest('Types file (types/messages.ts) exists', false, 'File not found or has errors');
  }

  // Test 24: Verify email utility exists
  try {
    // @ts-expect-error testing file existence
    const emailUtils = await import('../lib/utils/email');
    const hasSendFunction = typeof emailUtils.sendToolboxTalkEmail === 'function';
    logTest('Email utility (sendToolboxTalkEmail) exists', hasSendFunction, 
      !hasSendFunction ? 'sendToolboxTalkEmail function not found' : undefined
    );
  } catch (error) {
    logTest('Email utility (sendToolboxTalkEmail) exists', false, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('\n📋 PHASE 9: Component File Tests\n');

  // Test 25-30: Verify component files exist
  const components = [
    'BlockingMessageModal',
    'ReminderModal',
    'NotificationPanel',
    'MessageBlockingCheck',
    'CreateToolboxTalkForm',
    'CreateReminderForm',
    'MessagesReportView'
  ];

  for (const component of components) {
    try {
      await import(`../components/messages/${component}`);
      logTest(`Component (${component}.tsx) exists`, true);
    } catch {
      logTest(`Component (${component}.tsx) exists`, false, 'File not found or has errors');
    }
  }

  console.log('\n📋 PHASE 10: Cleanup Test Data\n');

  // Cleanup: Remove test messages
  try {
    const { error } = await supabase
      .from('messages')
      .delete()
      .like('subject', '[TEST]%');

    logTest('Cleanup test messages', !error, error?.message);
  } catch (error) {
    logTest('Cleanup test messages', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 TEST SUMMARY\n');
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n❌ FAILED TESTS:\n');
    results.tests
      .filter(t => t.status === 'FAIL')
      .forEach(t => {
        console.log(`  • ${t.name}`);
        if (t.message) console.log(`    ${t.message}`);
      });
  }

  console.log('\n' + '='.repeat(60) + '\n');

  return results.failed === 0;
}

// Run tests
runTests()
  .then(success => {
    if (success) {
      console.log('✅ All tests passed! System is ready for deployment.\n');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed. Please review and fix issues before deployment.\n');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Test suite crashed:', error);
    process.exit(1);
  });

