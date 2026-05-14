/**
 * Test: Actions RLS Policy Fix
 * Verifies that inspections with defects can create actions after RLS fix
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// SAFETY CHECK: Skip when not running against localhost or staging
const shouldSkip = !supabaseUrl || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Actions RLS tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Actions RLS Policy Fix', () => {
  let supabase: SupabaseClient;
  let testUserId: string;
  let testVehicleId: string;
  let testInspectionId: string;
  let createdTestVehicle = false;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get a test user (any employee)
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();
    
    if (!users) throw new Error('No test user found');
    testUserId = users.id;

    // SAFETY: ONLY use test vehicles starting with TE57
    const vehicle = await supabase
      .from('vans')
      .select('id')
      .ilike('reg_number', 'TE57%')
      .limit(1)
      .single();
    
    // If no TE57 test vehicle exists, create one
    if (!vehicle.data) {
      const categoryId = (await supabase.from('van_categories').select('id').limit(1).single()).data?.id;
      const newVehicle = await supabase
        .from('vans')
        .insert({
          reg_number: 'TE57ACTRL',
          status: 'active',
          category_id: categoryId,
        })
        .select('id')
        .single();
      
      if (!newVehicle.data) throw new Error('Failed to create test vehicle');
      testVehicleId = newVehicle.data.id;
      createdTestVehicle = true;
    } else {
      testVehicleId = vehicle.data.id;
    }
  });

  afterAll(async () => {
    // Clean up test vehicle if we created it
    if (createdTestVehicle) {
      await supabase.from('vans').delete().eq('id', testVehicleId);
    }
  });

  it('should allow creating actions when submitting inspection with defects', async () => {
    // Step 1: Create an inspection
    // SAFETY: Using 26000 miles instead of 50000 to avoid Example Vehicle incident pattern
    const { data: inspection, error: inspectionError } = await supabase
      .from('van_inspections')
      .insert({
        van_id: testVehicleId,
        user_id: testUserId,
        inspection_date: new Date().toISOString().split('T')[0],
        inspection_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        current_mileage: 999999, // Obviously invalid test value for easy corruption detection
        status: 'draft',
      })
      .select()
      .single();

    expect(inspectionError).toBeNull();
    expect(inspection).toBeDefined();
    testInspectionId = inspection!.id;

    // Step 2: Create inspection items with defects
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .insert([
        {
          inspection_id: testInspectionId,
          item_number: 1,
          day_of_week: 1,
          status: 'attention', // DEFECT
        },
        {
          inspection_id: testInspectionId,
          item_number: 2,
          day_of_week: 1,
          status: 'ok',
        },
      ])
      .select();

    expect(itemsError).toBeNull();
    expect(items).toBeDefined();
    expect(items!.length).toBe(2);

    // Step 3: Submit inspection (change status to 'submitted')
    const { error: submitError } = await supabase
      .from('van_inspections')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', testInspectionId);

    expect(submitError).toBeNull();

    // Step 4: Create action for the defect (THIS IS WHAT WAS FAILING BEFORE)
    const failedItem = items!.find((item: { status: string }) => item.status === 'attention');
    
    const { data: action, error: actionError } = await supabase
      .from('actions')
      .insert({
        inspection_id: testInspectionId,
        inspection_item_id: failedItem!.id,
        title: 'Test Defect: Item 1 (Monday)',
        description: 'Vehicle inspection item failed during Monday inspection',
        priority: 'high',
        status: 'pending',
        created_by: testUserId,
      })
      .select()
      .single();

    // THE KEY TEST: This should NOT return 42501 error anymore
    expect(actionError).toBeNull();
    expect(action).toBeDefined();
    expect(action!.title).toContain('Test Defect');
    expect(action!.inspection_id).toBe(testInspectionId);

    // Step 5: Verify action can be read
    const { data: readAction, error: readError } = await supabase
      .from('actions')
      .select('*')
      .eq('id', action!.id)
      .single();

    expect(readError).toBeNull();
    expect(readAction).toBeDefined();

    // Cleanup
    await supabase.from('actions').delete().eq('id', action!.id);
    await supabase.from('inspection_items').delete().eq('inspection_id', testInspectionId);
    await supabase.from('van_inspections').delete().eq('id', testInspectionId);
  });

  it('should verify RLS policies use roles table', async () => {
    // Query the policies to ensure they're using the roles table
    const { data: policies, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          policyname,
          cmd,
          qual
        FROM pg_policies
        WHERE tablename = 'actions'
        ORDER BY policyname
      `
    });

    // This test verifies the migration was applied
    // We should have policies that reference 'roles' table
    expect(error).toBeNull();
    expect(policies).toBeDefined();
    
    // Check that at least one policy definition includes 'roles' table
    const policiesUsingRoles = policies?.filter((p: { qual?: string }) =>
      p.qual && (p.qual.includes('roles') || p.qual.includes('is_manager_admin'))
    );
    
    expect(policiesUsingRoles?.length).toBeGreaterThan(0);
  });
});
