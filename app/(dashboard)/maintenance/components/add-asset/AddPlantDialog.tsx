'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OnceDialog } from '@/components/ui/once-ui';
import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';
import { isApplicableToType, type VehicleCategoryOption } from './utils';

interface AddPlantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

export function AddPlantDialog({ open, onOpenChange, onSuccess }: AddPlantDialogProps) {
  const queryClient = useQueryClient();
  const [categories, setCategories] = useState<VehicleCategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    plant_id: '',
    nickname: '',
    serial_number: '',
    category_id: '',
    status: 'active',
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setIsFetchingCategories(true);
        const response = await fetch('/api/admin/categories');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch categories');
        const filtered = ((data.categories || []) as VehicleCategoryOption[]).filter((category) =>
          isApplicableToType(category.applies_to, 'plant')
        );
        setCategories(filtered);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError, 'Unable to load categories'));
      } finally {
        setIsFetchingCategories(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError('');
    setFormData({
      plant_id: '',
      nickname: '',
      serial_number: '',
      category_id: '',
      status: 'active',
    });
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!formData.plant_id.trim()) {
      setError('Plant ID is required');
      return;
    }
    if (!formData.category_id) {
      setError('Category is required');
      return;
    }

    const serialNumberResult = validateAndNormalizePlantSerialNumber(formData.serial_number);
    if (!serialNumberResult.valid) {
      setError(serialNumberResult.error || 'Serial Number is invalid');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plant_id: formData.plant_id.trim(),
          nickname: formData.nickname.trim() || null,
          serial_number: serialNumberResult.value,
          category_id: formData.category_id,
          status: formData.status,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(data.error, 'Failed to create plant'));

      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('Plant asset added successfully');
      await onSuccess?.();
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(getErrorMessage(submitError, 'Failed to create plant'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <OnceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Plant"
      description="Create a plant asset with required category details."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="rounded border border-red-700 bg-red-900/20 p-2 text-sm text-red-300">{error}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="plant-id">Plant ID *</Label>
          <Input
            id="plant-id"
            value={formData.plant_id}
            onChange={(event) => setFormData((prev) => ({ ...prev, plant_id: event.target.value }))}
            placeholder="P001"
            className="bg-slate-900 text-white"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plant-nickname">Nickname</Label>
          <Input
            id="plant-nickname"
            value={formData.nickname}
            onChange={(event) => setFormData((prev) => ({ ...prev, nickname: event.target.value }))}
            placeholder="Optional"
            className="bg-slate-900 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plant-serial-number">Serial Number</Label>
          <Input
            id="plant-serial-number"
            value={formData.serial_number}
            onChange={(event) => setFormData((prev) => ({ ...prev, serial_number: event.target.value }))}
            onBlur={() => {
              const result = validateAndNormalizePlantSerialNumber(formData.serial_number);
              if (result.valid) {
                setFormData((prev) => ({ ...prev, serial_number: result.value || '' }));
              }
            }}
            placeholder="Optional"
            className="bg-slate-900 text-white"
          />
          <p className="text-xs text-muted-foreground">Optional manufacturer serial number. Letters and numbers only.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="plant-category">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, category_id: value }))}
            disabled={isFetchingCategories}
          >
            <SelectTrigger id="plant-category" className="bg-slate-900 text-white">
              <SelectValue placeholder={isFetchingCategories ? 'Loading categories...' : 'Select category'} />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900">
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id} className="text-white">
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-slate-600 text-white">
            Cancel
          </Button>
          <Button type="submit" className="bg-maintenance hover:bg-maintenance-dark" disabled={isLoading || isFetchingCategories}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add Plant
          </Button>
        </div>
      </form>
    </OnceDialog>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

