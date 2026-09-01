/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchedulingDateRangeControls } from '@/app/(dashboard)/scheduling/components/SchedulingDateRangeControls';
import {
  SCHEDULING_BOARD_PRIMARIES,
  type SchedulingBoardPrimary,
} from '@/lib/config/scheduling-primary-preference';
import {
  SCHEDULING_BOARD_VIEWS,
  type SchedulingBoardView,
} from '@/lib/config/scheduling-view-preference';

interface ControlsHarnessProps {
  initialDate: string;
  initialView: SchedulingBoardView;
}

function ControlsHarness({ initialDate, initialView }: ControlsHarnessProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [view, setView] = useState(initialView);
  const [primary, setPrimary] = useState<SchedulingBoardPrimary>(
    SCHEDULING_BOARD_PRIMARIES.job
  );

  return (
    <SchedulingDateRangeControls
      selectedDate={selectedDate}
      view={view}
      onDateChange={setSelectedDate}
      onViewChange={setView}
      primary={primary}
      onPrimaryChange={setPrimary}
    />
  );
}

describe('SchedulingDateRangeControls', () => {
  it('navigates and labels daily ranges one day at a time', () => {
    render(
      <ControlsHarness
        initialDate="2026-07-14"
        initialView={SCHEDULING_BOARD_VIEWS.daily}
      />
    );

    expect(screen.getByText('Tuesday, 14 July 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText('Wednesday, 15 July 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('Tuesday, 14 July 2026')).toBeInTheDocument();
  });

  it('preserves weekly labels and navigates seven days at a time', () => {
    render(
      <ControlsHarness
        initialDate="2026-07-14"
        initialView={SCHEDULING_BOARD_VIEWS.weekly}
      />
    );

    expect(screen.getByText('13 Jul – 19 Jul 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText('20 Jul – 26 Jul 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByText('13 Jul – 19 Jul 2026')).toBeInTheDocument();
  });

  it('exposes a distinct primary-resource grouping control', () => {
    render(
      <ControlsHarness
        initialDate="2026-07-14"
        initialView={SCHEDULING_BOARD_VIEWS.weekly}
      />
    );

    expect(screen.getByTestId('schedule-primary-tabs')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Primary Jobs' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Primary Employees' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole('tab', { name: 'Primary Employees' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
