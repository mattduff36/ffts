// Types for Vehicle Maintenance & Service System

export type CategoryResponsibility = 'workshop' | 'office';
export type MaintenancePeriodUnit = 'weeks' | 'months' | 'miles' | 'hours';
export type MaintenanceCategorySource = 'system' | 'custom';

export interface MaintenanceCategory {
  id: string;
  name: string;
  description: string | null;
  // 'mileage' is the stored distance type. HGV screens label the same readings as kilometres.
  type: 'date' | 'mileage' | 'hours';
  period_value: number;
  period_unit: MaintenancePeriodUnit;
  alert_threshold_days: number | null;
  alert_threshold_miles: number | null;
  alert_threshold_hours: number | null;
  applies_to: string[];
  is_active: boolean;
  sort_order: number;
  field_key?: string | null;
  is_system?: boolean;
  is_delete_protected?: boolean;
  created_at: string;
  updated_at: string;
  
  // Duty/Responsibility settings (added 2026-01-19)
  responsibility: CategoryResponsibility;
  show_on_overview: boolean;
  reminder_in_app_enabled: boolean;
  reminder_email_enabled: boolean;
}

export interface MaintenanceCategoryRecipient {
  id: string;
  category_id: string;
  user_id: string;
  created_at: string;
}

export interface MaintenanceCategoryWithRecipients extends MaintenanceCategory {
  recipients?: MaintenanceCategoryRecipient[];
}

export interface VehicleMaintenance {
  id: string;
  van_id: string | null;
  hgv_id?: string | null;
  plant_id?: string | null;
  
  // Date-based maintenance
  tax_due_date: string | null;
  mot_due_date: string | null;
  first_aid_kit_expiry: string | null;
  six_weekly_inspection_due_date?: string | null;
  fire_extinguisher_due_date?: string | null;
  taco_calibration_due_date?: string | null;
  loler_due_date?: string | null; // LOLER inspection due (plant machinery only)
  
  // Mileage-based maintenance (vehicles)
  current_mileage: number | null;
  last_service_mileage: number | null;
  next_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  
  // Hours-based maintenance (plant machinery)
  current_hours?: number | null;
  last_service_hours?: number | null;
  next_service_hours?: number | null;
  last_hours_update?: string | null;
  
  // Tracker
  tracker_id: string | null;
  
  // Tracking
  last_mileage_update: string | null;
  last_updated_at: string;
  last_updated_by: string | null;
  
  // DVLA API Sync
  last_dvla_sync: string | null;
  dvla_sync_status: 'never' | 'success' | 'error' | 'pending' | null;
  dvla_sync_error: string | null;
  dvla_raw_data: unknown | null;
  
  // VES API Vehicle Data
  ves_make: string | null;
  ves_colour: string | null;
  ves_fuel_type: string | null;
  ves_year_of_manufacture: number | null;
  ves_engine_capacity: number | null;
  ves_tax_status: string | null;
  ves_mot_status: string | null;
  ves_co2_emissions: number | null;
  ves_euro_status: string | null;
  ves_real_driving_emissions: string | null;
  ves_type_approval: string | null;
  ves_wheelplan: string | null;
  ves_revenue_weight: number | null;
  ves_marked_for_export: boolean | null;
  ves_month_of_first_registration: string | null;
  ves_date_of_last_v5c_issued: string | null;
  
  // MOT History API Data - Sync tracking
  mot_expiry_date: string | null;
  mot_api_sync_status: 'never' | 'success' | 'error' | 'pending' | null;
  mot_api_sync_error: string | null;
  last_mot_api_sync: string | null;
  mot_raw_data: unknown | null;
  
  // MOT History API Data - Vehicle details
  mot_make: string | null;
  mot_model: string | null;
  mot_first_used_date: string | null;
  mot_registration_date: string | null;
  mot_manufacture_date: string | null;
  mot_engine_size: string | null;
  mot_fuel_type: string | null;
  mot_primary_colour: string | null;
  mot_secondary_colour: string | null;
  mot_vehicle_id: string | null;
  mot_registration: string | null;
  mot_vin: string | null;
  mot_v5c_reference: string | null;
  mot_dvla_id: string | null;
  
  created_at: string;
  updated_at: string;
  
