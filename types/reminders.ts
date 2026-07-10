export type ReminderActionSourceType = 'system_generated' | 'manager_created';
export type ReminderActionStatus = 'open' | 'resolved' | 'cancelled';
export type ReminderPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ReminderAssetType = 'van' | 'plant' | 'hgv';
export type ReminderStatus = 'pending' | 'actioned' | 'cancelled';

export const FLEET_INSPECTION_DEFAULT_THRESHOLD_DAYS = 28;

export interface ReminderAction {
  id: string;
  workflow_key: string;
  source_type: ReminderActionSourceType;
  dedupe_key: string;
  status: ReminderActionStatus;
  priority: ReminderPriority;
  title: string;
  description: string | null;
  asset_type: ReminderAssetType | null;
  van_id: string | null;
  plant_id: string | null;
  hgv_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  resolved_by: string | null;
  ignored_until: string | null;
  ignored_forever: boolean;
  ignored_at: string | null;
  ignored_by: string | null;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  action_id: string;
  assigned_to: string;
  assigned_by: string | null;
  status: ReminderStatus;
  action_note: string | null;
  actioned_at: string | null;
  actioned_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderActionCounts {
  total: number;
  pending: number;
  actioned: number;
  cancelled: number;
}

export interface ReminderActionWithAsset extends ReminderAction {
  asset_label: string | null;
  asset_route: string | null;
  reminders_count: ReminderActionCounts;
}

export interface ReminderWithAction extends Reminder {
  action: ReminderActionWithAsset;
  assigned_by_name?: string | null;
  task_href?: string | null;
  task_label?: string | null;
  task_name?: string;
}

export interface AssignRemindersRequest {
  action_id: string;
  assignee_ids: string[];
}

export type ReminderActionIgnoreDuration = '6_weeks' | '1_year' | 'forever';

export interface IgnoreReminderActionRequest {
  duration: ReminderActionIgnoreDuration;
}

export interface FleetInspectionAssetTypeSettings {
  van: boolean;
  plant: boolean;
  hgv: boolean;
}

export interface FleetInspectionWorkflowConfig {
  overdue_days_threshold: number;
  asset_types: FleetInspectionAssetTypeSettings;
}

export interface ReminderWorkflowSettings {
  workflow_key: string;
  is_enabled: boolean;
  config: FleetInspectionWorkflowConfig | Record<string, unknown>;
  updated_by: string | null;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}
