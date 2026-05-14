'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { formatDateTime } from '@/lib/utils/date';

const PRIMARY_CTA_BUTTON_CLASS = 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover font-semibold disabled:opacity-60';

export interface AdjustTimestampTarget {
  itemType: 'created' | 'status_event' | 'comment';
  timelineItemId: string;
  label: string;
  currentTimestamp: string;
}

function toLocalDateTimeInputValue(timestamp: string): string {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function toIsoTimestamp(inputValue: string): string {
  const parsed = new Date(inputValue);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Please provide a valid date and time.');
  }

  return parsed.toISOString();
}

interface AdjustTaskTimestampDialogProps {
  open: boolean;
  target: AdjustTimestampTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (nextTimestampIso: string) => Promise<void>;
}

export function AdjustTaskTimestampDialog({
  open,
  target,
  onOpenChange,
  onConfirm,
}: AdjustTaskTimestampDialogProps) {
  const { tabletModeEnabled } = useTabletMode();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) {
      setValue('');
      setError(null);
      setSubmitting(false);
      return;
    }

    setValue(toLocalDateTimeInputValue(target.currentTimestamp));
    setError(null);
    setSubmitting(false);
  }, [open, target]);

  const currentTimestampLabel = useMemo(() => {
    if (!target) {
      return '';
    }

    return formatDateTime(target.currentTimestamp);
  }, [target]);

  const handleConfirm = async () => {
    if (!target) {
      return;
    }

    if (!value) {
      setError('Please select a date and time.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onConfirm(toIsoTimestamp(value));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update timestamp.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!target) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className={`max-w-md ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}>
        <DialogHeader>
          <DialogTitle>Adjust Timestamp</DialogTitle>
          <DialogDescription>
            Update the saved timestamp for <span className="font-medium text-foreground">{target.label}</span>.
            This correction will be reflected anywhere this event is shown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Current timestamp</p>
            <p className="text-sm text-foreground">{currentTimestampLabel}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-task-timestamp">New date and time</Label>
            <Input
              id="adjust-task-timestamp"
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className={`${PRIMARY_CTA_BUTTON_CLASS}${tabletModeEnabled ? ' min-h-11 text-base px-4' : ''}`}
          >
            {submitting ? 'Saving...' : 'Save Timestamp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
