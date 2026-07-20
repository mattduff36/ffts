/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SchedulingEmployeeView } from '@/app/(dashboard)/scheduling/components/SchedulingEmployeeView';

const { mockFetchMySchedule } = vi.hoisted(() => ({
  mockFetchMySchedule: vi.fn(),
}));

vi.mock('@/lib/client/scheduling', () => ({
  fetchMySchedule: mockFetchMySchedule,
}));

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SchedulingEmployeeView />
    </QueryClientProvider>
  );
}

describe('SchedulingEmployeeView', () => {
  it('renders the employee job, site, and co-assigned plant', async () => {
    mockFetchMySchedule.mockResolvedValue({
      week: { start: '2026-07-13', end: '2026-07-19' },
      jobs: [{
        id: 'job-1',
        job_reference: 'JOB-101',
        title: 'Crown reduction',
        description: null,
        site_address: 'Riverside Estate',
        status: 'scheduled',
        source_type: 'manual',
        start_date: '2026-07-15',
        end_date: '2026-07-15',
        estimated_duration_minutes: 240,
        quote_id: null,
        quote_project_number_id: null,
        customer_id: null,
        created_by: null,
        updated_by: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }],
      visits: [{
        id: 'visit-1',
        job_id: 'job-1',
        sequence_number: 1,
        title: null,
        starts_at: '2026-07-15T08:00:00Z',
        ends_at: '2026-07-15T12:00:00Z',
        status: 'planned',
        notes: null,
        created_by: 'manager-1',
        updated_by: 'manager-1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }],
      assignments: [{
        id: 'assignment-1',
        job_id: 'job-1',
        work_date: '2026-07-15',
        visit_id: 'visit-1',
        profile_id: 'employee-1',
        resource_type: 'employee',
        employee: null,
        notes: null,
        conflict_override: false,
        conflict_codes: [],
        conflict_override_by: null,
        conflict_override_at: null,
        assigned_by: 'manager-1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        conflicts: [],
        visit: {
          id: 'visit-1',
          job_id: 'job-1',
          sequence_number: 1,
          title: null,
          starts_at: '2026-07-15T08:00:00Z',
          ends_at: '2026-07-15T12:00:00Z',
          status: 'planned',
          notes: null,
          created_by: 'manager-1',
          updated_by: 'manager-1',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
        },
      }],
      plant_assignments: [{
        id: 'plant-assignment-1',
        job_id: 'job-1',
        work_date: '2026-07-15',
        visit_id: 'visit-1',
        plant_id: 'plant-1',
        resource_type: 'plant',
        plant: {
          id: 'plant-1',
          plant_id: 'P001',
          nickname: 'Loader',
          make: null,
          model: null,
          status: 'active',
        },
        notes: null,
        conflict_override: false,
        conflict_codes: [],
        conflict_override_by: null,
        conflict_override_at: null,
        assigned_by: 'manager-1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        conflicts: [],
        visit: {
          id: 'visit-1',
          job_id: 'job-1',
          sequence_number: 1,
          title: null,
          starts_at: '2026-07-15T08:00:00Z',
          ends_at: '2026-07-15T12:00:00Z',
          status: 'planned',
          notes: null,
          created_by: 'manager-1',
          updated_by: 'manager-1',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
        },
      }],
    });

    renderView();

    expect(await screen.findByText('JOB-101')).toBeInTheDocument();
    expect(screen.getByText('Riverside Estate')).toBeInTheDocument();
    expect(screen.getByText('Loader')).toBeInTheDocument();
    expect(screen.getByText(/09:00–13:00/)).toBeInTheDocument();
    expect(screen.getByText('1 assignment')).toBeInTheDocument();
  });
});
