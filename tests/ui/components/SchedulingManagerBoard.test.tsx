/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulingManagerBoard } from '@/app/(dashboard)/scheduling/components/SchedulingManagerBoard';
import {
  getSchedulingViewStorageKey,
  SCHEDULING_BOARD_VIEWS,
} from '@/lib/config/scheduling-view-preference';
import { SchedulingApiError } from '@/lib/client/scheduling';
import {
  formatScheduleDate,
  getSchedulingWeek,
} from '@/lib/utils/scheduling';
import type { SchedulingBoardPayload } from '@/types/scheduling';

interface DragEndEvent {
  canceled?: boolean;
  operation: {
    source: { data?: Record<string, unknown> } | null;
    target: { data?: Record<string, unknown> } | null;
  };
}

interface DraggableOptions {
  id: string;
  disabled?: boolean;
}

const {
  dndState,
  mockCreateAssignment,
  mockCreateProjectJob,
  mockDeleteJob,
  mockFetchBoard,
  mockFetchProjectCandidates,
  mockFetchQuoteCandidates,
  mockMoveAssignment,
  mockSaveQuoteSchedule,
  mockSaveVisit,
  mockToastInfo,
} = vi.hoisted(() => ({
  dndState: {
    onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
    draggableOptions: [] as DraggableOptions[],
    sensors: [] as unknown[],
  },
  mockCreateAssignment: vi.fn(),
  mockCreateProjectJob: vi.fn(),
  mockDeleteJob: vi.fn(),
  mockFetchBoard: vi.fn(),
  mockFetchProjectCandidates: vi.fn(),
  mockFetchQuoteCandidates: vi.fn(),
  mockMoveAssignment: vi.fn(),
  mockSaveQuoteSchedule: vi.fn(),
  mockSaveVisit: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock('@dnd-kit/dom', () => ({
  Accessibility: {
    configure: vi.fn(() => ({})),
  },
  KeyboardSensor: {},
  PointerActivationConstraints: {
    Delay: class MockDelayConstraint {},
    Distance: class MockDistanceConstraint {},
  },
  PointerSensor: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
    sensors,
  }: {
    children: ReactNode;
    onDragEnd?: (event: DragEndEvent) => void;
    sensors?: unknown[];
  }) => {
    dndState.onDragEnd = onDragEnd;
    dndState.sensors = sensors || [];
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  useDraggable: (options: DraggableOptions) => {
    dndState.draggableOptions.push(options);
    return { ref: vi.fn(), handleRef: vi.fn(), isDragging: false };
  },
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: mockToastInfo,
    success: vi.fn(),
  },
}));

vi.mock('@/lib/client/scheduling', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/scheduling')>(
    '@/lib/client/scheduling'
  );
  return {
    ...actual,
    createProjectScheduleJob: mockCreateProjectJob,
    createScheduleAssignment: mockCreateAssignment,
    deletePlantUnavailability: vi.fn(),
    deleteScheduleAssignment: vi.fn(),
    deleteScheduleJob: mockDeleteJob,
    fetchScheduleProjectCandidates: mockFetchProjectCandidates,
    fetchSchedulingBoard: mockFetchBoard,
    fetchScheduleQuoteCandidates: mockFetchQuoteCandidates,
    moveScheduleAssignment: mockMoveAssignment,
    deleteScheduleVisit: vi.fn(),
    savePlantUnavailability: vi.fn(),
    saveScheduleJob: vi.fn(),
    saveQuoteSchedule: mockSaveQuoteSchedule,
    saveScheduleVisit: mockSaveVisit,
  };
});

