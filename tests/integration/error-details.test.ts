/**
 * Error Details API Integration Tests
 * 
 * Tests the error details API endpoints that provide contextual
 * information about why errors occurred
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// SAFETY CHECK: Skip when not running against localhost or staging
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const shouldSkip = !supabaseUrl || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Error Details tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

describeOrSkip('Error Details API - Subcategory Tasks', () => {
  let testCategoryId: string;
  let testSubcategoryId: string;
  let testVehicleId: string;
  let testTaskId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Get or create test vehicle
    const { data: existingVehicle } = await supabase
      .from('vans')
      .select('id')
      .ilike('reg_number', 'ZZ99ERRTEST')
      .single();

    if (existingVehicle) {
      testVehicleId = existingVehicle.id;
    } else {
      const { data: categories } = await supabase
        .from('van_categories')
        .select('id')
        .limit(1)
        .single();

      const { data: newVehicle } = await supabase
        .from('vans')
        .insert({
          reg_number: 'ZZ99ERRTEST',
          status: 'active',
          category_id: categories?.id,
        })
        .select('id')
        .single();

      testVehicleId = newVehicle!.id;
    }

    // Get a user for task creation
    const { data: users } = await supabase.auth.admin.listUsers();
    testUserId = users.users[0].id;

    // Create test category
    const { data: category } = await supabase
      .from('workshop_task_categories')
      .insert({
        name: 'Test Error Category',
        slug: 'test-error-category',
        is_active: true,
        sort_order: 999,
      })
      .select('id')
      .single();

    testCategoryId = category!.id;

    // Create test subcategory
    const { data: subcategory } = await supabase
      .from('workshop_task_subcategories')
      .insert({
        category_id: testCategoryId,
        name: 'Test Error Subcategory',
        slug: 'test-error-subcategory',
        is_active: true,
        sort_order: 1,
      })
      .select('id')
      .single();

    testSubcategoryId = subcategory!.id;

    // Create test task using the subcategory
    const { data: task } = await supabase
      .from('actions')
      .insert({
        van_id: testVehicleId,
        title: 'Test Error Task',
        status: 'pending',
        workshop_category_id: testCategoryId,
        workshop_subcategory_id: testSubcategoryId,
        created_by: testUserId,
        workshop_comments: 'Test task for error details',
      })
      .select('id')
      .single();

    testTaskId = task!.id;
  });

  afterAll(async () => {
    // Cleanup: delete in reverse order of creation
    if (testTaskId) {
      await supabase.from('actions').delete().eq('id', testTaskId);
    }
    if (testSubcategoryId) {
      await supabase.from('workshop_task_subcategories').delete().eq('id', testSubcategoryId);
    }
    if (testCategoryId) {
      await supabase.from('workshop_task_categories').delete().eq('id', testCategoryId);
    }
    // Keep test vehicle for potential reuse in other tests
  });

  it('should return error details for subcategory with tasks', async () => {
    const response = await fetch(
      `http://localhost:4000/api/errors/details/subcategory-tasks?id=${testSubcategoryId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    // Verify response structure
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('detailsType', 'subcategory-tasks');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('actions');
    expect(data).toHaveProperty('resolutionGuide');

    // Verify summary
    expect(data.summary.title).toContain('Test Error Subcategory');
    expect(data.summary.count).toBeGreaterThan(0);
    expect(data.summary.subcategoryName).toBe('Test Error Subcategory');

    // Verify items
    expect(data.items).toBeInstanceOf(Array);
    expect(data.items.length).toBeGreaterThan(0);
    
    const firstItem = data.items[0];
    expect(firstItem).toHaveProperty('id');
    expect(firstItem).toHaveProperty('title');
    expect(firstItem).toHaveProperty('status');
    expect(firstItem).toHaveProperty('vehicle');
    expect(firstItem).toHaveProperty('created_at');
    expect(firstItem).toHaveProperty('url');

    // Verify resolution guide
    expect(data.resolutionGuide).toBeInstanceOf(Array);
    expect(data.resolutionGuide.length).toBeGreaterThan(0);
  });

  it('should return 404 for non-existent subcategory', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await fetch(
      `http://localhost:4000/api/errors/details/subcategory-tasks?id=${fakeId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'Subcategory not found');
  });

  it('should return 400 when id parameter is missing', async () => {
    const response = await fetch(
      'http://localhost:4000/api/errors/details/subcategory-tasks',
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'Subcategory ID is required');
  });

  it('should include vehicle information in task items', async () => {
    const response = await fetch(
      `http://localhost:4000/api/errors/details/subcategory-tasks?id=${testSubcategoryId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();
    const firstItem = data.items[0];

    expect(firstItem.vehicle).toHaveProperty('reg_number');
    expect(firstItem.vehicle.reg_number).toBe('ZZ99ERRTEST');
  });

  it('should include status breakdown in summary', async () => {
    const response = await fetch(
      `http://localhost:4000/api/errors/details/subcategory-tasks?id=${testSubcategoryId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    expect(data.summary).toHaveProperty('statusBreakdown');
    expect(data.summary.statusBreakdown).toHaveProperty('pending');
    expect(data.summary.statusBreakdown.pending).toBeGreaterThan(0);
  });
});
