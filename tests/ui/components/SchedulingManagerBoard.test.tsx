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

interface DndAnnouncements {
  dragover?: (event: DragEndEvent) => string | undefined;
}

interface DraggableOptions {
  id: string;
  disabled?: boolean;
}

let timelineViewportWidth = 1800;
let resizeObservers: MockResizeObserver[] = [];

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private observedTarget: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }

  observe(target: Element) {
    this.observedTarget = target;
    this.resizeObserved(timelineViewportWidth);
  }

  unobserve(target: Element) {
    if (this.observedTarget === target) this.observedTarget = null;
  }

  disconnect() {
    this.observedTarget = null;
    resizeObservers = resizeObservers.filter((observer) => observer !== this);
  }

  resizeObserved(clientWidth: number, contentRectWidth = clientWidth) {
    if (!this.observedTarget) return;
    Object.defineProperty(this.observedTarget, 'clientWidth', {
      configurable: true,
      value: clientWidth,
    });
    this.resize(this.observedTarget, contentRectWidth);
  }

  resize(target: Element, width: number) {
    this.callback(
      [{
        target,
        contentRect: { width },
      } as unknown as ResizeObserverEntry],
      this
    );
  }
}

function resizeTimelineViewport(width: number, contentRectWidth = width) {
  timelineViewportWidth = width;
  for (const resizeObserver of resizeObservers) {
    resizeObserver.resizeObserved(width, contentRectWidth);
  }
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
  mockSaveScheduleJob,
  mockSaveVisit,
  mockToastInfo,
} = vi.hoisted(() => ({
  dndState: {
    onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
    onDragStart: undefined as ((event: DragEndEvent) => void) | undefined,
    announcements: undefined as DndAnnouncements | undefined,
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
  mockSaveScheduleJob: vi.fn(),
  mockSaveVisit: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock('@dnd-kit/dom', () => ({
  Accessibility: {
    configure: vi.fn((options: { announcements?: DndAnnouncements }) => {
      dndState.announcements = options.announcements;
      return {};
    }),
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
    onDragStart,
    plugins,
    sensors,
  }: {
    children: ReactNode;
    onDragEnd?: (event: DragEndEvent) => void;
    onDragStart?: (event: DragEndEvent) => void;
    plugins?: (defaults: unknown[]) => unknown[];
    sensors?: unknown[];
  }) => {
    dndState.onDragEnd = onDragEnd;
    dndState.onDragStart = onDragStart;
    dndState.sensors = sensors || [];
    plugins?.([]);
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

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => ({
    hasPermission: true,
    loading: false,
    serviceUnavailable: false,
  }),
}));

vi.mock('@/components/security/SensitiveModuleGate', () => ({
  useSensitiveModuleAccess: () => ({
    loading: false,
    state: { required: false, unlocked: true },
    canAccess: true,
    refresh: vi.fn(),
    unlock: vi.fn(),
    renew: vi.fn(),
  }),
  SensitiveModuleGate: () => null,
  SensitiveModuleSessionManager: () => null,
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
    saveScheduleJob: mockSaveScheduleJob,
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

function prepareDailyBoard() {
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
  return today;
}

describe('SchedulingManagerBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndState.onDragEnd = undefined;
    dndState.onDragStart = undefined;
    dndState.announcements = undefined;
    dndState.draggableOptions.length = 0;
    dndState.sensors.length = 0;
    localStorage.clear();
    timelineViewportWidth = 1800;
    resizeObservers = [];
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
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
    mockSaveScheduleJob.mockResolvedValue({});
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

  it('replaces Add Project job with shared Quote and Project creation controls', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Quote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Project Number' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Project job' })).not.toBeInTheDocument();
  });

  it('removes a Project schedule only after destructive confirmation', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    const removeButton = screen.getAllByRole('button', { name: 'Remove JOB-101' })[0];
    expect(removeButton).toHaveClass('bg-transparent', 'text-[#e2e8f0]');
    fireEvent.click(removeButton);
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Remove Project job from the schedule?',
    });
    expect(confirmation).toHaveTextContent('The Project Number and its costs remain open');
    expect(within(confirmation).getByRole('button', { name: 'Remove job' }))
      .toHaveClass('bg-[#b91c1c]', 'text-[#ffffff]');

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

    const draftCard = await screen.findByRole('button', {
      name: 'Q-DRAFT: select job or drag to a calendar date',
    });
    expect(draftCard).toBeInTheDocument();
    act(() => {
      dndState.onDragStart?.({
        operation: {
          source: {
            data: {
              quote: { id: 'quote-draft', base_quote_reference: 'Q-DRAFT' },
            },
          },
          target: null,
        },
      });
    });
    expect(draftCard).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      dndState.onDragEnd?.({
        canceled: true,
        operation: {
          source: {
            data: {
              quote: { id: 'quote-draft', base_quote_reference: 'Q-DRAFT' },
            },
          },
          target: null,
        },
      });
    });
    expect(within(draftCard).getByText('Changes Requested')).toHaveClass(
      'text-[9px]',
      'text-slate-400'
    );
    expect(within(draftCard).getByText('2 days').parentElement).toHaveClass(
      'text-slate-300'
    );
    const quoteDragCue = within(draftCard).getByTestId('schedule-quote-drag-cue');
    expect(quoteDragCue.tagName.toLowerCase()).toBe('svg');
    expect(quoteDragCue).toHaveAttribute('aria-hidden', 'true');
    expect(quoteDragCue).toHaveClass('pointer-events-none');
    expect(quoteDragCue).not.toHaveAttribute('tabindex');
    expect(draftCard.querySelector('button')).toBeNull();
    expect(screen.queryByText('Q-SCHEDULED')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Draft (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pending (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Accepted (1)' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Accepted (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole('button', {
      name: 'Q-ACCEPTED: select job or drag to a calendar date',
    }))
      .toBeInTheDocument();
    expect(screen.queryByText('Q-DRAFT')).not.toBeInTheDocument();
  });

  it('shows unscheduled Project Numbers in a fourth unified queue tab', async () => {
    mockFetchProjectCandidates.mockResolvedValue([{
      id: 'project-open-1',
      project_reference: '99050-MD',
      manager_profile_id: 'manager-1',
      requester_initials: 'MD',
      title: 'Reserve works',
      description: 'Open project',
      status: 'open',
    }]);
    renderBoard();
    expect(await screen.findByRole('tab', { name: 'Projects (1)' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    const projectCard = await screen.findByRole('button', {
      name: '99050-MD: select job or drag to a calendar date',
    });
    expect(within(projectCard).getByText('Project')).toBeInTheDocument();
    expect(within(projectCard).getByText('1 day')).toBeInTheDocument();
    fireEvent.click(projectCard);
    expect(projectCard).toHaveAttribute('aria-pressed', 'true');
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
    expect(await screen.findByRole('button', {
      name: 'Q-DRAFT: select job or drag to a calendar date',
    }))
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

  it('uses whole Jobs, Employees, and Plant cards as accessible drag activators', async () => {
    mockFetchBoard.mockResolvedValue({
      ...board,
      resources: {
        ...board.resources,
        plant: [{
          id: 'plant-1',
          plant_id: 'P001',
          nickname: 'Loader',
          make: 'JCB',
          model: '403',
          status: 'active',
        }],
      },
    });
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    const jobsGuidance = screen.getByText(/Drag an unscheduled job onto a date/);
    expect(screen.getByTestId('schedule-manager-layout')).toHaveClass(
      'xl:grid-cols-[350px_minmax(0,1fr)]'
    );
    expect(screen.getByTestId('schedule-resources-panel')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-resource-tabs')).toHaveClass(
      'grid',
      'w-full',
      'grid-cols-3'
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pending (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    const quoteCard = screen.getByRole('button', {
      name: 'Q-100: select job or drag to a calendar date',
    });
    expect(quoteCard).toHaveAttribute('data-testid', expect.stringContaining('schedule-quote-'));
    fireEvent.click(quoteCard);
    expect(quoteCard).toHaveAttribute('aria-pressed', 'true');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Employees' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/Select a visit to show resources/).className)
      .toBe(jobsGuidance.className);

    expect(dndState.sensors).toHaveLength(2);
    const employeeCard = screen.getByRole('button', {
      name: 'Bob Jones: select resource or drag to a timed visit',
    });
    const employeeDragCue = within(employeeCard).getByTestId(
      'schedule-resource-drag-cue'
    );
    expect(employeeDragCue).toHaveAttribute('aria-hidden', 'true');
    expect(employeeDragCue).toHaveClass('pointer-events-none');
    expect(employeeDragCue).not.toHaveAttribute('tabindex');
    expect(employeeCard.querySelector('button')).toBeNull();
    expect(within(employeeCard).getByText('Bob Jones')).toHaveClass(
      'text-sm',
      'font-semibold'
    );
    expect(within(employeeCard).getByText('Arborists')).toHaveClass(
      'text-xs',
      'text-slate-300'
    );
    expect(within(employeeCard).getByText('Employee · E002')).toHaveClass(
      'text-[10px]',
      'text-slate-400'
    );
    fireEvent.click(employeeCard);
    expect(employeeCard).toHaveAttribute('aria-pressed', 'true');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Plant' }), {
      button: 0,
      ctrlKey: false,
    });
    const plantCard = screen.getByRole('button', {
      name: 'P001 — Loader: select resource or drag to a timed visit',
    });
    const plantDragCue = within(plantCard).getByTestId(
      'schedule-resource-drag-cue'
    );
    expect(plantDragCue).toHaveAttribute('aria-hidden', 'true');
    expect(plantDragCue).toHaveClass('pointer-events-none');
    expect(plantCard.querySelector('button')).toBeNull();
    expect(within(plantCard).getByText('JCB · 403')).toHaveClass(
      'text-xs',
      'text-slate-300'
    );
    expect(within(plantCard).getByText('Plant · active')).toHaveClass(
      'text-[10px]',
      'text-slate-400'
    );
    fireEvent.click(plantCard);
    expect(plantCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('schedule-resource-scroll-area')).toHaveClass(
      'scrollbar-subtle'
    );

    expect(screen.queryByRole('button', {
      name: /^(Drag Q-100|Drag Bob Jones|Drag P001|Select Bob Jones|Select P001)/,
    })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Move Alex Smith to another visit' })[0]
    ).toBeInTheDocument();
  });

  it('announces timed visit targets for resource drags and dates for Quote drags', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    expect(dndState.announcements?.dragover?.({
      operation: {
        source: {
          data: {
            resource: { type: 'employee', id: 'employee-2', label: 'Bob Jones' },
          },
        },
        target: {
          data: {
            jobReference: 'JOB-101',
            visitSequenceNumber: 1,
            workDate: '2026-07-14',
          },
        },
      },
    })).toBe('Bob Jones is over visit 1 for JOB-101.');

    expect(dndState.announcements?.dragover?.({
      operation: {
        source: {
          data: {
            quote: {
              id: 'quote-draft',
              base_quote_reference: 'Q-DRAFT',
            },
          },
        },
        target: { data: { workDate: '2026-07-14' } },
      },
    })).toBe('Q-DRAFT is over Tuesday 14 July.');
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

  it('uses Resources Jobs as the only first-time Quote scheduling entry point', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText(/Drag an unscheduled job onto a date/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule Quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule a Quote' })).not.toBeInTheDocument();
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
    const quoteActions = screen.getByTestId('schedule-job-actions-desktop-job-1');
    expect(within(quoteActions).queryByRole('button', { name: 'Edit JOB-101' }))
      .not.toBeInTheDocument();
    const openQuoteLink = within(quoteActions).getByRole('link', {
      name: 'Open Quote JOB-101 in new tab',
    });
    expect(openQuoteLink).toHaveAttribute('target', '_blank');
    expect(openQuoteLink).toHaveAttribute('rel', 'noopener noreferrer');

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

  it('toggles crew offer directly with optimistic rollback protection', async () => {
    renderBoard();
    expect(await screen.findByText('Weekly job board')).toBeInTheDocument();
    const actions = screen.getByTestId('schedule-job-actions-desktop-job-1');
    const toggle = within(actions).getByRole('button', {
      name: 'Offer if crew finishes early',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(mockSaveScheduleJob).toHaveBeenCalledWith(
        { is_drop_on_ready: true },
        'job-1'
      )
    );

    mockSaveScheduleJob.mockRejectedValueOnce(new Error('Unable to update'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
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

  it('places accessible daily display controls beside the assignment instructions', async () => {
    const today = prepareDailyBoard();
    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    expect(dailyTimeline).toHaveAttribute(
      'aria-label',
      'Daily schedule timeline'
    );
    const instructionRow = screen.getByTestId('schedule-daily-instruction-row');
    expect(instructionRow).toHaveTextContent(
      'Drag a resource card onto a timed visit, or select the visit and tap a resource.'
    );
    const modeControls = within(instructionRow).getByRole('group', {
      name: 'Daily timeline display mode',
    });
    const fitButton = within(modeControls).getByRole('button', {
      name: 'Shrink to fit width',
    });
    const scrollButton = within(modeControls).getByRole('button', { name: 'Scroll' });

    await waitFor(() => expect(fitButton).toHaveAttribute('aria-pressed', 'true'));
    expect(fitButton).toHaveAttribute('title', 'Shrink to fit width');
    expect(fitButton).toBeEnabled();
    expect(fitButton).toHaveClass('bg-[#34d399]', 'text-[#020617]');
    expect(fitButton).toHaveClass('hover:text-[#020617]');
    expect(scrollButton).toHaveAttribute('aria-pressed', 'false');
    expect(scrollButton).toHaveAttribute('title', 'Scroll');
    expect(scrollButton).toHaveClass(
      'text-[#e2e8f0]',
      'hover:text-[#ffffff]'
    );
    expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'fit');
    expect(screen.getByTestId('schedule-daily-timeline-content')).toHaveStyle({
      width: '1800px',
    });
    const jobHeader = screen.getByTestId('schedule-daily-job-header');
    const jobCell = screen.getByTestId('schedule-daily-job-cell-job-1');
    expect(jobHeader).toHaveClass(
      'sticky',
      'left-0',
      'z-30',
      'bg-[hsl(var(--background)/0.5)]'
    );
    expect(jobHeader).not.toHaveClass('backdrop-blur');
    expect(jobCell).toHaveClass(
      'sticky',
      'left-0',
      'z-30',
      'bg-[hsl(var(--background)/0.5)]'
    );
    expect(within(jobCell).getByRole('button', { name: 'Edit JOB-101' }))
      .toBeInTheDocument();
    expect(screen.getByTestId('schedule-daily-timeline-header')).toHaveClass(
      'relative',
      'z-0'
    );
    expect(screen.getByTestId('schedule-timeline-hour-5')).toHaveTextContent('05:00');
    const endMarker = screen.getByTestId('schedule-timeline-hour-20');
    expect(endMarker).toHaveTextContent('20:00');
    expect(endMarker).toHaveAttribute('data-boundary', 'end');
    expect(endMarker).toHaveStyle({ right: '0px', width: '1px' });
    expect(endMarker.style.left).toBe('');
    expect(endMarker.firstElementChild).toHaveClass(
      'inline-block',
      'absolute',
      'right-0'
    );
    const timelineCell = screen.getByTestId(`schedule-cell-job-1-${today}`);
    expect(timelineCell).toHaveClass('relative', 'z-0');
    expect(timelineCell).toHaveAttribute(
      'data-timeline-start',
      '05:00'
    );
    expect(timelineCell).toHaveAttribute(
      'data-timeline-end',
      '20:00'
    );
    const visitPlacement = within(dailyTimeline).getByTestId(
      'schedule-timeline-visit-visit-1'
    );
    expect(jobCell).toHaveStyle({ height: '144px' });
    expect(timelineCell).toHaveStyle({ height: '144px' });
    expect(visitPlacement).toHaveStyle({ top: '8px', height: '128px' });
    const timelineVisit = within(dailyTimeline).getByTestId('schedule-visit-visit-1');
    expect(timelineVisit).toHaveClass(
      'flex',
      'h-full',
      'min-h-0',
      'flex-col',
      'overflow-hidden',
      'border-slate-500'
    );
    expect(timelineVisit).toHaveStyle({ backgroundColor: '#334155' });
    expect(within(timelineVisit).getByText('JOB-101')).toHaveAttribute(
      'title',
      'JOB-101'
    );
    expect(within(timelineVisit).getByTestId(
      'schedule-assignment-layout-visit-1'
    )).toHaveClass('mt-auto', 'shrink-0');
    expect(within(dailyTimeline).getByRole('button', {
      name: 'Adjust end of visit 1 for JOB-101',
    })).toHaveClass('z-10');
  });

  it('stretches Fit across ultra-wide ResizeObserver measurements while Scroll stays fixed', async () => {
    timelineViewportWidth = 2400;
    prepareDailyBoard();
    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    const timelineContent = screen.getByTestId('schedule-daily-timeline-content');
    const timelineHeader = screen.getByTestId('schedule-daily-timeline-header');

    await waitFor(() => expect(timelineContent).toHaveStyle({ width: '2400px' }));
    expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'fit');
    expect(dailyTimeline).toHaveClass('overflow-x-hidden');
    expect(dailyTimeline).not.toHaveClass('overflow-x-auto');
    expect(timelineHeader).toHaveAttribute('data-hour-width', '144');
    expect(timelineHeader).toHaveStyle({ width: '2160px' });

    dailyTimeline.scrollLeft = 42;
    act(() => resizeTimelineViewport(2707, 9999));

    await waitFor(() => expect(timelineContent).toHaveStyle({ width: '2700px' }));
    await waitFor(() => expect(dailyTimeline.scrollLeft).toBe(0));
    expect(timelineHeader).toHaveAttribute('data-hour-width', '164');
    expect(timelineHeader).toHaveStyle({ width: '2460px' });

    fireEvent.click(screen.getByRole('button', { name: 'Scroll' }));

    expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'scroll');
    expect(dailyTimeline).toHaveClass('overflow-x-auto');
    expect(dailyTimeline).not.toHaveClass('overflow-x-hidden');
    expect(timelineContent).toHaveStyle({ width: '1680px' });
    expect(timelineHeader).toHaveAttribute('data-hour-width', '96');
    expect(timelineHeader).toHaveStyle({ width: '1440px' });
  });

  it('preserves the standard timeline scale and exposes a thin scrollbar in Scroll mode', async () => {
    prepareDailyBoard();
    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    const scrollButton = screen.getByRole('button', { name: 'Scroll' });
    fireEvent.click(scrollButton);

    expect(scrollButton).toHaveAttribute('aria-pressed', 'true');
    expect(scrollButton).toHaveClass('bg-[#34d399]', 'text-[#020617]');
    expect(screen.getByRole('button', { name: 'Shrink to fit width' })).toHaveClass(
      'text-[#e2e8f0]',
      'hover:text-[#ffffff]'
    );
    expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'scroll');
    expect(dailyTimeline).not.toHaveClass('scrollbar-hidden');
    expect(dailyTimeline).toHaveClass('overflow-x-auto');
    expect(dailyTimeline).toHaveClass('[scrollbar-width:thin]');
    expect(screen.getByTestId('schedule-daily-timeline-content')).toHaveStyle({
      width: '1680px',
    });
    expect(screen.getByTestId('schedule-daily-timeline-header')).toHaveStyle({
      width: '1440px',
    });
  });

  it('disables Fit and forces Scroll when the measured scale would be too narrow', async () => {
    timelineViewportWidth = 1100;
    prepareDailyBoard();
    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    const fitButton = screen.getByRole('button', { name: 'Shrink to fit width' });
    const scrollButton = screen.getByRole('button', { name: 'Scroll' });

    await waitFor(() => expect(fitButton).toBeDisabled());
    expect(fitButton).toHaveAttribute('aria-pressed', 'false');
    expect(scrollButton).toHaveAttribute('aria-pressed', 'true');
    expect(dailyTimeline).toHaveAttribute('data-fit-eligible', 'false');
    expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'scroll');
    expect(screen.getByTestId('schedule-daily-timeline-content')).toHaveStyle({
      width: '1680px',
    });
  });

  it('pans Scroll mode from empty timeline space without hijacking visit controls', async () => {
    timelineViewportWidth = 1100;
    const today = prepareDailyBoard();
    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    await waitFor(() =>
      expect(dailyTimeline).toHaveAttribute('data-timeline-mode', 'scroll')
    );
    Object.defineProperty(dailyTimeline, 'scrollLeft', {
      configurable: true,
      value: 400,
      writable: true,
    });
    const timelineCell = screen.getByTestId(`schedule-cell-job-1-${today}`);

    fireEvent.pointerDown(timelineCell, {
      button: 0,
      clientX: 500,
      pointerId: 11,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(timelineCell, {
      clientX: 440,
      pointerId: 11,
      pointerType: 'mouse',
    });
    expect(dailyTimeline.scrollLeft).toBe(460);
    expect(dailyTimeline).toHaveAttribute('data-timeline-panning', 'true');
    fireEvent.pointerUp(timelineCell, {
      clientX: 440,
      pointerId: 11,
      pointerType: 'mouse',
    });
    expect(dailyTimeline).toHaveAttribute('data-timeline-panning', 'false');

    dailyTimeline.scrollLeft = 400;
    const visitButton = within(dailyTimeline).getByRole('button', {
      name: 'Select visit 1 for JOB-101',
    });
    fireEvent.pointerDown(visitButton, {
      button: 0,
      clientX: 500,
      pointerId: 12,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(visitButton, {
      clientX: 440,
      pointerId: 12,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(visitButton, {
      clientX: 440,
      pointerId: 12,
      pointerType: 'mouse',
    });
    expect(dailyTimeline.scrollLeft).toBe(400);
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
    expect(assignmentChip?.querySelector('.lucide-grip-vertical')).toBeNull();
    expect(assignmentMoveButtons[0]).toHaveClass('cursor-grab');
  });

  it('caps compact visit assignments at two rows with an exact accessible overflow count', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    const visit = {
      ...board.visits[0],
      starts_at: `${today}T10:00:00.000Z`,
      ends_at: `${today}T12:00:00.000Z`,
    };
    const employeeNames = [
      'Alice Stone',
      'Ben Smith',
      'Chloe Jones',
      'Dana White',
      'Evan Black',
      'Fiona Green',
      'George Brown',
      'Helen Gray',
    ];
    const baseEmployeeAssignment = board.assignments[0];
    if (baseEmployeeAssignment.resource_type !== 'employee') {
      throw new Error('Expected the board fixture to contain an employee assignment.');
    }
    const assignments: SchedulingBoardPayload['assignments'] = employeeNames.map(
      (fullName, index) => ({
        ...baseEmployeeAssignment,
        id: `assignment-${index + 1}`,
        work_date: today,
        visit_id: visit.id,
        profile_id: `employee-${index + 1}`,
        employee: {
          ...baseEmployeeAssignment.employee!,
          id: `employee-${index + 1}`,
          full_name: fullName,
        },
        visit,
      })
    );
    assignments[2] = {
      ...baseEmployeeAssignment,
      id: 'assignment-3',
      work_date: today,
      visit_id: visit.id,
      resource_type: 'plant',
      plant_id: 'plant-1',
      plant: {
        id: 'plant-1',
        plant_id: 'P001',
        nickname: 'Loader',
        make: 'JCB',
        model: '403',
        status: 'active',
      },
      visit,
    };
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
      visits: [visit],
      assignments,
    });

    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    const layout = within(dailyTimeline).getByTestId('schedule-assignment-layout-visit-1');
    expect(layout).toHaveAttribute('data-assignment-row-count', '2');
    expect(within(layout).getAllByTestId(/^schedule-assignment-row-/)).toHaveLength(2);
    expect(within(layout).getAllByTestId(/^schedule-assignment-chip-/)).toHaveLength(3);
    for (const assignmentChip of within(layout).getAllByTestId(
      /^schedule-assignment-chip-/
    )) {
      expect(assignmentChip.querySelector('.lucide-grip-vertical')).toBeNull();
    }
    expect(within(layout).getByText('Alice S')).toBeInTheDocument();
    expect(within(layout).getByText('Loader')).toBeInTheDocument();

    const overflow = within(layout).getByTestId('schedule-assignment-overflow-visit-1');
    expect(overflow).toHaveTextContent('+5');
    expect(overflow).toHaveAttribute(
      'aria-label',
      '5 more assignments: Dana White, Evan Black, Fiona Green, George Brown, Helen Gray'
    );
    expect(within(dailyTimeline).getByTestId('schedule-timeline-visit-visit-1')).toHaveStyle({
      top: '8px',
      height: '128px',
    });
    expect(layout).toHaveClass('mt-auto', 'shrink-0');
    expect(within(layout).getByRole('button', {
      name: 'Move Alice Stone to another visit',
    })).toBeInTheDocument();
    expect(within(layout).getByRole('button', {
      name: 'Remove Alice Stone',
    })).toBeInTheDocument();
  });

  it('keeps multiple Daily visits in distinct lanes inside the shared row height', async () => {
    const today = formatScheduleDate(new Date());
    const currentWeek = getSchedulingWeek(today);
    const firstVisit = {
      ...board.visits[0],
      starts_at: `${today}T08:00:00.000Z`,
      ends_at: `${today}T10:00:00.000Z`,
    };
    const secondVisit = {
      ...firstVisit,
      id: 'visit-2',
      sequence_number: 2,
      title: 'Afternoon visit',
      starts_at: `${today}T13:00:00.000Z`,
      ends_at: `${today}T15:00:00.000Z`,
    };
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
      visits: [firstVisit, secondVisit],
      assignments: [],
    });

    renderBoard();

    const dailyTimeline = await screen.findByTestId('schedule-daily-timeline');
    const timelineCell = within(dailyTimeline).getByTestId(
      `schedule-cell-job-1-${today}`
    );
    const firstPlacement = within(dailyTimeline).getByTestId(
      'schedule-timeline-visit-visit-1'
    );
    const secondPlacement = within(dailyTimeline).getByTestId(
      'schedule-timeline-visit-visit-2'
    );

    expect(timelineCell).toHaveStyle({ height: '188px' });
    expect(screen.getByTestId('schedule-daily-job-cell-job-1')).toHaveStyle({
      height: '188px',
    });
    expect(firstPlacement).toHaveStyle({ top: '8px', height: '82px' });
    expect(secondPlacement).toHaveStyle({ top: '98px', height: '82px' });
    expect(8 + 82).toBeLessThan(98);
    expect(98 + 82).toBeLessThanOrEqual(188);
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
    fireEvent.click(screen.getByRole('button', {
      name: 'Bob Jones: select resource or drag to a timed visit',
    }));

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
    fireEvent.click(screen.getByRole('button', {
      name: 'Bob Jones: select resource or drag to a timed visit',
    }));

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

  it('keeps Job details full-width and places actions beside the source footer badge', async () => {
    const today = prepareDailyBoard();
    renderBoard();
    expect(await screen.findByText('Daily job board')).toBeInTheDocument();

    const jobCell = screen.getByTestId('schedule-daily-job-cell-job-1');
    const jobReference = within(jobCell).getByText('JOB-101');
    const footer = within(jobCell).getByTestId('schedule-job-footer-desktop-job-1');
    const actionRow = within(footer).getByTestId('schedule-job-actions-desktop-job-1');
    expect(jobCell).toHaveClass('flex', 'h-full', 'flex-col');
    expect(jobReference).toBeInTheDocument();
    expect(jobReference.parentElement).not.toContainElement(actionRow);
    expect(within(jobCell).getByText('Crown reduction')).toBeInTheDocument();
    expect(within(jobCell).getByText('Riverside Estate')).toBeInTheDocument();
    expect(within(jobCell).getByText('Estimated 4 hours')).toBeInTheDocument();
    expect(within(footer).getByText('Project')).toHaveClass(
      'border-[#64748b]',
      'bg-[#0f172a]',
      'text-[#cbd5e1]'
    );
    expect(footer).toHaveClass('mt-auto');
    expect(within(jobCell).queryByText('Add visit')).not.toBeInTheDocument();

    const addVisitButton = within(actionRow).getByRole('button', {
      name: `Add Additional Visit to JOB-101 on ${today}`,
    });
    expect(addVisitButton).toHaveAttribute('title', 'Add Additional Visit');
    expect(addVisitButton).toHaveClass('h-6', 'w-6');
    fireEvent.click(addVisitButton);

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

  it('directs an empty board to the unified Jobs queue', async () => {
    mockFetchBoard.mockResolvedValue({ ...board, jobs: [], visits: [], assignments: [] });
    renderBoard();

    expect(await screen.findByText('No jobs scheduled for this week')).toBeInTheDocument();
    expect(screen.getByText(/Use Resources > Jobs for queued Quotes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule a Quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Project job' })).not.toBeInTheDocument();
  });

  it('restores tag and crew-offer filters from the URL with readable controls', async () => {
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
    const selectedTagButton = screen.getByRole('button', { name: 'Hospital' });
    expect(selectedTagButton).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(selectedTagButton).toHaveClass('bg-[#34d399]', 'text-[#020617]');
    expect(selectedTagButton.querySelector('.lucide-check')).not.toBeNull();
    const crewOfferButton = screen.getByRole('button', { name: 'Offer if crew free' });
    expect(crewOfferButton).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(crewOfferButton).toHaveClass('bg-[#34d399]', 'text-[#020617]');
    expect(screen.queryByText('Crew offer')).not.toBeInTheDocument();
    expect(screen.queryByText('Drop-on ready')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveClass(
      'text-[#e2e8f0]',
      'hover:text-[#ffffff]'
    );
  });
});
