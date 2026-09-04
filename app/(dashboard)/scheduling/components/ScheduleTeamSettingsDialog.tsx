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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT,
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
  }) => void;
}) {
  const [visibleSlotCount, setVisibleSlotCount] = useState(settings.visible_slot_count);
  const [leaderIds, setLeaderIds] = useState<Array<string | null>>([null, null, null, null, null]);
  const settingsKey = `${open}:${settings.visible_slot_count}:${settings.updated_at || ''}:${settings.leaders
    .map((leader) => `${leader.slot_index}:${leader.profile_id}`)
    .join(',')}`;
  const [syncedKey, setSyncedKey] = useState(settingsKey);
  if (open && syncedKey !== settingsKey) {
    setSyncedKey(settingsKey);
    setVisibleSlotCount(settings.visible_slot_count);
    setLeaderIds([1, 2, 3, 4, 5].map((slotIndex) =>
      settings.leaders.find((leader) => leader.slot_index === slotIndex)?.profile_id || null
    ));
  }

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
      <DialogContent className="max-w-lg" data-testid="schedule-team-settings-dialog">
        <DialogHeader>
          <DialogTitle>Scheduling settings</DialogTitle>
          <DialogDescription>
            Set the five main team leaders and how many team buckets appear on the daily board.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((slotIndex) => {
              const selectedId = leaderIds[slotIndex - 1];
              const selected = employees.find((employee) => employee.id === selectedId);
              return (
                <div key={slotIndex} className="space-y-1.5">
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
                {visibleSlotCount} of {SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT}. Extra teams stay unnamed.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className={schedulingControlStyles.outline}
                disabled={
                  visibleSlotCount <= SCHEDULE_DAY_TEAM_MIN_VISIBLE_SLOT_COUNT
                  || lastExtraHasMembers
                }
                onClick={() => setVisibleSlotCount((count) => count - 1)}
                data-testid="schedule-team-remove-extra"
              >
                <Minus className="h-4 w-4" />
                Remove extra
              </Button>
              <Button
                type="button"
                variant="outline"
                className={schedulingControlStyles.outline}
                disabled={visibleSlotCount >= SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT}
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
                leaders: [1, 2, 3, 4, 5].map((slotIndex) => ({
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
