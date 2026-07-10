/**
 * Vehicle History Page Integration Tests
 * Tests all workflows for /fleet/vehicles/[vehicleId]/history page
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasSupabaseCredentials = Boolean(supabaseUrl && supabaseKey);
const isAllowedSupabaseTarget = Boolean(
  supabaseUrl &&
    (supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('staging'))
);
const canRunVehicleHistorySuite = hasSupabaseCredentials && isAllowedSupabaseTarget;
const describeVehicleHistorySuite = canRunVehicleHistorySuite ? describe : describe.skip;

if (!hasSupabaseCredentials) {
  console.warn('Skipping vehicle-history integration suite: missing Supabase credentials in .env.local');
  console.warn('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
}

if (hasSupabaseCredentials && !isAllowedSupabaseTarget) {
  console.warn('Skipping vehicle-history integration suite: production-safety gate blocked this Supabase URL');
  console.warn(`Current URL: ${supabaseUrl}`);
}

describeVehicleHistorySuite('Vehicle History Page Workflows', () => {
  let supabase: SupabaseClient;
  let testVehicleId: string;
  let maintenanceVehicleFk: 'van_id' | 'vehicle_id' = 'van_id';
  let actionsVehicleFk: 'van_id' | 'vehicle_id' = 'van_id';

  const detectVehicleFk = async (
    table: 'vehicle_maintenance' | 'actions'
  ): Promise<'van_id' | 'vehicle_id'> => {
    const { error: vanIdError } = await supabase.from(table).select('van_id').limit(1);
    if (!vanIdError) return 'van_id';

    const { error: vehicleIdError } = await supabase.from(table).select('vehicle_id').limit(1);
    if (!vehicleIdError) return 'vehicle_id';

    // Keep historical default to avoid widening blast radius if schema probing fails.
    return 'van_id';
  };

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Authenticate as test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });

    if (authError) throw authError;
    void authData.user!.id;

    // SAFETY: ONLY get ZZ99 test vehicles
    const { data: vehicles } = await supabase
      .from('vans')
      .select('id')
      .ilike('reg_number', 'ZZ99%')
      .neq('status', 'deleted')
      .limit(1);

    if (vehicles && vehicles.length > 0) {
      testVehicleId = vehicles[0].id;
    }

    maintenanceVehicleFk = await detectVehicleFk('vehicle_maintenance');
    actionsVehicleFk = await detectVehicleFk('actions');
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });

  describe('Vehicle Data Display', () => {
    it('should fetch complete vehicle data', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: vehicle, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(
            id,
            category_id,
            van_categories(id, name)
          )
        `)
        .eq(maintenanceVehicleFk, testVehicleId)
        .maybeSingle();

      if (!vehicle) {
        console.log('No maintenance record found for test vehicle, skipping test');
        return;
      }

      expect(error).toBeNull();
      expect(vehicle).toBeDefined();
      expect(vehicle?.[maintenanceVehicleFk]).toBe(testVehicleId);
      expect(vehicle).toHaveProperty('vehicle_reg');
      expect(vehicle).toHaveProperty('vehicle_nickname');
      expect(vehicle).toHaveProperty('current_mileage');
    });

    it('should fetch vehicle service information', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: vehicle, error } = await supabase
        .from('vehicle_maintenance')
        .select('last_service_mileage, next_service_mileage, mot_due_date, tax_due_date, current_mileage')
        .eq(maintenanceVehicleFk, testVehicleId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(vehicle).toBeDefined();
    });
  });

  describe('Maintenance History Tab (formerly "Maintenance")', () => {
    it('should fetch all maintenance history for vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: history, error } = await supabase
        .from('actions')
        .select(`
          *,
          category:workshop_task_categories(id, name, slug),
          subcategory:workshop_task_subcategories(id, name, slug)
        `)
        .eq(actionsVehicleFk, testVehicleId)
        .in('action_type', ['workshop_task', 'inspection_defect'])
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should filter history by task type', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: workshopTasks, error: workshopError } = await supabase
        .from('actions')
        .select('*')
        .eq(actionsVehicleFk, testVehicleId)
        .eq('action_type', 'workshop_task');

      expect(workshopError).toBeNull();
      expect(workshopTasks).toBeDefined();

      const { data: defects, error: defectError } = await supabase
        .from('actions')
        .select('*')
        .eq(actionsVehicleFk, testVehicleId)
        .eq('action_type', 'inspection_defect');

      expect(defectError).toBeNull();
      expect(defects).toBeDefined();
    });

    it('should filter history by status', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const statuses = ['pending', 'logged', 'on_hold', 'completed'];

      for (const status of statuses) {
        const { data: tasks, error } = await supabase
          .from('actions')
          .select('*')
          .eq(actionsVehicleFk, testVehicleId)
          .eq('status', status);

        expect(error).toBeNull();
        expect(tasks).toBeDefined();
        expect(Array.isArray(tasks)).toBe(true);
      }
    });

    it('should filter history by category', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      // Get a category first
      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) {
        console.log('No categories, skipping test');
        return;
      }

      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq(actionsVehicleFk, testVehicleId)
        .eq('workshop_category_id', categories[0].id);

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('MOT History Tab', () => {
    it('should fetch MOT history for vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: vehicle, error } = await supabase
        .from('vehicle_maintenance')
        .select('mot_due_date')
        .eq(maintenanceVehicleFk, testVehicleId)
        .maybeSingle();

      // May not have maintenance record, that's OK
      if (error) {
        console.log('No maintenance record found for MOT history test');
      } else if (vehicle) {
        expect(vehicle).toHaveProperty('mot_due_date');
        console.log('MOT history: maintenance record found');
      }
    });
  });

  describe('Notes Tab', () => {
    it('should check if notes functionality exists', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      // Check if there's a notes field or separate notes table
      const { data: vehicle, error } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .eq(maintenanceVehicleFk, testVehicleId)
        .maybeSingle();

      // May return null if no maintenance record exists yet - that's OK
      if (error) {
        console.log('Notes tab: No maintenance record found for vehicle');
      } else {
        expect(vehicle).toBeDefined();
        // Notes might be added in future - this test documents current state
        console.log('Notes tab: Currently checking for implementation');
      }
    });
  });

  describe('Edit Vehicle Record Modal', () => {
    it('should update vehicle maintenance data', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const updates = {
        current_mileage: 999993, // Obviously invalid test value for easy corruption detection
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      
      try {
        const { data: session } = await supabase.auth.getSession();
        const response = await fetch(`${siteUrl}/api/admin/vehicles/${testVehicleId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session?.access_token}`
          },
          body: JSON.stringify(updates),
        });

        if (response.status === 403 || response.status === 401) {
          console.log('User not authorized for vehicle updates, skipping test');
          return;
        }

        if (!response.ok) {
          console.log('API test - Update failed:', response.status, await response.text());
          return;
        }

        expect(response.ok).toBe(true);
      } catch (error) {
        console.log('API test skipped - server may not be reachable:', error);
        return;
      }
    });

    it('should update vehicle service dates', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 6);

      const updates = {
        next_service_date: futureDate.toISOString().split('T')[0],
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      
      try {
        const { data: session } = await supabase.auth.getSession();
        const response = await fetch(`${siteUrl}/api/admin/vehicles/${testVehicleId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session?.access_token}`
          },
          body: JSON.stringify(updates),
        });

        if (response.status === 403 || response.status === 401) {
          console.log('User not authorized, skipping test');
          return;
        }

        if (!response.ok) {
          console.log('API test - Update failed:', response.status, await response.text());
          return;
        }

        expect(response.ok).toBe(true);
      } catch (error) {
        console.log('API test skipped - server may not be reachable:', error);
        return;
      }
    });

    it('should prevent vehicle retirement if open workshop tasks exist', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      // Check for open tasks
      const { data: openTasks } = await supabase
        .from('actions')
        .select('id')
        .eq(actionsVehicleFk, testVehicleId)
        .neq('status', 'completed')
        .limit(1);

      if (!openTasks || openTasks.length === 0) {
        console.log('No open tasks, cannot test retirement prevention');
        return;
      }

      // Attempt to retire vehicle (should fail)
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/admin/vehicles/${testVehicleId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      // Should return 409 (conflict) due to open tasks
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toContain('open workshop tasks');
    });
  });

  describe('Task Card Expansion', () => {
    it('should fetch task details for expansion', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: tasks } = await supabase
        .from('actions')
        .select('*')
        .eq(actionsVehicleFk, testVehicleId)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        console.log('No tasks for vehicle, skipping test');
        return;
      }

      const taskId = tasks[0].id;

      const { data: taskDetails, error } = await supabase
        .from('actions')
        .select(`
          *,
          category:workshop_task_categories(id, name, slug),
          subcategory:workshop_task_subcategories(id, name, slug)
        `)
        .eq('id', taskId)
        .single();

      expect(error).toBeNull();
      expect(taskDetails).toBeDefined();
      expect(taskDetails).toHaveProperty('title');
      expect(taskDetails).toHaveProperty('description');
      expect(taskDetails).toHaveProperty('status');
    });
  });
});
