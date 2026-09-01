'use client';

import { cn } from '@/lib/utils/cn';
import {
  OCCUPANCY_STRIP_END_MINUTES,
  OCCUPANCY_STRIP_START_MINUTES,
} from '@/lib/utils/scheduling-occupancy';
import type { ScheduleOccupancySegment, ScheduleOccupancyState } from '@/types/scheduling';

const OCCUPANCY_STATE_CLASS: Record<ScheduleOccupancyState, string> = {
  available: 'bg-emerald-400',
  booked: 'bg-rose-500',
  unavailable: 'bg-amber-400',
};

const STRIP_DURATION_MINUTES =
  OCCUPANCY_STRIP_END_MINUTES - OCCUPANCY_STRIP_START_MINUTES;

export function ResourceOccupancyStrip({
  resourceId,
  segments,
}: {
  resourceId: string;
  segments: ScheduleOccupancySegment[];
}) {
  return (
    <div
      data-testid={`schedule-resource-occupancy-${resourceId}`}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-[inherit] bg-slate-950/70"
      aria-hidden="true"
    >
      {segments.map((segment) => {
        const left =
          ((segment.startMinutes - OCCUPANCY_STRIP_START_MINUTES) / STRIP_DURATION_MINUTES) * 100;
        const width =
          ((segment.endMinutes - segment.startMinutes) / STRIP_DURATION_MINUTES) * 100;
        return (
          <span
            key={`${segment.startMinutes}-${segment.endMinutes}-${segment.state}`}
            data-occupancy-state={segment.state}
            className={cn('absolute inset-y-0', OCCUPANCY_STATE_CLASS[segment.state])}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}

export function ResourceOccupancyLegend() {
  return (
    <div
      data-testid="schedule-resource-occupancy-legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400"
    >
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        Available
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
        Booked
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
        Absent / off-shift
      </span>
    </div>
  );
}
