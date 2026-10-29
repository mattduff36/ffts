'use client';

import { useMemo, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT,
  SCHEDULE_DAY_TEAM_SLOT_INDEXES,
  SCHEDULE_DAY_TEAM_MIN_VISIBLE_SLOT_COUNT,
  extraSlotHasDailyMembers,
} from '@/lib/utils/scheduling-day-teams';
import { formatScheduleTeamName } from '@/lib/utils/scheduling';
import type {
  ScheduleDayTeams,
  ScheduleEmployeeResource,
  ScheduleTeamSettings,
} from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

const NONE_VALUE = '__none__';

export function ScheduleTeamSettingsDialog({
  open,
  onOpenChange,
  employees,
  settings,
  dayTeams,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: ScheduleEmployeeResource[];
  settings: ScheduleTeamSettings;
  dayTeams: ScheduleDayTeams[];
  saving: boolean;
  onSave: (input: {
    visible_slot_count: number;
    leaders: Array<{ slot_index: number; profile_id: string | null }>;
    names: Record<string, string>;
  }) => void;
}) {
  const [visibleSlotCount, setVisibleSlotCount] = useState(settings.visible_slot_count);
  const [leaderIds, setLeaderIds] = useState<Array<string | null>>(() =>
    SCHEDULE_DAY_TEAM_SLOT_INDEXES.map(slot => settings.leaders.find(leader => leader.slot_index === slot)?.profile_id || null)
  );
  const [names, setNames] = useState<Record<string, string>>(settings.names || {});
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setVisibleSlotCount(settings.visible_slot_count);
      setLeaderIds(SCHEDULE_DAY_TEAM_SLOT_INDEXES.map(slot =>
        settings.leaders.find(leader => leader.slot_index === slot)?.profile_id || null
      ));
      setNames(settings.names || {});
    }
  }
  const visibleSlots = SCHEDULE_DAY_TEAM_SLOT_INDEXES.slice(0, visibleSlotCount);

  const lastExtraHasMembers = useMemo(
    () => extraSlotHasDailyMembers({ day_teams: dayTeams }, visibleSlotCount),
    [dayTeams, visibleSlotCount]
  );

  function leaderOptions(slotIndex: number) {
    const taken = new Set(
      leaderIds
        .map((id, index) => (index === slotIndex - 1 ? null : id))
        .filter((id): id is string => Boolean(id))
    );
    return employees.filter((employee) => !taken.has(employee.id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" data-testid="schedule-team-settings-dialog">
        <DialogHeader>
          <DialogTitle>Scheduling settings</DialogTitle>
          <DialogDescription>
            Set team names and leaders. Eight teams are shown by default; add up to sixteen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid max-h-[55dvh] gap-3 overflow-y-auto p-1 sm:grid-cols-2">
            {visibleSlots.map((slotIndex) => {
              const selectedId = leaderIds[slotIndex - 1];
              const selected = employees.find((employee) => employee.id === selectedId);
              return (
                <div key={slotIndex} className="space-y-1.5 rounded-md border border-border p-3">
                  <Label htmlFor={`schedule-team-name-${slotIndex}`}>Team {slotIndex} name</Label>
                  <Input
                    id={`schedule-team-name-${slotIndex}`}
                    value={names[String(slotIndex)] || ''}
                    maxLength={80}
                    placeholder={formatScheduleTeamName(selected?.full_name, slotIndex)}
                    onChange={event => setNames(current => ({ ...current, [slotIndex]: event.target.value }))}
                    disabled={saving}
                  />
                  <Label htmlFor={`schedule-team-leader-${slotIndex}`}>
                    Team {slotIndex} leader
                  </Label>
                  <Select
                    value={selectedId || NONE_VALUE}
                    onValueChange={(value) => {
                      setLeaderIds((current) => current.map((id, index) =>
                        index === slotIndex - 1 ? (value === NONE_VALUE ? null : value) : id
                      ));
                    }}
                  >
                    <SelectTrigger
                      id={`schedule-team-leader-${slotIndex}`}
                      data-testid={`schedule-team-leader-${slotIndex}`}
                    >
                      <SelectValue placeholder="No leader" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No leader</SelectItem>
                      {leaderOptions(slotIndex).map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {formatScheduleTeamName(selected?.full_name, slotIndex)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Visible teams</p>
              <p className="text-xs text-muted-foreground">
                {visibleSlotCount} of {SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT}. Names apply across all dates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className={schedulingControlStyles.outline}
                disabled={
                  saving || visibleSlotCount <= SCHEDULE_DAY_TEAM_MIN_VISIBLE_SLOT_COUNT
                  || lastExtraHasMembers
                }
                onClick={() => {
                  setLeaderIds(current => current.map((id, index) => index === visibleSlotCount - 1 ? null : id));
                  setVisibleSlotCount(count => count - 1);
                }}
                data-testid="schedule-team-remove-extra"
              >
                <Minus className="h-4 w-4" />
                Remove extra
              </Button>
              <Button
                type="button"
                variant="outline"
                className={schedulingControlStyles.outline}
                disabled={saving || visibleSlotCount >= SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT}
                onClick={() => setVisibleSlotCount((count) => count + 1)}
                data-testid="schedule-team-add-extra"
              >
                <Plus className="h-4 w-4" />
                Add team
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={schedulingControlStyles.outline}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className={schedulingControlStyles.primary}
            disabled={saving}
            data-testid="schedule-team-settings-save"
            onClick={() => {
              onSave({
                visible_slot_count: visibleSlotCount,
                names: Object.fromEntries(visibleSlots.map(slot => [String(slot), (names[String(slot)] || '').trim()])),
                leaders: visibleSlots.map((slotIndex) => ({
                  slot_index: slotIndex,
                  profile_id: leaderIds[slotIndex - 1],
                })),
              });
            }}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
