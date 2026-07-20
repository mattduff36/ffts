/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulingManagerBoard } from '@/app/(dashboard)/scheduling/components/SchedulingManagerBoard';
import {
  getSchedulingViewStorageKey,
  SCHEDULING_BOARD_VIEWS,
} from '@/lib/config/scheduling-view-preference';
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
  mockFetchBoard,
  mockSaveVisit,
  mockToastInfo,
} = vi.hoisted(() => ({
  dndState: {
    onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
    draggableOptions: [] as DraggableOptions[],
  },
  mockCreateAssignment: vi.fn(),
  mockFetchBoard: vi.fn(),
  mockSaveVisit: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock('@dnd-kit/dom', () => ({
  Accessibility: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd?: (event: DragEndEvent) => void;
  }) => {
    dndState.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  useDraggable: (options: DraggableOptions) => {
    dndState.draggableOptions.push(options);
    return { ref: vi.fn(), isDragging: false };
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
    createScheduleAssignment: mockCreateAssignment,
    deletePlantUnavailability: vi.fn(),
    deleteScheduleAssignment: vi.fn(),
    deleteScheduleJob: vi.fn(),
    fetchSchedulingBoard: mockFetchBoard,
    deleteScheduleVisit: vi.fn(),
    savePlantUnavailability: vi.fn(),
    saveScheduleJob: vi.fn(),
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
    }],
    plant: [],
  },
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

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SchedulingManagerBoard userId="manager-1" />
    </QueryClientProvider>
  );
}

describe('SchedulingManagerBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndState.onDragEnd = undefined;
    dndState.draggableOptions.length = 0;
    localStorage.clear();
    mockWideViewport(false);
    mockFetchBoard.mockResolvedValue(board);
    mockCreateAssignment.mockResolvedValue(undefined);
    mockSaveVisit.mockResolvedValue(undefined);
  });

  it('uses the weekly board when no saved preference exists', async () => {
    renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(localStorage.getItem(getSchedulingViewStorageKey('manager-1'))).toBeNull();
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

  it('uses select and Assign as the reliable narrow-screen workflow', async () => {
    const { container } = renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    expect(dndState.draggableOptions).toHaveLength(0);

    fireEvent.click(screen.getByTestId('schedule-resource-employee-employee-1'));
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Assign resource to visit 1 for JOB-101',
      })[0]
    );

    expect(await screen.findByRole('dialog', { name: 'Assign resource' })).toHaveTextContent(
      'JOB-101 — Crown reduction'
    );
    expect(screen.getByText(/Visit 1/)).toBeInTheDocument();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('opens the assignment dialog after a valid wide-screen drop', async () => {
    mockWideViewport(true);
    renderBoard();

    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    await waitFor(() =>
      expect(dndState.draggableOptions.some((options) => options.id.includes('employee-1'))).toBe(true)
    );

    act(() => {
      dndState.onDragEnd?.({
        canceled: false,
        operation: {
          source: {
            data: {
              resource: { type: 'employee', id: 'employee-1', label: 'Alex Smith' },
            },
          },
          target: { data: { jobId: 'job-1', visitId: 'visit-1', workDate: '2026-07-14' } },
        },
      });
    });

    expect(await screen.findByRole('dialog', { name: 'Assign resource' })).toBeInTheDocument();
    expect(screen.getByText('Alex Smith (E001)')).toBeInTheDocument();
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
    expect(
      screen.getByRole('button', { name: "Add this week's first job" })
    ).toBeInTheDocument();
  });
});
