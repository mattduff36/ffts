'use client';

import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SCHEDULING_BOARD_PRIMARIES,
  type SchedulingBoardPrimary,
} from '@/lib/config/scheduling-primary-preference';
import {
  SCHEDULING_BOARD_VIEWS,
  type SchedulingBoardView,
} from '@/lib/config/scheduling-view-preference';
import {
  formatScheduleDate,
  getSchedulingWeek,
} from '@/lib/utils/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface SchedulingDateRangeControlsProps {
  selectedDate: string;
  view: SchedulingBoardView;
  onDateChange: (date: string) => void;
  onViewChange: (view: SchedulingBoardView) => void;
  primary: SchedulingBoardPrimary;
  onPrimaryChange: (primary: SchedulingBoardPrimary) => void;
}

export function SchedulingDateRangeControls({
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  primary,
  onPrimaryChange,
}: SchedulingDateRangeControlsProps) {
  const selected = parseISO(selectedDate);
  const week = getSchedulingWeek(selectedDate);
  const weekStart = parseISO(week.start);
  const weekEnd = parseISO(week.end);
  const periodLabel =
    view === SCHEDULING_BOARD_VIEWS.daily
      ? format(selected, 'EEEE, d MMMM yyyy')
      : `${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`;
  const periodName = view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week';

  function move(amount: number) {
    const days = view === SCHEDULING_BOARD_VIEWS.daily ? amount : amount * 7;
    onDateChange(formatScheduleDate(addDays(selected, days)));
  }

  function handleViewChange(value: string) {
    if (
      value === SCHEDULING_BOARD_VIEWS.daily
      || value === SCHEDULING_BOARD_VIEWS.weekly
    ) {
      onViewChange(value);
    }
  }

  function handlePrimaryChange(value: string) {
    if (
      value === SCHEDULING_BOARD_PRIMARIES.job
      || value === SCHEDULING_BOARD_PRIMARIES.employee
      || value === SCHEDULING_BOARD_PRIMARIES.plant
    ) {
      onPrimaryChange(value);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={view} onValueChange={handleViewChange}>
        <TabsList aria-label="Job board date range" className="grid h-9 grid-cols-2">
          <TabsTrigger value={SCHEDULING_BOARD_VIEWS.daily} className="px-3">
            Daily
          </TabsTrigger>
          <TabsTrigger value={SCHEDULING_BOARD_VIEWS.weekly} className="px-3">
            Weekly
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={primary} onValueChange={handlePrimaryChange}>
        <TabsList
          aria-label="Board primary resource"
          className="grid h-9 grid-cols-3"
          data-testid="schedule-primary-tabs"
        >
          <TabsTrigger
            value={SCHEDULING_BOARD_PRIMARIES.job}
            className="px-3"
            aria-label="Primary Jobs"
          >
            Jobs
          </TabsTrigger>
          <TabsTrigger
            value={SCHEDULING_BOARD_PRIMARIES.employee}
            className="px-3"
            aria-label="Primary Employees"
          >
            Employees
          </TabsTrigger>
          <TabsTrigger
            value={SCHEDULING_BOARD_PRIMARIES.plant}
            className="px-3"
            aria-label="Primary Plant"
          >
            Plant
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className={schedulingControlStyles.outline}
          size="sm"
          onClick={() => move(-1)}
          aria-label={`Previous ${periodName}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className={schedulingControlStyles.outline}
          size="sm"
          onClick={() => onDateChange(formatScheduleDate(new Date()))}
        >
          Today
        </Button>
        <div
          aria-live="polite"
          className="min-w-44 text-center text-sm font-semibold text-foreground"
        >
          {periodLabel}
        </div>
        <Button
          variant="outline"
          className={schedulingControlStyles.outline}
          size="sm"
          onClick={() => move(1)}
          aria-label={`Next ${periodName}`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
