'use client';

import { useEffect, useMemo, useState } from 'react';

import { fetchEmployeeWorkShift } from '@/lib/client/work-shifts';
import { useUpdateAbsence } from '@/lib/hooks/useAbsence';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage, shouldLogAbsenceManageError } from '@/lib/utils/absence-error-handling';
import { calculateDurationDays } from '@/lib/utils/date';
import {
  buildAbsenceTimesheetImpactMessage,
  getLockedAbsenceTimesheetImpacts,
  resolveAbsenceTimesheetImpacts,
} from '@/lib/utils/absence-timesheet-impact';
import type { AbsenceReason, AbsenceUpdate, AbsenceWithRelations } from '@/types/absence';
import type { WorkShiftPattern } from '@/types/work-shifts';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { toast } from 'sonner';

const ANNUAL_LEAVE_REASON_NAME = 'annual leave';

export type AbsenceEditDialogMode = 'full' | 'override-only';

function normalizeReasonName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function buildAbsenceEditDirtySnapshot({
  startDate,
  endDate,
  reasonId,
  isHalfDay,
  halfDaySession,
  notes,
  allowTimesheetWorkOnLeave,
}: {
  startDate: string;
  endDate: string;
  reasonId: string;
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM';
  notes: string;
  allowTimesheetWorkOnLeave: boolean;
}) {
  return JSON.stringify({
    startDate,
    endDate,
    reasonId,
    isHalfDay,
    halfDaySession,
    notes,
    allowTimesheetWorkOnLeave,
  });
}

