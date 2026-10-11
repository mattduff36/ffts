/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  ScheduleExpandingAction,
  ScheduleExpandingActionGroup,
  ScheduleHelpHint,
} from '@/app/(dashboard)/scheduling/components/ScheduleCompactControls';

describe('ScheduleCompactControls', () => {
  it('opens help on hover, click, and focus', () => {
    const { unmount } = render(
      <ScheduleHelpHint label="Resources help">
        <p>Help body</p>
      </ScheduleHelpHint>
    );

    expect(screen.queryByText('Help body')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Resources help' }));
    expect(screen.getByRole('note', { name: 'Resources help' })).toHaveTextContent('Help body');
    unmount();

    render(
      <ScheduleHelpHint label="Resources help">
        <p>Help body</p>
      </ScheduleHelpHint>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resources help' }));
    expect(screen.getByRole('note', { name: 'Resources help' })).toHaveTextContent('Help body');

    fireEvent.click(screen.getByRole('button', { name: 'Resources help' }));
    expect(screen.queryByText('Help body')).not.toBeInTheDocument();

    fireEvent.focus(screen.getByRole('button', { name: 'Resources help' }));
    expect(screen.getByText('Help body')).toBeInTheDocument();
  });

  it('uses the compact navbar expansion pattern with a delayed label reveal', () => {
    render(
      <ScheduleExpandingAction
        icon={Settings}
        label="Settings"
        data-testid="expanding-settings"
      />
    );

    const button = screen.getByRole('button', { name: 'Settings' });
    const label = button.querySelector('span');
    expect(button).toHaveClass('min-w-9', 'gap-0', 'overflow-hidden');
    expect(button).not.toHaveClass('hover:w-auto', 'focus-visible:w-auto');
    expect(label).toHaveClass(
      'max-w-0',
      'group-hover/action:max-w-[14rem]',
      'group-hover/action:delay-[1800ms]',
      'group-focus-visible/action:delay-[1800ms]'
    );
    expect(button.querySelector('svg')?.className).not.toMatch(/rotate|scale|translate/);
  });

  it('keeps labels primed while moving between actions and resets after inactivity', () => {
    vi.useFakeTimers();
    try {
      render(
        <ScheduleExpandingActionGroup data-testid="action-group">
          <ScheduleExpandingAction icon={Settings} label="First action" />
          <ScheduleExpandingAction icon={Settings} label="Second action" />
        </ScheduleExpandingActionGroup>
      );

      const group = screen.getByTestId('action-group');
      const firstLabel = screen.getByRole('button', { name: 'First action' }).querySelector('span');
      const secondLabel = screen.getByRole('button', { name: 'Second action' }).querySelector('span');

      expect(firstLabel).toHaveClass('group-hover/action:delay-[1800ms]');
      fireEvent.pointerEnter(group);
      act(() => vi.advanceTimersByTime(1800));

      expect(firstLabel).toHaveClass('group-hover/action:delay-0');
      expect(secondLabel).toHaveClass('group-hover/action:delay-0');

      fireEvent.pointerLeave(group);
      act(() => vi.advanceTimersByTime(2500));
      fireEvent.pointerEnter(group);
      expect(secondLabel).toHaveClass('group-hover/action:delay-0');

      fireEvent.pointerLeave(group);
      act(() => vi.advanceTimersByTime(3000));
      expect(firstLabel).toHaveClass('group-hover/action:delay-[1800ms]');
      expect(secondLabel).toHaveClass('group-hover/action:delay-[1800ms]');
    } finally {
      vi.useRealTimers();
    }
  });
});
