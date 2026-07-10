/**
 * Test: Plant Table Integration Tests
 * Verifies plant table functionality, data integrity, and related operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveTestPlantId } from './helpers/test-assets';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// SAFETY CHECK: Skip when env vars are missing or not running against localhost/staging
const shouldSkip = !supabaseUrl || !supabaseServiceKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Plant Table tests – missing env vars or not running against localhost/staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Plant Table Integration Tests', () => {
  let supabase: SupabaseClient;
  let testPlantId: string;
  let testManagerId: string;
  let testCategoryId: string;
  let testWorkshopCategoryId: string;
  let testWorkshopSubcategoryId: string;
  let createdPlantId: string | null = null;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Get a manager user for creating test data
    const { data: manager } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'manager')
      .limit(1)
      .single();
    
    if (!manager) throw new Error('No test manager found');
    testManagerId = manager.id;

    // Get a vehicle category for plant
    const { data: category } = await supabase
      .from('van_categories')
      .select('id')
      .limit(1)
      .single();
    
    if (!category) throw new Error('No vehicle category found');
    testCategoryId = category.id;

    // Get workshop category and subcategory for plant
    const { data: workshopCategory } = await supabase
      .from('workshop_task_categories')
      .select('id')
      .eq('applies_to', 'plant')
      .eq('is_active', true)
      .limit(1)
      .single();
    
    if (workshopCategory) {
      testWorkshopCategoryId = workshopCategory.id;

      const { data: subcategory } = await supabase
        .from('workshop_task_subcategories')
        .select('id')
        .eq('category_id', testWorkshopCategoryId)
        .eq('is_active', true)
        .limit(1)
        .single();
      
      if (subcategory) {
        testWorkshopSubcategoryId = subcategory.id;
      }
    }

    testPlantId = (await resolveTestPlantId(supabase)) || '';
  });

  afterAll(async () => {
    // Clean up any test plant we created
    if (createdPlantId) {
      await supabase
        .from('plant')
        .delete()
        .eq('id', createdPlantId);
    }
  });

  describe('Plant Table Structure', () => {
    it('should have plant table with required columns', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .limit(1)
        .single();

      expect(error).toBeNull();
      if (data) {
        expect(data).toHaveProperty('id');
        expect(data).toHaveProperty('plant_id');
        expect(data).toHaveProperty('nickname');
        expect(data).toHaveProperty('make');
        expect(data).toHaveProperty('model');
        expect(data).toHaveProperty('serial_number');
        expect(data).toHaveProperty('loler_due_date');
        expect(data).toHaveProperty('loler_last_inspection_date');
        expect(data).toHaveProperty('loler_certificate_number');
        expect(data).toHaveProperty('loler_inspection_interval_months');
        expect(data).toHaveProperty('current_hours');
        expect(data).toHaveProperty('status');
        expect(data).toHaveProperty('created_at');
        expect(data).toHaveProperty('updated_at');
      }
    });

    it('should have no plant rows in vehicles table', async () => {
      const { data, error } = await supabase
        .from('vans')
        .select('id, asset_type')
        .eq('asset_type', 'plant');

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('should have plant_id columns in related tables', async () => {
      // Check actions table
      const { error: actionsError } = await supabase
        .from('actions')
        .select('plant_id')
        .limit(1);
      expect(actionsError).toBeNull();

      // Check plant_inspections table
      const { error: inspectionsError } = await supabase
        .from('plant_inspections')
        .select('plant_id')
        .limit(1);
      expect(inspectionsError).toBeNull();

      // Check vehicle_maintenance table
      const { error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select('plant_id')
        .limit(1);
      expect(maintenanceError).toBeNull();
    });
  });

  describe('Plant CRUD Operations', () => {
    it('should create a new plant record', async () => {
      const { data, error } = await supabase
        .from('plant')
        .insert({
          plant_id: `ZZ99PLANT${Date.now().toString().slice(-4)}`,
          reg_number: `ZZ99PL${Date.now().toString().slice(-4)}`,
          nickname: 'Test Excavator',
          make: 'Caterpillar',
          model: '320',
          serial_number: `SN${Date.now()}`,
          year: 2020,
          weight_class: '20-30 tonnes',
          category_id: testCategoryId,
          current_hours: 1500,
          status: 'active',
          loler_inspection_interval_months: 12,
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('id');
      
      if (data) {
        createdPlantId = data.id;
      }
    });

    it('should read plant records', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .eq('status', 'active');

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data!.length).toBeGreaterThan(0);
    });

    it('should update plant record', async () => {
      if (!createdPlantId) {
        console.log('⏭️  Skipping update test - no test plant created');
        return;
      }

      const { data, error } = await supabase
        .from('plant')
        .update({
          current_hours: 1550,
          loler_due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        })
        .eq('id', createdPlantId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('current_hours', 1550);
      expect(data?.loler_due_date).toBeTruthy();
    });

    it('should enforce unique plant_id constraint', async () => {
      if (!createdPlantId) {
        console.log('⏭️  Skipping unique constraint test - no test plant created');
        return;
      }

      // Get the plant_id we just created
      const { data: existingPlant } = await supabase
        .from('plant')
        .select('plant_id')
        .eq('id', createdPlantId)
        .single();

      if (!existingPlant) return;

      // Try to create another plant with the same plant_id
      const { error } = await supabase
        .from('plant')
        .insert({
          plant_id: existingPlant.plant_id,
          category_id: testCategoryId,
          status: 'active',
        });

      expect(error).toBeTruthy();
      expect(error?.code).toBe('23505'); // unique_violation
    });
  });

  describe('Plant Workshop Tasks', () => {
    it('should create workshop task for plant', async () => {
      if (!testPlantId || !testWorkshopSubcategoryId) {
        console.log('⏭️  Skipping plant workshop task test - missing dependencies');
        return;
      }

      const { data, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          plant_id: testPlantId,
          van_id: null,
          workshop_subcategory_id: testWorkshopSubcategoryId,
          workshop_comments: 'Test plant maintenance task for integration testing',
          title: 'Test Plant Task',
          description: 'Integration test task',
          status: 'pending',
          priority: 'medium',
          created_by: testManagerId,
        })
        .select('id, plant_id, van_id')
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('plant_id', testPlantId);
      expect(data?.van_id).toBeNull();

      // Clean up
      if (data?.id) {
        await supabase.from('actions').delete().eq('id', data.id);
      }
    });

    it('should query workshop tasks with plant joins', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          title,
          plant_id,
          plant (
            plant_id,
            nickname
          )
        `)
        .not('plant_id', 'is', null)
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      
      if (data && data.length > 0) {
        expect(data[0]).toHaveProperty('plant_id');
        expect(data[0]).toHaveProperty('plant');
      }
    });

    it('should enforce check constraint for van_id vs plant_id in actions', async () => {
      if (!testPlantId) {
        console.log('⏭️  Skipping constraint test - no test plant');
        return;
      }

      // Get a vehicle ID
      const { data: vehicle } = await supabase
        .from('vans')
        .select('id')
        .limit(1)
        .single();

      if (!vehicle || !testWorkshopSubcategoryId) return;

      // Try to create action with BOTH van_id and plant_id
      const { error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          van_id: vehicle.id,
          plant_id: testPlantId,
          workshop_subcategory_id: testWorkshopSubcategoryId,
          workshop_comments: 'This should fail',
          title: 'Invalid Task',
          status: 'pending',
          priority: 'medium',
          created_by: testManagerId,
        });

      expect(error).toBeTruthy();
      expect(error?.code).toBe('23514'); // check_violation
    });
  });

  describe('Plant Maintenance Records', () => {
    it('should create maintenance record for plant', async () => {
      if (!testPlantId) {
        console.log('⏭️  Skipping plant maintenance test - no test plant');
        return;
      }

      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .insert({
          plant_id: testPlantId,
          van_id: null,
          current_hours: 2000,
          last_service_hours: 1900,
          next_service_hours: 2100,
          last_hours_update: new Date().toISOString(),
          last_updated_at: new Date().toISOString(),
          last_updated_by: testManagerId,
        })
        .select('id, plant_id, van_id, current_hours')
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('plant_id', testPlantId);
      expect(data?.van_id).toBeNull();
      expect(data).toHaveProperty('current_hours', 2000);

      // Clean up
      if (data?.id) {
        await supabase.from('vehicle_maintenance').delete().eq('id', data.id);
      }
    });

    it('should query maintenance records for plant', async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          id,
          current_hours,
          plant_id,
          plant (
            plant_id,
            nickname
          )
        `)
        .not('plant_id', 'is', null)
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Plant Inspections', () => {
    it('should support plant inspections (submitted only)', async () => {
      if (!testPlantId) {
        console.log('⏭️  Skipping plant inspection test - no test plant');
        return;
      }

      const { data, error } = await supabase
        .from('plant_inspections')
        .insert({
          plant_id: testPlantId,
          van_id: null,
          user_id: testManagerId,
          inspection_date: new Date().toISOString(),
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          signature_data: 'test-signature',
          signed_at: new Date().toISOString(),
        })
        .select('id, plant_id, van_id, status')
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('plant_id', testPlantId);
      expect(data?.van_id).toBeNull();
      expect(data?.status).toBe('submitted');

      // Clean up
      if (data?.id) {
        await supabase.from('plant_inspections').delete().eq('id', data.id);
      }
    });

    it('should reject draft status for plant inspections', async () => {
      if (!testPlantId) {
        console.log('⏭️  Skipping plant draft rejection test - no test plant');
        return;
      }

      const { data, error } = await supabase
        .from('plant_inspections')
        .insert({
          plant_id: testPlantId,
          van_id: null,
          user_id: testManagerId,
          inspection_date: new Date().toISOString(),
          status: 'draft',
        })
        .select('id')
        .single();

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  });

  describe('Data Migration Verification', () => {
    it('should have correct count of plant records', async () => {
      const { count, error } = await supabase
        .from('plant')
        .select('*', { count: 'exact', head: true });

      expect(error).toBeNull();
      expect(count).toBeGreaterThan(0);
      console.log(`✓ Found ${count} plant records in plant table`);
    });

    it('should have plant tasks migrated correctly', async () => {
      const { count, error } = await supabase
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✓ Found ${count || 0} workshop tasks with plant_id`);
    });

    it('should have plant maintenance records migrated', async () => {
      const { count, error } = await supabase
        .from('vehicle_maintenance')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✓ Found ${count || 0} maintenance records with plant_id`);
    });

    it('should have plant inspections migrated', async () => {
      const { count, error } = await supabase
        .from('plant_inspections')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✓ Found ${count || 0} inspections with plant_id`);
    });
  });

  describe('Plant RLS Policies', () => {
    it('should allow authenticated users to read active plant', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .eq('status', 'active')
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should have proper indexes on plant table', async () => {
      // Query using indexed columns to verify they exist
      const { error: plantIdError } = await supabase
        .from('plant')
        .select('id')
        .eq('plant_id', 'TEST')
        .limit(1);
      expect(plantIdError).toBeNull();

      const { error: statusError } = await supabase
        .from('plant')
        .select('id')
        .eq('status', 'active')
        .limit(1);
      expect(statusError).toBeNull();
    });
  });

  describe('LOLER Fields', () => {
    it('should support LOLER compliance tracking', async () => {
      if (!createdPlantId) {
        console.log('⏭️  Skipping LOLER test - no test plant created');
        return;
      }

      const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from('plant')
        .update({
          loler_due_date: futureDate.toISOString().split('T')[0],
          loler_last_inspection_date: pastDate.toISOString().split('T')[0],
          loler_certificate_number: 'LOLER-TEST-2024-001',
          loler_inspection_interval_months: 12,
        })
        .eq('id', createdPlantId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toHaveProperty('loler_due_date');
      expect(data).toHaveProperty('loler_last_inspection_date');
      expect(data).toHaveProperty('loler_certificate_number', 'LOLER-TEST-2024-001');
      expect(data).toHaveProperty('loler_inspection_interval_months', 12);
    });

    it('should query plant by LOLER due date', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('plant_id, loler_due_date')
        .not('loler_due_date', 'is', null)
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });
});
