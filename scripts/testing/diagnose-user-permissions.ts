// Diagnostic script to check user permissions and role setup
// Run: npx tsx scripts/diagnose-user-permissions.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function diagnoseUserPermissions() {
  console.log('🔍 Diagnosing User Permissions\n');
  console.log('Checking Example User Seven (andy@example.com)...\n');

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

    // 1. Check all available roles
    console.log('📋 Available Roles:');
    console.log('='.repeat(80));
    const { rows: roles } = await client.query(`
      SELECT 
        id,
        name,
        display_name,
        is_manager_admin,
        is_super_admin
      FROM roles
      ORDER BY name;
    `);
    
    console.table(roles);

    // 2. Check Andy's profile
    console.log('\n👤 Example User Seven\'s Profile:');
    console.log('='.repeat(80));
    const { rows: andyProfile } = await client.query(`
      SELECT 
        p.id,
        au.email,
        p.full_name,
        p.employee_id,
        p.role_id,
        r.name as role_name,
        r.display_name as role_display_name,
        r.is_manager_admin,
        r.is_super_admin
      FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      LEFT JOIN auth.users au ON p.id = au.id
      WHERE au.email = 'andy@example.com';
    `);

    if (andyProfile.length === 0) {
      console.log('❌ User not found!');
      return;
    }

    console.table(andyProfile);

    const andy = andyProfile[0];

    // 3. Analysis
    console.log('\n🔬 Analysis:');
    console.log('='.repeat(80));
    
    if (!andy.role_id) {
      console.log('❌ ISSUE: User has no role_id assigned!');
      console.log('   This means the role field is NULL in the profiles table.');
    } else {
      console.log(`✅ User has role_id: ${andy.role_id}`);
      console.log(`   Role name: ${andy.role_name || 'MISSING'}`);
      console.log(`   Display name: ${andy.role_display_name || 'MISSING'}`);
    }

    if (andy.is_manager_admin) {
      console.log('✅ Role has is_manager_admin = true');
      console.log('   → User SHOULD be able to see all inspections');
    } else {
      console.log('❌ ISSUE: Role has is_manager_admin = false or NULL');
      console.log('   → User will only see their own inspections');
      console.log('   → This is why Andy can\'t see everyone\'s inspections!');
    }

    if (andy.is_super_admin) {
      console.log('✅ User has super admin privileges');
    }

    // 4. Check what should be the correct role
    console.log('\n💡 Recommended Fix:');
    console.log('='.repeat(80));
    
    const adminRole = roles.find(r => r.name === 'admin');
    const managerRole = roles.find(r => r.name === 'manager');
    
    if (adminRole && !adminRole.is_manager_admin) {
      console.log('⚠️  ISSUE FOUND: The "admin" role has is_manager_admin = false');
      console.log('   The admin role should have is_manager_admin = true');
      console.log('\n   Run this SQL to fix:');
      console.log(`   UPDATE roles SET is_manager_admin = true WHERE name = 'admin';`);
    }
    
    if (managerRole && !managerRole.is_manager_admin) {
      console.log('⚠️  ISSUE FOUND: The "manager" role has is_manager_admin = false');
      console.log('   The manager role should have is_manager_admin = true');
      console.log('\n   Run this SQL to fix:');
      console.log(`   UPDATE roles SET is_manager_admin = true WHERE name = 'manager';`);
    }

    if (!andy.role_id) {
      console.log('\n   To assign admin role to Andy:');
      if (adminRole) {
        console.log(`   UPDATE profiles SET role_id = '${adminRole.id}' WHERE id = '${andy.id}';`);
      } else {
        console.log('   ⚠️  No admin role found in database!');
      }
    }

    // 5. Session cache warning
    console.log('\n⚠️  IMPORTANT: After fixing roles, Andy must:');
    console.log('   1. Log out completely');
    console.log('   2. Clear browser cache/cookies');
    console.log('   3. Log back in');
    console.log('   The auth hook caches the profile/role data in the session.');

  } catch (error: unknown) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.error(error);
  } finally {
    await client.end();
    console.log('\n📡 Database connection closed');
  }
}

diagnoseUserPermissions().catch(console.error);

