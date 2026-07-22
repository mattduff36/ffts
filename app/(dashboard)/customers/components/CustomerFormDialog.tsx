'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, MapPin, Plus, Power, Trash2 } from 'lucide-react';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import type {
  Customer,
  CustomerContactFormData,
  CustomerFormData,
  CustomerSiteFormData,
} from '../types';
import { EMPTY_CUSTOMER_FORM } from '../types';

interface CustomerFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CustomerFormData) => Promise<void>;
  customer?: Customer | null;
}

function buildCustomerFormDirtySnapshot(form: CustomerFormData) {
  return JSON.stringify(form);
}

export function CustomerFormDialog({ open, onClose, onSubmit, customer }: CustomerFormDialogProps) {
  const [form, setForm] = useState<CustomerFormData>({ ...EMPTY_CUSTOMER_FORM, secondary_contacts: [] });
  const [saving, setSaving] = useState(false);
  const [initialDirtySnapshot, setInitialDirtySnapshot] = useState('');
  const isEditing = !!customer;
  const currentDirtySnapshot = buildCustomerFormDirtySnapshot(form);
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
    if (customer) {
      const nextForm: CustomerFormData = {
        company_name: customer.company_name,
        short_name: customer.short_name || '',
        contact_name: customer.contact_name || '',
        contact_email: customer.contact_email || '',
        contact_phone: customer.contact_phone || '',
        contact_job_title: customer.contact_job_title || '',
        address_line_1: customer.address_line_1 || '',
        address_line_2: customer.address_line_2 || '',
        city: customer.city || '',
        county: customer.county || '',
        postcode: customer.postcode || '',
        payment_terms_days: customer.payment_terms_days,
        default_validity_days: customer.default_validity_days,
        status: customer.status,
        notes: customer.notes || '',
        secondary_contacts: (customer.secondary_contacts || []).map(contact => ({
          id: contact.id,
          name: contact.name || '',
          job_title: contact.job_title || '',
          email: contact.email || '',
          phone: contact.phone || '',
        })),
        sites: (customer.sites || []).map(site => ({
          id: site.id,
          site_name: site.site_name,
          address_line_1: site.address_line_1 || '',
          address_line_2: site.address_line_2 || '',
          city: site.city || '',
          county: site.county || '',
          postcode: site.postcode || '',
          is_active: site.is_active,
          is_default: site.is_default,
          notes: site.notes || '',
        })),
      };
      setForm(nextForm);
      setInitialDirtySnapshot(buildCustomerFormDirtySnapshot(nextForm));
    } else {
      const nextForm = { ...EMPTY_CUSTOMER_FORM, secondary_contacts: [], sites: [] };
      setForm(nextForm);
      setInitialDirtySnapshot(buildCustomerFormDirtySnapshot(nextForm));
    }
  }, [customer, open]);

  function updateField<K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function updateSecondaryContact<K extends keyof CustomerContactFormData>(
    index: number,
    key: K,
    value: CustomerContactFormData[K]
  ) {
    setForm(prev => ({
      ...prev,
      secondary_contacts: prev.secondary_contacts.map((contact, idx) => (
        idx === index ? { ...contact, [key]: value } : contact
      )),
    }));
  }

  function addSecondaryContact() {
    setForm(prev => ({
      ...prev,
      secondary_contacts: [
        ...prev.secondary_contacts,
        { name: '', job_title: '', email: '', phone: '' },
      ],
    }));
  }

  function removeSecondaryContact(index: number) {
    setForm(prev => ({
      ...prev,
      secondary_contacts: prev.secondary_contacts.filter((_, idx) => idx !== index),
    }));
  }

  function updateSite<K extends keyof CustomerSiteFormData>(
    index: number,
    key: K,
    value: CustomerSiteFormData[K]
  ) {
    setForm(prev => ({
      ...prev,
      sites: prev.sites.map((site, siteIndex) => {
        if (siteIndex !== index) {
          if (key === 'is_default' && value === true) return { ...site, is_default: false };
          return site;
        }

        if (key === 'is_active' && value === false) {
          return { ...site, is_active: false, is_default: false };
        }
        return { ...site, [key]: value };
      }),
    }));
  }

  function addSite() {
    setForm(prev => ({
      ...prev,
      sites: [
        ...prev.sites,
        {
          site_name: '',
          address_line_1: '',
          address_line_2: '',
          city: '',
          county: '',
          postcode: '',
          is_active: true,
          is_default: prev.sites.every(site => !site.is_active),
          notes: '',
        },
      ],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {isEditing ? 'Edit Customer' : 'Add Customer'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {isEditing ? 'Update customer details.' : 'Add a new customer to your directory.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Company Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input
                  id="company_name"
                  required
                  value={form.company_name}
                  onChange={e => updateField('company_name', e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="short_name">Short Name</Label>
                <Input
                  id="short_name"
                  value={form.short_name}
                  onChange={e => updateField('short_name', e.target.value)}
                  placeholder="e.g. BPB"
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            {/* Primary Contact */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">Primary Contact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact Name</Label>
                  <Input
                    id="contact_name"
                    value={form.contact_name}
                    onChange={e => updateField('contact_name', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_job_title">Job Title</Label>
                  <Input
                    id="contact_job_title"
                    value={form.contact_job_title}
                    onChange={e => updateField('contact_job_title', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_email">Email</Label>
                  <Input
                    id="contact_email"
                    type="email"
                    value={form.contact_email}
                    onChange={e => updateField('contact_email', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_phone">Phone</Label>
                  <Input
                    id="contact_phone"
                    value={form.contact_phone}
                    onChange={e => updateField('contact_phone', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-xs font-semibold tracking-wide text-muted-foreground">Secondary Contact(s)</h5>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSecondaryContact}
                    className="border-slate-600 text-muted-foreground"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add another contact?
                  </Button>
                </div>

                {form.secondary_contacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No secondary contacts added.</p>
                ) : (
                  <div className="space-y-3">
                    {form.secondary_contacts.map((contact, index) => (
                      <div key={contact.id || index} className="rounded-lg border border-slate-700 bg-slate-950/30 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">Secondary Contact {index + 1}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeSecondaryContact(index)}
                            className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`secondary_contact_name_${index}`}>Contact Name</Label>
                            <Input
                              id={`secondary_contact_name_${index}`}
                              value={contact.name}
                              onChange={e => updateSecondaryContact(index, 'name', e.target.value)}
                              className="bg-slate-800 border-slate-600"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`secondary_contact_job_title_${index}`}>Job Title</Label>
                            <Input
                              id={`secondary_contact_job_title_${index}`}
                              value={contact.job_title}
                              onChange={e => updateSecondaryContact(index, 'job_title', e.target.value)}
                              className="bg-slate-800 border-slate-600"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`secondary_contact_email_${index}`}>Email</Label>
                            <Input
                              id={`secondary_contact_email_${index}`}
                              type="email"
                              value={contact.email}
                              onChange={e => updateSecondaryContact(index, 'email', e.target.value)}
                              className="bg-slate-800 border-slate-600"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`secondary_contact_phone_${index}`}>Phone</Label>
                            <Input
                              id={`secondary_contact_phone_${index}`}
                              value={contact.phone}
                              onChange={e => updateSecondaryContact(index, 'phone', e.target.value)}
                              className="bg-slate-800 border-slate-600"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Address */}
            <div className="border-t border-slate-700 pt-4">
              <div className="mb-3 space-y-1">
                <h4 className="text-sm font-semibold text-muted-foreground">Customer Address</h4>
                <p className="text-xs text-slate-400">
                  Use this for the customer&apos;s correspondence address. Save work locations separately below.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="address_line_1">Address Line 1</Label>
                  <Input
                    id="address_line_1"
                    value={form.address_line_1}
                    onChange={e => updateField('address_line_1', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="address_line_2">Address Line 2</Label>
                  <Input
                    id="address_line_2"
                    value={form.address_line_2}
                    onChange={e => updateField('address_line_2', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={e => updateField('city', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="county">County</Label>
                  <Input
                    id="county"
                    value={form.county}
                    onChange={e => updateField('county', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input
                    id="postcode"
                    value={form.postcode}
                    onChange={e => updateField('postcode', e.target.value)}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
            </div>

            {/* Sites */}
            <div className="border-t border-slate-700 pt-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-muted-foreground">Customer Sites</h4>
                  <p className="text-xs text-slate-400">
                    Saved sites can be selected on quotes and manually scheduled jobs.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSite}
                  className="border-slate-600 text-muted-foreground"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Site
                </Button>
              </div>

              {form.sites.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                  No saved sites. Existing customer addresses remain available as correspondence details.
                </p>
              ) : (
                <div className="space-y-4">
                  {form.sites.map((site, index) => (
                    <div
                      key={site.id || index}
                      className="rounded-lg border border-slate-700 bg-slate-950/30 p-4"
                    >
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-brand-yellow" />
                          <span className="font-medium text-white">
                            {site.site_name.trim() || `Site ${index + 1}`}
                          </span>
                          <Badge
                            variant="outline"
                            className={site.is_active
                              ? 'border-green-500/30 bg-green-500/10 text-green-300'
                              : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                            }
                          >
                            {site.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          {site.is_default ? (
                            <Badge variant="outline" className="border-brand-yellow/40 text-brand-yellow">
                              Default
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {site.is_active && !site.is_default ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => updateSite(index, 'is_default', true)}
                              className="border-slate-600 text-muted-foreground"
                            >
                              Make Default
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateSite(index, 'is_active', !site.is_active)}
                            className={site.is_active
                              ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                              : 'border-green-500/40 text-green-300 hover:bg-green-500/10'
                            }
                          >
                            <Power className="mr-2 h-4 w-4" />
                            {site.is_active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`site_name_${index}`}>Site Name *</Label>
                          <Input
                            id={`site_name_${index}`}
                            required
                            value={site.site_name}
                            onChange={event => updateSite(index, 'site_name', event.target.value)}
                            placeholder="e.g. Main site"
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`site_address_line_1_${index}`}>Address Line 1 *</Label>
                          <Input
                            id={`site_address_line_1_${index}`}
                            value={site.address_line_1}
                            onChange={event => updateSite(index, 'address_line_1', event.target.value)}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`site_address_line_2_${index}`}>Address Line 2</Label>
                          <Input
                            id={`site_address_line_2_${index}`}
                            value={site.address_line_2}
                            onChange={event => updateSite(index, 'address_line_2', event.target.value)}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`site_city_${index}`}>City</Label>
                          <Input
                            id={`site_city_${index}`}
                            value={site.city}
                            onChange={event => updateSite(index, 'city', event.target.value)}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`site_county_${index}`}>County</Label>
                          <Input
                            id={`site_county_${index}`}
                            value={site.county}
                            onChange={event => updateSite(index, 'county', event.target.value)}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`site_postcode_${index}`}>Postcode</Label>
                          <Input
                            id={`site_postcode_${index}`}
                            value={site.postcode}
                            onChange={event => updateSite(index, 'postcode', event.target.value)}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`site_notes_${index}`}>Site Notes</Label>
                          <Textarea
                            id={`site_notes_${index}`}
                            value={site.notes}
                            onChange={event => updateSite(index, 'notes', event.target.value)}
                            rows={2}
                            className="bg-slate-800 border-slate-600"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Terms & Status */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">Terms & Status</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payment_terms_days">Payment Terms (days)</Label>
                  <Input
                    id="payment_terms_days"
                    type="number"
                    min={0}
                    value={form.payment_terms_days}
                    onChange={e => { const v = parseInt(e.target.value); updateField('payment_terms_days', isNaN(v) ? 30 : v); }}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_validity_days">Quote Validity (days)</Label>
                  <Input
                    id="default_validity_days"
                    type="number"
                    min={0}
                    value={form.default_validity_days}
                    onChange={e => { const v = parseInt(e.target.value); updateField('default_validity_days', isNaN(v) ? 30 : v); }}
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={form.status} onValueChange={v => updateField('status', v as 'active' | 'inactive')}>
                    <SelectTrigger className="bg-slate-800 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
                rows={3}
                className="bg-slate-800 border-slate-600"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={discard} disabled={saving} className="border-slate-600 text-muted-foreground">
              {isFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={saving || !form.company_name.trim()} className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold">
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : isEditing ? 'Update Customer' : 'Add Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
