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
import { deleteScheduleJob, saveScheduleJob } from '@/lib/client/scheduling';
import type { ScheduleJob, ScheduleJobStatus } from '@/types/scheduling';

interface ScheduleJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob | null;
  defaultDate: string;
  onSaved: () => void;
}

export function ScheduleJobDialog({
  open,
  onOpenChange,
  job,
  defaultDate,
  onSaved,
}: ScheduleJobDialogProps) {
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [status, setStatus] = useState<ScheduleJobStatus>('draft');
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReference(job?.job_reference || '');
    setTitle(job?.title || '');
    setDescription(job?.description || '');
    setSiteAddress(job?.site_address || '');
    setStatus(job?.status || 'draft');
    setStartDate(job?.start_date || defaultDate);
    setEndDate(job?.end_date || defaultDate);
  }, [defaultDate, job, open]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveScheduleJob(
        {
          job_reference: reference,
          title,
          description: description || null,
          site_address: siteAddress || null,
          status,
          start_date: startDate,
          end_date: endDate,
        },
        job?.id
      );
      toast.success(job ? 'Job updated' : 'Job created');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save job');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!job) return;
    setSaving(true);
    try {
      await deleteScheduleJob(job.id);
      toast.success('Job deleted');
      setDeleteOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle>{job ? 'Edit scheduled job' : 'Add scheduled job'}</DialogTitle>
            <DialogDescription>
              Set the inclusive job dates. Employees and plant can then be allocated by day.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-job-reference">Job reference</Label>
                <Input
                  id="schedule-job-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. 12345-MD"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-job-status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ScheduleJobStatus)}>
                  <SelectTrigger id="schedule-job-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-title">Title</Label>
              <Input id="schedule-job-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-site">Site</Label>
              <Input
                id="schedule-job-site"
                value={siteAddress}
                onChange={(event) => setSiteAddress(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-description">Description</Label>
              <Textarea
                id="schedule-job-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-job-start">Start date</Label>
                <Input id="schedule-job-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-job-end">End date</Label>
                <Input id="schedule-job-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {job ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save job
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              All employee and plant assignments for {job?.job_reference} will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Delete job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
