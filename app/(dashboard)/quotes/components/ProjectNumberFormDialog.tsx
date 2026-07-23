'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import type { QuoteManagerOption, QuoteProjectNumber } from '../types';

interface ProjectNumberForm {
  manager_profile_id: string;
  title: string;
  description: string;
  notes: string;
}

interface ProjectNumberFormDialogProps {
  open: boolean;
  managerOptions: QuoteManagerOption[];
  onClose: () => void;
  onCreated: (project: QuoteProjectNumber) => void | Promise<void>;
}

const EMPTY_FORM: ProjectNumberForm = {
  manager_profile_id: '',
  title: '',
  description: '',
  notes: '',
};

export function ProjectNumberFormDialog({
  open,
  managerOptions,
  onClose,
  onCreated,
}: ProjectNumberFormDialogProps) {
  const [form, setForm] = useState<ProjectNumberForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const guard = useDirtyDialogGuard({
    isDirty: Object.values(form).some(Boolean),
    disabled: saving,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) {
        setForm(EMPTY_FORM);
        onClose();
      }
    },
  });

  async function handleSubmit() {
    if (!form.manager_profile_id || !form.title.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/project-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to create project number.');
      toast.success('Project number created');
      setForm(EMPTY_FORM);
      onClose();
      await onCreated(payload.project || payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create project number.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={guard.handleOpenChange}>
      <DialogContent
        ref={guard.contentRef}
        className="max-w-2xl"
        onInteractOutside={guard.handleInteractOutside}
        onEscapeKeyDown={guard.handleEscapeKeyDown}
      >
        <DialogHeader><DialogTitle>Create Project Number</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Manager *</Label>
            <Select
              value={form.manager_profile_id}
              onValueChange={(value) => setForm((current) => ({ ...current, manager_profile_id: value }))}
            >
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                {managerOptions.filter((option) => option.is_active).map((option) => (
                  <SelectItem key={option.profile_id} value={option.profile_id}>
                    {option.profile?.full_name || option.signoff_name || option.initials}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-number-title">Title *</Label>
            <Input id="project-number-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-number-description">Description</Label>
            <Textarea id="project-number-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-number-notes">Notes</Label>
            <Textarea id="project-number-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={guard.discard}>Cancel</Button>
            <Button disabled={saving || !form.manager_profile_id || !form.title.trim()} onClick={() => void handleSubmit()}>
              {saving ? 'Creating…' : 'Reserve Number'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
