'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, AlertCircle, CheckCircle2, User } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getWeekEnding, formatDateISO, getWeekEndingSundayOptions } from '@/lib/utils/date';
import { Employee } from '@/types/common';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';

interface WeekSelectorProps {
  targetUserId: string;
  onWeekSelected: (weekEnding: string, existingTimesheetId: string | null) => void;
  initialWeek?: string | null;
  canSelectEmployee?: boolean;
  employees?: Employee[];
  selectedEmployeeId?: string;
  onSelectedEmployeeChange?: (employeeId: string) => void;
}

interface ExistingTimesheetSummary {
  id: string;
  status: string;
}

function normalizeExistingTimesheetSummary(row: { id: string; status: string | null }): ExistingTimesheetSummary {
  return {
    id: row.id,
    status: row.status ?? 'draft',
  };
}

function isEditableExistingStatus(status: string): boolean {
  return status === 'draft' || status === 'rejected';
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function WeekSelector({
  targetUserId,
  onWeekSelected,
  initialWeek,
  canSelectEmployee = false,
  employees = [],
  selectedEmployeeId = '',
  onSelectedEmployeeChange,
}: WeekSelectorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedDate, setSelectedDate] = useState(initialWeek || '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [existingTimesheet, setExistingTimesheet] = useState<{ id: string; status: string } | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [existingWeekMap, setExistingWeekMap] = useState<Record<string, ExistingTimesheetSummary>>({});
  const weekOptions = useMemo(() => getWeekEndingSundayOptions(), []);
  const weekEndingDates = useMemo(() => weekOptions.map((option) => option.isoDate), [weekOptions]);

  // Auto-suggest next Sunday as default
  useEffect(() => {
    if (weekOptions.length === 0) return;

    if (!initialWeek && (!selectedDate || !weekEndingDates.includes(selectedDate))) {
      const defaultWeek = formatDateISO(getWeekEnding());
      const fallbackWeek = weekEndingDates.includes(defaultWeek) ? defaultWeek : weekOptions[0].isoDate;
      setSelectedDate(fallbackWeek);
    }
  }, [initialWeek, selectedDate, weekEndingDates, weekOptions]);

  // Switching the target employee must clear stale validation state
  // from a previously checked employee/week combination.
  useEffect(() => {
    setError('');
    setExistingTimesheet(null);
    setShowSuccess(false);
    setExistingWeekMap({});
  }, [targetUserId]);

  useEffect(() => {
    if (!targetUserId || weekEndingDates.length === 0) return;

    let cancelled = false;

    const loadExistingWeeks = async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('timesheets')
          .select('id, week_ending, status')
          .eq('user_id', targetUserId)
          .in('week_ending', weekEndingDates);

        if (queryError) throw queryError;
        if (cancelled) return;

        const nextWeekMap: Record<string, ExistingTimesheetSummary> = {};
        for (const row of (data || []) as Array<{ id: string; week_ending: string; status: string | null }>) {
          nextWeekMap[row.week_ending] = normalizeExistingTimesheetSummary(row);
        }

        setExistingWeekMap(nextWeekMap);
        setSelectedDate((current) => {
          if (!current) return current;
          const selectedWeek = nextWeekMap[current];
          if (!selectedWeek || isEditableExistingStatus(selectedWeek.status)) return current;

          const fallback = weekEndingDates.find((weekEnding) => {
            const existing = nextWeekMap[weekEnding];
            return !existing || isEditableExistingStatus(existing.status);
          });
          return fallback || current;
        });
      } catch (fetchError) {
        if (!isAuthErrorStatus(getErrorStatus(fetchError)) && !isNetworkFetchError(fetchError)) {
          console.error('Error preloading existing timesheet weeks:', fetchError);
        }
      }
    };

    void loadExistingWeeks();

    return () => {
      cancelled = true;
    };
  }, [supabase, targetUserId, weekEndingDates]);

  const selectedWeekSummary = selectedDate ? existingWeekMap[selectedDate] || null : null;
  const isSelectedWeekLocked = Boolean(
    selectedWeekSummary && !isEditableExistingStatus(selectedWeekSummary.status)
  );
  const weekOptionsWithStatus = useMemo(
    () =>
      weekOptions.map((option) => {
        const existing = existingWeekMap[option.isoDate];
        return {
          ...option,
          status: existing?.status || null,
          disabled: Boolean(existing && !isEditableExistingStatus(existing.status)),
        };
      }),
    [weekOptions, existingWeekMap]
  );

  // Check if a date is a Sunday
  const isSunday = (dateString: string): boolean => {
    if (!dateString) return false;
    const date = new Date(dateString + 'T00:00:00');
    return date.getDay() === 0;
  };

  // Handle date change
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setError('');
    setExistingTimesheet(null);
    setShowSuccess(false);
  };

  // Check for existing timesheet and proceed
  const handleProceed = async () => {
    setError('');
    setExistingTimesheet(null);
    setShowSuccess(false);

    // Validate date is selected
    if (!selectedDate) {
      setError('Please select a week ending date');
      return;
    }

    if (!targetUserId) {
      setError('Please select an employee first');
      return;
    }

    if (isSelectedWeekLocked && selectedWeekSummary) {
      setExistingTimesheet(selectedWeekSummary);
      setError(
        `You already have a ${selectedWeekSummary.status} timesheet for this week. You cannot create another timesheet for the same week.`
      );
      return;
    }

    // Validate date is a Sunday
    if (!isSunday(selectedDate)) {
      setError('Week ending must be a Sunday. Please select a Sunday date.');
      return;
    }

    setChecking(true);

    try {
      // Check for existing timesheet for this week
      const { data: existing, error: queryError } = await supabase
        .from('timesheets')
        .select('id, status')
        .eq('user_id', targetUserId)
        .eq('week_ending', selectedDate)
        .maybeSingle();

      if (queryError) throw queryError;

      if (existing) {
        const existingSummary = normalizeExistingTimesheetSummary(existing);
        // Timesheet exists for this week
        if (isEditableExistingStatus(existingSummary.status)) {
          // Can edit this timesheet
          setExistingTimesheet(existingSummary);
          setError('');
          setShowSuccess(true);
          
          // Auto-proceed to edit after showing message
          setTimeout(() => {
            onWeekSelected(selectedDate, existing.id);
          }, 1000);
        } else {
          // Timesheet is submitted/approved - cannot edit
          setExistingTimesheet(existingSummary);
          setError(`You already have a ${existingSummary.status} timesheet for this week. You cannot create another timesheet for the same week.`);
        }
      } else {
        // No existing timesheet - can create new
        setShowSuccess(true);
        setTimeout(() => {
          onWeekSelected(selectedDate, null);
        }, 500);
      }
    } catch (err) {
      const isNetworkFailure = isNetworkFetchError(err);
      if (!isAuthErrorStatus(getErrorStatus(err)) && !isNetworkFailure) {
        console.error('Error checking for existing timesheet:', err);
      }
      if (isNetworkFailure) {
        setError('Connection problem while checking existing timesheets. Please check your connection and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to check for existing timesheets');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card className="">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 shrink-0 rounded-full bg-timesheet/10 flex items-center justify-center">
              <Calendar className="h-6 w-6 text-timesheet" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-2xl text-foreground">Select Week Ending Date</CardTitle>
              <CardDescription className="text-muted-foreground">
                Choose the Sunday for the week you want to record
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date Picker */}
          {canSelectEmployee && (
            <div className="space-y-2">
              <Label htmlFor="employee" className="text-foreground text-lg flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating timesheet for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={(value) => onSelectedEmployeeChange?.(value)}>
                <SelectTrigger id="employee" className="h-12 text-base bg-white dark:bg-slate-900 border-border text-foreground">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.has_module_access === false ? ' - No Timesheets access' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="week-ending" className="text-foreground text-lg">
              Week Ending Date (Sunday)
            </Label>
            <Select value={selectedDate} onValueChange={handleDateChange}>
              <SelectTrigger
                id="week-ending"
                aria-label="Week Ending Date (Sunday)"
                className="h-auto min-h-16 py-3 text-xl bg-white dark:bg-slate-900 border-border text-foreground sm:text-2xl"
              >
                <SelectValue placeholder="Select week ending Sunday" />
              </SelectTrigger>
              <SelectContent>
                {weekOptionsWithStatus.map((option) => (
                  <SelectItem
                    key={option.isoDate}
                    value={option.isoDate}
                    disabled={option.disabled}
                  >
                    {option.status
                      ? `${option.label} (${formatStatusLabel(option.status)})`
                      : option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-base text-muted-foreground dark:text-muted-foreground">
              Choose from the last 3, current, and next 2 Sunday week-ending dates.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-400">
                {error}
                {existingTimesheet && existingTimesheet.status !== 'draft' && existingTimesheet.status !== 'rejected' && (
                  <div className="mt-2">
                    <Link href="/timesheets">
                      <Button variant="outline" size="sm" className="text-xs">
                        View Existing Timesheets
                      </Button>
                    </Link>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert (editing existing) */}
          {showSuccess && existingTimesheet && (
            <Alert className="bg-blue-500/10 border-blue-500/50">
              <CheckCircle2 className="h-4 w-4 text-blue-400" />
              <AlertDescription className="text-blue-400">
                Found existing draft timesheet. Loading it for editing...
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert (new timesheet) */}
          {showSuccess && !existingTimesheet && (
            <Alert className="bg-green-500/10 border-green-500/50">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-400">
                Week validated! Loading timesheet form...
              </AlertDescription>
            </Alert>
          )}

          {/* Continue Button */}
          <Button
            onClick={handleProceed}
            disabled={!selectedDate || !targetUserId || checking || showSuccess}
            className="w-full h-14 text-lg bg-timesheet hover:bg-timesheet-dark text-white font-semibold"
          >
            {checking ? (
              'Checking...'
            ) : showSuccess ? (
              'Loading...'
            ) : (
              'Continue to Timesheet'
            )}
          </Button>

          {/* Info Box */}
          <div className="bg-slate-100 dark:bg-slate-800/50 border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2 text-sm">Quick Tips:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Week ending date must always be a Sunday</li>
              <li>• You can only have one timesheet per week</li>
              <li>• Draft and rejected timesheets can be edited</li>
              <li>• Submitted and approved timesheets cannot be changed</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
