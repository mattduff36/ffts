/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrainingDeclineDialog } from '@/app/(dashboard)/timesheets/components/TrainingDeclineDialog';

function expectLargeTouchButton(element: HTMLElement) {
  expect(element).toHaveClass('h-20');
  expect(element).toHaveClass('w-full');
  expect(element).toHaveClass('rounded-lg');
  expect(element).toHaveClass('border-2');
  expect(element).toHaveClass('text-lg');
}

function expectCompactCancelButton(element: HTMLElement) {
  expect(element).toHaveClass('h-14');
  expect(element).toHaveClass('w-auto');
  expect(element).toHaveClass('px-8');
  expect(element).toHaveClass('rounded-lg');
}

describe('TrainingDeclineDialog', () => {
  it('renders the confirmation copy and calls the confirm handler', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <TrainingDeclineDialog
        open
        dayLabel="Tuesday"
        trainingLabel="Training (AM)"
        pending={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('Remove Training Booking?')).toBeInTheDocument();
    expect(screen.getByText(/Tuesday is currently marked as Training \(AM\)/)).toBeInTheDocument();
    expect(screen.getByText(/you did not attend/i)).toBeInTheDocument();
    expect(
      screen.getByText(/your team manager plus any configured training coordinator will be notified/i)
    ).toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const confirmButton = screen.getByRole('button', { name: 'Confirm Did Not Attend' });
    expectCompactCancelButton(cancelButton);
    expectLargeTouchButton(confirmButton);

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables actions while the decline is pending', () => {
    render(
      <TrainingDeclineDialog
        open
        dayLabel="Wednesday"
        trainingLabel="Training"
        pending
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
