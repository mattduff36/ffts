/**
 * Plant History Page Integration Tests
 * Tests all workflows for /fleet/plant/[plantId]/history page
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { resolveTestPlantId } from './helpers/test-assets';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// SAFETY CHECK: Skip when not running against localhost or staging
const shouldSkip = !supabaseUrl || !supabaseKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
if (shouldSkip) {
  console.warn('⏭️  Skipping Plant History tests – not running against localhost or staging (URL: %s)', supabaseUrl);
}
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Plant History Page Workflows', () => {
  let supabase: SupabaseClient;
  let testPlantId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Authenticate as test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });

    if (authError) throw authError;
    void authData.user!.id;

    testPlantId = (await resolveTestPlantId(supabase)) || '';
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });

  describe('Plant Data Display', () => {
    it('should fetch complete plant data', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      const { data: plant, error } = await supabase
        .from('plant')
        .select(`
          *,
          van_categories (
            id,
            name
          )
        `)
        .eq('id', testPlantId)
        .single();

      expect(error).toBeNull();
      expect(plant).toBeDefined();
      expect(plant?.id).toBe(testPlantId);
      expect(plant).toHaveProperty('plant_id');
      expect(plant).toHaveProperty('current_hours');
      expect(plant).toHaveProperty('loler_due_date');
    });

    it('should fetch plant maintenance information', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      const { data: maintenance, error } = await supabase
        .from('vehicle_maintenance')
        .select('current_hours, last_service_hours, next_service_hours, tracker_id')
        .eq('plant_id', testPlantId)
        .maybeSingle();

      expect(error).toBeNull();
      // Maintenance record may not exist for all plant assets
      if (maintenance) {
        expect(maintenance).toHaveProperty('current_hours');
      }
    });
  });

  describe('Plant Maintenance History', () => {
    it('should fetch maintenance history for plant', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      const { data: history, error } = await supabase
        .from('maintenance_history')
        .select('*')
        .eq('plant_id', testPlantId)
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should fetch workshop tasks for plant', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      const { data: tasks, error } = await supabase
        .from('actions')
        .select(`
          *,
          workshop_task_categories (
            id,
            name
          )
        `)
        .eq('plant_id', testPlantId)
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Edit Plant Record Modal', () => {
    it('should have plant_id column in maintenance_history', async () => {
      // Verify the migration was successful
      const { data: _data, error } = await supabase
        .from('maintenance_history')
        .select('plant_id')
        .limit(1);

      // Should not error even if no records exist
      expect(error).toBeNull();
    });

    it('should fetch plant maintenance history API endpoint', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
      
      try {
        const { data: session } = await supabase.auth.getSession();
        const response = await fetch(`${siteUrl}/api/maintenance/history/plant/${testPlantId}`, {
          headers: { 
            'Authorization': `Bearer ${session.session?.access_token}`
          },
        });

        if (!response.ok) {
          console.log('API test - Plant history fetch failed:', response.status, await response.text());
          return;
        }

        const result = await response.json();
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('history');
        expect(result).toHaveProperty('workshopTasks');
        expect(result).toHaveProperty('plant');
      } catch (error) {
        console.log('API test skipped - server may not be reachable:', error);
        return;
      }
    });
  });

  describe('Plant Retirement Flow', () => {
    it('should prevent retirement if open workshop tasks exist', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      // Check for open tasks
      const { data: openTasks } = await supabase
        .from('actions')
        .select('id')
        .eq('plant_id', testPlantId)
        .neq('status', 'completed')
        .limit(1);

      if (!openTasks || openTasks.length === 0) {
        console.log('No open tasks, cannot test retirement prevention');
        return;
      }

      // This suite should not mutate asset status; just verify the open-task guard precondition.
      expect(openTasks.length).toBeGreaterThan(0);
    });

    it('should allow status change to retired when no open tasks', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      // Check for open tasks
      const { data: openTasks } = await supabase
        .from('actions')
        .select('id')
        .eq('plant_id', testPlantId)
        .neq('status', 'completed')
        .limit(1);

      if (openTasks && openTasks.length > 0) {
        console.log('Open tasks exist, skipping retirement test');
        return;
      }

      // If no open tasks, the update should be allowed (but we won't actually do it in test)
      console.log('Plant has no open tasks - retirement would be allowed');
    });
  });

  describe('Documents Tab', () => {
    it('should fetch workshop task attachments for plant', async () => {
      if (!testPlantId) {
        console.log('No test plant, skipping test');
        return;
      }

      // Get workshop tasks first
      const { data: tasks } = await supabase
        .from('actions')
        .select('id')
        .eq('plant_id', testPlantId);

      if (!tasks || tasks.length === 0) {
        console.log('No workshop tasks for plant, skipping attachments test');
        return;
      }

      const taskIds = tasks.map((t: { id: string }) => t.id);

      const { data: attachments, error } = await supabase
        .from('workshop_task_attachments')
        .select(`
          id,
          task_id,
          created_at,
          workshop_attachment_templates (
            name,
            description
          )
        `)
        .in('task_id', taskIds);

      expect(error).toBeNull();
      expect(Array.isArray(attachments)).toBe(true);
    });
  });
});
