'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  createScheduleAssignment,
  SchedulingApiError,
  type CreateAssignmentInput,
} from '@/lib/client/scheduling';
import { enumerateScheduleDates, formatScheduleVisitTime, getScheduleVisitDate } from '@/lib/utils/scheduling';
import type {
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  ScheduleVisit,
  SchedulingConflict,
} from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

export interface SelectedScheduleResource {
  type: 'employee' | 'plant';
  id: string;
  label: string;
}

interface ScheduleAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob | null;
  visit?: ScheduleVisit | null;
  initialDate: string | null;
  initialResource: SelectedScheduleResource | null;
  availableDates?: string[];
  employees: ScheduleEmployeeResource[];
  plant: SchedulePlantResource[];
  onSaved: () => void;
}

function flattenConflictMessages(payload: Record<string, unknown>): SchedulingConflict[] {
  const byDate = payload.conflicts_by_date;
  if (!byDate || typeof byDate !== 'object') return [];
  return Object.values(byDate as Record<string, SchedulingConflict[]>).flat();
}

export function ScheduleAssignmentDialog({
  open,
  onOpenChange,
  job,
  visit,
  initialDate,
  initialResource,
  availableDates,
  employees,
  plant,
  onSaved,
}: ScheduleAssignmentDialogProps) {
  const [resourceType, setResourceType] = useState<'employee' | 'plant'>('employee');
  const [resourceId, setResourceId] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [pendingInput, setPendingInput] = useState<CreateAssignmentInput | null>(null);
  const [conflicts, setConflicts] = useState<SchedulingConflict[]>([]);

  const jobDates = useMemo(
    () => {
      if (!job) return [];
      const dates = enumerateScheduleDates(job.start_date, job.end_date);
      if (!availableDates) return dates;
      const available = new Set(availableDates);
      return dates.filter((date) => available.has(date));
    },
    [availableDates, job]
  );
  const resources = resourceType === 'employee' ? employees : plant;

  useEffect(() => {
    if (!open) return;
    setResourceType(initialResource?.type || 'employee');
    setResourceId(initialResource?.id || '');
    setSelectedDates(visit ? [getScheduleVisitDate(visit.starts_at)] : initialDate ? [initialDate] : []);
    setPendingInput(null);
    setConflicts([]);
  }, [initialDate, initialResource, open, visit]);

  function toggleDate(date: string, checked: boolean) {
    setSelectedDates((current) =>
      checked ? Array.from(new Set([...current, date])).sort() : current.filter((item) => item !== date)
    );
  }

  async function submit(input: CreateAssignmentInput) {
    setSaving(true);
    try {
      await createScheduleAssignment(input);
      toast.success('Resource assigned');
      onOpenChange(false);
      setPendingInput(null);
      onSaved();
    } catch (error) {
      if (error instanceof SchedulingApiError && error.status === 409 && error.payload.conflicts_by_date) {
        setPendingInput(input);
        setConflicts(flattenConflictMessages(error.payload));
      } else {
        toast.error(error instanceof Error ? error.message : 'Unable to create assignment');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    if (!job || !resourceId || (!visit && selectedDates.length === 0)) {
      toast.error(visit ? 'Choose a resource' : 'Choose a resource and at least one job date');
      return;
    }
    void submit({
      job_id: job.id,
      ...(visit ? { visit_id: visit.id } : {}),
      resource_type: resourceType,
      resource_id: resourceId,
      work_dates: selectedDates,
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle>Assign resource</DialogTitle>
            <DialogDescription>
              {job ? `${job.job_reference} — ${job.title}` : 'Choose a job day on the board.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <div className="space-y-2">
                <Label>Resource type</Label>
                <Select
                  value={resourceType}
                  onValueChange={(value) => {
                    setResourceType(value as 'employee' | 'plant');
                    setResourceId('');
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="plant">Plant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Resource</Label>
                <Select value={resourceId} onValueChange={setResourceId}>
                  <SelectTrigger><SelectValue placeholder={`Select ${resourceType}`} /></SelectTrigger>
                  <SelectContent>
                    {resources.map((resource) => (
                      <SelectItem key={resource.id} value={resource.id}>
                        {'full_name' in resource
                          ? `${resource.full_name}${resource.employee_id ? ` (${resource.employee_id})` : ''}`
                          : `${resource.plant_id}${resource.nickname ? ` — ${resource.nickname}` : ''}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {visit ? (
              <div className="rounded-md border border-scheduling/30 bg-scheduling-soft p-3 text-sm">
                <p className="font-medium text-foreground">
                  Visit {visit.sequence_number}{visit.title ? ` — ${visit.title}` : ''}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {new Intl.DateTimeFormat('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'Europe/London',
                  }).format(new Date(visit.starts_at))}
                  {' · '}
                  {formatScheduleVisitTime(visit.starts_at)}–{formatScheduleVisitTime(visit.ends_at)}
                </p>
              </div>
            ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{availableDates ? 'Assignment days this week' : 'Assignment days'}</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className={schedulingControlStyles.outline} onClick={() => setSelectedDates([])}>
                    Clear
                  </Button>
                  <Button type="button" size="sm" variant="outline" className={schedulingControlStyles.outline} onClick={() => setSelectedDates(jobDates)}>
                    {availableDates ? 'All this week' : 'All job days'}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {jobDates.map((date) => (
                  <label
                    key={date}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selectedDates.includes(date)}
                      onCheckedChange={(checked) => toggleDate(date, checked === true)}
                      className={schedulingControlStyles.checkbox}
                    />
                    {new Intl.DateTimeFormat('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    }).format(new Date(`${date}T12:00:00`))}
                  </label>
                ))}
              </div>
            </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" className={schedulingControlStyles.outline} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className={schedulingControlStyles.primary}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingInput !== null} onOpenChange={(value) => !value && setPendingInput(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Scheduling conflict
            </AlertDialogTitle>
            <AlertDialogDescription>
              Review the warning{conflicts.length === 1 ? '' : 's'} before assigning this resource.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm text-foreground">
            {conflicts.map((conflict, index) => (
              <li key={`${conflict.code}-${index}`} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                {conflict.message}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel className={schedulingControlStyles.outline}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                if (pendingInput) void submit({ ...pendingInput, override_conflicts: true });
              }}
              className={schedulingControlStyles.warning}
            >
              Assign anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
