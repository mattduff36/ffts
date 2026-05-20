'use client';

import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import {
  EMPTY_INVENTORY_ITEM_FORM,
  INVENTORY_CATEGORY_LABELS,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemCategory,
  type InventoryItemFormData,
  type InventoryLocation,
  type InventoryStatus,
} from '../types';

interface InventoryItemDialogProps {
  open: boolean;
  item?: InventoryItem | null;
  locations: InventoryLocation[];
  categories: InventoryItemCategory[];
  onClose: () => void;
  onSubmit: (data: InventoryItemFormData) => Promise<void>;
}

export function InventoryItemDialog({
  open,
  item,
  locations,
  categories,
  onClose,
  onSubmit,
}: InventoryItemDialogProps) {
  const [form, setForm] = useState<InventoryItemFormData>(EMPTY_INVENTORY_ITEM_FORM);
  const [saving, setSaving] = useState(false);
  const isEditing = !!item;

  useEffect(() => {
    if (item) {
      setForm({
        item_number: item.item_number,
        name: item.name,
        category: item.category,
        location_id: item.location_id || '',
        last_checked_at: item.last_checked_at || '',
        check_interval_days: item.check_interval_days ? String(item.check_interval_days) : '',
        status: item.status,
      });
      return;
    }

    setForm({
      ...EMPTY_INVENTORY_ITEM_FORM,
      category: categories[0]?.slug || EMPTY_INVENTORY_ITEM_FORM.category,
    });
  }, [categories, item, locations, open]);

  const categoryOptions = categories.length > 0
    ? [...categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => [
        category.slug,
        category.name,
      ] as const)
    : (Object.entries(INVENTORY_CATEGORY_LABELS) as Array<[InventoryCategory, string]>);

  function updateField<K extends keyof InventoryItemFormData>(key: K, value: InventoryItemFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
            <DialogTitle>{isEditing ? 'Edit Inventory Item' : 'Add Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Track item identity, location, and the last six-week check date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
              Fleet Plant guidance: anything with an engine, valued over £1000, or too large for a standard van should normally be added to Fleet Plant instead of Inventory. This is guidance only for this phase.
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item_number">ID Number *</Label>
                <Input
                  id="item_number"
                  required
                  value={form.item_number}
                  onChange={(event) => updateField('item_number', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(value) => updateField('category', value as InventoryCategory)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <Select
                  value={form.location_id || 'unassigned'}
                  onValueChange={(value) => updateField('location_id', value === 'unassigned' ? '' : value)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned" className="text-muted-foreground">No location assigned</SelectItem>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="last_checked_at">Last Checked</Label>
                <Input
                  id="last_checked_at"
                  type="date"
                  value={form.last_checked_at}
                  onChange={(event) => updateField('last_checked_at', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="check_interval_days">Check Interval Days</Label>
                <Input
                  id="check_interval_days"
                  type="number"
                  min={1}
                  max={3650}
                  value={form.check_interval_days}
                  onChange={(event) => updateField('check_interval_days', event.target.value)}
                  placeholder="Default 42"
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => updateField('status', value as InventoryStatus)}
                >
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
