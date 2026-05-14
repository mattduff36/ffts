import { Timesheet, TimesheetEntry } from '@/types/timesheet';

export const createMockTimesheet = (overrides?: Partial<Timesheet>): Timesheet => ({
  id: 'test-timesheet-id',
  user_id: 'test-user-id',
  reg_number: 'AB12 CDE',
  week_ending: '2024-12-01',
  status: 'draft',
  signature_data: null,
  signed_at: null,
  submitted_at: null,
  reviewed_by: null,
  reviewed_at: null,
  manager_comments: null,
  adjusted_by: null,
  adjusted_at: null,
  adjustment_recipients: null,
  processed_at: null,
  created_at: '2024-11-25T10:00:00Z',
  updated_at: '2024-11-25T10:00:00Z',
  ...overrides,
});

export const createMockTimesheetEntry = (overrides?: Partial<TimesheetEntry>): TimesheetEntry => ({
  id: 'test-entry-id',
  timesheet_id: 'test-timesheet-id',
  day_of_week: 1,
  time_started: '08:00',
  time_finished: '17:00',
  job_number: 'JOB123',
  working_in_yard: false,
  did_not_work: false,
  daily_total: 8.0,
  remarks: null,
  created_at: '2024-11-25T10:00:00Z',
  updated_at: '2024-11-25T10:00:00Z',
  ...overrides,
});

export const createMockProfile = (overrides?: Record<string, unknown>) => ({
  id: 'test-profile-id',
  full_name: 'Test User',
  email: 'test@example.com',
  employee_id: 'EMP001',
  roles: {
    id: 'role-id',
    name: 'employee',
    display_name: 'Employee',
    is_manager_admin: false,
  },
  ...overrides,
});

export const createMockManager = () =>
  createMockProfile({
    id: 'manager-id',
    full_name: 'Test Manager',
    email: 'manager@example.com',
    roles: {
      id: 'manager-role-id',
      name: 'manager',
      display_name: 'Manager',
      is_manager_admin: true,
    },
  });

export const createMockAdmin = () =>
  createMockProfile({
    id: 'admin-id',
    full_name: 'Test Admin',
    email: 'admin@example.com',
    roles: {
      id: 'admin-role-id',
      name: 'admin',
      display_name: 'Administrator',
      is_manager_admin: true,
    },
  });

export const createPriorityManager = () =>
  createMockProfile({
    id: 'suzanne-id',
    full_name: 'Priority Manager',
    email: 'priority.manager@example.com',
    roles: {
      id: 'manager-role-id',
      name: 'manager',
      display_name: 'Manager',
      is_manager_admin: true,
    },
  });

// API response format factories (transformed from database schema)
// These match the shape returned by /api/timesheets/managers
export const createManagerApiResponse = (overrides?: Record<string, unknown>) => ({
  id: 'manager-id',
  full_name: 'Test Manager',
  email: 'manager@example.com',
  role: {
    name: 'manager',
    display_name: 'Manager',
  },
  ...overrides,
});

export const createPriorityManagerApiResponse = () => ({
  id: 'suzanne-id',
  full_name: 'Priority Manager',
  email: 'priority.manager@example.com',
  role: {
    name: 'manager',
    display_name: 'Manager',
  },
});

