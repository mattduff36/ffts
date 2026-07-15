export type ScheduleJobStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type ScheduleJobSource = 'sample' | 'manual' | 'quote';
export type ScheduleResourceType = 'employee' | 'plant';

export type SchedulingConflictCode =
  | 'employee_double_booked'
  | 'employee_absent'
  | 'employee_off_shift'
  | 'plant_double_booked'
  | 'plant_unavailable'
  | 'plant_inactive';

export interface SchedulingConflict {
  code: SchedulingConflictCode;
  message: string;
  severity: 'warning' | 'error';
  conflictingJobId?: string;
  conflictingJobReference?: string;
}

export interface ScheduleJob {
  id: string;
  job_reference: string;
  title: string;
  description: string | null;
  site_address: string | null;
  status: ScheduleJobStatus;
  source_type: ScheduleJobSource;
  start_date: string;
  end_date: string;
  quote_id: string | null;
  quote_project_number_id: string | null;
  customer_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleEmployeeResource {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
}

export interface SchedulePlantResource {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  status: 'active' | 'inactive' | 'maintenance' | 'retired' | null;
}

export interface ScheduleAssignmentBase {
  id: string;
  job_id: string;
  work_date: string;
  notes: string | null;
  conflict_override: boolean;
  conflict_codes: SchedulingConflictCode[];
  conflict_override_by: string | null;
  conflict_override_at: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  conflicts: SchedulingConflict[];
}

export interface ScheduleEmployeeAssignment extends ScheduleAssignmentBase {
  resource_type: 'employee';
  profile_id: string;
  employee: ScheduleEmployeeResource | null;
}

export interface SchedulePlantAssignment extends ScheduleAssignmentBase {
  resource_type: 'plant';
  plant_id: string;
  plant: SchedulePlantResource | null;
}

export type ScheduleAssignment = ScheduleEmployeeAssignment | SchedulePlantAssignment;

export interface SchedulePlantUnavailability {
  id: string;
  plant_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  plant?: SchedulePlantResource | null;
}

export interface SchedulingContext {
  user_id: string;
  is_manager_or_admin: boolean;
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  team_id: string | null;
  team_name: string | null;
}

export interface SchedulingBoardPayload {
  week: {
    start: string;
    end: string;
  };
  jobs: ScheduleJob[];
  assignments: ScheduleAssignment[];
  resources: {
    employees: ScheduleEmployeeResource[];
    plant: SchedulePlantResource[];
  };
  plant_unavailability: SchedulePlantUnavailability[];
}

export interface SchedulingSelfPayload {
  week: {
    start: string;
    end: string;
  };
  assignments: ScheduleEmployeeAssignment[];
  jobs: ScheduleJob[];
  plant_assignments: SchedulePlantAssignment[];
}