const board: SchedulingBoardPayload = {
  week: { start: '2026-07-13', end: '2026-07-19' },
  jobs: [{
    id: 'job-1',
    job_reference: 'JOB-101',
    title: 'Crown reduction',
    description: null,
    site_address: 'Riverside Estate',
    status: 'scheduled',
    source_type: 'manual',
    start_date: '2026-07-13',
    end_date: '2026-07-15',
    estimated_duration_minutes: 240,
    quote_id: null,
    quote_project_number_id: 'project-1',
    customer_id: null,
    customer_site_id: null,
    is_drop_on_ready: false,
    tags: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  }],
  tags: [],
  visits: [{
    id: 'visit-1',
    job_id: 'job-1',
    sequence_number: 1,
    title: 'Morning visit',
    starts_at: '2026-07-14T08:00:00Z',
    ends_at: '2026-07-14T12:00:00Z',
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
    work_date: '2026-07-14',
    visit_id: 'visit-1',
    profile_id: 'employee-1',
    resource_type: 'employee',
    employee: {
      id: 'employee-1',
      full_name: 'Alex Smith',
      employee_id: 'E001',
      team_id: 'team-1',
      team_name: 'Arborists',
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
      title: 'Morning visit',
      starts_at: '2026-07-14T08:00:00Z',
      ends_at: '2026-07-14T12:00:00Z',
      status: 'planned',
      notes: null,
      created_by: 'manager-1',
      updated_by: 'manager-1',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
  }],
  resources: {
    employees: [{
      id: 'employee-1',
      full_name: 'Alex Smith',
      employee_id: 'E001',
      team_id: 'team-1',
      team_name: 'Arborists',
    }, {
      id: 'employee-2',
      full_name: 'Bob Jones',
      employee_id: 'E002',
      team_id: 'team-1',
      team_name: 'Arborists',
    }],
    plant: [],
  },
  employee_capacity: [{
    date: '2026-07-14',
    available_employee_count: 2,
    total_available_minutes: 660,
    employees: [{
      profile_id: 'employee-1',
      full_name: 'Alex Smith',
      available_minutes: 210,
    }, {
      profile_id: 'employee-2',
      full_name: 'Bob Jones',
      available_minutes: 450,
    }],
  }],
  plant_unavailability: [],
};

function mockWideViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(min-width: 1280px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderBoard(searchParams = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <QueryClientProvider client={queryClient}>
        <SchedulingManagerBoard userId="manager-1" />
      </QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

describe('SchedulingManagerBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndState.onDragEnd = undefined;
    dndState.draggableOptions.length = 0;
    dndState.sensors.length = 0;
    localStorage.clear();
    mockWideViewport(false);
    mockFetchBoard.mockResolvedValue(board);
    mockCreateAssignment.mockResolvedValue(undefined);
    mockCreateProjectJob.mockResolvedValue(undefined);
    mockDeleteJob.mockResolvedValue(undefined);
    mockFetchProjectCandidates.mockResolvedValue([]);
    mockMoveAssignment.mockResolvedValue(undefined);
    mockFetchQuoteCandidates.mockResolvedValue([{
      id: '33333333-3333-4333-8333-333333333333',
      quote_reference: 'Q-100',
      base_quote_reference: 'Q-100',
      title: 'Oak reduction',
      customer_name: 'Example Customer',
      status: 'sent',
      start_date: null,
      end_date: null,
      estimated_duration_days: null,
    }]);
    mockSaveQuoteSchedule.mockResolvedValue({});
    mockSaveVisit.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [{
              profile_id: 'manager-1',
              initials: 'MD',
              is_active: true,
              profile: { full_name: 'Manager One' },
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          customers: [{
            id: 'customer-1',
            company_name: 'Example Customer',
            status: 'active',
            sites: [],
          }],
          tags: [],
        }),
      };
    }));
  });

  it('uses the weekly board when no saved preference exists', async () => {
    renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'true');
    expect(localStorage.getItem(getSchedulingViewStorageKey('manager-1'))).toBeNull();
  });

  it('replaces free-form manual creation with inline Project Number fields', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Project job' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add Project job' });

    expect(within(dialog).getByLabelText('Project source')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Manager *')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Project title *')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Project description')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Project notes')).toBeInTheDocument();
    expect(screen.queryByText('Add manual job')).not.toBeInTheDocument();
  });

  it('removes a Project schedule only after destructive confirmation', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove JOB-101' })[0]);
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Remove Project job from the schedule?',
    });
    expect(confirmation).toHaveTextContent('The Project Number and its costs remain open');

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove job' }));
    await waitFor(() => expect(mockDeleteJob).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(mockFetchQuoteCandidates.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(mockFetchBoard.mock.calls.length).toBeGreaterThan(1));
  });

  it('explains that removing a Quote job preserves and requeues its Quote', async () => {
    mockFetchBoard.mockResolvedValue({
      ...board,
      jobs: [{
        ...board.jobs[0],
        source_type: 'quote',
        quote_id: '33333333-3333-4333-8333-333333333333',
        quote_project_number_id: null,
      }],
    });
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove JOB-101' })[0]);
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Remove Quote job from the schedule?',
    });

    expect(confirmation).toHaveTextContent('The Quote is not deleted');
    expect(confirmation).toHaveTextContent('return to the Jobs queue');
  });

  it('groups only unscheduled Quotes into the three Jobs queue stages', async () => {
    mockFetchQuoteCandidates.mockResolvedValue([
      {
        id: 'quote-draft',
        quote_reference: 'Q-DRAFT',
        base_quote_reference: 'Q-DRAFT',
        title: 'Draft work',
        customer_name: 'Draft Customer',
        status: 'changes_requested',
        start_date: null,
        end_date: null,
        estimated_duration_days: 2,
      },
      {
        id: 'quote-pending',
        quote_reference: 'Q-PENDING',
        base_quote_reference: 'Q-PENDING',
        title: 'Pending work',
        customer_name: 'Pending Customer',
        status: 'sent',
        start_date: null,
        end_date: null,
        estimated_duration_days: 1,
      },
      {
        id: 'quote-accepted',
        quote_reference: 'Q-ACCEPTED',
        base_quote_reference: 'Q-ACCEPTED',
        title: 'Accepted work',
        customer_name: 'Accepted Customer',
        status: 'po_received',
        start_date: null,
        end_date: null,
        estimated_duration_days: 4,
      },
      {
        id: 'quote-scheduled',
        quote_reference: 'Q-SCHEDULED',
        base_quote_reference: 'Q-SCHEDULED',
        title: 'Already scheduled',
        customer_name: 'Scheduled Customer',
        status: 'draft',
        start_date: '2026-07-13',
        end_date: '2026-07-13',
        estimated_duration_days: 1,
      },
    ]);

    renderBoard();

    expect(await screen.findByRole('button', { name: 'Drag Q-DRAFT to a calendar date' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Q-SCHEDULED')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Draft (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pending (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Accepted (1)' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Accepted (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole('button', { name: 'Drag Q-ACCEPTED to a calendar date' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Q-DRAFT')).not.toBeInTheDocument();
  });

  it('schedules a dragged queue job from the dropped date and estimated duration', async () => {
    const quote = {
      id: 'quote-draft',
      quote_reference: 'Q-DRAFT',
      base_quote_reference: 'Q-DRAFT',
      title: 'Draft work',
      customer_name: 'Draft Customer',
      status: 'draft',
      start_date: null,
      end_date: null,
      estimated_duration_days: 3,
    };
    mockFetchQuoteCandidates.mockResolvedValue([quote]);
    renderBoard();
    expect(await screen.findByRole('button', { name: 'Drag Q-DRAFT to a calendar date' }))
      .toBeInTheDocument();

    act(() => {
      dndState.onDragEnd?.({
        canceled: false,
        operation: {
          source: { data: { quote } },
          target: { data: { workDate: '2026-07-14' } },
        },
      });
    });

    await waitFor(() =>
      expect(mockSaveQuoteSchedule).toHaveBeenCalledWith({
        quote_id: 'quote-draft',
        start_date: '2026-07-14',
        end_date: '2026-07-16',
      })
    );
  });

  it('supports selecting a queue job and placing it with a date button', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pending (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText('Q-100'));
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Schedule Q-100 from 2026-07-14',
      })[0]
    );

    await waitFor(() =>
      expect(mockSaveQuoteSchedule).toHaveBeenCalledWith({
        quote_id: '33333333-3333-4333-8333-333333333333',
        start_date: '2026-07-14',
        end_date: '2026-07-14',
      })
    );
  });

  it('provides keyboard-operable dedicated drag handles', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Employees' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(dndState.sensors).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Drag Bob Jones to a visit' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Move Alex Smith to another visit' })[0]
    ).toBeInTheDocument();
  });

  it('switches to daily and persists the user-scoped preference', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Daily' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('Daily job board')).toBeInTheDocument();
    expect(localStorage.getItem(getSchedulingViewStorageKey('manager-1'))).toBe(
      SCHEDULING_BOARD_VIEWS.daily
    );
  });

  it('opens a clicked weekly date in daily view and persists the preference', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Open daily schedule for Tuesday 14 July',
      })[0]
    );

    expect(await screen.findByText('Daily job board')).toBeInTheDocument();
    expect(await screen.findByTestId('schedule-cell-job-1-2026-07-14')).toBeInTheDocument();
    expect(localStorage.getItem(getSchedulingViewStorageKey('manager-1'))).toBe(
      SCHEDULING_BOARD_VIEWS.daily
    );
  });

  it('shows weekly available people and hours with an employee breakdown', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', {
        name: '2 people with 11h available on Tuesday 14 July',
      })[0]
    );

    expect(screen.getByText('2 people · 11h available')).toBeInTheDocument();
    expect(screen.getAllByText('Alex Smith').length).toBeGreaterThan(0);
    expect(screen.getByText('3h 30m')).toBeInTheDocument();
    expect(screen.getByText('7h 30m')).toBeInTheDocument();
  });

  it('schedules an open Quote directly from the board', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Schedule Quote' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule a Quote' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Q-100/ }));
    fireEvent.change(within(dialog).getByLabelText('Start date'), {
      target: { value: '2026-07-27' },
    });
    fireEvent.change(within(dialog).getByLabelText('End date'), {
      target: { value: '2026-07-29' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule Quote' }));

    await waitFor(() =>
      expect(mockSaveQuoteSchedule).toHaveBeenCalledWith({
        quote_id: '33333333-3333-4333-8333-333333333333',
        start_date: '2026-07-27',
        end_date: '2026-07-29',
      })
    );
  });

  it('reschedules an existing Quote job from the board', async () => {
    mockFetchBoard.mockResolvedValue({
      ...board,
      jobs: [{
        ...board.jobs[0],
        source_type: 'quote',
        quote_id: '33333333-3333-4333-8333-333333333333',
      }],
    });
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Reschedule JOB-101' })[0]
    );
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule Quote job' });
    expect(within(dialog).getByLabelText('Start date')).toHaveValue('2026-07-13');
    expect(within(dialog).getByLabelText('End date')).toHaveValue('2026-07-15');
    fireEvent.change(within(dialog).getByLabelText('End date'), {
      target: { value: '2026-07-16' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update schedule' }));

    await waitFor(() =>
      expect(mockSaveQuoteSchedule).toHaveBeenCalledWith({
        quote_id: '33333333-3333-4333-8333-333333333333',
        start_date: '2026-07-13',
        end_date: '2026-07-16',
      })
    );
  });

  it('restores the saved view for the current user', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    localStorage.setItem(
      getSchedulingViewStorageKey('manager-1'),
      SCHEDULING_BOARD_VIEWS.daily
    );
    mockFetchBoard.mockResolvedValue({
      ...board,
      week: currentWeek,
      jobs: [{
        ...board.jobs[0],
        start_date: currentWeek.start,
        end_date: currentWeek.end,
      }],
      visits: [],
      assignments: [],
    });

    renderBoard();

    expect(await screen.findByText('Daily job board')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId(`schedule-cell-job-1-${today}`)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^schedule-cell-/)).toHaveLength(1);
  });

  it('renders the daily board as a horizontally scrollable time line from 5am to 8pm', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    localStorage.setItem(
      getSchedulingViewStorageKey('manager-1'),
      SCHEDULING_BOARD_VIEWS.daily
    );
    mockFetchBoard.mockResolvedValue({
      ...board,
      week: currentWeek,
      jobs: [{
        ...board.jobs[0],
        start_date: currentWeek.start,
        end_date: currentWeek.end,
      }],
      visits: [{
        ...board.visits[0],
        starts_at: `${today}T10:00:00.000Z`,
        ends_at: `${today}T12:00:00.000Z`,
      }],
      assignments: [],
    });

    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    expect(dailyTimeline).toHaveAttribute(
      'aria-label',
      'Daily schedule timeline'
    );
    expect(dailyTimeline).toHaveClass('scrollbar-hidden');
    expect(screen.getByTestId('schedule-timeline-hour-5')).toHaveTextContent('05:00');
    expect(screen.getByTestId('schedule-timeline-hour-20')).toHaveTextContent('20:00');
    expect(screen.getByTestId(`schedule-cell-job-1-${today}`)).toHaveAttribute(
      'data-timeline-start',
      '05:00'
    );
    expect(screen.getByTestId(`schedule-cell-job-1-${today}`)).toHaveAttribute(
      'data-timeline-end',
      '20:00'
    );
    expect(screen.getByTestId('schedule-timeline-visit-visit-1')).toBeInTheDocument();
    const timelineVisit = within(dailyTimeline).getByTestId('schedule-visit-visit-1');
    expect(timelineVisit).toHaveClass('border-slate-500');
    expect(timelineVisit).toHaveStyle({ backgroundColor: '#334155' });
  });

  it('shows compact employee names on assignment chips without shortening accessible labels', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    const assignmentMoveButtons = screen.getAllByRole('button', {
      name: 'Move Alex Smith to another visit',
    });
    const assignmentChip = assignmentMoveButtons[0].closest('div');
    expect(assignmentChip).toHaveTextContent('Alex S');
    expect(assignmentChip).not.toHaveTextContent('Alex Smith');
  });

  it('resizes daily visits in 30-minute keyboard increments', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    localStorage.setItem(
      getSchedulingViewStorageKey('manager-1'),
      SCHEDULING_BOARD_VIEWS.daily
    );
    mockFetchBoard.mockResolvedValue({
      ...board,
      week: currentWeek,
      jobs: [{
        ...board.jobs[0],
        start_date: currentWeek.start,
        end_date: currentWeek.end,
      }],
      visits: [{
        ...board.visits[0],
        starts_at: `${today}T10:00:00.000Z`,
        ends_at: `${today}T12:00:00.000Z`,
      }],
      assignments: [],
    });
    renderBoard();

    const resizeEnd = await screen.findByRole('button', {
      name: 'Adjust end of visit 1 for JOB-101',
    });
    fireEvent.keyDown(resizeEnd, { key: 'ArrowLeft' });

    await waitFor(() =>
      expect(mockSaveVisit).toHaveBeenCalledWith(
        expect.objectContaining({
          starts_at: `${today}T10:00:00.000Z`,
          ends_at: `${today}T11:30:00.000Z`,
        }),
        'visit-1'
      )
    );
  });

  it('snaps pointer resizing to 30 minutes and enforces the minimum duration', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    localStorage.setItem(
      getSchedulingViewStorageKey('manager-1'),
      SCHEDULING_BOARD_VIEWS.daily
    );
    mockFetchBoard.mockResolvedValue({
      ...board,
      week: currentWeek,
      jobs: [{
        ...board.jobs[0],
        start_date: currentWeek.start,
        end_date: currentWeek.end,
      }],
      visits: [{
        ...board.visits[0],
        starts_at: `${today}T10:00:00.000Z`,
        ends_at: `${today}T12:00:00.000Z`,
      }],
      assignments: [],
    });
    const firstRender = renderBoard();

    const resizeEnd = await screen.findByRole('button', {
      name: 'Adjust end of visit 1 for JOB-101',
    });
    fireEvent.pointerDown(resizeEnd, { pointerId: 7, clientX: 100 });
    fireEvent.pointerMove(resizeEnd, { pointerId: 7, clientX: 140 });
    fireEvent.pointerUp(resizeEnd, { pointerId: 7, clientX: 140 });

    await waitFor(() =>
      expect(mockSaveVisit).toHaveBeenCalledWith(
        expect.objectContaining({
          ends_at: `${today}T12:30:00.000Z`,
        }),
        'visit-1'
      )
    );

    firstRender.unmount();
    mockSaveVisit.mockClear();
    mockFetchBoard.mockResolvedValue({
      ...board,
      week: currentWeek,
      jobs: [{
        ...board.jobs[0],
        start_date: currentWeek.start,
        end_date: currentWeek.end,
      }],
      visits: [{
        ...board.visits[0],
        starts_at: `${today}T10:00:00.000Z`,
        ends_at: `${today}T10:30:00.000Z`,
      }],
      assignments: [],
    });
    const secondRender = renderBoard();
    const resizeStart = await screen.findByRole('button', {
      name: 'Adjust start of visit 1 for JOB-101',
    });
    fireEvent.keyDown(resizeStart, { key: 'ArrowRight' });
    expect(mockSaveVisit).not.toHaveBeenCalled();
    secondRender.unmount();
  });

  it('clears the selected visit when clicking outside visit cards', async () => {
    renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Select visit 1 for JOB-101',
      })[0]
    );

    expect(screen.getByRole('button', { name: 'Clear selected visit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Available (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Weekly job board'));

    expect(screen.queryByRole('button', { name: 'Clear selected visit' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Available (2)' })).toBeInTheDocument();
  });

  it('selects a visit, removes overlapping resources, and assigns with one tap', async () => {
    const { container } = renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Employees' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole('tab', { name: 'Available (2)' })).toHaveClass(
      'whitespace-nowrap',
      'text-[10px]'
    );
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Select visit 1 for JOB-101',
      })[0]
    );

    expect(screen.queryByTestId('schedule-resource-employee-employee-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('schedule-resource-employee-employee-2')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Assign(?: selected)?$/ })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Bob Jones' }));

    await waitFor(() =>
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        job_id: 'job-1',
        visit_id: 'visit-1',
        resource_type: 'employee',
        resource_id: 'employee-2',
      })
    );
    expect(screen.queryByRole('button', { name: 'Clear selected visit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Assign resource' })).not.toBeInTheDocument();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('assigns directly after a valid drag', async () => {
    mockWideViewport(true);
    renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Employees' }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(dndState.draggableOptions.some((options) => options.id.includes('employee-2'))).toBe(true)
    );

    act(() => {
      dndState.onDragEnd?.({
        canceled: false,
        operation: {
          source: {
            data: {
              resource: { type: 'employee', id: 'employee-2', label: 'Bob Jones' },
            },
          },
          target: { data: { jobId: 'job-1', visitId: 'visit-1', workDate: '2026-07-14' } },
        },
      });
    });

    await waitFor(() =>
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        job_id: 'job-1',
        visit_id: 'visit-1',
        resource_type: 'employee',
        resource_id: 'employee-2',
      })
    );
    expect(screen.queryByRole('dialog', { name: 'Assign resource' })).not.toBeInTheDocument();
  });

  it('rolls back optimistic availability and opens override review on conflict', async () => {
    mockCreateAssignment.mockRejectedValueOnce(
      new SchedulingApiError(
        'This assignment has scheduling conflicts.',
        409,
        {
          conflicts_by_date: {
            '2026-07-14': [{
              code: 'employee_absent',
              severity: 'warning',
              message: 'Employee has an approved absence.',
            }],
          },
        }
      )
    );
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Select visit 1 for JOB-101' })[0]
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Bob Jones' }));

    expect(
      await screen.findByRole('alertdialog', { name: 'Review scheduling conflict' })
    ).toHaveTextContent('Employee has an approved absence.');
    expect(screen.getByTestId('schedule-resource-employee-employee-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assign anyway' }));
    await waitFor(() =>
      expect(mockCreateAssignment).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resource_id: 'employee-2',
          override_conflicts: true,
        })
      )
    );
  });

  it('moves an existing assignment directly between visits', async () => {
    const secondVisit = {
      ...board.visits[0],
      id: 'visit-2',
      sequence_number: 2,
      title: 'Afternoon visit',
      starts_at: '2026-07-14T13:00:00Z',
      ends_at: '2026-07-14T17:00:00Z',
    };
    mockFetchBoard.mockResolvedValue({
      ...board,
      visits: [...board.visits, secondVisit],
    });
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    act(() => {
      dndState.onDragEnd?.({
        canceled: false,
        operation: {
          source: { data: { assignment: board.assignments[0] } },
          target: {
            data: {
              jobId: 'job-1',
              visitId: 'visit-2',
              workDate: '2026-07-14',
            },
          },
        },
      });
    });

    await waitFor(() =>
      expect(mockMoveAssignment).toHaveBeenCalledWith(board.assignments[0], 'visit-2')
    );
  });

  it('opens a timed visit editor from an active job day', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Add visit to JOB-101 on 2026-07-14',
      })[0]
    );

    expect(await screen.findByRole('dialog', { name: 'Add visit' })).toHaveTextContent(
      'JOB-101'
    );
  });

  it('explains a drop that misses an available day', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    act(() => {
      dndState.onDragEnd?.({
        canceled: false,
        operation: {
          source: {
            data: {
              resource: { type: 'employee', id: 'employee-1', label: 'Alex Smith' },
            },
          },
          target: null,
        },
      });
    });

    expect(mockToastInfo).toHaveBeenCalledWith(
      'Drop onto a timed visit.'
    );
  });

  it('offers a clear creation path when the viewed week has no jobs', async () => {
    mockFetchBoard.mockResolvedValue({ ...board, jobs: [], visits: [], assignments: [] });
    renderBoard();

    expect(await screen.findByText('No jobs scheduled for this week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule a Quote' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add Project job' }).length)
      .toBeGreaterThan(0);
  });

  it('restores tag and drop-on filters from the URL', async () => {
    const hospitalTag = {
      id: 'tag-hospital',
      name: 'Hospital',
      color: 'slate',
      description: null,
      is_active: true,
    };
    mockFetchBoard.mockResolvedValue({
      ...board,
      tags: [hospitalTag],
      jobs: [
        {
          ...board.jobs[0],
          is_drop_on_ready: true,
          tags: [hospitalTag],
        },
        {
          ...board.jobs[0],
          id: 'job-2',
          job_reference: 'JOB-202',
          title: 'Routine pruning',
          is_drop_on_ready: false,
          tags: [],
        },
      ],
    });

    renderBoard('?tags=tag-hospital&ready=true');

    expect(await screen.findAllByText('JOB-101')).not.toHaveLength(0);
    expect(screen.queryByText('JOB-202')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hospital' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Ready for drop-on' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
