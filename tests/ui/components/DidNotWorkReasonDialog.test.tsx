/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DidNotWorkReasonDialog } from '@/components/timesheets/DidNotWorkReasonDialog';

function expectLargeTouchButton(element: HTMLElement) {
  expect(element).toHaveClass('h-20');
  expect(element).toHaveClass('w-full');
  expect(element).toHaveClass('rounded-lg');
  expect(element).toHaveClass('border-2');
  expect(element).toHaveClass('text-xl');
}

function expectSquareChoiceButton(element: HTMLElement, colorClass: string) {
  expect(element).toHaveClass('h-auto');
  expect(element).toHaveClass('min-h-24');
  expect(element).toHaveClass('aspect-square');
  expect(element).toHaveClass('w-full');
  expect(element).toHaveClass('rounded-lg');
  expect(element).toHaveClass('border-2');
  expect(element).toHaveClass('text-xl');
  expect(element).toHaveClass(colorClass);
}

function expectCompactCancelButton(element: HTMLElement) {
  expect(element).toHaveClass('h-14');
  expect(element).toHaveClass('w-auto');
  expect(element).toHaveClass('px-8');
  expect(element).toHaveClass('rounded-lg');
}

describe('DidNotWorkReasonDialog', () => {
  it('confirms sickness directly from the reason choice step', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Tuesday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const sickButton = screen.getByRole('button', { name: 'Sick' });
    expectSquareChoiceButton(sickButton, 'border-red-600');
    expectSquareChoiceButton(screen.getByRole('button', { name: 'Training' }), 'border-emerald-500');
    expectSquareChoiceButton(screen.getByRole('button', { name: 'Other' }), 'border-indigo-500');
    expectCompactCancelButton(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(sickButton);

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'sickness' });
  });

  it('asks for the training session before confirming training', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Wednesday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Training' }));
    const halfDayPmButton = screen.getByRole('button', { name: 'Half Day PM' });
    expectLargeTouchButton(screen.getByRole('button', { name: 'Full Day' }));
    expectLargeTouchButton(screen.getByRole('button', { name: 'Half Day AM' }));
    expectLargeTouchButton(halfDayPmButton);
    expectCompactCancelButton(screen.getByRole('button', { name: 'Back' }));
    expectCompactCancelButton(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(halfDayPmButton);

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'training', trainingSession: 'PM' });
  });

  it('keeps the existing text reason flow for Other', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Thursday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByPlaceholderText(/personal appointment/i), {
      target: { value: 'Vehicle issue' },
    });
    const saveReasonButton = screen.getByRole('button', { name: 'Save Reason' });
    expectCompactCancelButton(screen.getByRole('button', { name: 'Back' }));
    expectCompactCancelButton(screen.getByRole('button', { name: 'Cancel' }));
    expectLargeTouchButton(saveReasonButton);

    fireEvent.click(saveReasonButton);

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'other', reason: 'Vehicle issue' });
  });
});
