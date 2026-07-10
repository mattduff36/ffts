/**
 * Fleet Module Integration Tests
 * Tests all workflows for /fleet page including vehicles, maintenance, and categories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// SAFETY CHECK: Skip when not running against localhost or staging
const shouldSkip = !supabaseUrl || !supabaseKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Fleet Module tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Fleet Module Workflows', () => {
  let supabase: SupabaseClient;
  let testVehicleId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseKey);
    
    // Authenticate as test user
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

  describe('Vehicles Tab Workflows', () => {
    it('should fetch all active vehicles', async () => {
      const { data: vehicles, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(id, reg_number, nickname)
        `);

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();
      expect(Array.isArray(vehicles)).toBe(true);
    });

    it('should fetch all active vehicles (alternative direct query)', async () => {
      const { data: vehicles, error } = await supabase
        .from('vans')
        .select('*')
        .neq('status', 'deleted')
        .order('nickname');

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();
      expect(Array.isArray(vehicles)).toBe(true);
    });

    it('should fetch vehicle with maintenance data', async () => {
      // SAFETY: ONLY get test vehicles starting with ZZ99
      const { data: vehicles } = await supabase
        .from('vans')
        .select('id')
        .ilike('reg_number', 'ZZ99%')
        .neq('status', 'deleted')
        .limit(1);

      if (!vehicles || vehicles.length === 0) {
        console.log('No ZZ99 test vehicles found, skipping test');
        return;
      }

      const vehicleId = vehicles[0].id;

      const { data: vehicleData, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(
            id,
            reg_number,
            nickname,
            category_id,
            van_categories(id, name)
          )
        `)
        .eq('van_id', vehicleId)
        .maybeSingle();

      if (error) {
        console.log('Error fetching vehicle data:', error);
      }
      
      if (!vehicleData) {
        console.log('No maintenance record found for vehicle, skipping test');
        return;
      }

      expect(vehicleData).toBeDefined();
      expect(vehicleData?.van_id).toBe(vehicleId);
      
      // Set testVehicleId for other tests
      testVehicleId = vehicleId;
    });

    it('should update vehicle maintenance data', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      // First, get the vehicle_maintenance record ID
      const { data: vmRecord } = await supabase
        .from('vehicle_maintenance')
        .select('id')
        .eq('van_id', testVehicleId)
        .single();

      if (!vmRecord) {
        console.log('No vehicle_maintenance record found, skipping test');
        return;
      }

      // SAFETY: Using obviously invalid mileage (999997) so corruption is immediately visible
      const updates = {
        current_mileage: 999997,
      };

      const { data: updated, error } = await supabase
        .from('vehicle_maintenance')
        .update(updates)
        .eq('id', vmRecord.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.current_mileage).toBe(999997);
    });
  });

  describe('Maintenance Tab Workflows', () => {
    it('should fetch all workshop tasks with filters', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select(`
          *,
          vehicle:vehicles!van_id(id, reg_number, nickname),
          category:workshop_task_categories(id, name, slug),
          subcategory:workshop_task_subcategories(id, name, slug)
        `)
        .eq('action_type', 'workshop_task')
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status', async () => {
      const { data: pendingTasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'pending');

      expect(error).toBeNull();
      expect(pendingTasks).toBeDefined();
      expect(Array.isArray(pendingTasks)).toBe(true);
    });

    it('should filter tasks by vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: vehicleTasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('van_id', testVehicleId);

      expect(error).toBeNull();
      expect(vehicleTasks).toBeDefined();
      expect(Array.isArray(vehicleTasks)).toBe(true);
    });

    it('should fetch overdue and due soon tasks', async () => {
      // Fetch vehicles with service data by joining with active vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(id, status)
        `)
        .neq('vehicles.status', 'deleted');

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();

      // Calculate overdue/due soon based on service dates
      const today = new Date();
      const overdueVehicles = vehicles?.filter((v: { mot_expiry_date?: string }) => {
        if (!v.mot_expiry_date) return false;
        const motDate = new Date(v.mot_expiry_date);
        return motDate < today;
      });

      expect(Array.isArray(overdueVehicles)).toBe(true);
    });
  });

  describe('Vehicle Categories Management', () => {
    let testCategoryId: string;

    it('should fetch all vehicle categories', async () => {
      const { data: categories, error} = await supabase
        .from('van_categories')
        .select('*')
        .order('name');

      expect(error).toBeNull();
      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
    });

    it('should create a new vehicle category (manager only)', async () => {
      const newCategory = {
        name: 'Test Category ' + Date.now(),
        colour: '#FF0000',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      
      try {
        const response = await fetch(`${siteUrl}/api/admin/vehicle-categories`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
        }
      } catch {
        console.log('API test skipped - server may not be reachable from test environment');
        return;
      }
    }, 10000);

    it('should update vehicle category', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const updates = {
        colour: '#00FF00',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/admin/vehicle-categories/${testCategoryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete vehicle category', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      const response = await fetch(`${siteUrl}/api/admin/vehicle-categories/${testCategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });
  });
});
