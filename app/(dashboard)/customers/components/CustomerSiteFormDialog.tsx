'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { handleEnterAdvancesFields } from '@/lib/forms/enter-advances-fields';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import type { CustomerSite } from '../types';

interface CustomerSiteFormDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
  onCreated: (site: CustomerSite) => void;
}

interface SiteDraft {
  site_name: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  county: string;
  postcode: string;
  notes: string;
}

const EMPTY_SITE_DRAFT: SiteDraft = {
  site_name: '',
  address_line_1: '',
  address_line_2: '',
  city: '',
  county: '',
  postcode: '',
  notes: '',
};

function draftSnapshot(draft: SiteDraft) {
  return JSON.stringify(draft);
}

export function CustomerSiteFormDialog({
  open,
  onClose,
  customerId,
  onCreated,
}: CustomerSiteFormDialogProps) {
  const [form, setForm] = useState<SiteDraft>(EMPTY_SITE_DRAFT);
  const [initialDirtySnapshot, setInitialDirtySnapshot] = useState(() => draftSnapshot(EMPTY_SITE_DRAFT));
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isFormDirty = open && draftSnapshot(form) !== initialDirtySnapshot;
  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handlePointerDownOutside,
    handleEscapeKeyDown,
    handleFocusOutside,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: saving,
    onOpenChange: (isOpen) => {
      if (!isOpen && !saving) onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    const nextForm = { ...EMPTY_SITE_DRAFT };
    setForm(nextForm);
    setInitialDirtySnapshot(draftSnapshot(nextForm));
    setFieldErrors({});
    setFormError(null);
  }, [open, customerId]);

  function updateField<K extends keyof SiteDraft>(key: K, value: SiteDraft[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setFieldErrors(prev => {
      if (!prev[`sites.0.${key}`]) return prev;
      const next = { ...prev };
      delete next[`sites.0.${key}`];
      return next;
    });
    setFormError(null);
  }

  function fieldError(key: keyof SiteDraft) {
    return fieldErrors[`sites.0.${key}`] || '';
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites: [{
            site_name: form.site_name,
            address_line_1: form.address_line_1,
            address_line_2: form.address_line_2,
            city: form.city,
            county: form.county,
            postcode: form.postcode,
            notes: form.notes,
          }],
        }),
      });
      const payload = await response.json().catch(() => null) as {
        site?: CustomerSite;
        error?: string;
        field_errors?: Record<string, string>;
      } | null;

      if (!response.ok || !payload?.site) {
        setFieldErrors(payload?.field_errors || {});
        setFormError(payload?.error || 'Failed to add site');
        return;
      }

      onCreated(payload.site);
      onClose();
    } catch {
      setFormError('Failed to add site');
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white"
        onInteractOutside={handleInteractOutside}
        onPointerDownOutside={handlePointerDownOutside}
        onFocusOutside={handleFocusOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <form onSubmit={handleSubmit} noValidate onKeyDown={handleEnterAdvancesFields}>
          <DialogHeader>
            <DialogTitle className="text-white">Add site</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Save a site name and address for this customer.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {formError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {formError}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="new_site_name">Site Name *</Label>
              <Input
                id="new_site_name"
                value={form.site_name}
                onChange={event => updateField('site_name', event.target.value)}
                aria-invalid={!!fieldError('site_name')}
                placeholder="e.g. Main site"
                className="bg-slate-800 border-slate-600"
              />
              {fieldError('site_name') ? <p className="text-xs text-red-300">{fieldError('site_name')}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_site_address_line_1">Address Line 1 *</Label>
              <Input
                id="new_site_address_line_1"
                value={form.address_line_1}
                onChange={event => updateField('address_line_1', event.target.value)}
                aria-invalid={!!fieldError('address_line_1')}
                className="bg-slate-800 border-slate-600"
              />
              {fieldError('address_line_1') ? (
                <p className="text-xs text-red-300">{fieldError('address_line_1')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_site_address_line_2">Address Line 2</Label>
              <Input
                id="new_site_address_line_2"
                value={form.address_line_2}
                onChange={event => updateField('address_line_2', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new_site_city">City</Label>
                <Input
                  id="new_site_city"
                  value={form.city}
                  onChange={event => updateField('city', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_site_county">County</Label>
                <Input
                  id="new_site_county"
                  value={form.county}
                  onChange={event => updateField('county', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_site_postcode">Postcode</Label>
              <Input
                id="new_site_postcode"
                value={form.postcode}
                onChange={event => updateField('postcode', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_site_notes">Site Notes</Label>
              <Textarea
                id="new_site_notes"
                value={form.notes}
                onChange={event => updateField('notes', event.target.value)}
                rows={3}
                className="bg-slate-800 border-slate-600"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={discard}
              disabled={saving}
              className="border-slate-600 text-muted-foreground"
            >
              {isFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold"
            >
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Add site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
