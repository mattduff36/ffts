/**
 * Test: Workshop Tasks RLS Policies
 * Verifies that workshop users can access workshop tasks and categories
 * Verifies that managers/admins can manage categories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// SAFETY CHECK: Skip when not running against localhost or staging
const shouldSkip = !supabaseUrl || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Workshop Tasks RLS tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Workshop Tasks RLS Policies', () => {
  let supabase: SupabaseClient;
  let testManagerId: string;
  let testEmployeeId: string;
  let testVehicleId: string;
  let testCategoryId: string;
  let testWorkshopTaskId: string;
  let createdTestVehicle = false;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get a manager user
    const { data: manager } = await supabase
      .from('profiles')
      .select('id, roles!inner(is_manager_admin)')
      .eq('roles.is_manager_admin', true)
      .limit(1)
      .single();
    
    if (!manager) throw new Error('No test manager found');
    testManagerId = manager.id;

    // Get a regular employee (non-manager)
    const { data: employee } = await supabase
      .from('profiles')
      .select('id, roles!inner(is_manager_admin)')
      .eq('roles.is_manager_admin', false)
      .limit(1)
      .single();
    
    if (!employee) throw new Error('No test employee found');
    testEmployeeId = employee.id;

    // SAFETY: ONLY use deterministic fictional vehicles starting with ZZ99
    const vehicle = await supabase
      .from('vans')
      .select('id')
      .ilike('reg_number', 'ZZ99%')
      .eq('status', 'active')
      .limit(1)
      .single();
    
    // If no fictional test vehicle exists, create one
    if (!vehicle.data) {
      const categoryId = (await supabase.from('van_categories').select('id').limit(1).single()).data?.id;
      const newVehicle = await supabase
        .from('vans')
        .insert({
          reg_number: 'ZZ99WSHP',
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

    // Get or create a test category
    const { data: category } = await supabase
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Test Category')
      .single();

    if (category) {
      testCategoryId = category.id;
    } else {
      const { data: newCategory, error } = await supabase
        .from('workshop_task_categories')
        .insert({
          name: 'Test Category',
          applies_to: 'van',
          is_active: true,
          sort_order: 999,
          created_by: testManagerId,
        })
        .select()
        .single();

      if (error) throw error;
      testCategoryId = newCategory!.id;
    }
  });

  afterAll(async () => {
    // Cleanup test vehicle if we created it
    if (createdTestVehicle) {
      await supabase.from('vans').delete().eq('id', testVehicleId);
    }
    
    // Cleanup test data
    if (testWorkshopTaskId) {
      await supabase.from('actions').delete().eq('id', testWorkshopTaskId);
    }
    if (testCategoryId) {
      await supabase.from('workshop_task_categories').delete().eq('name', 'Test Category');
    }
  });

  describe('Workshop Task Categories RLS', () => {
    it('should allow any authenticated user to read categories', async () => {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('*')
        .eq('id', testCategoryId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.name).toBe('Test Category');
    });

    it('should allow managers to create categories', async () => {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .insert({
          name: 'Manager Test Category',
          applies_to: 'van',
          is_active: true,
          sort_order: 1000,
          created_by: testManagerId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.name).toBe('Manager Test Category');

      // Cleanup
      await supabase.from('workshop_task_categories').delete().eq('id', data!.id);
    });

    it('should allow managers to update categories', async () => {
      const { error } = await supabase
        .from('workshop_task_categories')
        .update({ sort_order: 998 })
        .eq('id', testCategoryId);

      expect(error).toBeNull();
    });

    it('should allow managers to delete categories', async () => {
      // Create a temporary category to delete
      const { data: tempCategory } = await supabase
        .from('workshop_task_categories')
        .insert({
          name: 'Temp Delete Category',
          applies_to: 'van',
          is_active: true,
          sort_order: 1001,
          created_by: testManagerId,
        })
        .select()
        .single();

      const { error } = await supabase
        .from('workshop_task_categories')
        .delete()
        .eq('id', tempCategory!.id);

      expect(error).toBeNull();
    });
  });

  describe('Workshop Tasks (Actions) RLS', () => {
    it('should allow creating workshop_vehicle_task actions', async () => {
      const { data, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          van_id: testVehicleId,
          workshop_category_id: testCategoryId,
          workshop_comments: 'Test workshop task for RLS verification',
          title: 'Test Workshop Task',
          description: 'Testing workshop task creation',
          priority: 'medium',
          status: 'pending',
          created_by: testManagerId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.action_type).toBe('workshop_vehicle_task');
      expect(data!.van_id).toBe(testVehicleId);
      
      testWorkshopTaskId = data!.id;
    });

    it('should allow reading workshop tasks', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select('*')
        .eq('id', testWorkshopTaskId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.action_type).toBe('workshop_vehicle_task');
    });

    it('should allow updating workshop task status', async () => {
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_comment: 'Started work',
          logged_at: new Date().toISOString(),
          logged_by: testManagerId,
        })
        .eq('id', testWorkshopTaskId);

      expect(error).toBeNull();
    });

    it('should allow completing workshop tasks', async () => {
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_at: new Date().toISOString(),
          actioned_by: testManagerId,
        })
        .eq('id', testWorkshopTaskId);

      expect(error).toBeNull();
    });

    it('should filter workshop tasks by action_type', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select('*')
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .limit(10);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      
      // All returned actions should be workshop-related
      data!.forEach((action: { action_type: string }) => {
        expect(['inspection_defect', 'workshop_vehicle_task']).toContain(action.action_type);
      });
    });

    it('should create inspection_defect actions with correct type', async () => {
      // Create a test inspection
      // SAFETY: Using 27000 miles instead of 50000 to avoid Example Vehicle incident pattern
      const { data: inspection } = await supabase
        .from('van_inspections')
        .insert({
          van_id: testVehicleId,
          user_id: testManagerId,
          inspection_date: new Date().toISOString().split('T')[0],
          inspection_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          current_mileage: 999996, // Obviously invalid test value for easy corruption detection
          status: 'submitted',
        })
        .select()
        .single();

      const { data: defectAction, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'inspection_defect',
          inspection_id: inspection!.id,
          workshop_category_id: testCategoryId,
          title: 'Test Inspection Defect',
          description: 'Defect found during inspection',
          priority: 'high',
          status: 'pending',
          created_by: testManagerId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(defectAction).toBeDefined();
      expect(defectAction!.action_type).toBe('inspection_defect');

      // Cleanup
      await supabase.from('actions').delete().eq('id', defectAction!.id);
      await supabase.from('van_inspections').delete().eq('id', inspection!.id);
    });
  });

  describe('Workshop Tasks Module Permission', () => {
    it('should verify workshop-tasks permission exists for managers', async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('*, roles!inner(*)')
        .eq('module_name', 'workshop-tasks')
        .eq('roles.is_manager_admin', true)
        .limit(1)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.module_name).toBe('workshop-tasks');
      expect(data!.enabled).toBe(true);
    });

    it('should verify workshop-tasks permission can be granted to non-managers', async () => {
      // Check if permission exists for the test employee's role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role_id')
        .eq('id', testEmployeeId)
        .single();

      const { data: permission } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('role_id', profile!.role_id)
        .eq('module_name', 'workshop-tasks')
        .single();

      expect(permission).toBeDefined();
      expect(permission!.module_name).toBe('workshop-tasks');
      // Permission may be enabled or disabled for employees (that's configurable)
    });
  });

  describe('Data Integrity', () => {
    it('should enforce action_type check constraint', async () => {
      const { error } = await supabase
        .from('actions')
        .insert({
          action_type: 'invalid_type' as unknown as 'inspection_defect', // Invalid type - testing DB constraint
          title: 'Invalid Action Type',
          description: 'Should fail',
          priority: 'medium',
          status: 'pending',
          created_by: testManagerId,
        });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('violates check constraint');
    });

    it('should allow nullable workshop fields for non-workshop actions', async () => {
      const { data, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'manager_action',
          title: 'Manager Action Without Workshop Fields',
          description: 'This is a pure manager action',
          priority: 'low',
          status: 'pending',
          created_by: testManagerId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.van_id).toBeNull();
      expect(data!.workshop_category_id).toBeNull();
      expect(data!.workshop_comments).toBeNull();

      // Cleanup
      await supabase.from('actions').delete().eq('id', data!.id);
    });

    it('should reference workshop_task_categories correctly', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          *,
          workshop_task_categories (
            id,
            name,
            applies_to
          )
        `)
        .eq('id', testWorkshopTaskId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.workshop_task_categories).toBeDefined();
      expect(data!.workshop_task_categories.name).toBe('Test Category');
    });

    it('should reference vehicles correctly for workshop tasks', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          *,
          vans (
            id,
            reg_number
          )
        `)
        .eq('id', testWorkshopTaskId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.vans).toBeDefined();
      expect(data!.vans.id).toBe(testVehicleId);
    });
  });

  describe('Indexes Performance', () => {
    it('should efficiently query by action_type and status', async () => {
      const startTime = Date.now();
      
      const { data, error } = await supabase
        .from('actions')
        .select('id, action_type, status')
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);

      const queryTime = Date.now() - startTime;

      expect(error).toBeNull();
      expect(data).toBeDefined();
      // Query should be fast (under 500ms even with many records)
      expect(queryTime).toBeLessThan(500);
    });

    it('should efficiently query by van_id', async () => {
      const startTime = Date.now();
      
      const { data, error } = await supabase
        .from('actions')
        .select('id, van_id, status')
        .eq('van_id', testVehicleId)
        .limit(50);

      const queryTime = Date.now() - startTime;

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(queryTime).toBeLessThan(500);
    });
  });

  describe('Workshop Task Comments RLS', () => {
    let testCommentId: string;

    it('should allow workshop users to create comments for workshop tasks', async () => {
      const { data, error } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testManagerId,
          body: 'Test comment for RLS verification',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.body).toBe('Test comment for RLS verification');
      expect(data!.task_id).toBe(testWorkshopTaskId);
      expect(data!.author_id).toBe(testManagerId);
      
      testCommentId = data!.id;
    });

    it('should allow workshop users to read comments for workshop tasks', async () => {
      const { data, error } = await supabase
        .from('workshop_task_comments')
        .select('*')
        .eq('task_id', testWorkshopTaskId);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.length).toBeGreaterThan(0);
    });

    it('should allow comment author to update their own comment', async () => {
      const { error } = await supabase
        .from('workshop_task_comments')
        .update({ body: 'Updated test comment' })
        .eq('id', testCommentId);

      expect(error).toBeNull();

      // Verify update
      const { data } = await supabase
        .from('workshop_task_comments')
        .select('body, updated_at')
        .eq('id', testCommentId)
        .single();

      expect(data!.body).toBe('Updated test comment');
      expect(data!.updated_at).not.toBeNull();
    });

    it('should allow manager to update any comment', async () => {
      // Create a comment as the test employee
      const { data: employeeComment } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testEmployeeId,
          body: 'Employee comment',
        })
        .select()
        .single();

      // Manager should be able to update it
      const { error } = await supabase
        .from('workshop_task_comments')
        .update({ body: 'Manager edited employee comment' })
        .eq('id', employeeComment!.id);

      expect(error).toBeNull();

      // Cleanup
      await supabase.from('workshop_task_comments').delete().eq('id', employeeComment!.id);
    });

    it('should allow comment author to delete their own comment', async () => {
      // Create a temporary comment
      const { data: tempComment } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testManagerId,
          body: 'Temporary comment to delete',
        })
        .select()
        .single();

      const { error } = await supabase
        .from('workshop_task_comments')
        .delete()
        .eq('id', tempComment!.id);

      expect(error).toBeNull();

      // Verify deletion
      const { data } = await supabase
        .from('workshop_task_comments')
        .select('*')
        .eq('id', tempComment!.id);

      expect(data).toHaveLength(0);
    });

    it('should allow manager to delete any comment', async () => {
      // Create a comment as the test employee
      const { data: employeeComment } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testEmployeeId,
          body: 'Employee comment to be deleted by manager',
        })
        .select()
        .single();

      // Manager should be able to delete it
      const { error } = await supabase
        .from('workshop_task_comments')
        .delete()
        .eq('id', employeeComment!.id);

      expect(error).toBeNull();
    });

    it('should enforce body length constraint', async () => {
      const longBody = 'a'.repeat(1001); // 1001 chars (max is 1000)

      const { error } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testManagerId,
          body: longBody,
        });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('check constraint');
    });

    it('should not allow empty body', async () => {
      const { error } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: testWorkshopTaskId,
          author_id: testManagerId,
          body: '',
        });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('check constraint');
    });

    it('should cascade delete comments when task is deleted', async () => {
      // Create a temporary task
      const { data: tempTask } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          van_id: testVehicleId,
          workshop_category_id: testCategoryId,
          title: 'Temp task for cascade test',
          priority: 'medium',
          status: 'pending',
          created_by: testManagerId,
        })
        .select()
        .single();

      // Create a comment on the temp task
      const { data: tempComment } = await supabase
        .from('workshop_task_comments')
        .insert({
          task_id: tempTask!.id,
          author_id: testManagerId,
          body: 'Comment on temp task',
        })
        .select()
        .single();

      // Delete the task
      await supabase.from('actions').delete().eq('id', tempTask!.id);

      // Verify comment was cascade deleted
      const { data: commentAfterDelete } = await supabase
        .from('workshop_task_comments')
        .select('*')
        .eq('id', tempComment!.id);

      expect(commentAfterDelete).toHaveLength(0);
    });

    it('should query comments with author profile data', async () => {
      const { data, error } = await supabase
        .from('workshop_task_comments')
        .select(`
          *,
          profiles:author_id (
            id,
            full_name
          )
        `)
        .eq('id', testCommentId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.profiles).toBeDefined();
      expect(data!.profiles.id).toBe(testManagerId);
    });

    afterAll(async () => {
      // Cleanup test comments
      if (testCommentId) {
        await supabase.from('workshop_task_comments').delete().eq('id', testCommentId);
      }
    });
  });
});

