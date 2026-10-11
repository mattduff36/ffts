/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulingEmployeeView } from '@/app/(dashboard)/scheduling/components/SchedulingEmployeeView';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';

const { mockFetchMySchedule, authState, navigation } = vi.hoisted(() => ({
  mockFetchMySchedule: vi.fn(),
  authState: { user: { id: 'employee-1' } as { id: string } | null },
  navigation: {
    search: 'date=2026-07-15',
    replace: vi.fn(),
  },
}));

vi.mock('@/lib/client/scheduling', () => ({
  fetchMySchedule: mockFetchMySchedule,
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduling/my',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

function renderView(expandWeek = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SchedulingEmployeeView />
    </QueryClientProvider>
  );
  if (expandWeek) fireEvent.click(screen.getByText(/^Week overview/));
  return { ...view, queryClient };
}

function visit(id: string, sequence: number, startsAt: string, endsAt: string, notes: string | null = null) {
  return {
    id,
    job_id: 'job-1',
    sequence_number: sequence,
    title: sequence === 2 ? 'North boundary' : null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'planned',
    notes,
    created_by: 'manager-1',
    updated_by: 'manager-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

function employeeAssignment(
  id: string,
  workDate: string,
  visitId: string | null,
  notes: string | null,
  visitValue: ReturnType<typeof visit> | null
) {
  return {
    id,
    job_id: 'job-1',
    work_date: workDate,
    visit_id: visitId,
    profile_id: 'employee-1',
    resource_type: 'employee',
    employee: null,
    notes,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: 'manager-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    conflicts: [],
    visit: visitValue,
  };
}

function plantAssignment(id: string, visitId: string | null, nickname: string) {
  return {
    id,
    job_id: 'job-1',
    work_date: '2026-07-15',
    visit_id: visitId,
    plant_id: id,
    resource_type: 'plant',
    plant: {
      id,
      plant_id: id,
      nickname,
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
    visit: null,
  };
}

const northVisit = visit('visit-1', 2, '2026-07-15T08:00:00Z', '2026-07-15T12:00:00Z', 'Gate code 1234');

function schedulePayload() {
  return {
    week: { start: '2026-07-13', end: '2026-07-19' },
    jobs: [{
      id: 'job-1',
      job_reference: 'JOB-101',
      title: 'Crown reduction',
      description: 'Reduce the crown by two metres.',
      site_address: 'Riverside Estate',
      status: 'scheduled',
      source_type: 'manual',
      customer_name: 'Riverside Homes',
      start_date: '2026-07-15',
      end_date: '2026-07-15',
    }],
    visits: [
      northVisit,
      visit('visit-other', 9, '2026-07-16T08:00:00Z', '2026-07-16T09:00:00Z'),
    ],
    assignments: [
      employeeAssignment('assignment-1', '2026-07-15', 'visit-1', 'Bring the chipper', northVisit),
    ],
    plant_assignments: [
      plantAssignment('plant-1', 'visit-1', 'Loader'),
      plantAssignment('plant-2', 'visit-other', 'Wrong machine'),
    ],
  };
}

describe('SchedulingEmployeeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'employee-1' };
    navigation.search = 'date=2026-07-15';
    mockFetchMySchedule.mockResolvedValue(schedulePayload());
  });

  it('renders the selected day job, notes, site, directions, and matching plant', async () => {
    const { queryClient } = renderView();

    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();
    expect(screen.getByText('Riverside Homes')).toBeInTheDocument();
    expect(screen.getByText('Riverside Estate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Riverside%20Estate'
    );
    expect(screen.getByText(/Reduce the crown by two metres/)).toBeInTheDocument();
    expect(screen.getByText(/Gate code 1234/)).toBeInTheDocument();
    expect(screen.getByText(/Bring the chipper/)).toBeInTheDocument();
    expect(screen.getByText('Visit 2 · North boundary')).toBeInTheDocument();
    expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
    expect(screen.getByText(/Loader/)).toBeInTheDocument();
    expect(screen.queryByText('Wrong machine')).not.toBeInTheDocument();
    expect(screen.getByText(/09:00–13:00/)).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('1 assignment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(mockFetchMySchedule).toHaveBeenCalledWith('2026-07-13');
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual([
      'my-schedule',
      'employee-1',
      '2026-07-13',
    ]);
  });

  it('keeps the selected date from the URL and moves by day and week', async () => {
    renderView();
    expect(await screen.findByLabelText('Schedule date')).toHaveValue('2026-07-15');

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByLabelText('Schedule date')).toHaveValue('2026-07-16');
    expect(navigation.replace).toHaveBeenCalledWith(
      '/scheduling/my?date=2026-07-16',
      { scroll: false }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByLabelText('Schedule date')).toHaveValue('2026-07-15');

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByLabelText('Schedule date')).toHaveValue('2026-07-22');
    expect(mockFetchMySchedule).toHaveBeenCalledWith('2026-07-20');
  });

  it('falls back to the London today when the URL date is invalid', async () => {
    navigation.search = 'date=not-a-date';
    mockFetchMySchedule.mockResolvedValue({
      ...schedulePayload(),
      week: { start: '1999-01-04', end: '1999-01-10' },
    });
    renderView();

    expect(await screen.findByLabelText('Schedule date')).toHaveValue(getScheduleVisitDate(new Date()));
    expect(screen.queryByText('JOB-101')).not.toBeInTheDocument();
  });

  it('sorts timed jobs and labels untimed work separately', async () => {
    const early = visit('visit-early', 1, '2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z');
    const late = visit('visit-late', 3, '2026-07-15T13:00:00Z', '2026-07-15T14:00:00Z');
    mockFetchMySchedule.mockResolvedValue({
      ...schedulePayload(),
      jobs: [
        { ...schedulePayload().jobs[0], id: 'job-late', job_reference: 'JOB-LATE', title: 'Late job' },
        { ...schedulePayload().jobs[0], id: 'job-early', job_reference: 'JOB-EARLY', title: 'Early job' },
        { ...schedulePayload().jobs[0], id: 'job-open', job_reference: 'JOB-OPEN', title: 'Open job' },
      ],
      assignments: [
        { ...employeeAssignment('late', '2026-07-15', 'visit-late', null, late), job_id: 'job-late' },
        { ...employeeAssignment('open', '2026-07-15', null, null, null), job_id: 'job-open' },
        { ...employeeAssignment('early', '2026-07-15', 'visit-early', null, early), job_id: 'job-early' },
      ],
    });

    renderView();
    const earlyJob = await screen.findByText('JOB-EARLY');
    const lateJob = screen.getByText('JOB-LATE');
    const untimedHeading = screen.getByRole('heading', { name: 'Time to be confirmed' });
    const openJob = screen.getByText('JOB-OPEN');
    expect(earlyJob.compareDocumentPosition(lateJob) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lateJob.compareDocumentPosition(untimedHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(untimedHeading.compareDocumentPosition(openJob) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the next assigned day when the selected day is empty', async () => {
    navigation.search = 'date=2026-07-13';
    renderView();

    expect(await screen.findByText('No work assigned for this day.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next assigned day/ }));
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();
    expect(navigation.replace).toHaveBeenCalledWith(
      '/scheduling/my?date=2026-07-15',
      { scroll: false }
    );
  });

  it('refreshes, retries, and keeps day navigation usable while updating', async () => {
    let resolveLoad: (value: ReturnType<typeof schedulePayload>) => void = () => undefined;
    mockFetchMySchedule.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderView();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    expect(screen.getByText('Loading your schedule...')).toBeInTheDocument();
    resolveLoad(schedulePayload());
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));
    await waitFor(() => expect(mockFetchMySchedule).toHaveBeenCalledTimes(2));

    mockFetchMySchedule.mockRejectedValueOnce(new Error('Network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
    mockFetchMySchedule.mockResolvedValueOnce(schedulePayload());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();

    let resolveWeek: (value: ReturnType<typeof schedulePayload>) => void = () => undefined;
    mockFetchMySchedule.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveWeek = resolve;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByText('Updating schedule…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeEnabled();
    expect(screen.queryByText('No work assigned for this day.')).not.toBeInTheDocument();
    resolveWeek({
      ...schedulePayload(),
      week: { start: '2026-07-20', end: '2026-07-26' },
      assignments: [],
    });
    expect(await screen.findByText('No work assigned for this day.')).toBeInTheDocument();
  });

  it('does not load a schedule until the signed-in user id is available', async () => {
    authState.user = null;
    const view = renderView();
    expect(mockFetchMySchedule).not.toHaveBeenCalled();

    authState.user = { id: 'employee-1' };
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <SchedulingEmployeeView />
      </QueryClientProvider>
    );
    await waitFor(() => expect(mockFetchMySchedule).toHaveBeenCalledWith('2026-07-13'));
    expect(view.queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual([
      'my-schedule',
      'employee-1',
      '2026-07-13',
    ]);
  });

  it('keeps the week overview collapsed initially for the mobile daily view', async () => {
    renderView(false);
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();
    expect(screen.getByText(/^Week overview/).closest('details')).not.toHaveAttribute('open');
  });

  it('never shows the previous user schedule while the next user is loading', async () => {
    const view = renderView();
    expect(await screen.findByText('JOB-101')).toBeInTheDocument();
    mockFetchMySchedule.mockImplementationOnce(() => new Promise(() => {}));
    authState.user = { id: 'employee-2' };
    view.rerender(<QueryClientProvider client={view.queryClient}><SchedulingEmployeeView /></QueryClientProvider>);
    expect(screen.queryByText('JOB-101')).not.toBeInTheDocument();
    expect(screen.getByText('Loading your schedule...')).toBeInTheDocument();
  });

  it('shows existing customer contact and exact-visit crew without invented details', async () => {
    mockFetchMySchedule.mockResolvedValue({
      ...schedulePayload(),
      job_details: [{ job_id: 'job-1', site_name: 'North entrance', site_notes: 'Use the side gate.', customer_contact: { name: 'Site coordinator', phone: '01234 567890', email: 'coordinator@example.test', job_title: null } }],
      crew_assignments: [
        { job_id: 'job-1', work_date: '2026-07-15', visit_id: 'visit-1', profile_id: 'crew', full_name: 'Assigned colleague' },
        { job_id: 'job-1', work_date: '2026-07-15', visit_id: 'wrong', profile_id: 'other', full_name: 'Other visit colleague' },
      ],
    });
    renderView();
    expect(await screen.findByText('Customer contact')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '01234 567890' })).toHaveAttribute('href', 'tel:01234567890');
    expect(screen.getByText(/Use the side gate/)).toBeInTheDocument();
    expect(screen.getByText('Assigned colleague')).toBeInTheDocument();
    expect(screen.queryByText('Other visit colleague')).not.toBeInTheDocument();
  });
});
