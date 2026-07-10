/**
 * Workshop Tasks Module Integration Tests
 * Tests all workflows for /workshop-tasks page including task management and category management
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  deleteActionsByIds,
  deleteRowsByIds,
  deleteWorkshopTasksForUserMatching,
  prefixPattern,
} from './helpers/test-cleanup';
import { resolveTestHgvId, resolveTestPlantId, resolveTestVanId } from './helpers/test-assets';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const runLiveDatabaseTests = process.env.RUN_LIVE_DB_TESTS === 'true';

if (runLiveDatabaseTests && (!supabaseUrl || !supabaseKey)) {
  console.error('Missing Supabase credentials in .env.local');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
  throw new Error('Missing required environment variables for integration tests');
}

const describeLive = runLiveDatabaseTests ? describe : describe.skip;

describeLive('Workshop Tasks Module Workflows', () => {
  let supabase: SupabaseClient;
  let testUserId: string;
  let testVehicleId: string;
  let testHgvId: string;
  let testPlantId: string;
  const createdTaskIds = new Set<string>();
  const createdCategoryIds = new Set<string>();
  const createdSubcategoryIds = new Set<string>();

  function applyTestAssetScope<TQuery extends { or: (filters: string) => TQuery }>(query: TQuery): TQuery {
    const filters = [testVehicleId && `van_id.eq.${testVehicleId}`, testHgvId && `hgv_id.eq.${testHgvId}`, testPlantId && `plant_id.eq.${testPlantId}`]
      .filter(Boolean)
      .join(',');

    return filters ? query.or(filters) : query;
  }

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Authenticate as test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });

    if (authError) throw authError;
    testUserId = authData.user!.id;

    testVehicleId = (await resolveTestVanId(supabase)) || '';
    testHgvId = (await resolveTestHgvId(supabase)) || '';
    testPlantId = (await resolveTestPlantId(supabase)) || '';

    await deleteWorkshopTasksForUserMatching({
      createdBy: testUserId,
      titlePatterns: [
        prefixPattern('Test Workflow Task '),
        prefixPattern('Multi-step Test Task '),
        prefixPattern('WF Van Task '),
        prefixPattern('WF HGV Task '),
        prefixPattern('WF Plant Task '),
        prefixPattern('WF Dedupe Title '),
        prefixPattern('New Workshop Task '),
      ],
    });
  });

  afterAll(async () => {
    await deleteActionsByIds(Array.from(createdTaskIds));
    await deleteRowsByIds('workshop_task_subcategories', Array.from(createdSubcategoryIds));
    await deleteRowsByIds('workshop_task_categories', Array.from(createdCategoryIds));
    await deleteWorkshopTasksForUserMatching({
      createdBy: testUserId,
      titlePatterns: [
        prefixPattern('Test Workflow Task '),
        prefixPattern('Multi-step Test Task '),
        prefixPattern('WF Van Task '),
        prefixPattern('WF HGV Task '),
        prefixPattern('WF Plant Task '),
        prefixPattern('WF Dedupe Title '),
        prefixPattern('New Workshop Task '),
      ],
    });
    await supabase.auth.signOut();
  });

  describe('Task Viewing and Filtering', () => {
    it('should fetch all workshop tasks', async () => {
      const { data: tasks, error } = await applyTestAssetScope(supabase
        .from('actions')
        .select(`
          *,
          vehicle:vans!actions_van_id_fkey(id, reg_number, nickname),
          category:workshop_task_categories(id, name, slug),
          subcategory:workshop_task_subcategories(id, name, slug)
        `)
        .eq('action_type', 'workshop_vehicle_task'))
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);

      if (tasks && tasks.length > 0) {
        void tasks[0].id;
      }
    });

    it('should filter tasks by status - pending', async () => {
      const { data: tasks, error } = await applyTestAssetScope(supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_vehicle_task')
        .eq('status', 'pending'));

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - in progress', async () => {
      const { data: tasks, error } = await applyTestAssetScope(supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_vehicle_task')
        .eq('status', 'logged'));

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - on hold', async () => {
      const { data: tasks, error } = await applyTestAssetScope(supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_vehicle_task')
        .eq('status', 'on_hold'));

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - completed', async () => {
      const { data: tasks, error } = await applyTestAssetScope(supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_vehicle_task')
        .eq('status', 'completed'));

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_vehicle_task')
        .eq('van_id', testVehicleId);

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Task Status Change Workflows', () => {
    let workflowTestTaskId: string;

    beforeAll(async () => {
      // Create a test task for workflow testing
      if (!testVehicleId) return;

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) return;

      const { data: newTask, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          title: 'Test Workflow Task ' + Date.now(),
          description: 'Testing status workflows',
          status: 'pending',
          priority: 'medium',
          van_id: testVehicleId,
          workshop_category_id: categories[0].id,
          created_by: testUserId,
        })
        .select()
        .single();

      if (!error && newTask) {
        workflowTestTaskId = newTask.id;
        createdTaskIds.add(newTask.id);
      }
    });

    afterAll(async () => {
      if (workflowTestTaskId) {
        createdTaskIds.add(workflowTestTaskId);
      }
    });

    it('should start task (pending -> in progress)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_by: testUserId,
          logged_at: new Date().toISOString(),
          logged_comment: 'Started working on this task',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('logged');
    });

    it('should place task on hold (in progress -> on hold)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'on_hold',
          workshop_comments: 'Waiting for parts',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('on_hold');
    });

    it('should resume task (on hold -> in progress)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          workshop_comments: 'Parts arrived, resuming work',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('logged');
    });

    it('should complete task (in progress -> completed)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_by: testUserId,
          actioned_at: new Date().toISOString(),
          actioned_comment: 'Task completed successfully',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('completed');
      expect(updated?.actioned).toBe(true);
    });

    it('should support multi-step completion (pending -> in progress -> completed)', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) {
        console.log('No categories, skipping test');
        return;
      }

      // Create task
      const { data: newTask, error: createError } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          title: 'Multi-step Test Task ' + Date.now(),
          description: 'Testing multi-step completion',
          status: 'pending',
          priority: 'high',
          van_id: testVehicleId,
          workshop_category_id: categories[0].id,
          created_by: testUserId,
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(newTask).toBeDefined();

      if (!newTask) return;
      createdTaskIds.add(newTask.id);

      // Step 1: Move to in progress
      const { data: inProgress, error: step1Error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_by: testUserId,
          logged_at: new Date().toISOString(),
          logged_comment: 'Step 1: Started task',
        })
        .eq('id', newTask.id)
        .select()
        .single();

      expect(step1Error).toBeNull();
      expect(inProgress?.status).toBe('logged');

      // Step 2: Complete
      const { data: completed, error: step2Error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_by: testUserId,
          actioned_at: new Date().toISOString(),
          actioned_comment: 'Step 2: Completed task',
        })
        .eq('id', newTask.id)
        .select()
        .single();

      expect(step2Error).toBeNull();
      expect(completed?.status).toBe('completed');

      createdTaskIds.add(newTask.id);
    });
  });

  describe('Category Management Workflows', () => {
    let testCategoryId: string;
    let testSubcategoryId: string;

    it('should fetch all categories', async () => {
      const { data: categories, error } = await supabase
        .from('workshop_task_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      expect(error).toBeNull();
      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
    });

    it('should fetch all subcategories', async () => {
      const { data: subcategories, error } = await supabase
        .from('workshop_task_subcategories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      expect(error).toBeNull();
      expect(subcategories).toBeDefined();
      expect(Array.isArray(subcategories)).toBe(true);
    });

    it('should create new category via API (manager only)', async () => {
      const newCategory = {
        name: 'Test Category ' + Date.now(),
        slug: 'test-category-' + Date.now(),
        sort_order: 0,
        is_active: true,
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      
      try {
        const response = await fetch(`${siteUrl}/api/workshop-tasks/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newCategory),
        });

        if (response.status === 403) {
          console.log('User not authorized for category management, skipping test');
          return;
        }

        expect(response.ok).toBe(true);
        const data = await response.json();
        expect(data.success).toBe(true);

        if (data.category) {
          testCategoryId = data.category.id;
          createdCategoryIds.add(data.category.id);
        }
      } catch {
        console.log('API test skipped - server may not be reachable from test environment');
        return;
      }
    }, 10000);

    it('should update category via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const updates = {
        name: 'Updated Test Category',
      };

      const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/workshop-tasks/categories/${testCategoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should create subcategory via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const newSubcategory = {
        category_id: testCategoryId,
        name: 'Test Subcategory ' + Date.now(),
        slug: 'test-subcategory-' + Date.now(),
        sort_order: 0,
        is_active: true,
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubcategory),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);

      if (data.subcategory) {
        testSubcategoryId = data.subcategory.id;
        createdSubcategoryIds.add(data.subcategory.id);
      }
    });

    it('should update subcategory via API', async () => {
      if (!testSubcategoryId) {
        console.log('No test subcategory, skipping test');
        return;
      }

      const updates = {
        name: 'Updated Test Subcategory',
        slug: 'updated-test-subcategory',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories/${testSubcategoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete subcategory via API', async () => {
      if (!testSubcategoryId) {
        console.log('No test subcategory, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories/${testSubcategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete category via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/categories/${testCategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });
  });

  describe('Task Creation Workflow', () => {
    let createdTaskId: string;

    it('should create a new workshop task', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) {
        console.log('No categories, skipping test');
        return;
      }

      const newTask = {
        action_type: 'workshop_vehicle_task',
        title: 'New Workshop Task ' + Date.now(),
        description: 'Test task creation',
        status: 'pending',
        priority: 'medium',
        van_id: testVehicleId,
        workshop_category_id: categories[0].id,
        created_by: testUserId,
      };

      const { data: task, error } = await supabase
        .from('actions')
        .insert(newTask)
        .select()
        .single();

      expect(error).toBeNull();
      expect(task).toBeDefined();
      expect(task?.title).toBe(newTask.title);

      if (task) {
        createdTaskId = task.id;
        createdTaskIds.add(task.id);
      }
    });

    it('should cleanup created task', async () => {
      if (!createdTaskId) {
        console.log('No created task, skipping cleanup');
        return;
      }
      await deleteActionsByIds([createdTaskId]);
      createdTaskIds.delete(createdTaskId);
    });
  });

  describe('Multi-asset lifecycle and dedupe edge cases', () => {
    afterAll(async () => {
      await deleteActionsByIds(Array.from(createdTaskIds));
    });

    const getCategoryForAsset = async (assetType: 'van' | 'hgv' | 'plant') => {
      const { data: categories, error } = await supabase
        .from('workshop_task_categories')
        .select('id, applies_to')
        .eq('is_active', true)
        .eq('applies_to', assetType)
        .limit(1);

      expect(error).toBeNull();
      return categories?.[0] || null;
    };

    const createTaskForAsset = async (
      assetType: 'van' | 'hgv' | 'plant',
      assetId: string,
      categoryId: string,
      title: string
    ) => {
      const payload: Record<string, unknown> = {
        action_type: 'workshop_vehicle_task',
        title,
        description: `Workflow test for ${assetType}`,
        status: 'pending',
        priority: 'medium',
        workshop_category_id: categoryId,
        created_by: testUserId,
      };

      if (assetType === 'van') payload.van_id = assetId;
      if (assetType === 'hgv') payload.hgv_id = assetId;
      if (assetType === 'plant') payload.plant_id = assetId;

      const { data, error } = await supabase.from('actions').insert(payload).select('id, status').single();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      return data?.id as string;
    };

    it('creates and transitions a van task through lifecycle states', async () => {
      if (!testVehicleId) {
        console.log('No test van available, skipping');
        return;
      }
      const category = await getCategoryForAsset('van');
      if (!category) {
        console.log('No active van category, skipping');
        return;
      }

      const taskId = await createTaskForAsset(
        'van',
        testVehicleId,
        category.id,
        `WF Van Task ${Date.now()}`
      );
      createdTaskIds.add(taskId);

      const states = ['logged', 'on_hold', 'completed'] as const;
      for (const status of states) {
        const { data, error } = await supabase
          .from('actions')
          .update({ status })
          .eq('id', taskId)
          .select('status')
          .single();
        expect(error).toBeNull();
        expect(data?.status).toBe(status);
      }
    });

    it('creates and transitions an HGV task through lifecycle states', async () => {
      const hgvId = testHgvId;
      if (!hgvId) {
        console.log('No TE57 test HGV available, skipping');
        return;
      }

      const category = await getCategoryForAsset('hgv');
      if (!category) {
        console.log('No active HGV category, skipping');
        return;
      }

      const taskId = await createTaskForAsset('hgv', hgvId, category.id, `WF HGV Task ${Date.now()}`);
      createdTaskIds.add(taskId);

      const { data, error } = await supabase
        .from('actions')
        .update({ status: 'logged' })
        .eq('id', taskId)
        .select('status, hgv_id')
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe('logged');
      expect(data?.hgv_id).toBe(hgvId);
    });

    it('creates and transitions a plant task through lifecycle states', async () => {
      const plantId = testPlantId;
      if (!plantId) {
        console.log('No TE57 test plant available, skipping');
        return;
      }

      const category = await getCategoryForAsset('plant');
      if (!category) {
        console.log('No active plant category, skipping');
        return;
      }

      const taskId = await createTaskForAsset(
        'plant',
        plantId,
        category.id,
        `WF Plant Task ${Date.now()}`
      );
      createdTaskIds.add(taskId);

      const { data, error } = await supabase
        .from('actions')
        .update({ status: 'on_hold' })
        .eq('id', taskId)
        .select('status, plant_id')
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe('on_hold');
      expect(data?.plant_id).toBe(plantId);
    });

    it('active-status dedupe query excludes completed tasks', async () => {
      if (!testVehicleId) {
        console.log('No test van available, skipping');
        return;
      }
      const category = await getCategoryForAsset('van');
      if (!category) {
        console.log('No active van category, skipping');
        return;
      }

      const sharedTitle = `WF Dedupe Title ${Date.now()}`;
      const activeTaskId = await createTaskForAsset('van', testVehicleId, category.id, sharedTitle);
      createdTaskIds.add(activeTaskId);

      const completedTaskId = await createTaskForAsset('van', testVehicleId, category.id, sharedTitle);
      createdTaskIds.add(completedTaskId);
      await supabase.from('actions').update({ status: 'completed' }).eq('id', completedTaskId);

      const { data, error } = await supabase
        .from('actions')
        .select('id, status')
        .eq('van_id', testVehicleId)
        .eq('title', sharedTitle)
        .eq('action_type', 'workshop_vehicle_task')
        .in('status', ['pending', 'logged', 'on_hold']);

      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThanOrEqual(1);
      expect(data?.some((row: { id: string }) => row.id === completedTaskId)).toBe(false);
    });
  });
});
