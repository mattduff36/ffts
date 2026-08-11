'use client';

import { useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import type { ScheduleQuoteInput } from '@/lib/client/scheduling';
import type { ScheduleJob } from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface ScheduleQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob;
  initialInput?: ScheduleQuoteInput | null;
  onSubmit: (input: ScheduleQuoteInput) => void;
}

export function ScheduleQuoteDialog({
  open,
  onOpenChange,
  job,
  initialInput = null,
  onSubmit,
}: ScheduleQuoteDialogProps) {
  const [startDate, setStartDate] = useState(
    initialInput?.start_date || job.start_date
  );
  const [endDate, setEndDate] = useState(
    initialInput?.end_date || job.end_date
  );
  const [isSaving, setIsSaving] = useState(false);

  function handleSave() {
    if (!job.quote_id || !startDate || !endDate || isSaving) return;
    if (endDate < startDate) {
      toast.error('End date must be on or after the start date.');
      return;
    }

    onSubmit({
      quote_id: job.quote_id,
      start_date: startDate,
      end_date: endDate,
    });
    setIsSaving(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
        <DialogHeader>
          <DialogTitle>Reschedule Quote job</DialogTitle>
          <DialogDescription>
            Set the planning window here. The Quote remains the source of truth and its
            workflow status will not change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="rounded-lg border border-scheduling/40 bg-scheduling-soft p-4">
            <p className="text-sm font-semibold text-foreground">{job.job_reference}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {job.customer_name ? `${job.customer_name} · ` : ''}{job.title}
            </p>
          </div>

          <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-quote-start">Start date</Label>
              <Input
                id="schedule-quote-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-quote-end">End date</Label>
              <Input
                id="schedule-quote-end"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className={schedulingControlStyles.outline} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!job.quote_id || !startDate || !endDate || isSaving}
            className={schedulingControlStyles.primary}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" />
            )}
            Update schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
