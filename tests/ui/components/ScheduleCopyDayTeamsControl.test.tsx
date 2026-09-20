/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleCopyDayTeamsControl } from '@/app/(dashboard)/scheduling/components/ScheduleCopyDayTeamsControl';

describe('ScheduleCopyDayTeamsControl', () => {
  it('defaults to the previous date and copies that selection', async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(
      <ScheduleCopyDayTeamsControl
        selectedDate="2026-09-21"
        onCopy={onCopy}
      />
    );

    fireEvent.click(screen.getByTestId('schedule-copy-day-teams-button'));
    expect(screen.getByTestId('schedule-copy-day-teams-popover')).toBeInTheDocument();
    const dateInput = screen.getByTestId('schedule-copy-day-teams-date') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-09-20');
    fireEvent.click(screen.getByTestId('schedule-copy-day-teams-confirm'));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('2026-09-20'));
  });

  it('does not copy when the source date matches the selected day', () => {
    const onCopy = vi.fn();
    render(
      <ScheduleCopyDayTeamsControl
        selectedDate="2026-09-21"
        onCopy={onCopy}
      />
    );

    fireEvent.click(screen.getByTestId('schedule-copy-day-teams-button'));
    fireEvent.change(screen.getByTestId('schedule-copy-day-teams-date'), {
      target: { value: '2026-09-21' },
    });
    expect(screen.getByTestId('schedule-copy-day-teams-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('schedule-copy-day-teams-confirm'));
    expect(onCopy).not.toHaveBeenCalled();
  });
});
