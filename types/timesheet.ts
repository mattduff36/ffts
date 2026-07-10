export interface TimesheetEntryJobCode {
  id?: string;
  timesheet_entry_id?: string;
  job_number: string;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface TimesheetEntry {
  id?: string;
  timesheet_id: string;
  day_of_week: number; // 1-7 (Monday-Sunday)
  time_started: string | null;
  time_finished: string | null;
  operator_travel_hours?: number | null;
  operator_yard_hours?: number | null;
  operator_working_hours?: number | null;
  machine_travel_hours?: number | null;
  machine_start_time?: string | null;
  machine_finish_time?: string | null;
  machine_working_hours?: number | null;
  machine_standing_hours?: number | null;
  machine_operator_hours?: number | null;
  maintenance_breakdown_hours?: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: TimesheetEntryJobCode[];
  working_in_yard: boolean;
  subsistence_payment_required?: boolean;
  did_not_work: boolean;
  night_shift?: boolean;
  bank_holiday?: boolean;
  daily_total: number | null; // Hours (e.g., 8.5)
  remarks: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Timesheet {
  id: string;
  user_id: string;
  timesheet_type?: string | null;
  template_version?: number | null;
  reg_number: string | null;
  site_address?: string | null;
  hirer_name?: string | null;
  is_hired_plant?: boolean | null;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
  week_ending: string; // Date string (Sunday of the week)
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted';
  signature_data: string | null;
  signed_at: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  adjusted_by: string | null;
  adjusted_at: string | null;
  adjustment_recipients: string[] | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  entries?: TimesheetEntry[];
}

export interface TimesheetFormData {
  reg_number: string;
  week_ending: Date;
  entries: {
    [key: number]: { // day_of_week as key
      time_started: string;
      time_finished: string;
      working_in_yard: boolean;
      remarks: string;
    };
  };
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

