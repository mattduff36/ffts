import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// SAFETY CHECK: Skip when not running against localhost or staging
const shouldSkip = !supabaseUrl || !supabaseServiceKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Workshop Task Completion tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Workshop Task Completion with Maintenance Updates', () => {
  let supabase: SupabaseClient;
  let testVehicleId: string;
  let testTaskId: string;
  let testUserId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: `test-completion-${Date.now()}@example.com`,
      password: 'testPassword123!',
      email_confirm: true,
    });
    if (userError) throw new Error(`Failed to create user: ${userError.message}`);
    testUserId = userData.user!.id;

    const { error: profileError } = await supabase.from('profiles').insert({
      id: testUserId,
      full_name: 'Test User',
    });
    if (profileError) throw new Error(`Failed to create profile: ${profileError.message}`);

    // Get a vehicle category
    const { data: category } = await supabase
      .from('van_categories')
      .select('id')
      .limit(1)
      .single();

    const { data: vehicle, error: vehicleError } = await supabase
      .from('vans')
      .insert({
        reg_number: `ZZ99COMP${Date.now().toString().slice(-4)}`,
        category_id: category?.id || null,
        status: 'active',
      })
      .select()
      .single();
    if (vehicleError || !vehicle) throw new Error(`Failed to create vehicle: ${vehicleError?.message}`);
    testVehicleId = vehicle.id;

    const { data: serviceCategory, error: categoryError } = await supabase
      .from('workshop_task_categories')
      .select('id')
      .ilike('name', '%service%')
      .eq('applies_to', 'van')
      .single();
    if (categoryError || !serviceCategory) throw new Error(`Failed to find service category: ${categoryError?.message}`);

    const { data: task, error: taskError } = await supabase
      .from('actions')
      .insert({
        action_type: 'workshop_vehicle_task',
        van_id: testVehicleId,
        workshop_category_id: serviceCategory.id,
        title: 'Test Service Task',
        description: 'Test service work',
        priority: 'medium',
        status: 'logged',
        created_by: testUserId,
        logged_at: new Date().toISOString(),
        logged_by: testUserId,
        logged_comment: 'Started test service',
      })
      .select()
      .single();
    if (taskError || !task) throw new Error(`Failed to create task: ${taskError?.message}`);
    testTaskId = task.id;
  });

  afterAll(async () => {
    if (testTaskId) {
      await supabase.from('actions').delete().eq('id', testTaskId);
    }
    if (testVehicleId) {
      await supabase.from('maintenance_history').delete().eq('van_id', testVehicleId);
      await supabase.from('vehicle_maintenance').delete().eq('van_id', testVehicleId);
      await supabase.from('vans').delete().eq('id', testVehicleId);
    }
    if (testUserId) {
      await supabase.from('profiles').delete().eq('id', testUserId);
      await supabase.auth.admin.deleteUser(testUserId);
    }
  });

  it('should verify Service category has completion_updates configured', async () => {
    const { data: serviceCategory } = await supabase
      .from('workshop_task_categories')
      .select('id, name, completion_updates')
      .ilike('name', '%service%')
      .eq('applies_to', 'van')
      .single();

    expect(serviceCategory).not.toBeNull();
    expect(serviceCategory!.completion_updates).not.toBeNull();
    
    const updates = serviceCategory!.completion_updates as Array<{ target: string; field_name: string; value_type: string; label: string }>;
    expect(Array.isArray(updates)).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    
    const serviceUpdate = updates[0];
    expect(serviceUpdate.target).toBe('vehicle_maintenance');
    expect(serviceUpdate.field_name).toBe('next_service_mileage');
    expect(serviceUpdate.value_type).toBe('mileage');
    expect(serviceUpdate.label).toContain('Next Service Due');
  });
});
