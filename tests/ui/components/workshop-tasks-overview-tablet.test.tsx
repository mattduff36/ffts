import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { WorkshopTasksOverviewTab } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTasksOverviewTab';
import { Tabs } from '@/components/ui/tabs';
import type { Action, WorkshopTaskTileFilter } from '@/app/(dashboard)/workshop-tasks/types';

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

function createTask(id: string, status: string, overrides: Partial<Action> = {}): Action {
  return {
    id,
    status,
    title: id,
    created_at: '2026-06-09T08:00:00Z',
    actioned_at: status === 'completed' ? '2026-06-09T12:00:00Z' : null,
    action_type: 'workshop_vehicle_task',
    workshop_comments: null,
    description: null,
    ...overrides,
  } as Action;
}

const mixedTasks = [
  createTask('PENDING-1', 'pending'),
  createTask('HP-1', 'pending', {
    action_type: 'inspection_defect',
    hgv_id: 'hgv-1',
    description: 'Daily check defect',
  }),
  createTask('PROGRESS-1', 'logged', { logged_comment: 'Started' }),
  createTask('HOLD-1', 'on_hold', { logged_comment: 'Waiting for parts' }),
  createTask('DONE-1', 'completed'),
];

function isHighPriorityTask(task: Action) {
  return task.action_type === 'inspection_defect' && Boolean(task.hgv_id);
}

function renderOverview() {
  return render(
    <TabletModeProvider>
      <Tabs value="overview" onValueChange={vi.fn()}>
        <WorkshopTasksOverviewTab
          assetTab="all"
          onAssetTabChange={vi.fn()}
          statusFilter="all"
          onStatusFilterChange={vi.fn()}
          vehicleFilter="all"
          onVehicleFilterChange={vi.fn()}
          vehicles={[]}
          loading={false}
          tabFilteredTasks={[]}
          taskCount={0}
          pendingTaskCount={0}
          pendingTasks={[]}
          highPriorityPendingCount={0}
          inProgressTaskCount={0}
          inProgressTasks={[]}
          onHoldTaskCount={0}
          onHoldTasks={[]}
          completedTaskCount={0}
          completedTasks={[]}
          showPending={true}
          onShowPendingChange={vi.fn()}
          showInProgress={true}
          onShowInProgressChange={vi.fn()}
          showOnHold={false}
          onShowOnHoldChange={vi.fn()}
          showCompleted={false}
          onShowCompletedChange={vi.fn()}
          updatingStatus={new Set()}
          taskAttachmentCounts={new Map()}
          taskInspectionPhotos={{}}
          getStatusIcon={() => null}
          getVehicleReg={() => 'VAN-1'}
          getSourceLabel={() => 'Workshop Task'}
          getAssetDisplay={() => 'VAN-1'}
          onCreateTask={vi.fn()}
          onOpenTaskModal={vi.fn()}
          onOpenComments={vi.fn()}
          onMarkInProgress={vi.fn()}
          onMarkComplete={vi.fn()}
          onMarkOnHold={vi.fn()}
          onResumeTask={vi.fn()}
          onUndoLogged={vi.fn()}
          onUndoComplete={vi.fn()}
          onEditTask={vi.fn()}
          onDeleteTask={vi.fn()}
        />
      </Tabs>
    </TabletModeProvider>
  );
}

