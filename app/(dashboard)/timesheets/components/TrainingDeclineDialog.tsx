'use client';

import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const LARGE_DESTRUCTIVE_BUTTON_CLASSNAME =
  'flex h-20 w-full items-center justify-center rounded-lg border-2 border-red-500 bg-red-500/20 px-4 py-5 text-lg font-semibold text-red-100 shadow-lg shadow-red-500/20 transition-all hover:bg-red-500/30 hover:text-red-50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/30 disabled:text-muted-foreground disabled:opacity-50 disabled:shadow-none';
const COMPACT_CANCEL_BUTTON_CLASSNAME =
  'mx-auto flex h-14 w-auto items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800/30 px-8 text-lg font-semibold text-foreground shadow-sm transition-all hover:bg-slate-800/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30';

interface TrainingDeclineDialogProps {
  open: boolean;
  dayLabel: string;
  trainingLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function TrainingDeclineDialog({
  open,
  dayLabel,
  trainingLabel,
  pending,
  onCancel,
  onConfirm,
}: TrainingDeclineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && !nextOpen && onCancel()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto border-border bg-white dark:bg-slate-900">
        <DialogHeader className="space-y-2 text-center">
          <DialogTitle className="text-2xl font-bold leading-tight text-foreground">Remove Training Booking?</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-muted-foreground">
            {dayLabel} is currently marked as {trainingLabel}. If you confirm that you did not attend,
            the linked training booking will be deleted and your team manager plus Sarah Hubbard will be
            notified.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={onCancel}
            disabled={pending}
          >
            <XCircle className="h-5 w-5" aria-hidden="true" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={LARGE_DESTRUCTIVE_BUTTON_CLASSNAME}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Removing...' : 'Confirm Did Not Attend'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
