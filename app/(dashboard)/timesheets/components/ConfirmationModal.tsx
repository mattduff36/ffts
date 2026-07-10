'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Calendar, 
  Briefcase, 
  Home, 
  Moon,
  XCircle
} from 'lucide-react';
import { DAY_NAMES } from '@/types/timesheet';
import { formatHours } from '@/lib/utils/time-calculations';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import { collectUniqueJobNumbers, getEntryJobNumbers } from '@/lib/utils/timesheet-job-codes';

interface TimesheetEntry {
  day_of_week: number;
  time_started: string;
  time_finished: string;
  job_number: string;
  job_numbers?: string[];
  working_in_yard: boolean;
  subsistence_payment_required?: boolean;
  did_not_work: boolean;
  daily_total: number | null;
  remarks: string;
  night_shift?: boolean;
  bank_holiday?: boolean;
}

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  weekEnding: string;
  entries: TimesheetEntry[];
  offDayStates?: TimesheetOffDayState[];
  regNumber: string;
  submitting: boolean;
}

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  weekEnding,
  entries,
  offDayStates = [],
  regNumber,
  submitting,
}: ConfirmationModalProps) {
  const leaveAwareTotals = buildLeaveAwareTotals(entries, offDayStates);
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));
  const weeklyTotalMultiline = formatLeaveAwareWeeklyDisplayMultiline(
    leaveAwareTotals.weekly.workedHours,
    leaveAwareTotals.weekly.leaveDays
  );
  const rawTotalHours = entries.reduce((sum, entry) => sum + (entry.daily_total || 0), 0);
  const daysWorked = entries.filter((entry) => {
    const row = leaveAwareTotals.rowByDay.get(entry.day_of_week);
    return !entry.did_not_work && (row?.workedHours || 0) > 0;
  }).length;
  const subsistenceDays = entries.filter(
    (entry) => entry.subsistence_payment_required && !entry.did_not_work
  ).length;
  const daysCoveredByWorkOrLeave = entries.filter((entry) => {
    const row = leaveAwareTotals.rowByDay.get(entry.day_of_week);
    return !entry.did_not_work && (((row?.workedHours || 0) > 0) || Boolean(row?.hasLeave));
  }).length;
  const uniqueJobNumbers = collectUniqueJobNumbers(entries, {
    excludeDidNotWork: true,
    excludeWorkingInYard: true,
  });
  const daysWithMissingJobs = entries.filter(
    entry =>
      !entry.did_not_work &&
      !entry.working_in_yard &&
      !offDayByDay.get(entry.day_of_week)?.hasTrainingBooking &&
      getEntryJobNumbers(entry).length === 0
  ).length;

  // Generate warnings (Q9 requirements)
  const warnings: string[] = [];
  if (rawTotalHours > 60) warnings.push('Total hours exceed 60 hours - please verify all entries');
  if (rawTotalHours < 10) warnings.push('Total hours are less than 10 - please ensure this is correct');
  if (daysCoveredByWorkOrLeave === 0) warnings.push('No working days recorded - is this correct?');
  if (daysWithMissingJobs > 0) warnings.push(`${daysWithMissingJobs} day(s) missing job numbers`);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !submitting && !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-border">
        <DialogHeader>
          <DialogTitle className="text-2xl text-foreground">Confirm Timesheet Submission</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Please review your timesheet carefully before submitting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date Confirmation (Q9 requirement) */}
          <Alert className="bg-blue-500/10 border-blue-500/50">
            <Calendar className="h-4 w-4 text-blue-400" />
            <AlertDescription className="text-blue-600 dark:text-blue-400">
              <span className="font-semibold">Week Ending:</span> {formatDate(weekEnding)}
              <br />
              <span className="text-sm">Please confirm this is the correct week before submitting.</span>
            </AlertDescription>
          </Alert>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Total Hours */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Weekly Total</p>
              </div>
              <p className="text-xl font-bold text-foreground whitespace-pre-line">{weeklyTotalMultiline}</p>
            </div>

            {/* Days Worked */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Days Worked</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{daysWorked} / 7</p>
            </div>

            {/* Job Numbers */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Job Numbers</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{uniqueJobNumbers.length}</p>
            </div>

            {/* Vehicle */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Vehicle Reg</p>
              </div>
              <p className="text-lg font-bold text-foreground">{regNumber || 'N/A'}</p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Moon className="h-4 w-4 text-emerald-500" />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Subsistence</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{subsistenceDays}</p>
            </div>
          </div>

          {/* Warnings (Q9 requirements) */}
          {warnings.length > 0 && (
            <Alert className="bg-amber-500/10 border-amber-500/50">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-600 dark:text-amber-400">
                <p className="font-semibold mb-2">Please Review:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Day-by-Day Breakdown */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground">Daily Breakdown</h3>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {entries.map((entry, index) => {
                const rowTotal = leaveAwareTotals.rowByDay.get(entry.day_of_week);
                const dayOffState = offDayByDay.get(entry.day_of_week);
                const hasWork = (rowTotal?.workedHours || 0) > 0;
                return (
                  <div 
                    key={index} 
                    className={`p-4 ${!hasWork && !entry.did_not_work ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-foreground w-24">{DAY_NAMES[index]}</span>
                          
                          {entry.did_not_work ? (
                            <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-700">
                              <XCircle className="h-3 w-3 mr-1" />
                              Did Not Work
                            </Badge>
                          ) : (
                            <>
                              <span className="text-sm text-muted-foreground">
                                {entry.time_started && entry.time_finished
                                  ? `${entry.time_started} - ${entry.time_finished}`
                                  : 'No times'}
                              </span>
                              <span className="font-semibold text-foreground">
                                {rowTotal?.display || `${formatHours(entry.daily_total)}h`}
                              </span>
                            </>
                          )}
                        </div>
                        
                        {/* Additional Info */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {getEntryJobNumbers(entry).map((jobNumber) => (
                            <span
                              key={`${entry.day_of_week}-${jobNumber}`}
                              className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded"
                            >
                              Job: {jobNumber}
                            </span>
                          ))}
                          {entry.working_in_yard && (
                            <Badge variant="secondary" className="text-xs">
                              <Home className="h-3 w-3 mr-1" />
                              Yard Work
                            </Badge>
                          )}
                          {entry.subsistence_payment_required && !entry.did_not_work && (
                            <Badge className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                              <Moon className="h-3 w-3 mr-1" />
                              Subsistence
                            </Badge>
                          )}
                          {dayOffState?.hasTrainingBooking && (
                            <Badge variant="secondary" className="text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              Training
                            </Badge>
                          )}
                          {entry.night_shift && (
                            <Badge className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                              Night Shift
                            </Badge>
                          )}
                          {entry.bank_holiday && (
                            <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                              Bank Holiday
                            </Badge>
                          )}
                          {entry.remarks && (
                            <span className="text-xs text-muted-foreground dark:text-muted-foreground italic">
                              Note: {entry.remarks}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-slate-100 dark:bg-slate-800/50 border border-border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              By confirming, you certify that all times and details are correct and should be used for payroll purposes.
              Once submitted, this timesheet will be sent to your manager for approval.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="border-border"
          >
            Go Back to Edit
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
            className="bg-timesheet hover:bg-timesheet-dark text-white font-semibold"
          >
            {submitting ? 'Submitting...' : 'Confirm Submission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