function renderStatefulOverview(initialFilter: WorkshopTaskTileFilter = 'all') {
  function StatefulOverview() {
    const [statusFilter, setStatusFilter] = useState<WorkshopTaskTileFilter>(initialFilter);
    const [showPending, setShowPending] = useState(initialFilter === 'pending' || initialFilter === 'high_priority');
    const [showInProgress, setShowInProgress] = useState(initialFilter === 'logged');
    const [showOnHold, setShowOnHold] = useState(initialFilter === 'on_hold');
    const [showCompleted, setShowCompleted] = useState(initialFilter === 'completed');
    const pendingTasks = mixedTasks.filter((task) => task.status === 'pending');
    const highPriorityPendingTasks = pendingTasks.filter(isHighPriorityTask);
    const inProgressTasks = mixedTasks.filter((task) => task.status === 'logged');
    const onHoldTasks = mixedTasks.filter((task) => task.status === 'on_hold');
    const completedTasks = mixedTasks.filter((task) => task.status === 'completed');
    const visiblePendingTasks = statusFilter === 'all' || statusFilter === 'pending'
      ? pendingTasks
      : statusFilter === 'high_priority'
        ? highPriorityPendingTasks
        : [];
    const visibleInProgressTasks = statusFilter === 'all' || statusFilter === 'logged' ? inProgressTasks : [];
    const visibleOnHoldTasks = statusFilter === 'all' || statusFilter === 'on_hold' ? onHoldTasks : [];
    const visibleCompletedTasks = statusFilter === 'all' || statusFilter === 'completed' ? completedTasks : [];
    const handleStatusFilterChange = (nextFilter: WorkshopTaskTileFilter) => {
      setStatusFilter(nextFilter);
      setShowPending(nextFilter === 'pending' || nextFilter === 'high_priority');
      setShowInProgress(nextFilter === 'logged');
      setShowOnHold(nextFilter === 'on_hold');
      setShowCompleted(nextFilter === 'completed');
    };

    return (
      <TabletModeProvider>
        <Tabs value="overview" onValueChange={vi.fn()}>
          <WorkshopTasksOverviewTab
            assetTab="all"
            onAssetTabChange={vi.fn()}
            statusFilter={statusFilter}
            onStatusFilterChange={handleStatusFilterChange}
            vehicleFilter="all"
            onVehicleFilterChange={vi.fn()}
            vehicles={[]}
            loading={false}
            tabFilteredTasks={mixedTasks}
            taskCount={mixedTasks.length}
            pendingTaskCount={pendingTasks.length}
            pendingTasks={visiblePendingTasks}
            highPriorityPendingCount={highPriorityPendingTasks.length}
            inProgressTaskCount={inProgressTasks.length}
            inProgressTasks={visibleInProgressTasks}
            onHoldTaskCount={onHoldTasks.length}
            onHoldTasks={visibleOnHoldTasks}
            completedTaskCount={completedTasks.length}
            completedTasks={visibleCompletedTasks}
            showPending={showPending}
            onShowPendingChange={setShowPending}
            showInProgress={showInProgress}
            onShowInProgressChange={setShowInProgress}
            showOnHold={showOnHold}
            onShowOnHoldChange={setShowOnHold}
            showCompleted={showCompleted}
            onShowCompletedChange={setShowCompleted}
            updatingStatus={new Set()}
            taskAttachmentCounts={new Map()}
            taskInspectionPhotos={{}}
            getStatusIcon={() => null}
            getVehicleReg={(task) => task.id}
            getSourceLabel={(task) => task.action_type === 'inspection_defect' ? 'Daily Check Defect Fix' : 'Workshop Task'}
            getAssetDisplay={() => 'VAN-1'}
            onCreateTask={vi.fn()}
            onOpenTaskModal={vi.fn()}
            onOpenComments={vi.fn()}
            onMarkInProgress={vi.fn()}
            onMarkComplete={vi.fn()}
            onMarkOnHold={vi.fn()}
            onResumeTask={vi.fn()}
            onUndoLogged={vi.fn()}
            onUndoComplete={vi.fn()}
            onEditTask={vi.fn()}
            onDeleteTask={vi.fn()}
          />
        </Tabs>
      </TabletModeProvider>
    );
  }

  return render(<StatefulOverview />);
}

describe('WorkshopTasksOverviewTab tablet classes', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: { id: 'workshop-test-user' },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('applies touch target classes in tablet mode', async () => {
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');
    renderOverview();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /All Assets/i }).className).toContain('min-h-11');
    });
  });

  it('keeps desktop sizing when tablet mode is off', async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /All Assets/i }).className).not.toContain('min-h-11');
    });
  });
});

describe('WorkshopTasksOverviewTab status tile filters', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: { id: 'workshop-test-user' },
      }),
    })) as unknown as typeof fetch;
  });

  it('defaults to the All Tasks tile with task sections collapsed', async () => {
    renderStatefulOverview();

    const allTasksTile = screen.getByRole('button', { name: /show all workshop tasks/i });
    await waitFor(() => {
      expect(allTasksTile.getAttribute('aria-pressed')).toBe('true');
      expect(allTasksTile.className).toContain('border-workshop');
    });
    expect(screen.getByText('Pending Tasks (2)')).toBeTruthy();
    expect(screen.getByText('In Progress Tasks (1)')).toBeTruthy();
    expect(screen.queryByText('PENDING-1')).toBeNull();
    expect(screen.queryByText('PROGRESS-1')).toBeNull();
  });

  it('filters visible sections when a status tile is clicked', async () => {
    renderStatefulOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show all workshop tasks/i }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: /show in progress workshop tasks/i }));

    expect(screen.getByRole('button', { name: /show in progress workshop tasks/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/Pending Tasks \(/i)).toBeNull();
    expect(screen.getByText('In Progress Tasks (1)')).toBeTruthy();
    expect(screen.getByText('PROGRESS-1')).toBeTruthy();
  });

  it('filters High Priority to pending HGV defect tasks only', async () => {
    renderStatefulOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show all workshop tasks/i }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: /show high priority workshop tasks/i }));

    expect(screen.getByRole('button', { name: /show high priority workshop tasks/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Pending Tasks (1)')).toBeTruthy();
    expect(screen.getByText('HP-1')).toBeTruthy();
    expect(screen.queryByText('PENDING-1')).toBeNull();
  });

  it('keeps the status dropdown synced with selected database-backed tiles', async () => {
    renderStatefulOverview('high_priority');

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')[0].textContent).toContain('Pending');
    });

    fireEvent.click(screen.getByRole('button', { name: /show completed workshop tasks/i }));

    expect(screen.getByRole('button', { name: /show completed workshop tasks/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('combobox')[0].textContent).toContain('Completed');
  });
});

