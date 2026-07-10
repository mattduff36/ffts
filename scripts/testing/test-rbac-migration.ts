/**
 * Comprehensive RBAC Migration Test Suite
 * 
 * Tests:
 * 1. Database structure and integrity
 * 2. Role and permission data
 * 3. API endpoints with new role system
 * 4. Permission checks
 * 5. User role assignments
 * 6. Backward compatibility
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

const results: TestResult[] = [];
let totalTests = 0;
let passedTests = 0;

function logTest(name: string, passed: boolean, message: string, details?: unknown) {
  totalTests++;
  if (passed) passedTests++;
  
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}: ${message}`);
  if (details) {
    console.log(`   Details:`, details);
  }
  
  results.push({ name, passed, message, details });
}

async function runTests() {
  console.log('🚀 Starting RBAC Migration Test Suite\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  
  if (!connectionString) {
    console.error('❌ Missing database connection string');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString);
  
  const pgClient = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    await pgClient.connect();
    console.log('📡 Connected to database\n');

    // ========================================
    // TEST 1: Database Structure
    // ========================================
    console.log('📋 TEST GROUP 1: Database Structure\n');

    // Test 1.1: Roles table exists
    const rolesTable = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'roles'
      );
    `);
    logTest(
      'Test 1.1',
      rolesTable.rows[0].exists,
      'Roles table exists'
    );

    // Test 1.2: Role_permissions table exists
    const permissionsTable = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'role_permissions'
      );
    `);
    logTest(
      'Test 1.2',
      permissionsTable.rows[0].exists,
      'Role_permissions table exists'
    );

    // Test 1.3: Profiles.role_id column exists
    const roleIdColumn = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles'
        AND column_name = 'role_id'
      );
    `);
    logTest(
      'Test 1.3',
      roleIdColumn.rows[0].exists,
      'Profiles.role_id column exists'
    );

    // Test 1.4: Profiles.super_admin column exists
    const superAdminColumn = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles'
        AND column_name = 'super_admin'
      );
    `);
    logTest(
      'Test 1.4',
      superAdminColumn.rows[0].exists,
      'Profiles.super_admin column exists'
    );

    // ========================================
    // TEST 2: Role Data Integrity
    // ========================================
    console.log('\n📋 TEST GROUP 2: Role Data Integrity\n');

    // Test 2.1: Roles exist
    const rolesCount = await pgClient.query('SELECT COUNT(*) FROM roles');
    const hasRoles = parseInt(rolesCount.rows[0].count) > 0;
    logTest(
      'Test 2.1',
      hasRoles,
      `Roles table populated (${rolesCount.rows[0].count} roles)`
    );

    // Test 2.2: Required roles exist
    const requiredRoles = await pgClient.query(`
      SELECT name FROM roles 
      WHERE name IN ('admin', 'manager', 'employee-civils', 'employee-transport')
    `);
    const hasRequiredRoles = requiredRoles.rows.length >= 2;
    logTest(
      'Test 2.2',
      hasRequiredRoles,
      `Required roles exist (${requiredRoles.rows.length} found)`,
      requiredRoles.rows.map(r => r.name)
    );

    // Test 2.3: All users have role_id assigned
    const usersWithoutRole = await pgClient.query(`
      SELECT COUNT(*) FROM profiles WHERE role_id IS NULL
    `);
    const allUsersHaveRole = parseInt(usersWithoutRole.rows[0].count) === 0;
    logTest(
      'Test 2.3',
      allUsersHaveRole,
      allUsersHaveRole 
        ? 'All users have role_id assigned' 
        : `${usersWithoutRole.rows[0].count} users missing role_id`
    );

    // Test 2.4: Super admin exists
    const superAdminExists = await pgClient.query(`
      SELECT p.id, u.email, p.super_admin
      FROM profiles p
      INNER JOIN auth.users u ON u.id = p.id
      WHERE p.super_admin = true OR u.email = 'admin@mpdee.co.uk'
    `);
    const hasSuperAdmin = superAdminExists.rows.length > 0;
    logTest(
      'Test 2.4',
      hasSuperAdmin,
      hasSuperAdmin 
        ? `Super admin exists: ${superAdminExists.rows[0]?.email}`
        : 'No super admin found'
    );

    // ========================================
    // TEST 3: Permission Data
    // ========================================
    console.log('\n📋 TEST GROUP 3: Permission Data\n');

    // Test 3.1: Permissions exist
    const permissionsCount = await pgClient.query('SELECT COUNT(*) FROM role_permissions');
    const hasPermissions = parseInt(permissionsCount.rows[0].count) > 0;
    logTest(
      'Test 3.1',
      hasPermissions,
      `Permissions exist (${permissionsCount.rows[0].count} total)`
    );

    // Test 3.2: All modules have permissions
    const modules = [
      'timesheets', 'inspections', 'rams', 'absence', 'toolbox-talks',
      'approvals', 'actions', 'reports', 'admin-users', 'admin-vans'
    ];
    const modulePermissions = await pgClient.query(`
      SELECT DISTINCT module_name FROM role_permissions
    `);
    const moduleNames = modulePermissions.rows.map(r => r.module_name);
    const missingModules = modules.filter(m => !moduleNames.includes(m));
    logTest(
      'Test 3.2',
      missingModules.length === 0,
      missingModules.length === 0
        ? 'All modules have permissions defined'
        : `Missing permissions for: ${missingModules.join(', ')}`,
      { defined: moduleNames, missing: missingModules }
    );

    // Test 3.3: Manager/Admin roles have full access
    const managerAdminPerms = await pgClient.query(`
      SELECT r.name, COUNT(rp.id) as perm_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.enabled = true
      WHERE r.is_manager_admin = true
      GROUP BY r.id, r.name
    `);
    const allHaveFullAccess = managerAdminPerms.rows.every(
      row => parseInt(row.perm_count) >= modules.length
    );
    logTest(
      'Test 3.3',
      allHaveFullAccess,
      allHaveFullAccess
        ? 'Manager/Admin roles have full access'
        : 'Some manager/admin roles missing permissions',
      managerAdminPerms.rows
    );

    // ========================================
    // TEST 4: Database Relationships
    // ========================================
    console.log('\n📋 TEST GROUP 4: Database Relationships\n');

    // Test 4.1: All profiles.role_id reference valid roles
    const invalidRoleIds = await pgClient.query(`
      SELECT COUNT(*) FROM profiles p
      WHERE p.role_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = p.role_id)
    `);
    const allRoleIdsValid = parseInt(invalidRoleIds.rows[0].count) === 0;
    logTest(
      'Test 4.1',
      allRoleIdsValid,
      allRoleIdsValid
        ? 'All profile role_ids reference valid roles'
        : `${invalidRoleIds.rows[0].count} profiles with invalid role_id`
    );

    // Test 4.2: All role_permissions.role_id reference valid roles
    const invalidPermRoleIds = await pgClient.query(`
      SELECT COUNT(*) FROM role_permissions rp
      WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = rp.role_id)
    `);
    const allPermRoleIdsValid = parseInt(invalidPermRoleIds.rows[0].count) === 0;
    logTest(
      'Test 4.2',
      allPermRoleIdsValid,
      allPermRoleIdsValid
        ? 'All permission role_ids reference valid roles'
        : `${invalidPermRoleIds.rows[0].count} permissions with invalid role_id`
    );

    // ========================================
    // TEST 5: Trigger Function
    // ========================================
    console.log('\n📋 TEST GROUP 5: Trigger Function\n');

    // Test 5.1: Trigger function uses role_id
    const triggerFunction = await pgClient.query(`
      SELECT prosrc FROM pg_proc 
      WHERE proname = 'handle_new_user'
    `);
    const usesRoleId = triggerFunction.rows[0]?.prosrc.includes('role_id');
    logTest(
      'Test 5.1',
      usesRoleId,
      usesRoleId
        ? 'Trigger function uses role_id'
        : 'Trigger function still uses old role field'
    );

    // ========================================
    // TEST 6: Supabase API Tests
    // ========================================
    console.log('\n📋 TEST GROUP 6: Supabase API Tests\n');

    // Test 6.1: Fetch profiles with role join
    const { data: profilesWithRole, error: profileError } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        role:roles(
          name,
          display_name,
          is_manager_admin
        )
      `)
      .limit(5);

    const profileJoinWorks = !profileError && profilesWithRole && profilesWithRole.length > 0;
    logTest(
      'Test 6.1',
      profileJoinWorks,
      profileJoinWorks
        ? `Profile-Role join works (${profilesWithRole?.length} profiles fetched)`
        : `Profile-Role join failed: ${profileError?.message}`
    );

    // Test 6.2: Verify role structure in joined data
    const roleData = profilesWithRole?.[0]?.role;
    const roleObj = Array.isArray(roleData) ? roleData[0] : roleData;
    const hasRoleStructure = roleObj && 
      'name' in (roleObj as unknown as Record<string, unknown>) &&
      'display_name' in (roleObj as unknown as Record<string, unknown>);
    logTest(
      'Test 6.2',
      !!hasRoleStructure,
      hasRoleStructure
        ? 'Role structure correct in joined data'
        : 'Role structure incorrect or missing',
      profilesWithRole?.[0]?.role
    );

    // Test 6.3: Fetch role permissions
    const { data: permissions, error: permError } = await supabase
      .from('role_permissions')
      .select('*')
      .limit(5);

    const permissionsAccessible = !permError && permissions && permissions.length > 0;
    logTest(
      'Test 6.3',
      permissionsAccessible,
      permissionsAccessible
        ? `Role permissions accessible (${permissions?.length} fetched)`
        : `Role permissions error: ${permError?.message}`
    );

    // Test 6.4: Fetch roles
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select('*');

    const rolesAccessible = !rolesError && roles && roles.length > 0;
    logTest(
      'Test 6.4',
      rolesAccessible,
      rolesAccessible
        ? `Roles accessible (${roles?.length} total roles)`
        : `Roles error: ${rolesError?.message}`
    );

    // ========================================
    // TEST 7: Permission Logic Tests
    // ========================================
    console.log('\n📋 TEST GROUP 7: Permission Logic Tests\n');

    // Test 7.1: Find an admin user and verify permissions
    const adminUser = await pgClient.query(`
      SELECT p.id, r.is_manager_admin
      FROM profiles p
      INNER JOIN roles r ON r.id = p.role_id
      WHERE r.name = 'admin'
      LIMIT 1
    `);

    if (adminUser.rows.length > 0) {
      const { data: adminPerms } = await supabase
        .from('role_permissions')
        .select('module_name, enabled')
        .eq('role_id', (await supabase
          .from('profiles')
          .select('role_id')
          .eq('id', adminUser.rows[0].id)
          .single()
        ).data?.role_id || '');

      const adminHasAccess = adminUser.rows[0].is_manager_admin || 
        (adminPerms && adminPerms.filter(p => p.enabled).length >= 5);
      
      logTest(
        'Test 7.1',
        adminHasAccess,
        adminHasAccess
          ? 'Admin users have proper permissions'
          : 'Admin users missing permissions'
      );
    } else {
      logTest(
        'Test 7.1',
        false,
        'No admin users found for testing'
      );
    }

    // Test 7.2: Find an employee and verify limited permissions
    const employeeUser = await pgClient.query(`
      SELECT p.id, r.name, r.is_manager_admin
      FROM profiles p
      INNER JOIN roles r ON r.id = p.role_id
      WHERE r.name LIKE 'employee-%'
      LIMIT 1
    `);

    if (employeeUser.rows.length > 0) {
      const isNotManagerAdmin = !employeeUser.rows[0].is_manager_admin;
      logTest(
        'Test 7.2',
        isNotManagerAdmin,
        isNotManagerAdmin
          ? 'Employee users not marked as manager/admin'
          : 'Employee user incorrectly marked as manager/admin'
      );
    } else {
      logTest(
        'Test 7.2',
        true,
        'No employee users found (skipped)'
      );
    }

    // ========================================
    // TEST 8: Data Consistency
    // ========================================
    console.log('\n📋 TEST GROUP 8: Data Consistency\n');

    // Test 8.1: No orphaned permissions
    const orphanedPerms = await pgClient.query(`
      SELECT COUNT(*) FROM role_permissions rp
      WHERE NOT EXISTS (
        SELECT 1 FROM roles r WHERE r.id = rp.role_id
      )
    `);
    const noOrphanedPerms = parseInt(orphanedPerms.rows[0].count) === 0;
    logTest(
      'Test 8.1',
      noOrphanedPerms,
      noOrphanedPerms
        ? 'No orphaned permissions'
        : `${orphanedPerms.rows[0].count} orphaned permissions found`
    );

    // Test 8.2: All roles have at least one permission
    const rolesWithoutPerms = await pgClient.query(`
      SELECT r.name, r.is_manager_admin
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      GROUP BY r.id, r.name, r.is_manager_admin
      HAVING COUNT(rp.id) = 0
    `);
    const allRolesHavePerms = rolesWithoutPerms.rows.length === 0;
    logTest(
      'Test 8.2',
      allRolesHavePerms,
      allRolesHavePerms
        ? 'All roles have permissions defined'
        : `${rolesWithoutPerms.rows.length} roles without permissions`,
      rolesWithoutPerms.rows.map(r => r.name)
    );

    // Test 8.3: User count consistency
    const totalUsers = await pgClient.query('SELECT COUNT(*) FROM profiles');
    const usersWithRoles = await pgClient.query('SELECT COUNT(*) FROM profiles WHERE role_id IS NOT NULL');
    const countsMatch = totalUsers.rows[0].count === usersWithRoles.rows[0].count;
    logTest(
      'Test 8.3',
      countsMatch,
      countsMatch
        ? `All ${totalUsers.rows[0].count} users have roles assigned`
        : `Mismatch: ${totalUsers.rows[0].count} total, ${usersWithRoles.rows[0].count} with roles`
    );

  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    logTest('FATAL', false, 'Test suite encountered fatal error', error);
  } finally {
    await pgClient.end();
    console.log('\n🔌 Database connection closed');
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('\n📊 TEST SUMMARY\n');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED! The RBAC migration is successful.\n');
  } else {
    console.log('⚠️  SOME TESTS FAILED. Review the results above.\n');
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(totalTests === passedTests ? 0 : 1);
}

runTests().catch(console.error);