  // Metadata
  notes: string | null;
}

export interface MaintenanceHistory {
  id: string;
  van_id: string | null;
  plant_id: string | null;
  maintenance_category_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  value_type: 'date' | 'mileage' | 'boolean' | 'text';
  comment: string; // Minimum 10 characters
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
}

export interface VehicleArchive {
  id: string;
  van_id: string;
  reg_number: string;
  category_id: string | null;
  status: string | null;
  archive_reason: 'Sold' | 'Scrapped' | 'Other';
  archive_comment: string | null;
  archived_by: string | null;
  archived_at: string;
  vehicle_data: Record<string, unknown>;
  maintenance_data: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================================
// Extended types with calculations
// ============================================================================

export type MaintenanceStatus = 'overdue' | 'due_soon' | 'ok' | 'not_set';

export interface MaintenanceItemStatus {
  status: MaintenanceStatus;
  days_until?: number;
  miles_until?: number;
  hours_until?: number;
  due_date?: string;
  due_mileage?: number;
  due_hours?: number;
}

export interface VehicleMaintenanceWithStatus extends VehicleMaintenance {
  // Asset type flag (set by PlantOverview for plant assets)
  is_plant?: boolean;
  
  vehicle?: {
    id: string;
    reg_number: string | null;
    category_id: string | null;
    status: string;
    nickname?: string | null;
    asset_type?: 'van' | 'vehicle' | 'hgv' | 'plant' | 'tool';
    plant_id?: string | null;
    serial_number?: string | null;
    year?: number | null;
    weight_class?: string | null;
    vehicle_type?: string | null;
  };
  
  // Last inspection info
  last_inspector?: string | null;
  last_inspection_date?: string | null;
  
  // Calculated status for each maintenance type
  tax_status?: MaintenanceItemStatus;
  mot_status?: MaintenanceItemStatus;
  service_status?: MaintenanceItemStatus;
  cambelt_status?: MaintenanceItemStatus;
  first_aid_status?: MaintenanceItemStatus;
  six_weekly_status?: MaintenanceItemStatus;
  fire_extinguisher_status?: MaintenanceItemStatus;
  taco_calibration_status?: MaintenanceItemStatus;
  loler_status?: MaintenanceItemStatus; // For plant machinery
  service_hours_status?: MaintenanceItemStatus; // For plant machinery (hours-based service)
  maintenance_items?: MaintenanceItem[];
  
  // Overall counts
  overdue_count: number;
  due_soon_count: number;
}

export interface MaintenanceItem {
  id: string;
  category_id: string;
  category_name: string;
  category_type: MaintenanceCategory['type'];
  category_field_key: string | null;
  source: MaintenanceCategorySource;
  is_system: boolean;
  is_delete_protected: boolean;
  sort_order: number;
  asset_type: 'van' | 'hgv' | 'plant';
  status: MaintenanceItemStatus;
  due_date: string | null;
  due_mileage: number | null;
  last_mileage: number | null;
  due_hours: number | null;
  last_hours: number | null;
  display_value: string;
  display_unit: 'date' | 'miles' | 'km' | 'hours';
  value_id?: string | null;
}

export interface CustomMaintenanceItemUpdate {
  category_id: string;
  due_date?: string | null;
  due_mileage?: number | null;
  last_mileage?: number | null;
  due_hours?: number | null;
  last_hours?: number | null;
  notes?: string | null;
}

// ============================================================================
// Request/Response types for API
// ============================================================================

export interface UpdateMaintenanceRequest {
  current_mileage?: number | null; // Manual override for current mileage
  tax_due_date?: string | null;
  mot_due_date?: string | null;
  first_aid_kit_expiry?: string | null;
  six_weekly_inspection_due_date?: string | null;
  fire_extinguisher_due_date?: string | null;
  taco_calibration_due_date?: string | null;
  next_service_mileage?: number | null;
  last_service_mileage?: number | null;
  cambelt_due_mileage?: number | null;
  current_hours?: number | null; // For plant machinery
  last_service_hours?: number | null; // For plant machinery
  next_service_hours?: number | null; // For plant machinery
  tracker_id?: string | null;
  notes?: string | null;
  custom_items?: CustomMaintenanceItemUpdate[];
  comment: string; // Mandatory for audit trail (min 10 chars)
}

export interface CreateCategoryRequest {
  name: string;
  description?: string;
  type: 'date' | 'mileage' | 'hours';
  period_value: number;
  period_unit?: MaintenancePeriodUnit;
  alert_threshold_days?: number;
  alert_threshold_miles?: number;
  alert_threshold_hours?: number;
  applies_to?: string[];
  sort_order?: number;
  responsibility?: CategoryResponsibility;
  show_on_overview?: boolean;
  reminder_in_app_enabled?: boolean;
  reminder_email_enabled?: boolean;
}

export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
  period_value?: number;
  period_unit?: MaintenancePeriodUnit;
  alert_threshold_days?: number;
  alert_threshold_miles?: number;
  alert_threshold_hours?: number;
  applies_to?: string[];
  is_active?: boolean;
  sort_order?: number;
  responsibility?: CategoryResponsibility;
  show_on_overview?: boolean;
  reminder_in_app_enabled?: boolean;
  reminder_email_enabled?: boolean;
}

