import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';
import type { MaintenanceHistoryResponse } from '@/types/maintenance';

interface WorkshopTaskCategoryShape {
  name: string;
}

interface WorkshopTaskSubcategoryShape {
  name: string;
}

interface WorkshopTaskShape {
  id: string;
  created_at: string | null;
  status: string | null;
  action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action';
  workshop_comments: string | null;
  description: string | null;
  logged_comment: string | null;
  actioned_comment: string | null;
  actioned_at: string | null;
  logged_at: string | null;
  status_history?: unknown[] | null;
  created_by: string | null;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  workshop_task_categories?: WorkshopTaskCategoryShape[] | WorkshopTaskCategoryShape | null;
  workshop_task_subcategories?: WorkshopTaskSubcategoryShape[] | WorkshopTaskSubcategoryShape | null;
  profiles?: { full_name: string | null } | null;
}

// Helper to create service role client for bypassing RLS
function getSupabaseServiceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * GET /api/maintenance/history/[vehicleId]
 * Returns maintenance history for a vehicle
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Await params (Next.js 15 requirement)
    const { vehicleId } = await params;
    
    // Try vans table first, then hgvs table
  let vehicle: { id: string; reg_number: string | null } | null = null;
    let assetType: 'van' | 'hgv' = 'van';
    
    const { data: van } = await supabase
      .from('vans')
      .select('id, reg_number')
      .eq('id', vehicleId)
      .single();
    
    if (van) {
      vehicle = van;
      assetType = 'van';
    } else {
      const { data: hgv } = await supabase
        .from('hgvs')
        .select('id, reg_number')
        .eq('id', vehicleId)
        .single();
      
      if (hgv) {
        vehicle = hgv;
        assetType = 'hgv';
      }
    }
    
    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }
    
    const fkColumn = assetType === 'hgv' ? 'hgv_id' : 'van_id';
    
    // Get maintenance record with VES and MOT data
    const { data: maintenanceData } = await supabase
      .from('vehicle_maintenance')
      .select(`
        ves_make,
        ves_colour,
        ves_fuel_type,
        ves_year_of_manufacture,
        ves_engine_capacity,
        ves_tax_status,
        ves_mot_status,
        ves_co2_emissions,
        ves_euro_status,
        ves_real_driving_emissions,
        ves_type_approval,
        ves_wheelplan,
        ves_revenue_weight,
        ves_marked_for_export,
        ves_month_of_first_registration,
        ves_date_of_last_v5c_issued,
        tax_due_date,
        mot_due_date,
        last_dvla_sync,
        mot_make,
        mot_model,
        mot_fuel_type,
        mot_primary_colour,
        mot_registration,
        mot_year_of_manufacture,
        mot_first_used_date,
        last_mot_api_sync
      `)
      .eq(fkColumn, vehicleId)
      .single();
    
    // Get history (RLS handles permission check)
    const { data: history, error } = await supabase
      .from('maintenance_history')
      .select('*')
      .eq(fkColumn, vehicleId)
      .order('created_at', { ascending: false });
    
    if (error) {
      logger.error('Failed to fetch history', error);
      throw error;
    }
    
    // Get workshop tasks for this vehicle
    // Use service role client to bypass RLS - maintenance history should show ALL workshop tasks
    // regardless of user permissions, as it's an audit trail
    // Note: Includes BOTH 'workshop_vehicle_task' (manual) and 'inspection_defect' (from inspections)
    const supabaseServiceRole = getSupabaseServiceRole();
    
    const { data: directTasks, error: directError } = await supabaseServiceRole
      .from('actions')
      .select(`
        id,
        created_at,
        status,
        action_type,
        title,
        status_history,
        workshop_comments,
        description,
        logged_comment,
        actioned_comment,
        actioned_at,
        logged_at,
        created_by,
        van_id,
        hgv_id,
        plant_id,
        workshop_task_categories (
          name
        ),
        workshop_task_subcategories (
          name
        )
      `)
      .eq(fkColumn, vehicleId)
      .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
      .order('created_at', { ascending: false });
    
    const workshopTasks = (directTasks || []) as WorkshopTaskShape[];
    const workshopError = directError;
    
    if (workshopError) {
      logger.error('Failed to fetch workshop tasks', workshopError);
      logger.error('Vehicle ID:', vehicleId);
      // Don't fail the whole request if workshop tasks fail
    } else {
      logger.info(`Fetched ${workshopTasks?.length || 0} workshop tasks for vehicle ${vehicleId}`);
      if (workshopTasks && workshopTasks.length > 0) {
        logger.info('Workshop tasks statuses:', workshopTasks.map(t => ({ id: t.id, status: t.status, created_at: t.created_at })));
      }
    }
    
    // Fetch profile names for workshop tasks using service role for consistency
    let tasksWithProfiles: WorkshopTaskShape[] = workshopTasks;
    if (workshopTasks && workshopTasks.length > 0) {
      const userIds = [...new Set(workshopTasks.map(t => t.created_by).filter(Boolean))];
      
      if (userIds.length > 0) {
        // Fetch profiles from database
        const { data: profiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        
        const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
        tasksWithProfiles = workshopTasks.map((task) => ({
          ...task,
          profiles: task.created_by ? { full_name: profileMap.get(task.created_by) || null } : null,
        }));
      } else {
        // No user IDs to fetch, but still need to add profiles property (as null) to each task
        tasksWithProfiles = workshopTasks.map((task) => ({
          ...task,
          profiles: null,
        }));
      }
    }

    const normalizedWorkshopTasks = tasksWithProfiles.map((task) => ({
      ...task,
      created_at: task.created_at ?? '',
      status: task.status ?? 'pending',
      workshop_task_categories: Array.isArray(task.workshop_task_categories)
        ? task.workshop_task_categories[0] ?? null
        : task.workshop_task_categories ?? null,
      workshop_task_subcategories: Array.isArray(task.workshop_task_subcategories)
        ? task.workshop_task_subcategories[0] ?? null
        : task.workshop_task_subcategories ?? null,
      profiles: task.profiles?.full_name
        ? { full_name: task.profiles.full_name }
        : null,
    }));
    
    const response: MaintenanceHistoryResponse = {
      success: true,
      history: (history || []).map((entry) => ({
        ...entry,
        created_at: entry.created_at ?? '',
      })),
      workshopTasks: normalizedWorkshopTasks,
      vehicle: {
        id: vehicle.id,
        reg_number: vehicle.reg_number || 'Unknown'
      },
      vesData: maintenanceData || null
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    logger.error('GET /api/maintenance/history/[vehicleId] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
