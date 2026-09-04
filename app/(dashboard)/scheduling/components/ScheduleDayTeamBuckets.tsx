'use client';

import { X } from 'lucide-react';
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
  buildScheduleDayTeams,
  defaultScheduleTeamSettings,
} from '@/lib/utils/scheduling-day-teams';
import { formatScheduleEmployeeCompactName, formatScheduleTeamName } from '@/lib/utils/scheduling';
import type { ScheduleOccupancySegment } from '@/types/scheduling';
import type { ScheduleDayTeamSlot, ScheduleDayTeamSlotIndex, ScheduleTeamSettings } from '@/types/scheduling';
import { ResourceDragCue, ScheduleResourceCardShell } from './ScheduleResourceCard';
import { schedulingControlStyles } from './scheduling-control-styles';

export interface ScheduleDayTeamDragData {
  workDate: string;
  slotIndex: ScheduleDayTeamSlotIndex;
}

function DayTeamSlotCard({
  slot,
  workDate,
  dndScope,
  teamName,
  occupancySegments,
  onRemoveMember,
}: {
  slot: ScheduleDayTeamSlot;
  workDate: string;
  dndScope: 'desktop' | 'mobile';
  teamName: string;
  occupancySegments?: ScheduleOccupancySegment[];
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
  const tint = schedulingControlStyles.dayTeamTints[slot.slot_index - 1]
    || schedulingControlStyles.resourceEmployee;

  return (
    <div
      ref={(node) => {
        dropRef(node);
        dragRef(node);
      }}
      data-testid={`schedule-day-team-slot-${dndScope}-${slot.slot_index}`}
    >
      <ScheduleResourceCardShell
        tintClassName={tint}
        occupancySegments={occupancySegments}
        occupancyResourceId={`day-team-${slot.slot_index}`}
        className={cn(
          'min-h-11 items-stretch p-0',
          isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling',
          isDragging && 'opacity-40'
        )}
      >
        <button
          ref={handleRef}
          type="button"
          disabled={slot.members.length === 0}
          className={cn(
            'flex min-h-11 min-w-11 touch-none items-center justify-center self-stretch',
            slot.members.length > 0
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default'
          )}
          style={slot.members.length > 0 ? { touchAction: 'none' } : undefined}
          data-testid={`schedule-day-team-drag-handle-${dndScope}-${slot.slot_index}`}
          aria-label={
            slot.members.length > 0
              ? `Drag ${teamName} onto a timed visit`
              : `${teamName} is empty`
          }
        >
          <ResourceDragCue testId={`schedule-day-team-drag-cue-${slot.slot_index}`} />
        </button>
        <div className="min-w-0 flex-1 space-y-1 p-2 pl-0">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-sm font-semibold text-slate-100" title={teamName}>
              {teamName}
            </span>
            <span className="text-[11px] text-slate-300">
              {slot.members.length}/{SCHEDULE_DAY_TEAM_SLOT_CAPACITY}
            </span>
          </div>
          <div className="flex min-h-5 flex-wrap gap-1">
            {slot.members.length === 0 ? (
              <p className="px-0.5 text-[11px] leading-4 text-slate-300">
                Drop employees here
              </p>
            ) : (
              slot.members.map((member) => {
                const fullName = member.employee?.full_name || 'Employee';
                const compact = formatScheduleEmployeeCompactName(fullName);
                return (
                  <span
                    key={member.profile_id}
                    className={cn(
                      'inline-flex max-w-full items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                      schedulingControlStyles.sourceBadge
                    )}
                    data-testid={`schedule-day-team-member-${dndScope}-${member.profile_id}`}
                    data-leader={member.is_leader ? 'true' : 'false'}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate">{compact}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {member.is_leader ? `${fullName} (team leader)` : fullName}
                      </TooltipContent>
                    </Tooltip>
                    {member.is_leader ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${fullName} from ${teamName}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onRemoveMember(slot.slot_index, member.profile_id);
                        }}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </ScheduleResourceCardShell>
    </div>
  );
}

export function ScheduleDayTeamBuckets({
  workDate,
  slots,
  dndScope,
  teamSettings,
  occupancyBySlot,
  onRemoveMember,
}: {
  workDate: string;
  slots: ScheduleDayTeamSlot[];
  dndScope: 'desktop' | 'mobile';
  teamSettings?: ScheduleTeamSettings;
  occupancyBySlot?: Partial<Record<ScheduleDayTeamSlotIndex, ScheduleOccupancySegment[]>>;
  onRemoveMember: (slotIndex: ScheduleDayTeamSlotIndex, profileId: string) => void;
}) {
  const settings = teamSettings || defaultScheduleTeamSettings();
  const resolvedSlots = buildScheduleDayTeams(
    [workDate],
    slots.flatMap((slot) => slot.members).filter((member) => member.is_leader !== true),
    settings
  )[0].slots;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="grid w-full grid-cols-5 gap-2"
        data-testid={`schedule-day-team-buckets-${dndScope}`}
        aria-label="Day team buckets"
      >
        {resolvedSlots.map((slot) => {
          const leader = settings.leaders.find((item) => item.slot_index === slot.slot_index);
          return (
            <DayTeamSlotCard
              key={slot.slot_index}
              slot={slot}
              workDate={workDate}
              dndScope={dndScope}
              teamName={formatScheduleTeamName(leader?.employee?.full_name, slot.slot_index)}
              occupancySegments={occupancyBySlot?.[slot.slot_index]}
              onRemoveMember={onRemoveMember}
            />
          );
        })}
      </div>
    </TooltipProvider>
  );
}