export interface ArchiveVehicleRequest {
  van_id: string;
  reason: 'Sold' | 'Scrapped' | 'Other';
  comment?: string;
}

export interface MaintenanceListResponse {
  success: boolean;
  vehicles: VehicleMaintenanceWithStatus[];
  summary: {
    total: number;
    overdue: number;
    due_soon: number;
  };
}

export interface MaintenanceUpdateResponse {
  success: boolean;
  maintenance: VehicleMaintenance;
  history_entry?: MaintenanceHistory;
}

export interface CategoriesListResponse {
  success: boolean;
  categories: MaintenanceCategory[];
}

export interface WorkshopTaskHistoryItem {
  id: string;
  created_at: string;
  status: string;
  action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action';
  workshop_comments: string | null;
  description: string | null;
  logged_comment: string | null;
  actioned_comment: string | null;
  actioned_at: string | null;
  logged_at: string | null;
  status_history?: unknown[] | null;
  workshop_task_categories?: {
    name: string;
  } | null;
  workshop_task_subcategories?: {
    name: string;
  } | null;
  profiles?: {
    full_name: string;
  } | null;
}

export interface MaintenanceHistoryResponse {
  success: boolean;
  history: MaintenanceHistory[];
  workshopTasks?: WorkshopTaskHistoryItem[];
  vehicle: {
    id: string;
    reg_number: string;
  };
  vesData?: {
    ves_make: string | null;
    ves_colour: string | null;
    ves_fuel_type: string | null;
    ves_year_of_manufacture: number | null;
    ves_engine_capacity: number | null;
    ves_tax_status: string | null;
    ves_mot_status: string | null;
    ves_co2_emissions: number | null;
    ves_euro_status: string | null;
    ves_real_driving_emissions: string | null;
    ves_type_approval: string | null;
    ves_wheelplan: string | null;
    ves_revenue_weight: number | null;
    ves_marked_for_export: boolean | null;
    ves_month_of_first_registration: string | null;
    ves_date_of_last_v5c_issued: string | null;
    tax_due_date: string | null;
    last_dvla_sync: string | null;
    mot_make?: string | null;
    mot_model?: string | null;
    mot_primary_colour?: string | null;
    mot_year_of_manufacture?: number | null;
    mot_fuel_type?: string | null;
    mot_first_used_date?: string | null;
    mot_due_date?: string | null;
  } | null;
}

export interface DeletedVehicle {
  id: string; // Archive record ID
  van_id: string; // Original van ID
  reg_number: string;
  nickname: string | null;
  current_mileage: number | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  archive_reason: 'Sold' | 'Scrapped' | 'Other';
  archived_at: string;
  archived_by: string | null;
  archive_comment: string | null;
}

export interface DeletedVehiclesListResponse {
  success: boolean;
  vehicles: DeletedVehicle[];
  count: number;
}

// ============================================================================
// Utility types
// ============================================================================

export interface DateThreshold {
  overdue_days: number; // Negative if overdue
  status: MaintenanceStatus;
}

export interface MileageThreshold {
  miles_until: number; // Negative if overdue
  status: MaintenanceStatus;
}

export interface HoursThreshold {
  hours_until: number; // Negative if overdue
  status: MaintenanceStatus;
}
