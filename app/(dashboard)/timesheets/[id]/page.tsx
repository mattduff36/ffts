'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTimesheetJobCodeOptions } from '@/lib/client/timesheet-job-codes';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Input } from '@/components/ui/input';
import { JobCodeFields } from '@/components/timesheets/JobCodeFields';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Save, Send, Edit2, CheckCircle2, XCircle, Download, Package, AlertTriangle, ArrowLeft, Moon } from 'lucide-react';
import Link from 'next/link';
import { BackButton } from '@/components/ui/back-button';
import { formatDate } from '@/lib/utils/date';
import { calculateStandardTimesheetHours, formatHours, roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';
import { DAY_NAMES, Timesheet, TimesheetEntry } from '@/types/timesheet';
import SignaturePad from '@/components/forms/SignaturePad';
import { Database } from '@/types/database';
import { TimesheetAdjustmentModal } from '@/components/timesheets/TimesheetAdjustmentModal';
import { TrainingDeclineDialog } from '@/app/(dashboard)/timesheets/components/TrainingDeclineDialog';
import { declineTrainingBookingsClient } from '@/lib/client/training-bookings';
import { toast } from 'sonner';
import { isNetworkFetchError } from '@/lib/utils/http-error';
import {
  type ApprovedAbsenceForTimesheet,
  type TimesheetOffDayState,
  getTimesheetWeekIsoBounds,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import { isPlantTimesheetV2, normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import {
  areCataloguedJobNumbers,
  formatEntryJobNumbers,
  getEntryJobNumbers,
  getNormalizedJobNumbers,
  getPrimaryJobNumber,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';
import {
  hasWorkedTimesForSubsistence,
  isSubsistencePaymentRequired,
  syncSubsistenceRemark,
} from '@/lib/utils/timesheet-subsistence';
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

export default function ViewTimesheetPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { options: jobCodeOptions, isLoading: jobCodeOptionsLoading } = useTimesheetJobCodeOptions();
  const cataloguedJobNumbers = useMemo(
    () => new Set(jobCodeOptions.map((option) => option.value)),
    [jobCodeOptions]
  );
  const supabase = createClient();
  
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [showProcessedDialog, setShowProcessedDialog] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionComments, setRejectionComments] = useState('');
  const [originalData, setOriginalData] = useState<{entries: TimesheetEntry[], regNumber: string | null} | null>(null);
  const [dataChanged, setDataChanged] = useState(false);
  const [manuallyEditedDays, setManuallyEditedDays] = useState<Set<number>>(new Set());
  const [offDayStates, setOffDayStates] = useState<TimesheetOffDayState[]>([]);
  const [trainingDeclineDayOfWeek, setTrainingDeclineDayOfWeek] = useState<number | null>(null);
  const [decliningTraining, setDecliningTraining] = useState(false);

  const getActionErrorMessage = (err: unknown, fallback: string) => {
    return err instanceof Error && err.message.trim().length > 0 ? err.message : fallback;
  };

  const isExpectedTimesheetActionError = (message: string) => {
    const normalized = message.trim().toLowerCase();
    return (
      normalized.includes('timesheet not found') ||
      normalized.includes('only submitted timesheets can be rejected') ||
      normalized.includes('only approved timesheets can be marked as adjusted')
    );
  };

  const getTrainingLabel = (dayOffState: TimesheetOffDayState | undefined): string =>
    dayOffState?.trainingDisplayRemarks || dayOffState?.trainingLabels[0]?.label || 'Training';

  const getPendingTrainingLabel = (dayOffState: TimesheetOffDayState | undefined): string =>
    dayOffState?.pendingTrainingDisplayRemarks || dayOffState?.pendingTrainingLabels[0]?.label || 'Training pending approval';

  const fetchTimesheet = useCallback(async (id: string) => {
    try {
      setError(''); // Clear any previous errors
      
      // Fetch timesheet
      const { data: timesheetData, error: timesheetError } = await supabase
        .from('timesheets')
        .select('*')
        .eq('id', id)
        .single();

      if (timesheetError) {
        if (timesheetError.code === 'PGRST116') {
          setTimesheet(null);
          setEntries([]);
          setOffDayStates([]);
          setSignature(null);
          setError('Timesheet not found. It may have been deleted.');
          setLoading(false);
          return;
        }
        throw timesheetError;
      }
      
      // Check if user has access
      if (!isManager && !isAdmin && !isSuperAdmin && timesheetData.user_id !== user?.id) {
        setTimesheet(null);
        setEntries([]);
        setOffDayStates([]);
        setSignature(null);
        setError('You do not have permission to view this timesheet');
        setLoading(false);
        return;
      }

      setTimesheet({
        ...timesheetData,
        status: timesheetData.status ?? 'draft',
        created_at: timesheetData.created_at ?? '',
        updated_at: timesheetData.updated_at ?? '',
      });
      setSignature(timesheetData.signature_data);

      // Fetch entries
      const { data: entriesData, error: entriesError } = await supabase
        .from('timesheet_entries')
        .select('*, timesheet_entry_job_codes(job_number, display_order)')
        .eq('timesheet_id', id)
        .order('day_of_week');

      if (entriesError) throw entriesError;

      const typedEntries = (entriesData || []) as TimesheetEntry[];

      // Create full week array (all 7 days)
      const fullWeek = Array.from({ length: 7 }, (_, i) => {
        const existingEntry = typedEntries.find((entry: TimesheetEntry) => entry.day_of_week === i + 1);
        return existingEntry || {
          day_of_week: i + 1,
          timesheet_id: id,
          job_number: null,
          job_numbers: [],
          did_not_work: false,
          time_started: null,
          time_finished: null,
          working_in_yard: false,
          subsistence_payment_required: false,
          daily_total: null,
          remarks: null,
        };
      });

      const normalizedWeek = fullWeek.map((entry) => ({
        ...entry,
        job_numbers: getEntryJobNumbers(entry),
        job_number: getPrimaryJobNumber(entry),
        subsistence_payment_required: isSubsistencePaymentRequired(entry),
      }));

      setEntries(normalizedWeek);

      try {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheetData.week_ending);
        const { data: absenceData, error: absenceError } = await supabase
          .from('absences')
          .select('id, date, end_date, status, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
          .eq('profile_id', timesheetData.user_id)
          .in('status', ['pending', 'approved', 'processed'])
          .lte('date', endIso);

        if (absenceError) throw absenceError;

        const approvedAbsences = ((absenceData || []) as ApprovedAbsenceForTimesheet[]).filter((row) => {
          const rowEnd = row.end_date || row.date;
          return row.date <= endIso && rowEnd >= startIso;
        });

        setOffDayStates(resolveTimesheetOffDayStates(timesheetData.week_ending, approvedAbsences, null));
      } catch (absenceLookupError) {
        console.warn('Failed to resolve leave state for timesheet details view:', absenceLookupError);
        setOffDayStates(resolveTimesheetOffDayStates(timesheetData.week_ending, [], null));
      }
      
      // Store original data if this is an approved timesheet (for change tracking)
      if (timesheetData.status === 'approved') {
        setOriginalData({
          entries: JSON.parse(JSON.stringify(normalizedWeek)),
          regNumber: timesheetData.reg_number
        });
      }
      
      // Enable editing for draft or rejected timesheets
      if (timesheetData.status === 'draft' || timesheetData.status === 'rejected') {
        setEditing(true);
      }
    } catch (err) {
      const errorContextId = 'timesheet-details-fetch-error';
      if (isNetworkFetchError(err)) {
        console.warn('Timesheet details temporarily unavailable:', err, { errorContextId });
      } else {
        console.error('Error fetching timesheet:', err, { errorContextId });
      }
      setError(err instanceof Error ? err.message : 'Failed to load timesheet');
    } finally {
      setLoading(false);
    }
  }, [supabase, isManager, isAdmin, isSuperAdmin, user]);

  useEffect(() => {
    if (params.id && !authLoading) {
      fetchTimesheet(params.id as string);
    }
  }, [params.id, authLoading, fetchTimesheet]);

  const isPlantV2Timesheet = isPlantTimesheetV2(timesheet);
  const displayEntries = useMemo(
    () => normalizeTimesheetEntriesForDisplay(timesheet, entries, offDayStates),
    [timesheet, entries, offDayStates]
  );

  const trimTrailingEmptyJobNumbers = (values: string[]): string[] => {
    const next = [...values];
    while (next.length > 0 && next[next.length - 1]?.trim() === '') {
      next.pop();
    }
    return next;
  };

  const getEditableJobNumbers = (entry: TimesheetEntry): string[] => (
    (entry.job_numbers?.length ?? 0) > 0 ? [...(entry.job_numbers || [])] : ['']
  );

  const handleJobNumberChange = (dayIndex: number, jobIndex: number, value: string) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers[jobIndex] = normalizeJobNumberInput(value);
    updateEntry(dayIndex, 'job_numbers', trimTrailingEmptyJobNumbers(nextJobNumbers));
  };

  const handleAddJobNumberField = (dayIndex: number) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers.push('');
    updateEntry(dayIndex, 'job_numbers', nextJobNumbers);
  };

  const handleRemoveJobNumberField = (dayIndex: number, jobIndex: number) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers.splice(jobIndex, 1);
    updateEntry(dayIndex, 'job_numbers', trimTrailingEmptyJobNumbers(nextJobNumbers));
  };

  const updateEntry = (dayIndex: number, field: string, value: string | boolean | number | null | string[]) => {
    const newEntries = [...entries];
    const currentEntry = newEntries[dayIndex];
    const normalizedValue =
      typeof value === 'string' && (field === 'time_started' || field === 'time_finished')
        ? roundTimeToNearestQuarterHour(value)
        : value;

    if (field === 'did_not_work') {
      const nextDidNotWork = Boolean(value);
      const nextRemarks =
        nextDidNotWork && (!currentEntry.remarks || currentEntry.remarks.trim().length === 0)
          ? 'Did Not Work'
          : currentEntry.remarks;

      newEntries[dayIndex] = {
        ...currentEntry,
        did_not_work: nextDidNotWork,
        time_started: nextDidNotWork ? null : currentEntry.time_started,
        time_finished: nextDidNotWork ? null : currentEntry.time_finished,
        job_number: nextDidNotWork ? null : currentEntry.job_number,
        job_numbers: nextDidNotWork ? [] : currentEntry.job_numbers,
        working_in_yard: nextDidNotWork ? false : currentEntry.working_in_yard,
        subsistence_payment_required: nextDidNotWork ? false : currentEntry.subsistence_payment_required,
        daily_total: nextDidNotWork ? 0 : currentEntry.daily_total,
        remarks: nextDidNotWork ? syncSubsistenceRemark(nextRemarks, false) : nextRemarks,
      };

      if (nextDidNotWork) {
        setManuallyEditedDays((prev) => {
          const next = new Set(prev);
          next.delete(dayIndex);
          return next;
        });
      }

      setEntries(newEntries);

      if (timesheet?.status === 'approved' && originalData) {
        setDataChanged(true);
      }
      return;
    }

    const nextEntry =
      field === 'job_numbers'
        ? {
            ...currentEntry,
            job_numbers: Array.isArray(normalizedValue) ? normalizedValue.map((jobNumber) => normalizeJobNumberInput(jobNumber)) : [],
            job_number: getPrimaryJobNumber(Array.isArray(normalizedValue) ? normalizedValue : []) || null,
          }
        : {
            ...currentEntry,
            [field]: normalizedValue,
          };

    if (field === 'working_in_yard' && value === true) {
      nextEntry.job_number = null;
      nextEntry.job_numbers = [];
    }

    if (field === 'subsistence_payment_required') {
      const isRequired = Boolean(value);
      nextEntry.subsistence_payment_required = isRequired;
      nextEntry.remarks = syncSubsistenceRemark(nextEntry.remarks, isRequired);
    }

    const hasMeaningfulValue =
      field === 'job_numbers'
        ? getNormalizedJobNumbers(Array.isArray(normalizedValue) ? normalizedValue : []).length > 0
        : normalizedValue !== null && normalizedValue !== false && normalizedValue !== '';

    if (
      (field === 'time_started' || field === 'time_finished' || field === 'job_number' || field === 'job_numbers' || field === 'working_in_yard') &&
      hasMeaningfulValue
    ) {
      nextEntry.did_not_work = false;
      if (nextEntry.remarks === 'Did Not Work') {
        nextEntry.remarks = null;
      }
    }

    newEntries[dayIndex] = nextEntry;

    // Auto-calculate daily total if both times are present
    if (field === 'time_started' || field === 'time_finished') {
      const entry = newEntries[dayIndex];
      newEntries[dayIndex].daily_total = calculateStandardTimesheetHours(entry.time_started, entry.time_finished);
      if (!hasWorkedTimesForSubsistence(newEntries[dayIndex])) {
        newEntries[dayIndex].subsistence_payment_required = false;
        newEntries[dayIndex].remarks = syncSubsistenceRemark(newEntries[dayIndex].remarks, false);
      }
      
      // Clear manual edit flag for this day when times change (recalculation)
      setManuallyEditedDays(prev => {
        const newSet = new Set(prev);
        newSet.delete(dayIndex);
        return newSet;
      });
    }

    // Handle manual daily_total edits
    if (field === 'daily_total') {
      // Mark this day as manually edited
      setManuallyEditedDays(prev => new Set(prev).add(dayIndex));
    }

    setEntries(newEntries);
    
    // Track if data has changed (for approved timesheets)
    if (timesheet?.status === 'approved' && originalData) {
      setDataChanged(true);
    }
  };

  const handleSubsistenceToggle = (dayIndex: number) => {
    const entry = entries[dayIndex];
    const nextValue = !entry.subsistence_payment_required;

    if (nextValue && !hasWorkedTimesForSubsistence(entry)) {
      toast.info('Enter start and finish times before adding subsistence.', {
        id: `timesheet-details-subsistence-blocked-${dayIndex}`,
        description: 'Use this when the worker stayed away overnight and needs subsistence payment.',
      });
      return;
    }

    updateEntry(dayIndex, 'subsistence_payment_required', nextValue);
    toast.success(nextValue ? 'Subsistence payment added' : 'Subsistence payment removed', {
      id: `timesheet-details-subsistence-toggle-${dayIndex}`,
      description: nextValue
        ? 'This day will be marked as stayed away for payroll.'
        : 'The stayed-away payroll marker has been removed for this day.',
    });
  };

  const leaveAwareTotals = useMemo(
    () => buildLeaveAwareTotals(displayEntries, offDayStates),
    [displayEntries, offDayStates]
  );
  const weeklyTotalMultiline = formatLeaveAwareWeeklyDisplayMultiline(
    leaveAwareTotals.weekly.workedHours,
    leaveAwareTotals.weekly.leaveDays
  );

  interface SaveTimesheetResult {
    success: boolean;
    errorMessage?: string;
  }

  const handleSave = async (): Promise<SaveTimesheetResult> => {
    if (!timesheet || !user) {
      return {
        success: false,
        errorMessage: 'Timesheet is not ready to save',
      };
    }

    setSaving(true);
    setError('');

    try {
      const entriesToPersist = normalizeTimesheetEntriesForDisplay(timesheet, entries, offDayStates);
      if (jobCodeOptionsLoading) {
        const errorMessage = 'Job codes are still loading. Please wait a moment, then try again.';
        setError(errorMessage);
        return {
          success: false,
          errorMessage,
        };
      }

      const invalidJobEntry = entriesToPersist.find((entry) => {
        const hasHours = Boolean(entry.time_started && entry.time_finished);
        if (!hasHours || entry.did_not_work || entry.working_in_yard) return false;

        return !areCataloguedJobNumbers(entry.job_numbers, cataloguedJobNumbers);
      });

      if (invalidJobEntry) {
        const errorMessage = `${DAY_NAMES[invalidJobEntry.day_of_week - 1]}: select at least one valid Job Number from the job-code list and do not repeat the same code on a single day.`;
        setError(errorMessage);
        return {
          success: false,
          errorMessage,
        };
      }

      // Update timesheet
      const { error: timesheetError } = await supabase
        .from('timesheets')
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (timesheetError) throw timesheetError;

      // Delete existing entries
      await supabase
        .from('timesheet_entries')
        .delete()
        .eq('timesheet_id', timesheet.id);

      // Insert updated entries, including did-not-work/yard rows
      type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
      const entriesToInsert: TimesheetEntryInsert[] = entriesToPersist
        .filter((entry) =>
          Boolean(
            entry.time_started ||
            entry.time_finished ||
            entry.remarks ||
            entry.did_not_work ||
            entry.working_in_yard ||
            entry.subsistence_payment_required ||
            entry.job_number ||
            entry.operator_travel_hours ||
            entry.operator_yard_hours ||
            entry.machine_travel_hours ||
            entry.machine_start_time ||
            entry.machine_finish_time ||
            entry.machine_standing_hours ||
            entry.machine_operator_hours ||
            entry.maintenance_breakdown_hours ||
            ((entry.daily_total || 0) > 0)
          )
        )
        .map((entry) => {
          const persistedJobNumbers = getNormalizedJobNumbers(entry.job_numbers);
          const normalizedRemarks =
            entry.remarks?.trim() ||
            (entry.did_not_work ? 'Did Not Work' : '');
          const requiresSubsistence =
            Boolean(entry.subsistence_payment_required) && hasWorkedTimesForSubsistence(entry);
          const persistedRemarks = syncSubsistenceRemark(normalizedRemarks, requiresSubsistence);

          return {
          timesheet_id: timesheet.id,
          day_of_week: entry.day_of_week,
          time_started: entry.time_started || null,
          time_finished: entry.time_finished || null,
          operator_travel_hours: entry.operator_travel_hours ?? null,
          operator_yard_hours: entry.operator_yard_hours ?? null,
          operator_working_hours: entry.operator_working_hours ?? null,
          machine_travel_hours: entry.machine_travel_hours ?? null,
          machine_start_time: entry.machine_start_time || null,
          machine_finish_time: entry.machine_finish_time || null,
          machine_working_hours: entry.machine_working_hours ?? null,
          machine_standing_hours: entry.machine_standing_hours ?? null,
          machine_operator_hours: entry.machine_operator_hours ?? null,
          maintenance_breakdown_hours: entry.maintenance_breakdown_hours ?? null,
          job_number: persistedJobNumbers[0] || null,
          did_not_work: entry.did_not_work,
          working_in_yard: entry.working_in_yard,
          subsistence_payment_required: requiresSubsistence,
          daily_total: entry.daily_total,
          night_shift: entry.night_shift ?? false,
          bank_holiday: entry.bank_holiday ?? false,
          remarks: persistedRemarks || null,
          };
        });

      if (entriesToInsert.length > 0) {
        const { data: insertedEntries, error: entriesError } = await supabase
          .from('timesheet_entries')
          .insert(entriesToInsert)
          .select('id, day_of_week');

        if (entriesError) throw entriesError;

        type TimesheetEntryJobCodeInsert = Database['public']['Tables']['timesheet_entry_job_codes']['Insert'];
        const entryIdByDay = new Map(
          (insertedEntries || []).map((entry) => [entry.day_of_week, entry.id] as const)
        );
        const jobCodesToInsert: TimesheetEntryJobCodeInsert[] = entriesToPersist.flatMap((entry) => {
          const entryId = entryIdByDay.get(entry.day_of_week);
          if (!entryId) return [];

          return getNormalizedJobNumbers(entry.job_numbers).map((jobNumber, displayOrder) => ({
            timesheet_entry_id: entryId,
            job_number: jobNumber,
            display_order: displayOrder,
          }));
        });

        if (jobCodesToInsert.length > 0) {
          const { error: jobCodesError } = await supabase
            .from('timesheet_entry_job_codes')
            .insert(jobCodesToInsert);

          if (jobCodesError) throw jobCodesError;
        }
      }

      // Refresh data
      await fetchTimesheet(timesheet.id);
      setEditing(false);
      return {
        success: true,
      };
    } catch (err) {
      const errorContextId = 'timesheet-details-save-error';
      console.error('Error saving timesheet:', err, { errorContextId });
      const errorMessage = err instanceof Error ? err.message : 'Failed to save timesheet';
      setError(errorMessage);
      toast.error(errorMessage, { id: errorContextId });
      return {
        success: false,
        errorMessage,
      };
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!timesheet || !user) return;
    
    if (!signature) {
      setShowSignaturePad(true);
      return;
    }

    try {
      // Save entries first
      const saveResult = await handleSave();
      if (!saveResult.success) {
        return;
      }

      setSaving(true);
      setError('');

      // Update timesheet status
      const { error: updateError } = await supabase
        .from('timesheets')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          signature_data: signature,
          signed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (updateError) throw updateError;

      router.push('/timesheets');
    } catch (err) {
      const errorContextId = 'timesheet-details-submit-error';
      console.error('Error submitting timesheet:', err, { errorContextId });
      setError(err instanceof Error ? err.message : 'Failed to submit timesheet');
      toast.error(err instanceof Error ? err.message : 'Failed to submit timesheet', { id: errorContextId });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!timesheet || (!isManager && !isAdmin && !isSuperAdmin)) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (error) throw error;
      
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!timesheet || (!isManager && !isAdmin && !isSuperAdmin)) return;
    if (rejectionComments.trim().length === 0) {
      toast.error('Please provide a reason for rejection', { id: 'timesheet-details-reject-validation-missing-reason' });
      return;
    }

    setSaving(true);
    setShowRejectDialog(false);
    
    try {
      // Call API endpoint to handle rejection with notifications
      const response = await fetch(`/api/timesheets/${timesheet.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comments: rejectionComments.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        const errorMessage = data?.error || 'Failed to reject timesheet';
        const rejectionErrorContextId = 'timesheet-details-reject-error';

        if (response.status === 404 && errorMessage === 'Timesheet not found') {
          setTimesheet(null);
          setEntries([]);
          setSignature(null);
          setError('Timesheet not found. It may have been deleted.');
          toast.error('Timesheet not found. It may have been deleted.', { id: rejectionErrorContextId });
          return;
        }

        throw new Error(errorMessage);
      }

      toast.success('Timesheet rejected and employee notified');
      setRejectionComments('');
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      const message = getActionErrorMessage(err, 'Failed to reject timesheet');
      const errorContextId = 'timesheet-details-reject-error';
      if (!isExpectedTimesheetActionError(message)) {
        console.error('Rejection error:', err, { errorContextId });
      }
      setError(message);
      toast.error(message, { id: errorContextId });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAsProcessed = async () => {
    if (!timesheet || (!isManager && !isAdmin && !isSuperAdmin)) return;

    setSaving(true);
    setShowProcessedDialog(false);
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (error) throw error;
      
      toast.success('Timesheet marked as Manager Approved');
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      const errorContextId = 'timesheet-details-mark-manager-approved-error';
      setError(err instanceof Error ? err.message : 'Failed to mark as Manager Approved');
      console.error('Error marking timesheet as Manager Approved:', err, { errorContextId });
      toast.error(err instanceof Error ? err.message : 'Failed to mark as Manager Approved', { id: errorContextId });
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async (selectedManagerIds: string[], comments: string) => {
    if (!timesheet || (!isManager && !isAdmin && !isSuperAdmin) || !user) return;

    try {
      // Save the entries first
      const saveResult = await handleSave();
      if (!saveResult.success) {
        if (saveResult.errorMessage) {
          toast.error(saveResult.errorMessage, { id: 'timesheet-details-adjust-save-validation' });
        }
        return;
      }

      // Call API endpoint to handle adjustment with notifications
      const response = await fetch(`/api/timesheets/${timesheet.id}/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comments,
          notifyManagerIds: selectedManagerIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to mark as adjusted');
      }

      toast.success('Timesheet marked as adjusted and notifications sent');
      setShowAdjustmentModal(false);
      setEditing(false);
      setDataChanged(false);
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      const errorContextId = 'timesheet-details-adjust-error';
      console.error('Adjustment error:', err, { errorContextId });
      toast.error(err instanceof Error ? err.message : 'Failed to mark as adjusted', { id: errorContextId });
      throw err; // Re-throw to let modal handle it
    }
  };

  const handleCancelTrainingDecline = () => {
    if (decliningTraining) return;
    setTrainingDeclineDayOfWeek(null);
  };

  const handleConfirmTrainingDecline = async () => {
    if (!timesheet || trainingDeclineDayOfWeek === null) return;
    const dayOffState = offDayStates.find((state) => state.day_of_week === trainingDeclineDayOfWeek);
    if (!dayOffState?.trainingAbsenceIds.length) {
      setTrainingDeclineDayOfWeek(null);
      return;
    }

    setDecliningTraining(true);
    try {
      const result = await declineTrainingBookingsClient({
        absenceIds: dayOffState.trainingAbsenceIds,
      });
      const returnedCount = result.returnedTimesheetIds?.length || 0;
      toast.success(
        returnedCount > 0
          ? 'Training booking removed and submitted timesheet returned for amendment.'
          : 'Training booking removed and notifications sent.'
      );
      setTrainingDeclineDayOfWeek(null);
      await fetchTimesheet(timesheet.id);
    } catch (trainingError) {
      const message =
        trainingError instanceof Error ? trainingError.message : 'Failed to remove training booking';
      toast.error(message);
    } finally {
      setDecliningTraining(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending Approval' },
      approved: { variant: 'success' as const, label: 'Payroll Received' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
      processed: { variant: 'default' as const, label: 'Manager Approved' },
      adjusted: { variant: 'default' as const, label: 'Adjusted' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    
    // Apply blue styling for final states (processed and adjusted)
    const isFinalState = status === 'processed' || status === 'adjusted';
    const blueClasses = isFinalState ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : '';
    
    return <Badge variant={config.variant} className={blueClasses}>{config.label}</Badge>;
  };

  if (authLoading || loading) {
    return <PageLoader message="Loading timesheet..." />;
  }

  if (error && !timesheet) {
    return (
      <div className="space-y-6">
        <Link href="/timesheets">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Timesheets
          </Button>
        </Link>
        <Card className="">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!timesheet) return null;

  const hasElevatedAccess = isManager || isAdmin || isSuperAdmin;
  const canEdit = editing && (timesheet.status === 'draft' || timesheet.status === 'rejected' || (hasElevatedAccess && timesheet.status === 'approved'));
  const canSubmit = timesheet.user_id === user?.id && (timesheet.status === 'draft' || timesheet.status === 'rejected');
  const canApprove = hasElevatedAccess && timesheet.status === 'submitted';
  const canMarkAsProcessed = hasElevatedAccess && timesheet.status === 'approved';
  const canEditApproved = hasElevatedAccess && timesheet.status === 'approved';
  const isEndState = timesheet.status === 'processed' || timesheet.status === 'adjusted';
  const trainingOffDayStates = offDayStates.filter(
    (state) => state.hasTrainingBooking || state.hasPendingTrainingBooking
  );
  const selectedTrainingDeclineState = trainingDeclineDayOfWeek === null
    ? undefined
    : offDayStates.find((state) => state.day_of_week === trainingDeclineDayOfWeek);
  const canDeclineTrainingFromDetails = !isEndState && (hasElevatedAccess || timesheet.user_id === user?.id);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {isPlantV2Timesheet ? 'Plant Timesheet' : 'Timesheet'}
              </h1>
              <p className="text-sm md:text-base text-muted-foreground">
                Week Ending {formatDate(timesheet.week_ending)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasElevatedAccess && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                  const pdfUrl = `/api/timesheets/${timesheet.id}/pdf`;
                  
                  if (isStandalone || isMobile) {
                    // Use in-app PDF viewer for PWA/mobile
                    router.push(`/pdf-viewer?url=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(`Timesheet-${timesheet.week_ending}`)}&return=${encodeURIComponent(`/timesheets/${timesheet.id}`)}`);
                  } else {
                    // Desktop: Open in new tab
                    window.open(pdfUrl, '_blank');
                  }
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Download PDF</span>
                <span className="sm:hidden">PDF</span>
              </Button>
            )}
            {getStatusBadge(timesheet.status)}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {timesheet.manager_comments && (
        <Card className="bg-white dark:bg-slate-900 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-400">Manager Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800 dark:text-amber-300">{timesheet.manager_comments}</p>
          </CardContent>
        </Card>
      )}

      {trainingOffDayStates.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="text-emerald-700 dark:text-emerald-300">Training Bookings</CardTitle>
            <CardDescription>
              Approved Training uses entered hours. Pending Training is shown for information only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {trainingOffDayStates.map((state) => (
              <div
                key={state.day_of_week}
                className="flex flex-col gap-3 rounded-md border border-border bg-white/60 p-3 dark:bg-slate-950/40 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-medium text-foreground">{DAY_NAMES[state.day_of_week - 1]}</p>
                  {state.hasTrainingBooking && (
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">{getTrainingLabel(state)}</p>
                  )}
                  {state.hasPendingTrainingBooking && (
                    <p className="text-sm text-sky-700 dark:text-sky-300">{getPendingTrainingLabel(state)}</p>
                  )}
                  {isEndState && state.hasTrainingBooking && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      This timesheet is locked, so Training is informational only.
                    </p>
                  )}
                </div>
                {state.hasTrainingBooking && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTrainingDeclineDayOfWeek(state.day_of_week)}
                    disabled={!canDeclineTrainingFromDetails || decliningTraining}
                    className="border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    Remove Training
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle>{isPlantV2Timesheet ? 'Plant Time Entries' : 'Time Entries'}</CardTitle>
              <CardDescription>
                {isPlantV2Timesheet
                  ? [
                      timesheet.reg_number ? `Machine: ${timesheet.reg_number}` : null,
                      timesheet.hirer_name ? `Hirer: ${timesheet.hirer_name}` : null,
                      timesheet.site_address ? `Site: ${timesheet.site_address}` : null,
                    ].filter(Boolean).join(' • ')
                  : (timesheet.reg_number ? `Registration: ${timesheet.reg_number}` : '')}
              </CardDescription>
            </div>
            {!editing && ((timesheet.status === 'draft' || timesheet.status === 'rejected') || canEditApproved) && !isEndState && (
              <Button variant="outline" onClick={() => setEditing(true)} className="w-full sm:w-auto">
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium">Day</th>
                  <th className="text-left p-2 font-medium">Time Started</th>
                  <th className="text-left p-2 font-medium">Time Finished</th>
                  {isPlantV2Timesheet && <th className="text-left p-2 font-medium">Travel Time</th>}
                  <th className="text-left p-2 font-medium">Job Number</th>
                  <th className="text-center p-2 font-medium">Did Not Work</th>
                  <th className="text-center p-2 font-medium">In Yard</th>
                  <th className="text-center p-2 font-medium">Subsistence</th>
                  <th className="text-right p-2 font-medium">Total Hours</th>
                  <th className="text-left p-2 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const displayEntry = displayEntries[index] || entry;
                  return (
                  <tr key={entry.day_of_week} className="border-b">
                    <td className="p-2 font-medium">{DAY_NAMES[index]}</td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_started || ''}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          disabled={entry.did_not_work}
                          className="w-32 text-slate-900"
                        />
                      ) : (
                        <span>{entry.time_started || '-'}</span>
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished || ''}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={entry.did_not_work}
                          className="w-32 text-slate-900"
                        />
                      ) : (
                        <span>{entry.time_finished || '-'}</span>
                      )}
                    </td>
                    {isPlantV2Timesheet && (
                      <td className="p-2">
                        <span>{displayEntry.operator_travel_hours != null ? `${formatHours(displayEntry.operator_travel_hours)}h` : '-'}</span>
                      </td>
                    )}
                    <td className="p-2">
                      {canEdit ? (
                        <JobCodeFields
                          values={entry.job_numbers || []}
                          onChange={(jobIndex, value) => handleJobNumberChange(index, jobIndex, value)}
                          onAdd={() => handleAddJobNumberField(index)}
                          onRemove={(jobIndex) => handleRemoveJobNumberField(index, jobIndex)}
                          disabled={entry.did_not_work || entry.working_in_yard}
                          placeholder={entry.working_in_yard ? 'YARD' : 'Job #'}
                          jobCodeOptions={jobCodeOptions}
                          jobCodeOptionsLoading={jobCodeOptionsLoading}
                          inputClassName="w-32 font-mono text-slate-900"
                        />
                      ) : (
                        <span className="text-sm font-mono">
                          {entry.working_in_yard ? 'YARD' : formatEntryJobNumbers(entry)}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          checked={entry.did_not_work}
                          onChange={(e) => updateEntry(index, 'did_not_work', e.target.checked)}
                          className="w-4 h-4"
                        />
                      ) : (
                        entry.did_not_work && <XCircle className="h-4 w-4 inline text-amber-600" />
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          checked={entry.working_in_yard}
                          onChange={(e) => updateEntry(index, 'working_in_yard', e.target.checked)}
                          disabled={entry.did_not_work}
                          className="w-4 h-4"
                        />
                      ) : (
                        entry.working_in_yard && <CheckCircle2 className="h-4 w-4 inline text-green-600" />
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          checked={Boolean(entry.subsistence_payment_required)}
                          onChange={() => handleSubsistenceToggle(index)}
                          disabled={entry.did_not_work}
                          className="w-4 h-4"
                          aria-label={`${DAY_NAMES[index]} subsistence payment required`}
                        />
                      ) : (
                        entry.subsistence_payment_required && <Moon className="h-4 w-4 inline text-emerald-600" />
                      )}
                    </td>
                    <td className="p-2 text-right font-semibold">
                      {canEdit && hasElevatedAccess && !leaveAwareTotals.rowByDay.get(entry.day_of_week)?.hasLeave && !isPlantV2Timesheet ? (
                        <Input
                          type="number"
                          step="0.25"
                          value={displayEntry.daily_total ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            updateEntry(index, 'daily_total', val);
                          }}
                          disabled={entry.did_not_work}
                          className={`w-24 text-right font-semibold ${
                            manuallyEditedDays.has(index) 
                              ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700' 
                              : ''
                          }`}
                        />
                      ) : (
                        <span className={manuallyEditedDays.has(index) ? 'text-blue-600 dark:text-blue-400' : ''}>
                          {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display || `${formatHours(displayEntry.daily_total)}h`}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          value={entry.remarks || ''}
                          onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                          placeholder="Notes"
                        />
                      ) : (
                        <span className="text-sm">{entry.remarks || (entry.did_not_work ? 'Did Not Work' : '-')}</span>
                      )}
                    </td>
                  </tr>
                )})}
                <tr className="bg-secondary/50 font-bold">
                  <td colSpan={isPlantV2Timesheet ? 8 : 7} className="p-2 text-right">
                    Weekly Total:
                  </td>
                  <td className="p-2 text-right text-lg whitespace-pre-line">
                    {weeklyTotalMultiline}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {entries.map((entry, index) => {
              const displayEntry = displayEntries[index] || entry;
              return (
              <Card key={entry.day_of_week}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{DAY_NAMES[index]}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Time Started</Label>
                      {canEdit ? (
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_started || ''}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          disabled={entry.did_not_work}
                        />
                      ) : (
                        <p className="text-sm">{entry.time_started || '-'}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Time Finished</Label>
                      {canEdit ? (
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished || ''}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={entry.did_not_work}
                        />
                      ) : (
                        <p className="text-sm">{entry.time_finished || '-'}</p>
                      )}
                    </div>
                  </div>
                  {isPlantV2Timesheet && (
                    <div className="space-y-1">
                      <Label className="text-xs">Travel Time</Label>
                      <p className="text-sm">
                        {displayEntry.operator_travel_hours != null ? `${formatHours(displayEntry.operator_travel_hours)}h` : '-'}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Job Number</Label>
                    {canEdit ? (
                      <JobCodeFields
                        values={entry.job_numbers || []}
                        onChange={(jobIndex, value) => handleJobNumberChange(index, jobIndex, value)}
                        onAdd={() => handleAddJobNumberField(index)}
                        onRemove={(jobIndex) => handleRemoveJobNumberField(index, jobIndex)}
                        disabled={entry.did_not_work || entry.working_in_yard}
                        placeholder={entry.working_in_yard ? 'YARD' : 'Job #'}
                        jobCodeOptions={jobCodeOptions}
                        jobCodeOptionsLoading={jobCodeOptionsLoading}
                        inputClassName="font-mono"
                      />
                    ) : (
                      <p className="text-sm font-mono">
                        {entry.working_in_yard ? 'YARD' : formatEntryJobNumbers(entry)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit ? (
                      <>
                        <input
                          type="checkbox"
                          id={`did-not-work-${index}`}
                          checked={entry.did_not_work}
                          onChange={(e) => updateEntry(index, 'did_not_work', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <Label htmlFor={`did-not-work-${index}`} className="text-sm">
                          Did Not Work
                        </Label>
                      </>
                    ) : (
                      entry.did_not_work && <span className="text-sm text-amber-600">Did Not Work</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit ? (
                      <>
                        <input
                          type="checkbox"
                          id={`yard-${index}`}
                          checked={entry.working_in_yard}
                          onChange={(e) => updateEntry(index, 'working_in_yard', e.target.checked)}
                          disabled={entry.did_not_work}
                          className="w-4 h-4"
                        />
                        <Label htmlFor={`yard-${index}`} className="text-sm">
                          Working in Yard
                        </Label>
                      </>
                    ) : (
                      entry.working_in_yard && <span className="text-sm text-green-600">✓ Working in Yard</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit ? (
                      <>
                        <input
                          type="checkbox"
                          id={`subsistence-${index}`}
                          checked={Boolean(entry.subsistence_payment_required)}
                          onChange={() => handleSubsistenceToggle(index)}
                          disabled={entry.did_not_work}
                          className="w-4 h-4"
                        />
                        <Label htmlFor={`subsistence-${index}`} className="text-sm">
                          Subsistence Payment
                        </Label>
                      </>
                    ) : (
                      entry.subsistence_payment_required && (
                        <span className="text-sm text-emerald-600">Subsistence Payment</span>
                      )
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Remarks</Label>
                    {canEdit ? (
                      <Input
                        value={entry.remarks || ''}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Any notes..."
                      />
                    ) : (
                      <p className="text-sm">{entry.remarks || (entry.did_not_work ? 'Did Not Work' : '-')}</p>
                    )}
                  </div>
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm font-medium">Daily Total:</span>
                      {canEdit && hasElevatedAccess && !leaveAwareTotals.rowByDay.get(entry.day_of_week)?.hasLeave && !isPlantV2Timesheet ? (
                        <Input
                          type="number"
                          step="0.25"
                          value={displayEntry.daily_total ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            updateEntry(index, 'daily_total', val);
                          }}
                          disabled={entry.did_not_work}
                          className={`w-24 text-right text-lg font-bold ${
                            manuallyEditedDays.has(index) 
                              ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700' 
                              : ''
                          }`}
                        />
                      ) : (
                        <span className={`text-lg font-bold ${manuallyEditedDays.has(index) ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                          {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display || `${formatHours(displayEntry.daily_total)}h`}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )})}

            <Card className="bg-primary text-primary-foreground">
              <CardContent className="pt-6">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">Weekly Total:</span>
                  <span className="text-2xl font-bold text-right whitespace-pre-line">
                    {weeklyTotalMultiline}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Signature Section */}
          {(signature || showSignaturePad) && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Employee Signature</h3>
              {signature && !showSignaturePad ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signature} alt="Signature" className="border rounded p-2 bg-white max-w-md" />
                  <p className="text-xs text-muted-foreground">
                    Signed on {timesheet.signed_at ? formatDate(timesheet.signed_at) : 'Unknown'}
                  </p>
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => setShowSignaturePad(true)}>
                      Update Signature
                    </Button>
                  )}
                </div>
              ) : showSignaturePad && (
                <SignaturePad
                  onSave={(sig) => {
                    setSignature(sig);
                    setShowSignaturePad(false);
                  }}
                  onCancel={() => setShowSignaturePad(false)}
                />
              )}
            </div>
          )}

          {/* Confirmation Text */}
          <div className="p-4 bg-secondary/50 rounded-md text-sm">
            <p className="italic">
              All time and other details are correct and should be used as a basis for wages etc.
            </p>
          </div>

          {/* Warning for payroll-received timesheet editing */}
          {editing && timesheet.status === 'approved' && dataChanged && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    Editing Payroll Received Timesheet
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                    You are editing a payroll received timesheet. When you finish, you must add a comment and mark it as &ldquo;Adjusted&rdquo; to notify the employee and selected managers.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            {/* Save button for draft/rejected/approved editing */}
            {canEdit && (
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}

            {/* Mark as Adjusted button (for managers editing approved timesheets) */}
            {editing && timesheet.status === 'approved' && dataChanged && hasElevatedAccess && (
              <Button
                variant="outline"
                onClick={() => setShowAdjustmentModal(true)}
                disabled={saving}
                className="border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white active:scale-95 transition-all"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Mark as Adjusted
              </Button>
            )}
            
            {/* Submit button for employees */}
            {canSubmit && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            )}

            {/* Approve/Reject buttons for pending timesheets */}
            {canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={saving}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  variant="outline"
                  onClick={handleApprove}
                  disabled={saving}
                  className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}

            {/* Mark as Manager Approved button (only if NOT editing) */}
            {canMarkAsProcessed && !editing && (
              <Button
                variant="outline"
                onClick={() => setShowProcessedDialog(true)}
                disabled={saving}
                className="border-timesheet/50 text-timesheet hover:bg-timesheet hover:text-white hover:border-timesheet active:bg-timesheet-dark active:scale-95 transition-all"
              >
                <Package className="h-4 w-4 mr-2" />
                Mark as Manager Approved
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mark as Manager Approved confirmation dialog */}
      <AlertDialog open={showProcessedDialog} onOpenChange={setShowProcessedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Timesheet as Manager Approved</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this timesheet as Manager Approved?
              <br />
              <br />
              <strong>Warning:</strong> Once marked as Manager Approved, this action cannot be undone. This indicates that the timesheet has been sent to payroll for payment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkAsProcessed}
              disabled={saving}
              className="bg-timesheet hover:bg-timesheet-dark focus:ring-timesheet"
            >
              {saving ? 'Updating...' : 'Mark as Manager Approved'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejection Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Timesheet</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this timesheet. The employee will be notified via email and in-app notification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Label htmlFor="rejection-comments" className="text-sm font-medium">
              Rejection Reason <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="rejection-comments"
              placeholder="Explain why this timesheet is being rejected..."
              value={rejectionComments}
              onChange={(e) => setRejectionComments(e.target.value)}
              disabled={saving}
              rows={4}
              className="resize-none bg-slate-800 border-slate-700 focus:border-slate-500 dark:text-slate-100 text-slate-900"
              required
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} onClick={() => setRejectionComments('')} className="border-slate-700 hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={saving || rejectionComments.trim().length === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600 border-0"
            >
              {saving ? 'Rejecting...' : 'Reject Timesheet'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Adjustment Modal */}
      {timesheet && (
        <TimesheetAdjustmentModal
          open={showAdjustmentModal}
          onClose={() => setShowAdjustmentModal(false)}
          onConfirm={handleAdjust}
          employeeName={(timesheet as Timesheet & { profile?: { full_name?: string | null } }).profile?.full_name || 'Employee'}
          weekEnding={formatDate(timesheet.week_ending)}
        />
      )}

      <TrainingDeclineDialog
        open={trainingDeclineDayOfWeek !== null}
        dayLabel={trainingDeclineDayOfWeek === null ? '' : DAY_NAMES[trainingDeclineDayOfWeek - 1]}
        trainingLabel={getTrainingLabel(selectedTrainingDeclineState)}
        pending={decliningTraining}
        onCancel={handleCancelTrainingDecline}
        onConfirm={handleConfirmTrainingDecline}
      />
    </div>
  );
}

