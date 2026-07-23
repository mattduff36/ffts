'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { deleteScheduleVisit, saveScheduleVisit } from '@/lib/client/scheduling';
import type { ScheduleJob, ScheduleVisit, ScheduleVisitStatus } from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface ScheduleVisitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob | null;
  visit: ScheduleVisit | null;
  defaultDate: string;
  onSaved: () => void;
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ScheduleVisitDialog({
  open,
  onOpenChange,
  job,
  visit,
  defaultDate,
  onSaved,
}: ScheduleVisitDialogProps) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<ScheduleVisitStatus>('planned');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(visit?.title || '');
    setStartsAt(visit ? toLocalDateTime(visit.starts_at) : `${defaultDate}T08:00`);
    setEndsAt(visit ? toLocalDateTime(visit.ends_at) : `${defaultDate}T12:00`);
    setNotes(visit?.notes || '');
    setStatus(visit?.status || 'planned');
  }, [defaultDate, open, visit]);

  async function handleSave() {
    if (!job || !startsAt || !endsAt) return;
    setSaving(true);
    try {
      await saveScheduleVisit(
        {
          job_id: job.id,
          title: title || null,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          notes: notes || null,
          status,
        },
        visit?.id
      );
      toast.success(visit ? 'Visit updated' : 'Visit added');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save visit');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!visit) return;
    setSaving(true);
    try {
      await deleteScheduleVisit(visit.id);
      toast.success('Visit deleted');
      setDeleteOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete visit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-border">
          <DialogHeader>
            <DialogTitle>{visit ? 'Edit visit' : 'Add visit'}</DialogTitle>
            <DialogDescription>
              {job ? `${job.job_reference} — visit ${visit?.sequence_number || 'time'}` : 'Set the visit time.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
              <div className="space-y-2">
                <Label htmlFor="schedule-visit-title">Visit label (optional)</Label>
                <Input
                  id="schedule-visit-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Crown reduction"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-visit-status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ScheduleVisitStatus)}>
                  <SelectTrigger id="schedule-visit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-visit-start">Starts</Label>
                <Input
                  id="schedule-visit-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-visit-end">Ends</Label>
                <Input
                  id="schedule-visit-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-visit-notes">Notes</Label>
              <Textarea
                id="schedule-visit-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {visit ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                className={schedulingControlStyles.danger}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className={schedulingControlStyles.outline} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" className={schedulingControlStyles.primary} disabled={saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save visit
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this visit?</AlertDialogTitle>
            <AlertDialogDescription>
              Its employee and plant assignments will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={schedulingControlStyles.outline}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className={schedulingControlStyles.danger}
            >
              Delete visit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
