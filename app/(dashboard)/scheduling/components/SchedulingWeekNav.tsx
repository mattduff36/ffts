'use client';

import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatScheduleDate } from '@/lib/utils/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface SchedulingWeekNavProps {
  weekStart: string;
  onChange: (weekStart: string) => void;
}

export function SchedulingWeekNav({ weekStart, onChange }: SchedulingWeekNavProps) {
  const start = parseISO(weekStart);
  const end = addDays(start, 6);

  function move(amount: number) {
    onChange(formatScheduleDate(addWeeks(start, amount)));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" className={schedulingControlStyles.outline} onClick={() => move(-1)} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={schedulingControlStyles.outline}
        onClick={() =>
          onChange(formatScheduleDate(startOfWeek(new Date(), { weekStartsOn: 1 })))
        }
      >
        Today
      </Button>
      <div className="min-w-44 text-center text-sm font-semibold text-foreground">
        {format(start, 'd MMM')} – {format(end, 'd MMM yyyy')}
      </div>
      <Button variant="outline" size="sm" className={schedulingControlStyles.outline} onClick={() => move(1)} aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
