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
  TRAINING_PROFILE_MATCH_STATUS_OPTIONS,
  type TrainingPerson,
  type TrainingPersonFormData,
} from '@/types/training';

interface TrainingPersonDialogProps {
  open: boolean;
  person?: TrainingPerson | null;
  onClose: () => void;
  onSubmit: (data: TrainingPersonFormData) => Promise<void>;
}

const EMPTY_FORM: TrainingPersonFormData = {
  employee_name_raw: '',
  profile_id: '',
  profile_match_status: 'not_attempted',
  profile_match_notes: '',
  date_of_births: '',
  source_sheets: '',
};

export function TrainingPersonDialog({ open, person, onClose, onSubmit }: TrainingPersonDialogProps) {
  const [form, setForm] = useState<TrainingPersonFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (person) {
      setForm({
        employee_name_raw: person.employee_name_raw,
        profile_id: person.profile_id || '',
        profile_match_status: person.profile_match_status,
        profile_match_notes: person.profile_match_notes || '',
        date_of_births: person.date_of_births.join(', '),
        source_sheets: person.source_sheets.join(', '),
      });
      return;
    }

    setForm(EMPTY_FORM);
  }, [person, open]);

  function updateField<K extends keyof TrainingPersonFormData>(key: K, value: TrainingPersonFormData[K]) {
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
            <DialogTitle>Edit Training Person</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Review the imported person and optional app profile link.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="training-person-name">Name</Label>
              <Input
                id="training-person-name"
                required
                value={form.employee_name_raw}
                onChange={(event) => updateField('employee_name_raw', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-profile-id">Profile ID</Label>
                <Input
                  id="training-profile-id"
                  value={form.profile_id}
                  onChange={(event) => updateField('profile_id', event.target.value)}
                  placeholder="Optional profiles.id"
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Match Status</Label>
                <Select
                  value={form.profile_match_status}
                  onValueChange={(value) => updateField('profile_match_status', value as TrainingPersonFormData['profile_match_status'])}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_PROFILE_MATCH_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="training-match-notes">Match Notes</Label>
              <Input
                id="training-match-notes"
                value={form.profile_match_notes}
                onChange={(event) => updateField('profile_match_notes', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-dobs">DOB Values</Label>
                <Input
                  id="training-dobs"
                  value={form.date_of_births}
                  onChange={(event) => updateField('date_of_births', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-source-sheets">Source Sheets</Label>
                <Input
                  id="training-source-sheets"
                  value={form.source_sheets}
                  onChange={(event) => updateField('source_sheets', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
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
