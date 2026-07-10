'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ProfileDetailsDraft {
  full_name: string;
  phone_number: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  secondary_emergency_contact_name: string;
  secondary_emergency_contact_phone: string;
  secondary_emergency_contact_relationship: string;
  employer_profile_notes: string;
}

interface ProfileMyDetailsTabProps {
  canEditBasicFields: boolean;
  draft: ProfileDetailsDraft;
  onDraftChange: (field: keyof ProfileDetailsDraft, value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}

const profileInputClassName =
  'h-14 border-slate-500/80 bg-slate-950/70 text-lg text-foreground shadow-inner shadow-black/20 placeholder:text-slate-500 focus-visible:border-brand-yellow focus-visible:ring-brand-yellow/60 read-only:bg-slate-800/60 read-only:text-slate-300 sm:h-10 sm:text-sm';

const profileTextareaClassName =
  'min-h-32 border-slate-500/80 bg-slate-950/70 text-lg text-foreground shadow-inner shadow-black/20 placeholder:text-slate-500 focus-visible:border-brand-yellow focus-visible:ring-brand-yellow/60 sm:min-h-20 sm:text-sm';

export function ProfileMyDetailsTab({
  canEditBasicFields,
  draft,
  onDraftChange,
  onSave,
  isSaving,
  hasChanges,
}: ProfileMyDetailsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Details</CardTitle>
        <CardDescription>
          Keep your account and emergency contact information up to date for your employer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-4 rounded-xl border border-slate-600/80 bg-slate-950/40 p-5 shadow-inner shadow-black/10 sm:rounded-lg sm:border-border sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold text-foreground sm:text-sm">Account details</h3>
            {!canEditBasicFields ? (
              <p className="text-sm text-muted-foreground sm:text-xs">Name and phone are read-only for your role</p>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-full-name" className="text-base font-semibold sm:text-sm">Full name</Label>
              <Input
                id="profile-full-name"
                value={draft.full_name}
                readOnly={!canEditBasicFields}
                onChange={(event) => onDraftChange('full_name', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-phone-number" className="text-base font-semibold sm:text-sm">Phone number</Label>
              <Input
                id="profile-phone-number"
                value={draft.phone_number}
                readOnly={!canEditBasicFields}
                onChange={(event) => onDraftChange('phone_number', event.target.value)}
                className={profileInputClassName}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-[hsl(var(--brand-yellow)/0.45)] bg-[hsl(var(--brand-yellow)/0.08)] p-5 shadow-inner shadow-black/10 sm:rounded-lg sm:border-[hsl(var(--brand-yellow)/0.3)] sm:bg-[hsl(var(--brand-yellow)/0.06)] sm:p-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground sm:text-sm">Emergency contacts</h3>
            <p className="text-sm text-muted-foreground sm:text-xs">
              These details are for workplace support if your manager needs to contact someone on your behalf.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-emergency-contact-name" className="text-base font-semibold sm:text-sm">Primary contact name</Label>
              <Input
                id="profile-emergency-contact-name"
                value={draft.emergency_contact_name}
                onChange={(event) => onDraftChange('emergency_contact_name', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-emergency-contact-phone" className="text-base font-semibold sm:text-sm">Primary contact phone</Label>
              <Input
                id="profile-emergency-contact-phone"
                value={draft.emergency_contact_phone}
                onChange={(event) => onDraftChange('emergency_contact_phone', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-emergency-contact-relationship" className="text-base font-semibold sm:text-sm">Relationship</Label>
              <Input
                id="profile-emergency-contact-relationship"
                value={draft.emergency_contact_relationship}
                onChange={(event) => onDraftChange('emergency_contact_relationship', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-name" className="text-base font-semibold sm:text-sm">Secondary contact name</Label>
              <Input
                id="profile-secondary-emergency-contact-name"
                value={draft.secondary_emergency_contact_name}
                onChange={(event) => onDraftChange('secondary_emergency_contact_name', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-phone" className="text-base font-semibold sm:text-sm">Secondary contact phone</Label>
              <Input
                id="profile-secondary-emergency-contact-phone"
                value={draft.secondary_emergency_contact_phone}
                onChange={(event) => onDraftChange('secondary_emergency_contact_phone', event.target.value)}
                className={profileInputClassName}
              />
            </div>
            <div className="space-y-2 sm:space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-relationship" className="text-base font-semibold sm:text-sm">Relationship</Label>
              <Input
                id="profile-secondary-emergency-contact-relationship"
                value={draft.secondary_emergency_contact_relationship}
                onChange={(event) => onDraftChange('secondary_emergency_contact_relationship', event.target.value)}
                className={profileInputClassName}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-600/80 bg-slate-950/40 p-5 shadow-inner shadow-black/10 sm:rounded-lg sm:border-border sm:p-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground sm:text-sm">Additional information</h3>
            <p className="text-sm text-muted-foreground sm:text-xs">
              Optional notes that may help your employer support you at work.
            </p>
          </div>
          <Textarea
            id="profile-employer-notes"
            value={draft.employer_profile_notes}
            maxLength={500}
            onChange={(event) => onDraftChange('employer_profile_notes', event.target.value)}
            placeholder="For example, preferred contact times or practical support notes."
            className={profileTextareaClassName}
          />
          <p className="text-right text-sm text-muted-foreground sm:text-xs">
            {draft.employer_profile_notes.length}/500
          </p>
        </section>

        <Button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || isSaving}
          className="h-14 w-full bg-brand-yellow text-base font-semibold text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60 sm:h-9 sm:w-auto sm:text-sm"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save details'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
