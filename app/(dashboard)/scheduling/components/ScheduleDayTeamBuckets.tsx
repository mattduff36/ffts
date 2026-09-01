'use client';

import { GripVertical, X } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import {
  SCHEDULE_DAY_TEAM_SLOT_CAPACITY,
  SCHEDULE_DAY_TEAM_SLOT_INDEXES,
} from '@/lib/utils/scheduling-day-teams';
import { formatScheduleEmployeeCompactName } from '@/lib/utils/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';
import type { ScheduleDayTeamSlot, ScheduleDayTeamSlotIndex } from '@/types/scheduling';

export interface ScheduleDayTeamDragData {
  workDate: string;
  slotIndex: ScheduleDayTeamSlotIndex;
}

function DayTeamSlotCard({
  slot,
  workDate,
  dndScope,
  onRemoveMember,
}: {
  slot: ScheduleDayTeamSlot;
  workDate: string;
  dndScope: 'desktop' | 'mobile';
  onRemoveMember: (slotIndex: ScheduleDayTeamSlotIndex, profileId: string) => void;
}) {
  const droppableId = `${dndScope}:day-team-slot:${workDate}:${slot.slot_index}`;
  const draggableId = `${dndScope}:day-team:${workDate}:${slot.slot_index}`;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: droppableId,
    type: 'schedule-day-team-slot',
    accept: ['schedule-resource'],
    data: {
      dayTeamSlotIndex: slot.slot_index,
      workDate,
    },
  });
  const { ref: dragRef, handleRef, isDragging } = useDraggable({
    id: draggableId,
    type: 'schedule-day-team',
    disabled: slot.members.length === 0,
    data: {
      dayTeam: {
        workDate,
        slotIndex: slot.slot_index,
      } satisfies ScheduleDayTeamDragData,
    },
  });

  return (
    <div
      ref={(node) => {
        dropRef(node);
        dragRef(node);
      }}
      data-testid={`schedule-day-team-slot-${dndScope}-${slot.slot_index}`}
      className={cn(
        'min-w-0 rounded-lg border border-border bg-card/80 p-2',
        isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling',
        isDragging && 'opacity-40'
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <button
          ref={handleRef}
          type="button"
          disabled={slot.members.length === 0}
          className={cn(
            'flex min-w-0 items-center gap-1 rounded text-left text-xs font-semibold text-foreground',
            slot.members.length > 0
              ? 'cursor-grab touch-none active:cursor-grabbing'
              : 'cursor-default text-muted-foreground'
          )}
          style={slot.members.length > 0 ? { touchAction: 'none' } : undefined}
          data-testid={`schedule-day-team-drag-handle-${dndScope}-${slot.slot_index}`}
          aria-label={
            slot.members.length > 0
              ? `Drag Team ${slot.slot_index} onto a timed visit`
              : `Team ${slot.slot_index} is empty`
          }
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>Team {slot.slot_index}</span>
        </button>
        <span className="text-[11px] text-muted-foreground">
          {slot.members.length}/{SCHEDULE_DAY_TEAM_SLOT_CAPACITY}
        </span>
      </div>
      <div className="flex min-h-8 flex-wrap gap-1">
        {slot.members.length === 0 ? (
          <p className="px-0.5 text-[11px] leading-4 text-muted-foreground">
            Drop employees here
          </p>
        ) : (
          slot.members.map((member) => {
            const fullName = member.employee?.full_name || 'Employee';
            return (
              <span
                key={member.profile_id}
                className={cn(
                  'inline-flex max-w-full items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                  schedulingControlStyles.sourceBadge
                )}
                data-testid={`schedule-day-team-member-${dndScope}-${member.profile_id}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate">
                      {formatScheduleEmployeeCompactName(fullName)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{fullName}</TooltipContent>
                </Tooltip>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${fullName} from Team ${slot.slot_index}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveMember(slot.slot_index, member.profile_id);
                  }}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ScheduleDayTeamBuckets({
  workDate,
  slots,
  dndScope,
  onRemoveMember,
}: {
  workDate: string;
  slots: ScheduleDayTeamSlot[];
  dndScope: 'desktop' | 'mobile';
  onRemoveMember: (slotIndex: ScheduleDayTeamSlotIndex, profileId: string) => void;
}) {
  const resolvedSlots = SCHEDULE_DAY_TEAM_SLOT_INDEXES.map((slotIndex) =>
    slots.find((slot) => slot.slot_index === slotIndex) || {
      work_date: workDate,
      slot_index: slotIndex,
      members: [],
    }
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="grid w-full gap-2 sm:grid-cols-3"
        data-testid={`schedule-day-team-buckets-${dndScope}`}
        aria-label="Day team buckets"
      >
        {resolvedSlots.map((slot) => (
          <DayTeamSlotCard
            key={slot.slot_index}
            slot={slot}
            workDate={workDate}
            dndScope={dndScope}
            onRemoveMember={onRemoveMember}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
