'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import {
  TRAINING_VALIDATION_STATUS_OPTIONS,
  type TrainingQualification,
  type TrainingQualificationFormData,
} from '@/types/training';

interface TrainingQualificationDialogProps {
  open: boolean;
  qualification?: TrainingQualification | null;
  onClose: () => void;
  onSubmit: (data: TrainingQualificationFormData) => Promise<void>;
}

const EMPTY_FORM: TrainingQualificationFormData = {
  canonical_name: '',
  validation_status: 'needs_manual_review',
  validation_notes: '',
};

export function TrainingQualificationDialog({
  open,
  qualification,
  onClose,
  onSubmit,
}: TrainingQualificationDialogProps) {
  const [form, setForm] = useState<TrainingQualificationFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (qualification) {
      setForm({
        canonical_name: qualification.canonical_name,
        validation_status: qualification.validation_status,
        validation_notes: qualification.validation_notes || '',
      });
      return;
    }

    setForm(EMPTY_FORM);
  }, [qualification, open]);

  function updateField<K extends keyof TrainingQualificationFormData>(key: K, value: TrainingQualificationFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl bg-slate-900 text-white border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Qualification</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Preserve the raw import value while refining the proposed catalogue name.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {qualification ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300">
                Raw: {qualification.qualification_raw}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="training-canonical-name">Canonical Name</Label>
              <Input
                id="training-canonical-name"
                required
                value={form.canonical_name}
                onChange={(event) => updateField('canonical_name', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="space-y-2">
              <Label>Validation Status</Label>
              <Select
                value={form.validation_status}
                onValueChange={(value) => updateField('validation_status', value as TrainingQualificationFormData['validation_status'])}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_VALIDATION_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="training-validation-notes">Validation Notes</Label>
              <Input
                id="training-validation-notes"
                value={form.validation_notes}
                onChange={(event) => updateField('validation_notes', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" className="bg-brand-yellow text-slate-950 hover:bg-brand-yellow/90" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
