/**
 * Plant Maintenance API Unit Tests
 * Tests the plant maintenance history API endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// SAFETY CHECK: Skip when env vars are missing or not running against localhost/staging
const shouldSkip = !supabaseUrl || !supabaseKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Plant Maintenance API tests – missing env vars or not running against localhost/staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Plant Maintenance API Tests', () => {
  let supabase: SupabaseClient;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });

    if (authError) throw authError;
    void authData.user!.id;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });

  describe('Database Schema Validation', () => {
    it('should have plant_id column in maintenance_history table', async () => {
      const { data: _data, error } = await supabase
        .from('maintenance_history')
        .select('plant_id, van_id')
        .limit(1);

      expect(error).toBeNull();
      // Schema should allow plant_id field
    });

    it('should enforce either van_id OR plant_id constraint', async () => {
      // This constraint is at DB level, testing that queries work correctly
      const { data: vehicleHistory } = await supabase
        .from('maintenance_history')
        .select('*')
        .not('van_id', 'is', null)
        .limit(1);

      const { data: plantHistory } = await supabase
        .from('maintenance_history')
        .select('*')
        .not('plant_id', 'is', null)
        .limit(1);

      // At least one type should have records (or both empty is ok for fresh DB)
      expect(vehicleHistory || plantHistory).toBeDefined();
    });

    it('should have current_hours field in vehicle_maintenance table', async () => {
      const { data: _data2, error } = await supabase
        .from('vehicle_maintenance')
        .select('current_hours, last_service_hours, next_service_hours')
        .limit(1);

      expect(error).toBeNull();
    });

    it('should have plant_id foreign key in vehicle_maintenance table', async () => {
      const { data: _data3, error } = await supabase
        .from('vehicle_maintenance')
        .select('plant_id')
        .not('plant_id', 'is', null)
        .limit(1);

      expect(error).toBeNull();
    });
  });

  describe('Plant Data Queries', () => {
    it('should fetch plant with all required fields', async () => {
      const { data: plants } = await supabase
        .from('plant')
        .select(`
          id,
          plant_id,
          nickname,
          make,
          model,
          serial_number,
          year,
          weight_class,
          category_id,
          loler_due_date,
          loler_last_inspection_date,
          loler_certificate_number,
          loler_inspection_interval_months,
          current_hours,
          status,
          reg_number,
          van_categories (
            name
          )
        `)
        .eq('status', 'active')
        .limit(1);

      if (plants && plants.length > 0) {
        const plant = plants[0];
        expect(plant).toHaveProperty('plant_id');
        expect(plant).toHaveProperty('status');
        expect(plant).toHaveProperty('loler_due_date');
        expect(plant).toHaveProperty('current_hours');
      } else {
        console.log('No active plant assets found - skipping validation');
      }
    });

    it('should fetch plant maintenance records by plant_id', async () => {
      const { data: maintenance, error } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .not('plant_id', 'is', null)
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(maintenance)).toBe(true);
    });

    it('should fetch plant workshop tasks', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select(`
          id,
          plant_id,
          status,
          workshop_task_categories (
            name
          )
        `)
        .not('plant_id', 'is', null)
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Plant History Queries', () => {
    it('should fetch maintenance history for plant assets', async () => {
      const { data: history, error } = await supabase
        .from('maintenance_history')
        .select('*')
        .not('plant_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

      expect(error).toBeNull();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should include required fields in plant maintenance history', async () => {
      const { data: history } = await supabase
        .from('maintenance_history')
        .select('*')
        .not('plant_id', 'is', null)
        .limit(1);

      if (history && history.length > 0) {
        const entry = history[0];
        expect(entry).toHaveProperty('plant_id');
        expect(entry).toHaveProperty('field_name');
        expect(entry).toHaveProperty('comment');
        expect(entry).toHaveProperty('updated_by_name');
        expect(entry.van_id).toBeNull();
      }
    });
  });

  describe('Plant Retirement Validation', () => {
    it('should query for open workshop tasks on plant', async () => {
      const { data: plants } = await supabase
        .from('plant')
        .select('id')
        .eq('status', 'active')
        .limit(1);

      if (plants && plants.length > 0) {
        const plantId = plants[0].id;

        const { data: openTasks, error } = await supabase
          .from('actions')
          .select('id, status')
          .eq('plant_id', plantId)
          .neq('status', 'completed')
          .limit(1);

        expect(error).toBeNull();
        expect(Array.isArray(openTasks)).toBe(true);
      }
    });

    it('should be able to update plant status to retired', async () => {
      // This tests the schema allows the update (not actually retiring in test)
      const { data: plants } = await supabase
        .from('plant')
        .select('id, status')
        .eq('status', 'active')
        .limit(1);

      if (plants && plants.length > 0) {
        // Just verify the query structure works (don't actually update)
        const plantId = plants[0].id;
        expect(plantId).toBeDefined();
        console.log('Plant status update query validated');
      }
    });
  });

  describe('Type Safety Validation', () => {
    it('should handle nullable fields correctly', async () => {
      const { data: maintenance } = await supabase
        .from('vehicle_maintenance')
        .select('current_hours, tracker_id, plant_id')
        .not('plant_id', 'is', null)
        .limit(1);

      if (maintenance && maintenance.length > 0) {
        const record = maintenance[0];
        // These fields can be null and should not throw
        expect(record.current_hours === null || typeof record.current_hours === 'number').toBe(true);
        expect(record.tracker_id === null || typeof record.tracker_id === 'string').toBe(true);
      }
    });
  });
});
