import { createClient } from '@/lib/supabase/client';

export type AlertType = 'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit' | 'LOLER' | '6 Weekly Inspection' | 'Fire Extinguisher' | 'Taco Calibration' | 'Service (Hours)';
export type AlertSeverity = 'overdue' | 'due_soon';

interface Alert {
  type: AlertType;
  detail: string;
  severity: AlertSeverity;
}

interface VehicleWithAlerts {
  van_id?: string;
  id: string;
  vehicle?: {
    id: string;
    reg_number: string;
  };
  alerts: Alert[];
}

interface CategoryCache {
  maintenanceCategory?: { id: string; subcategory?: { id: string } };
  uncategorized?: { id: string };
}

let categoryCache: CategoryCache | null = null;

/**
 * Fetch and cache maintenance/service category and subcategory IDs
 */
async function getCategoryCache(): Promise<CategoryCache> {
  if (categoryCache) {
    return categoryCache;
  }

  const supabase = createClient();
  const cache: CategoryCache = {};

  try {
    // Try to find Maintenance category
    const { data: categories } = await supabase
      .from('workshop_task_categories')
      .select('id, name, slug')
      .ilike('name', '%maintenance%')
      .eq('is_active', true)
      .limit(1);

    if (categories && categories.length > 0) {
      const maintenanceCat = categories[0];
      
      // Try to find Service subcategory under Maintenance
      const { data: subcategories } = await supabase
        .from('workshop_task_subcategories')
        .select('id, name, slug')
        .eq('category_id', maintenanceCat.id)
        .ilike('name', '%service%')
        .eq('is_active', true)
        .limit(1);

      cache.maintenanceCategory = {
        id: maintenanceCat.id,
        subcategory: subcategories && subcategories.length > 0 ? { id: subcategories[0].id } : undefined
      };
    }

    // Fallback: Find Uncategorized
    const { data: uncategorized } = await supabase
      .from('workshop_task_subcategories')
      .select('id, name, slug')
      .ilike('name', 'uncategorized')
      .eq('is_active', true)
      .limit(1);

    if (uncategorized && uncategorized.length > 0) {
      cache.uncategorized = { id: uncategorized[0].id };
    }

    categoryCache = cache;
    return cache;
  } catch (error) {
    console.error('Error fetching category cache:', error);
    return cache;
  }
}

/**
 * Generate deterministic task title and comments for an alert
 */
export function getTaskContent(alertType: AlertType, regNumber: string, detail: string) {
  const titles: Record<AlertType, string> = {
    'Tax': `Tax Due - ${regNumber}`,
    'MOT': `MOT Due - ${regNumber}`,
    'Service': `Service Due - ${regNumber}`,
    'Cambelt': `Cambelt Replacement Due - ${regNumber}`,
    'First Aid Kit': `First Aid Kit Expiry - ${regNumber}`,
    'LOLER': `LOLER THOROUGH EXAMINATION Due - ${regNumber}`,
    '6 Weekly Inspection': `6 Weekly Inspection Due - ${regNumber}`,
    'Fire Extinguisher': `Fire Extinguisher Due - ${regNumber}`,
    'Taco Calibration': `Taco Calibration Due - ${regNumber}`,
    'Service (Hours)': `Service Due (Hours) - ${regNumber}`,
  };

  const comments: Record<AlertType, string> = {
    'Tax': `Vehicle tax requires renewal. ${detail}`,
    'MOT': `MOT test is required. ${detail}`,
    'Service': `Vehicle service is required. ${detail}`,
    'Cambelt': `Cambelt replacement is required. ${detail}`,
    'First Aid Kit': `First aid kit requires replacement. ${detail}`,
    'LOLER': `LOLER THOROUGH EXAMINATION (Lifting Operations and Lifting Equipment Regulations) is required yearly for this plant machinery. ${detail}`,
    '6 Weekly Inspection': `HGV 6-weekly inspection is due. ${detail}`,
    'Fire Extinguisher': `Fire extinguisher inspection/replacement is due. ${detail}`,
    'Taco Calibration': `Tachograph calibration is due. ${detail}`,
    'Service (Hours)': `Plant machinery service is due based on engine hours. ${detail}`,
  };

  return {
    title: titles[alertType] || `Maintenance Task - ${regNumber}`,
    comments: comments[alertType] || `Maintenance required. ${detail}`
  };
}

/**
 * Check if a task already exists for this alert type and vehicle
 */
async function taskExistsForAlert(
  vehicleId: string,
  alertType: AlertType,
  regNumber: string
): Promise<boolean> {
  const supabase = createClient();
  const { title } = getTaskContent(alertType, regNumber, '');

  try {
    const { data, error } = await supabase
      .from('actions')
      .select('id, status')
      .eq('van_id', vehicleId)
      .eq('action_type', 'workshop_vehicle_task')
      .eq('title', title)
      .in('status', ['pending', 'logged', 'on_hold']) // Only check active tasks
      .limit(1);

    if (error) throw error;
    return (data && data.length > 0) || false;
  } catch (error) {
    console.error('Error checking existing task:', error);
    return false; // Assume doesn't exist if check fails
  }
}

/**
 * Ensure service tasks exist for all alerts on a vehicle
 * @param vehicle Vehicle with alerts to create tasks for
 * @param userId Current user ID for created_by field
 * @returns Array of created task IDs
 */
export async function ensureServiceTasksForAlerts(
  vehicle: VehicleWithAlerts,
  userId: string
): Promise<string[]> {
  if (!vehicle.alerts || vehicle.alerts.length === 0) {
    return [];
  }

  const supabase = createClient();
  const vehicleId = vehicle.van_id ?? vehicle.id;
  const regNumber = vehicle.vehicle?.reg_number || 'Unknown';
  const createdTaskIds: string[] = [];

  try {
    // Get category cache
    const cache = await getCategoryCache();

    // Determine which category/subcategory to use
    const subcategoryId = cache.maintenanceCategory?.subcategory?.id || cache.uncategorized?.id;

    if (!subcategoryId) {
      console.warn('No suitable category/subcategory found for service tasks');
      return [];
    }

    // Process each alert
    for (const alert of vehicle.alerts) {
      // Check if task already exists
      const exists = await taskExistsForAlert(vehicleId, alert.type, regNumber);
      if (exists) {
        continue; // Skip if task already exists
      }

      // Generate task content
      const { title, comments } = getTaskContent(alert.type, regNumber, alert.detail);

      // Determine priority based on severity
      const priority = alert.severity === 'overdue' ? 'high' : 'medium';

      // Create the task
      const { data, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          van_id: vehicleId,
          workshop_subcategory_id: subcategoryId,
          title,
          workshop_comments: comments,
          description: comments.substring(0, 200),
          status: 'pending',
          priority,
          created_by: userId,
        })
        .select('id')
        .single();

      if (error) {
        console.error(`Error creating task for ${alert.type}:`, error);
        continue;
      }

      if (data) {
        createdTaskIds.push(data.id);
      }
    }

    return createdTaskIds;
  } catch (error) {
    console.error('Error in ensureServiceTasksForAlerts:', error);
    return createdTaskIds;
  }
}

/**
 * Reset the category cache (useful for testing or after category changes)
 */
export function resetCategoryCache(): void {
  categoryCache = null;
}
