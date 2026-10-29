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
  resolveScheduleDayTeamName,
} from '@/lib/utils/scheduling-day-teams';
import { formatScheduleEmployeeCompactName } from '@/lib/utils/scheduling';
import type { ScheduleOccupancySegment } from '@/types/scheduling';
import type {
  ScheduleDayTeamPlant,
  ScheduleDayTeamSlot,
  ScheduleDayTeamSlotIndex,
  ScheduleTeamSettings,
} from '@/types/scheduling';
import { ResourceDragCue, ScheduleResourceCardShell } from './ScheduleResourceCard';
import { schedulingControlStyles } from './scheduling-control-styles';
import { scheduleTeamColour } from './ScheduleTeamColours';

export interface ScheduleDayTeamDragData {
  workDate: string;
  slotIndex: ScheduleDayTeamSlotIndex;
}

function slotHasResources(slot: ScheduleDayTeamSlot): boolean {
  return slot.members.length > 0 || (slot.plants?.length || 0) > 0;
}

function plantChipLabel(plant: ScheduleDayTeamPlant): string {
  return plant.plant?.nickname || plant.plant?.plant_id || 'Plant';
}

function DayTeamSlotCard({
  slot,
  workDate,
  dndScope,
  teamName,
  occupancySegments,
  onRemoveMember,
  onRemovePlant,
}: {
  slot: ScheduleDayTeamSlot;
  workDate: string;
  dndScope: 'desktop' | 'mobile';
  teamName: string;
  occupancySegments?: ScheduleOccupancySegment[];
  onRemoveMember: (slotIndex: ScheduleDayTeamSlotIndex, profileId: string) => void;
  onRemovePlant: (slotIndex: ScheduleDayTeamSlotIndex, plantId: string) => void;
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
    disabled: !slotHasResources(slot),
    data: {
      dayTeam: {
        workDate,
        slotIndex: slot.slot_index,
      } satisfies ScheduleDayTeamDragData,
    },
  });
  const colour = scheduleTeamColour(slot.slot_index);
  const tint = `${colour.tint} shadow-sm hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current`;

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
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: colour.accent }} />
        <button
          ref={handleRef}
          type="button"
          disabled={!slotHasResources(slot)}
          className={cn(
            'flex min-h-11 min-w-11 touch-none items-center justify-center self-stretch',
            slotHasResources(slot)
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default'
          )}
          style={slotHasResources(slot) ? { touchAction: 'none' } : undefined}
          data-testid={`schedule-day-team-drag-handle-${dndScope}-${slot.slot_index}`}
          aria-label={
            slotHasResources(slot)
              ? `Drag ${teamName} onto a timed visit`
              : `${teamName} is empty`
          }
        >
          <ResourceDragCue testId={`schedule-day-team-drag-cue-${slot.slot_index}`} />
        </button>
        <div className="min-w-0 flex-1 space-y-1 p-2 pl-0">
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-slate-950"
              style={{ backgroundColor: colour.accent }} aria-label={`Team bucket ${slot.slot_index}`}>
              {slot.slot_index}
            </span>
            <span className="truncate text-sm font-semibold text-slate-100" title={teamName}>
              {teamName}
            </span>
            <span className="text-[11px] text-slate-300">
              {slot.members.length}/{SCHEDULE_DAY_TEAM_SLOT_CAPACITY}
            </span>
          </div>
          <div className="flex min-h-5 flex-wrap gap-1">
            {slot.members.length === 0 && (slot.plants?.length || 0) === 0 ? (
              <p className="px-0.5 text-[11px] leading-4 text-slate-300">
                Drop employees or plant here
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
            {(slot.plants || []).map((plant) => {
              const label = plantChipLabel(plant);
              return (
                <span
                  key={plant.plant_id}
                  className={cn(
                    'inline-flex max-w-full items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                    schedulingControlStyles.sourceBadge
                  )}
                  data-testid={`schedule-day-team-plant-${dndScope}-${plant.plant_id}`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate">{label}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {plant.plant?.plant_id ? `${label} (${plant.plant.plant_id})` : label}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${label} from ${teamName}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemovePlant(slot.slot_index, plant.plant_id);
                    }}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </span>
              );
            })}
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
  onRemovePlant,
}: {
  workDate: string;
  slots: ScheduleDayTeamSlot[];
  dndScope: 'desktop' | 'mobile';
  teamSettings?: ScheduleTeamSettings;
  occupancyBySlot?: Partial<Record<ScheduleDayTeamSlotIndex, ScheduleOccupancySegment[]>>;
  onRemoveMember: (slotIndex: ScheduleDayTeamSlotIndex, profileId: string) => void;
  onRemovePlant: (slotIndex: ScheduleDayTeamSlotIndex, plantId: string) => void;
}) {
  const settings = teamSettings || defaultScheduleTeamSettings();
  const resolvedSlots = buildScheduleDayTeams(
    [workDate],
    slots.flatMap((slot) => slot.members).filter((member) => member.is_leader !== true),
    settings,
    slots.flatMap((slot) => slot.plants || [])
  )[0].slots;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8"
        data-testid={`schedule-day-team-buckets-${dndScope}`}
        aria-label="Day team buckets"
      >
        {resolvedSlots.map((slot) => (
          <DayTeamSlotCard
            key={slot.slot_index}
            slot={slot}
            workDate={workDate}
            dndScope={dndScope}
            teamName={resolveScheduleDayTeamName(slot, settings)}
            occupancySegments={occupancyBySlot?.[slot.slot_index]}
            onRemoveMember={onRemoveMember}
            onRemovePlant={onRemovePlant}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