interface AbsenceEditDialogProps {
  absence: AbsenceWithRelations | null;
  reasons: AbsenceReason[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: AbsenceEditDialogMode;
}

export function AbsenceEditDialog({
  absence,
  reasons,
  open,
  onOpenChange,
  mode = 'full',
}: AbsenceEditDialogProps) {
  const updateAbsence = useUpdateAbsence();
  const supabase = useMemo(() => createClient(), []);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [notes, setNotes] = useState('');
  const [allowTimesheetWorkOnLeave, setAllowTimesheetWorkOnLeave] = useState(false);
  const [workShiftPattern, setWorkShiftPattern] = useState<WorkShiftPattern | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [initialDirtySnapshot, setInitialDirtySnapshot] = useState('');
  const currentDirtySnapshot = buildAbsenceEditDirtySnapshot({
    startDate,
    endDate,
    reasonId,
    isHalfDay,
    halfDaySession,
    notes,
    allowTimesheetWorkOnLeave,
  });
  const isFormDirty = open && Boolean(initialDirtySnapshot) && currentDirtySnapshot !== initialDirtySnapshot;
  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handleEscapeKeyDown,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: submitting,
    onOpenChange,
  });

  useEffect(() => {
    if (!absence || !open) {
      return;
    }

    const nextStartDate = absence.date;
    const nextEndDate = absence.end_date || '';
    const nextReasonId = absence.reason_id;
    const nextIsHalfDay = Boolean(absence.is_half_day);
    const nextHalfDaySession = absence.half_day_session || 'AM';
    const nextNotes = absence.notes || '';
    const nextAllowTimesheetWorkOnLeave = Boolean(absence.allow_timesheet_work_on_leave);

    setStartDate(nextStartDate);
    setEndDate(nextEndDate);
    setReasonId(nextReasonId);
    setIsHalfDay(nextIsHalfDay);
    setHalfDaySession(nextHalfDaySession);
    setNotes(nextNotes);
    setAllowTimesheetWorkOnLeave(nextAllowTimesheetWorkOnLeave);
    setInitialDirtySnapshot(buildAbsenceEditDirtySnapshot({
      startDate: nextStartDate,
      endDate: nextEndDate,
      reasonId: nextReasonId,
      isHalfDay: nextIsHalfDay,
      halfDaySession: nextHalfDaySession,
      notes: nextNotes,
      allowTimesheetWorkOnLeave: nextAllowTimesheetWorkOnLeave,
    }));
  }, [absence, open]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkShift() {
      if (!absence || !open) {
        return;
      }

      try {
        const payload = await fetchEmployeeWorkShift(absence.profile_id);
        if (!cancelled) {
          setWorkShiftPattern(payload.pattern);
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to load employee work shift');
        if (shouldLogAbsenceManageError(error)) {
          console.error('Error loading employee work shift for absence edit:', error);
        } else {
          console.warn('Skipping employee work shift load for absence edit:', message);
        }
        if (!cancelled) {
          setWorkShiftPattern(undefined);
        }
      }
    }

    void loadWorkShift();
    return () => {
      cancelled = true;
    };
  }, [absence, open]);

  const editableReasons = useMemo(
    () => reasons.filter((reason) => reason.is_active || reason.id === absence?.reason_id),
    [reasons, absence?.reason_id]
  );

  const selectedReasonName = useMemo(() => {
    if (reasonId) {
      const selectedReason = editableReasons.find((reason) => reason.id === reasonId);
      if (selectedReason?.name) {
        return selectedReason.name;
      }
    }
    return absence?.absence_reasons.name || '';
  }, [reasonId, editableReasons, absence?.absence_reasons.name]);

  const canUseTimesheetWorkOverride =
    normalizeReasonName(selectedReasonName) === ANNUAL_LEAVE_REASON_NAME;

  useEffect(() => {
    if (!canUseTimesheetWorkOverride && allowTimesheetWorkOnLeave) {
      setAllowTimesheetWorkOnLeave(false);
    }
  }, [canUseTimesheetWorkOverride, allowTimesheetWorkOnLeave]);

  const duration = useMemo(() => {
    if (!startDate) {
      return 0;
    }

    return calculateDurationDays(
      new Date(`${startDate}T00:00:00`),
      endDate ? new Date(`${endDate}T00:00:00`) : null,
      isHalfDay,
      {
        pattern: workShiftPattern,
        halfDaySession,
      }
    );
  }, [startDate, endDate, isHalfDay, workShiftPattern, halfDaySession]);

  async function handleSubmit() {
    if (!absence) {
      return;
    }

    if (mode !== 'override-only' && (!startDate || !reasonId)) {
      toast.error('Please complete the required fields');
      return;
    }

    if (mode !== 'override-only' && isHalfDay && endDate && endDate !== startDate) {
      toast.error('Half-day absences must be a single day');
      return;
    }

    const updates: AbsenceUpdate =
      mode === 'override-only'
        ? {
            allow_timesheet_work_on_leave: canUseTimesheetWorkOverride ? allowTimesheetWorkOnLeave : false,
          }
        : {
            date: startDate,
            end_date: isHalfDay ? null : endDate || null,
            reason_id: reasonId,
            is_half_day: isHalfDay,
            half_day_session: isHalfDay ? halfDaySession : null,
            notes: notes.trim() || null,
            allow_timesheet_work_on_leave: canUseTimesheetWorkOverride ? allowTimesheetWorkOnLeave : false,
          };

    setSubmitting(true);
    try {
      if (mode !== 'override-only' && selectedReasonName) {
        const impacts = await resolveAbsenceTimesheetImpacts(supabase, {
          profileId: absence.profile_id,
          startDate,
          endDate: isHalfDay ? null : endDate || null,
          isHalfDay,
        });
        const message = buildAbsenceTimesheetImpactMessage(selectedReasonName, impacts);
        if (message && getLockedAbsenceTimesheetImpacts(impacts).length > 0) {
          window.alert(message);
          return;
        }
        if (message && !window.confirm(message)) return;
      }

      await updateAbsence.mutateAsync({
        id: absence.id,
        updates,
      });

      toast.success('Absence updated');
      onOpenChange(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to update absence');
      if (shouldLogAbsenceManageError(error)) {
        console.error('Error updating absence:', error);
      } else {
        console.warn('Update absence request rejected:', message);
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto border-border"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">Edit Booking</DialogTitle>
          <DialogDescription className="text-slate-400/90">
            {mode === 'override-only'
              ? 'Update this booking override so timesheet hours can be entered while leave stays in place.'
              : 'Update the selected absence booking without deleting and recreating it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
          {mode === 'override-only' ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Protected booking: only the timesheet-work override can be changed for this booking.
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Employee</Label>
            <div className="rounded-md border border-border bg-slate-950 px-3 py-2 text-sm text-slate-300">
              {absence?.profiles.full_name}
              {absence?.profiles.employee_id ? ` (${absence.profiles.employee_id})` : ''}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="absence-edit-reason" className="text-foreground font-medium">Reason *</Label>
            <Select
              value={reasonId}
              onValueChange={(value) => {
                setReasonId(value);
              }}
              disabled={mode === 'override-only'}
            >
              <SelectTrigger id="absence-edit-reason" className="bg-slate-950 border-border text-foreground">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {editableReasons.map((reason) => (
                  <SelectItem key={reason.id} value={reason.id}>
                    {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="absence-edit-start-date" className="text-foreground font-medium">Start Date *</Label>
              <Input
                id="absence-edit-start-date"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (endDate && endDate < event.target.value) {
                    setEndDate('');
                  }
                }}
                disabled={mode === 'override-only'}
                className="bg-slate-950 border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="absence-edit-end-date" className="text-foreground font-medium">End Date (optional)</Label>
              <Input
                id="absence-edit-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                min={startDate}
                disabled={mode === 'override-only' || !startDate || isHalfDay}
                className="bg-slate-950 border-border text-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Duration options</Label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
              <input
                type="checkbox"
                checked={isHalfDay}
                onChange={(event) => {
                  setIsHalfDay(event.target.checked);
                  if (event.target.checked) {
                    setEndDate('');
                  }
                }}
                disabled={mode === 'override-only'}
                className="rounded border-border"
              />
              <span className="text-sm text-slate-400/90">Half Day</span>
            </div>

            {isHalfDay && (
              <div className="flex gap-3 pt-1">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="edit-session"
                    value="AM"
                    checked={halfDaySession === 'AM'}
                    onChange={() => setHalfDaySession('AM')}
                    disabled={mode === 'override-only'}
                  />
                  <span className="text-sm text-slate-400/90">AM</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="edit-session"
                    value="PM"
                    checked={halfDaySession === 'PM'}
                    onChange={() => setHalfDaySession('PM')}
                    disabled={mode === 'override-only'}
                  />
                  <span className="text-sm text-slate-400/90">PM</span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="absence-edit-notes" className="text-foreground font-medium">Notes</Label>
            <Textarea
              id="absence-edit-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes..."
              disabled={mode === 'override-only'}
              className="bg-slate-950 border-border text-foreground min-h-[88px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Timesheet override</Label>
            <label className="flex items-start gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
              <input
                type="checkbox"
                checked={allowTimesheetWorkOnLeave}
                onChange={(event) => setAllowTimesheetWorkOnLeave(event.target.checked)}
                disabled={!canUseTimesheetWorkOverride}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-sm text-slate-300">
                Allow working hours in timesheets for this annual leave booking.
                <span className="block text-xs text-muted-foreground mt-1">
                  When enabled, users can enter normal working time/job data for the booking day while leave remains and paid leave hours are still credited.
                </span>
              </span>
            </label>
            {!canUseTimesheetWorkOverride ? (
              <p className="text-xs text-muted-foreground">
                This override is only available for Annual leave bookings.
              </p>
            ) : null}
          </div>

          {startDate && (
            <div className="space-y-2 bg-slate-800/30 p-3 rounded-lg">
              <p className="text-sm text-muted-foreground">
                Duration: <span className="text-white font-medium">{duration} {duration === 1 ? 'day' : 'days'}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Draft/submitted timesheets update from approved absence changes where allowed. Processed or adjusted
                timesheets remain locked for payroll history.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={discard}
            className="border-border text-muted-foreground"
          >
            {isFormDirty ? 'Discard Changes' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              !absence ||
              (mode === 'override-only' ? !canUseTimesheetWorkOverride : !startDate || !reasonId)
            }
            className="bg-absence hover:bg-absence-dark text-white"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
