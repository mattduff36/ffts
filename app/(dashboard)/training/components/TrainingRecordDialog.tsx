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
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import {
  TRAINING_RECORD_STATUS_OPTIONS,
  TRAINING_VALIDATION_STATUS_OPTIONS,
  type TrainingRecordFormData,
  type TrainingRecordWithRelations,
} from '@/types/training';

interface TrainingRecordDialogProps {
  open: boolean;
  record?: TrainingRecordWithRelations | null;
  onClose: () => void;
  onSubmit: (data: TrainingRecordFormData) => Promise<void>;
}

const EMPTY_FORM: TrainingRecordFormData = {
  employee_name_raw: '',
  qualification_raw: '',
  qualification_canonical_proposed: '',
  qualification_validation_status: 'needs_manual_review',
  qualification_group: '',
  relationship: '',
  card_number: '',
  card_type_or_status: '',
  approved: '',
  issue_date: '',
  issue_raw: '',
  expiry_date: '',
  expiry_raw: '',
  date_of_birth: '',
  date_of_birth_raw: '',
  comments: '',
  record_status: 'active',
  next_review_at: '',
};

function buildTrainingFormDirtySnapshot(form: TrainingRecordFormData) {
  return JSON.stringify(form);
}

export function TrainingRecordDialog({
  open,
  record,
  onClose,
  onSubmit,
}: TrainingRecordDialogProps) {
  const [form, setForm] = useState<TrainingRecordFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [initialDirtySnapshot, setInitialDirtySnapshot] = useState('');
  const isEditing = Boolean(record);
  const currentDirtySnapshot = buildTrainingFormDirtySnapshot(form);
  const isFormDirty = open && Boolean(initialDirtySnapshot) && currentDirtySnapshot !== initialDirtySnapshot;
  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handleEscapeKeyDown,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: saving,
    onOpenChange: (isOpen) => {
      if (!isOpen && !saving) onClose();
    },
  });

  useEffect(() => {
    if (record) {
      const nextForm: TrainingRecordFormData = {
        employee_name_raw: record.employee_name_raw || '',
        qualification_raw: record.qualification_raw,
        qualification_canonical_proposed: record.qualification_canonical_proposed,
        qualification_validation_status: record.qualification_validation_status,
        qualification_group: record.qualification_group || '',
        relationship: record.relationship || '',
        card_number: record.card_number || '',
        card_type_or_status: record.card_type_or_status || '',
        approved: record.approved || '',
        issue_date: record.issue_date || '',
        issue_raw: record.issue_raw || '',
        expiry_date: record.expiry_date || '',
        expiry_raw: record.expiry_raw || '',
        date_of_birth: record.date_of_birth || '',
        date_of_birth_raw: record.date_of_birth_raw || '',
        comments: record.comments || '',
        record_status: record.record_status,
        next_review_at: record.next_review_at || '',
      };
      setForm(nextForm);
      setInitialDirtySnapshot(buildTrainingFormDirtySnapshot(nextForm));
      return;
    }

    setForm(EMPTY_FORM);
    setInitialDirtySnapshot(buildTrainingFormDirtySnapshot(EMPTY_FORM));
  }, [record, open]);

  function updateField<K extends keyof TrainingRecordFormData>(key: K, value: TrainingRecordFormData[K]) {
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto bg-slate-900 text-white border-slate-700"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Training Record' : 'Add Training Record'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update the imported record while preserving source workbook details for audit.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-employee-name">Employee / Contact</Label>
                <Input
                  id="training-employee-name"
                  value={form.employee_name_raw}
                  onChange={(event) => updateField('employee_name_raw', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.record_status}
                  onValueChange={(value) => updateField('record_status', value as TrainingRecordFormData['record_status'])}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_RECORD_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="training-qualification-raw">Qualification Raw *</Label>
              <Input
                id="training-qualification-raw"
                required
                value={form.qualification_raw}
                onChange={(event) => updateField('qualification_raw', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-qualification-proposed">Proposed Canonical Name</Label>
                <Input
                  id="training-qualification-proposed"
                  value={form.qualification_canonical_proposed}
                  onChange={(event) => updateField('qualification_canonical_proposed', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Validation Status</Label>
                <Select
                  value={form.qualification_validation_status}
                  onValueChange={(value) => updateField('qualification_validation_status', value as TrainingRecordFormData['qualification_validation_status'])}
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
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="training-card-number">Card Number</Label>
                <Input
                  id="training-card-number"
                  value={form.card_number}
                  onChange={(event) => updateField('card_number', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-card-type">Card Type / Status</Label>
                <Input
                  id="training-card-type"
                  value={form.card_type_or_status}
                  onChange={(event) => updateField('card_type_or_status', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-approved">Approved</Label>
                <Input
                  id="training-approved"
                  value={form.approved}
                  onChange={(event) => updateField('approved', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="training-issue-date">Issue Date</Label>
                <Input
                  id="training-issue-date"
                  type="date"
                  value={form.issue_date}
                  onChange={(event) => updateField('issue_date', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-expiry-date">Expiry Date</Label>
                <Input
                  id="training-expiry-date"
                  type="date"
                  value={form.expiry_date}
                  onChange={(event) => updateField('expiry_date', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-next-review">Next Review</Label>
                <Input
                  id="training-next-review"
                  type="date"
                  value={form.next_review_at}
                  onChange={(event) => updateField('next_review_at', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-group">Qualification Group</Label>
                <Input
                  id="training-group"
                  value={form.qualification_group}
                  onChange={(event) => updateField('qualification_group', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-relationship">Relationship</Label>
                <Input
                  id="training-relationship"
                  value={form.relationship}
                  onChange={(event) => updateField('relationship', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="training-comments">Comments</Label>
              <Input
                id="training-comments"
                value={form.comments}
                onChange={(event) => updateField('comments', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>

            {record ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300">
                Source: {record.source_sheet} row {record.source_row} · {record.source_record_id}
                {record.expiry_raw && record.expiry_raw !== record.expiry_date ? ` · raw expiry: ${record.expiry_raw}` : ''}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={discard} disabled={saving}>
              {isFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button type="submit" className="bg-brand-yellow text-slate-950 hover:bg-brand-yellow/90" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
