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
import { Loader2 } from 'lucide-react';
import type { Customer, CustomerFormData } from '../types';
import { EMPTY_CUSTOMER_FORM } from '../types';

interface CustomerFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CustomerFormData) => Promise<void>;
  customer?: Customer | null;
}

export function CustomerFormDialog({ open, onClose, onSubmit, customer }: CustomerFormDialogProps) {
  const [form, setForm] = useState<CustomerFormData>(EMPTY_CUSTOMER_FORM);
  const [saving, setSaving] = useState(false);
  const isEditing = !!customer;

  useEffect(() => {
    if (customer) {
      setForm({
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
      });
    } else {
      setForm(EMPTY_CUSTOMER_FORM);
    }
  }, [customer, open]);

  function updateField<K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
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
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
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
            </div>

            {/* Address */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">Address</h4>
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
            <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="border-slate-600 text-muted-foreground">
              Cancel
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
