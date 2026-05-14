'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProcessTimesheetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  processing: boolean;
}

export function ProcessTimesheetModal({
  open,
  onOpenChange,
  onConfirm,
  processing,
}: ProcessTimesheetModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white dark:bg-slate-900 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Mark Timesheet as Manager Approved</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground space-y-2">
            <span className="block">
              Are you sure you want to mark this timesheet as Manager Approved?
            </span>
            <span className="block text-sm">
              <strong>Warning:</strong> Once marked as Manager Approved, this action cannot be undone.
              This indicates that the timesheet has been sent to payroll for payment.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={processing}
            className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
          >
            {processing ? 'Updating...' : 'Mark as Manager Approved'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
