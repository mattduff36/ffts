/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  ScheduleExpandingAction,
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

  it('keeps expanding actions icon-only until hover or focus', () => {
    render(
      <ScheduleExpandingAction
        icon={Settings}
        label="Settings"
        data-testid="expanding-settings"
      />
    );

    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveClass('w-9', 'hover:w-auto', 'focus-visible:w-auto');
    expect(button.querySelector('svg')?.className).not.toMatch(/rotate|scale|translate/);
  });
});
