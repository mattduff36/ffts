import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { WorkshopTaskStatusDialogs } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTaskStatusDialogs';
import { WorkshopTaskAdminDialogs } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTaskAdminDialogs';

let outsidePrevented = false;
let escapePrevented = false;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'workshop-test-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <button type="button" data-testid="dialog-request-close" onClick={() => onOpenChange?.(false)}>
          Request Close
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    className,
    onInteractOutside,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    className?: string;
    onInteractOutside?: (event: { preventDefault: () => void }) => void;
    onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div data-testid="dialog-content" className={className}>
      <button
        type="button"
        data-testid="dialog-outside"
        onClick={() => {
          outsidePrevented = false;
          onInteractOutside?.({ preventDefault: () => { outsidePrevented = true; } });
        }}
      >
        Outside
      </button>
      <button
        type="button"
        data-testid="dialog-escape"
        onClick={() => {
          escapePrevented = false;
          onEscapeKeyDown?.({ preventDefault: () => { escapePrevented = true; } });
        }}
      >
        Escape
      </button>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Workshop status/admin tablet safeguards', () => {
  beforeEach(() => {
    localStorage.clear();
    outsidePrevented = false;
    escapePrevented = false;
  });

  it('prevents status dialog accidental close when dirty', () => {
    const onShowStatusModalChange = vi.fn();
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');

    render(
      <TabletModeProvider>
        <WorkshopTaskStatusDialogs
          statusTask={null}
          showStatusModal
          onShowStatusModalChange={onShowStatusModalChange}
          loggedComment="started"
          onLoggedCommentChange={vi.fn()}
          onCancelStatusModal={vi.fn()}
          onConfirmMarkInProgress={vi.fn()}
          showOnHoldModal={false}
          onShowOnHoldModalChange={vi.fn()}
          onHoldComment=""
          onOnHoldCommentChange={vi.fn()}
          onCancelOnHoldModal={vi.fn()}
          onConfirmMarkOnHold={vi.fn()}
          onHoldingTask={null}
          showResumeModal={false}
          onShowResumeModalChange={vi.fn()}
          resumeComment=""
          onResumeCommentChange={vi.fn()}
          onCancelResumeModal={vi.fn()}
          onConfirmResumeTask={vi.fn()}
          resumingTask={null}
          updatingStatus={new Set()}
        />
      </TabletModeProvider>
    );

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(onShowStatusModalChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog-outside'));
    expect(outsidePrevented).toBe(true);

    fireEvent.click(screen.getByTestId('dialog-escape'));
    expect(escapePrevented).toBe(true);

    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();
  });

  it('prevents category dialog accidental close when dirty', () => {
    const onShowCategoryModalChange = vi.fn();
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');

    render(
      <TabletModeProvider>
        <WorkshopTaskAdminDialogs
          showSettings
          showCategoryModal
          onShowCategoryModalChange={onShowCategoryModalChange}
          editingCategory={null}
          categoryName="Brakes"
          onCategoryNameChange={vi.fn()}
          submittingCategory={false}
          onSaveCategory={vi.fn()}
          onResetCategoryForm={vi.fn()}
          showDeleteConfirm={false}
          onShowDeleteConfirmChange={vi.fn()}
          taskToDelete={null}
          getVehicleReg={() => 'VAN-1'}
          deleting={false}
          onConfirmDeleteTask={vi.fn()}
          onResetDeleteTask={vi.fn()}
        />
      </TabletModeProvider>
    );

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(onShowCategoryModalChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog-outside'));
    expect(outsidePrevented).toBe(true);

    fireEvent.click(screen.getByTestId('dialog-escape'));
    expect(escapePrevented).toBe(true);

    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();
  });
});

