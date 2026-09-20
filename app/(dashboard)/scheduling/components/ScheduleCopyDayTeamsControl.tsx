'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { subDays, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatScheduleDate } from '@/lib/utils/scheduling';
import { cn } from '@/lib/utils/cn';
import { schedulingControlStyles } from './scheduling-control-styles';

function previousWorkDate(workDate: string) {
  return formatScheduleDate(subDays(parseISO(workDate), 1));
}

export function ScheduleCopyDayTeamsControl({
  selectedDate,
  copying = false,
  onCopy,
}: {
  selectedDate: string;
  copying?: boolean;
  onCopy: (fromDate: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(previousWorkDate(selectedDate));

  useEffect(() => {
    setFromDate(previousWorkDate(selectedDate));
  }, [selectedDate]);

  const canCopy = Boolean(fromDate) && fromDate !== selectedDate && !copying;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn('h-7 gap-1.5 px-2 text-xs', schedulingControlStyles.outline)}
          aria-label="Copy team buckets from a previous date"
          data-testid="schedule-copy-day-teams-button"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy teams
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-72 space-y-3 p-3"
        data-testid="schedule-copy-day-teams-popover"
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-100">Copy team buckets</p>
          <p className="text-xs text-slate-300">
            Add the selected date’s crews to this day. Standing team leaders stay in Settings.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="schedule-copy-day-teams-date" className="text-xs text-slate-200">
            Copy from
          </Label>
          <Input
            id="schedule-copy-day-teams-date"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            data-testid="schedule-copy-day-teams-date"
            className="h-8"
          />
        </div>
        <Button
          type="button"
          size="sm"
          className={cn('h-8 w-full', schedulingControlStyles.primary)}
          disabled={!canCopy}
          data-testid="schedule-copy-day-teams-confirm"
          onClick={async () => {
            if (!canCopy) return;
            await onCopy(fromDate);
            setOpen(false);
          }}
        >
          {copying ? 'Copying…' : 'Copy teams'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
