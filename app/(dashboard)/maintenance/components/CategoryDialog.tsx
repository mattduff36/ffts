'use client';

import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { Loader2, Save, Plus, Briefcase, Wrench, Bell, Mail, Eye, Truck, HardHat } from 'lucide-react';
import type { MaintenanceCategory, CreateCategoryRequest, UpdateCategoryRequest } from '@/types/maintenance';
import { useCreateCategory, useUpdateCategory } from '@/lib/hooks/useMaintenance';
import {
  formatPeriodValue,
  normalizePeriodUnit,
} from '@/lib/utils/maintenancePeriods';
import { getDistanceTypeLabel } from '@/lib/utils/maintenanceCategoryRules';

// ============================================================================
// Zod Validation Schema
// ============================================================================

const createCategorySchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .nullable(),
  type: z.enum(['date', 'mileage', 'hours']),
  alert_threshold_days: z.coerce.number()
    .int()
    .positive('Must be positive')
    .optional()
    .nullable(),
  alert_threshold_miles: z.coerce.number()
    .int()
    .positive('Must be positive')
    .optional()
    .nullable(),
  alert_threshold_hours: z.coerce.number()
    .int()
    .positive('Must be positive')
    .optional()
    .nullable(),
  period_unit: z.enum(['weeks', 'months', 'miles', 'hours']),
  period_value: z.coerce.number()
    .int('Period must be a whole number')
    .positive('Period must be a positive number'),
  applies_to: z.array(z.enum(['van', 'plant', 'hgv']))
    .min(1, 'Category must apply to at least one asset type')
    .default(['van']),
  is_active: z.boolean().optional(),
  // New fields for duty/responsibility
  responsibility: z.enum(['workshop', 'office']).default('workshop'),
  show_on_overview: z.boolean().default(true),
  reminder_in_app_enabled: z.boolean().default(false),
  reminder_email_enabled: z.boolean().default(false),
}).superRefine((data, ctx) => {
  // ✅ Use superRefine for dynamic error paths based on category type
  if (data.type === 'date') {
    if (data.alert_threshold_days == null || data.alert_threshold_days <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date-based categories need days threshold',
        path: ['alert_threshold_days']
      });
    }
  } else if (data.type === 'mileage') {
    if (data.alert_threshold_miles == null || data.alert_threshold_miles <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Distance-based categories need a threshold',
        path: ['alert_threshold_miles']
      });
    }
  } else if (data.type === 'hours') {
    if (data.alert_threshold_hours == null || data.alert_threshold_hours <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hours-based categories need hours threshold',
        path: ['alert_threshold_hours']
      });
    }
  }
});

const editCategorySchema = createCategorySchema.partial().extend({
  type: z.enum(['date', 'mileage', 'hours']).optional(), // Type cannot be changed in edit
});

type CategoryFormData = z.infer<typeof createCategorySchema>;

function buildCategoryDialogSnapshot(value: Partial<CategoryFormData> | undefined) {
  return JSON.stringify(value || {});
}

function normalizeAppliesTo(values?: string[] | null): Array<'van' | 'plant' | 'hgv'> {
  const normalized = (values || []).filter(
    (value): value is 'van' | 'plant' | 'hgv' => value === 'van' || value === 'plant' || value === 'hgv',
  );
  return normalized.length > 0 ? normalized : ['van'];
}

function buildInitialCategoryFormValues(
  mode: 'create' | 'edit',
  category?: MaintenanceCategory | null
): CategoryFormData {
  if (mode === 'edit' && category) {
    return {
      name: category.name,
      description: category.description || '',
      type: category.type,
      period_unit: normalizePeriodUnit(category.type, category.period_unit),
      period_value: category.period_value,
      alert_threshold_days: category.alert_threshold_days || undefined,
      alert_threshold_miles: category.alert_threshold_miles || undefined,
      alert_threshold_hours: category.alert_threshold_hours || undefined,
      applies_to: normalizeAppliesTo(category.applies_to),
      is_active: category.is_active,
      responsibility: category.responsibility || 'workshop',
      show_on_overview: category.show_on_overview !== false,
      reminder_in_app_enabled: category.reminder_in_app_enabled || false,
      reminder_email_enabled: category.reminder_email_enabled || false,
    };
  }

  return {
    name: '',
    description: '',
    type: 'date',
    period_unit: 'months',
    period_value: 12,
    alert_threshold_days: 30,
    alert_threshold_miles: undefined,
    alert_threshold_hours: undefined,
    applies_to: ['van'],
    is_active: true,
    responsibility: 'workshop',
    show_on_overview: true,
    reminder_in_app_enabled: false,
    reminder_email_enabled: false,
  };
}

// ============================================================================
// Component
// ============================================================================

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  category?: MaintenanceCategory | null;
}

export function CategoryDialog({
  open,
  onOpenChange,
  mode,
  category
}: CategoryDialogProps) {
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
    setValue,
    getValues,
  } = useForm<CategoryFormData>({
    resolver: zodResolver(mode === 'create' ? createCategorySchema : editCategorySchema) as never,
    defaultValues: {
      type: 'date',
      is_active: true,
      period_unit: 'months',
      responsibility: 'workshop',
      show_on_overview: true,
      reminder_in_app_enabled: false,
      reminder_email_enabled: false,
    }
  });

  const selectedType = useWatch({ control, name: 'type' });
  const selectedResponsibility = useWatch({ control, name: 'responsibility' });
  const showOnOverview = useWatch({ control, name: 'show_on_overview' });
  const reminderInApp = useWatch({ control, name: 'reminder_in_app_enabled' });
  const reminderEmail = useWatch({ control, name: 'reminder_email_enabled' });
  const appliesTo = useWatch({ control, name: 'applies_to' });
  const selectedPeriodUnit = useWatch({ control, name: 'period_unit' });
  const formValues = useWatch({ control });
  const distanceTypeLabel = getDistanceTypeLabel(appliesTo);
  const initialDirtySnapshot = useMemo(
    () => buildCategoryDialogSnapshot(buildInitialCategoryFormValues(mode, category)),
    [category, mode]
  );
  const currentDirtySnapshot = buildCategoryDialogSnapshot(formValues);
  const isFormDirty = open && Boolean(initialDirtySnapshot) && currentDirtySnapshot !== initialDirtySnapshot;
  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handleEscapeKeyDown,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: isSubmitting || createMutation.isPending || updateMutation.isPending,
    onOpenChange,
  });

  // Reset form when dialog opens/closes or category changes
  useEffect(() => {
    if (open && mode === 'edit' && category) {
      reset(buildInitialCategoryFormValues(mode, category));
    } else if (open && mode === 'create') {
      reset(buildInitialCategoryFormValues(mode, category));
    }
  }, [open, mode, category, reset]);

  // Clear opposite threshold and set sensible defaults when type changes
  useEffect(() => {
    if (selectedType === 'date') {
      const nextUnit = normalizePeriodUnit('date', getValues('period_unit'));
      setValue('period_unit', nextUnit);
      setValue('alert_threshold_miles', undefined);
      setValue('alert_threshold_hours', undefined);
      if (!getValues('alert_threshold_days')) {
        setValue('alert_threshold_days', 30);
      }
      if (!getValues('period_value')) {
        setValue('period_value', 12);
      }
    } else if (selectedType === 'mileage') {
      setValue('period_unit', 'miles');
      setValue('alert_threshold_days', undefined);
      setValue('alert_threshold_hours', undefined);
      if (!getValues('alert_threshold_miles')) {
        setValue('alert_threshold_miles', 1000);
      }
      if (!getValues('period_value')) {
        setValue('period_value', 10000);
      }
    } else if (selectedType === 'hours') {
      setValue('period_unit', 'hours');
      setValue('alert_threshold_days', undefined);
      setValue('alert_threshold_miles', undefined);
      if (!getValues('alert_threshold_hours')) {
        setValue('alert_threshold_hours', 50);
      }
      if (!getValues('period_value')) {
        setValue('period_value', 250);
      }
      setValue('applies_to', ['plant']);
    }
  }, [selectedType, setValue, getValues]);

  const onSubmit = async (data: CategoryFormData) => {
    if (mode === 'create') {
      const createData: CreateCategoryRequest = {
        name: data.name,
        description: data.description || undefined,
        type: data.type,
        period_unit: data.period_unit,
        period_value: data.period_value,
        alert_threshold_days: data.type === 'date' ? (data.alert_threshold_days ?? undefined) : undefined,
        alert_threshold_miles: data.type === 'mileage' ? (data.alert_threshold_miles ?? undefined) : undefined,
        alert_threshold_hours: data.type === 'hours' ? (data.alert_threshold_hours ?? undefined) : undefined,
        applies_to: data.applies_to,
        responsibility: data.responsibility,
        show_on_overview: data.show_on_overview,
        reminder_in_app_enabled: data.reminder_in_app_enabled,
        reminder_email_enabled: data.reminder_email_enabled,
      };
      await createMutation.mutateAsync(createData);
      onOpenChange(false);
    } else if (mode === 'edit' && category) {
      const updateData: UpdateCategoryRequest = {
        name: data.name,
        description: data.description || undefined,
        period_unit: data.period_unit,
        period_value: data.period_value,
        alert_threshold_days: data.type === 'date' ? (data.alert_threshold_days ?? undefined) : undefined,
        alert_threshold_miles: data.type === 'mileage' ? (data.alert_threshold_miles ?? undefined) : undefined,
        alert_threshold_hours: data.type === 'hours' ? (data.alert_threshold_hours ?? undefined) : undefined,
        applies_to: data.applies_to,
        is_active: data.is_active,
        responsibility: data.responsibility,
        show_on_overview: data.show_on_overview,
        reminder_in_app_enabled: data.reminder_in_app_enabled,
        reminder_email_enabled: data.reminder_email_enabled,
      };
      await updateMutation.mutateAsync({ id: category.id, updates: updateData });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className="border-border text-white max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="text-2xl">
            {mode === 'create' ? 'Add New Category' : 'Edit Category'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {mode === 'create' 
              ? 'Create a new maintenance category with period and alert threshold'
              : 'Update category settings. Note: Type cannot be changed after creation.'
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="min-h-0 flex-1 flex flex-col">
          <input type="hidden" {...register('period_unit')} />
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-6">
              <div className="space-y-5">

          {/* Category Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Category Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="e.g., Brake Service, Tyre Replacement"
              className="bg-input border-border text-white"
            />
            {errors.name && (
              <p className="text-sm text-red-400">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Brief description of this maintenance type..."
              className="bg-input border-border text-white"
              rows={2}
            />
            {errors.description && (
              <p className="text-sm text-red-400">{errors.description.message}</p>
            )}
          </div>

          {/* Type Selection (Only for create) */}
          <div className="space-y-3">
            <Label>
              Type <span className="text-red-400">*</span>
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => mode !== 'edit' && setValue('type', 'date')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  mode === 'edit' 
                    ? 'opacity-50 cursor-not-allowed border-slate-700 bg-slate-800/50' 
                    : selectedType === 'date'
                      ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedType === 'date' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-slate-500'
                  }`}>
                    {selectedType === 'date' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <p className={`font-medium ${selectedType === 'date' ? 'text-blue-400' : 'text-white'}`}>
                    Date
                  </p>
                </div>
              </button>
              
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => mode !== 'edit' && setValue('type', 'mileage')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  mode === 'edit' 
                    ? 'opacity-50 cursor-not-allowed border-slate-700 bg-slate-800/50' 
                    : selectedType === 'mileage'
                      ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedType === 'mileage' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-slate-500'
                  }`}>
                    {selectedType === 'mileage' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <p className={`font-medium ${selectedType === 'mileage' ? 'text-blue-400' : 'text-white'}`}>
                    Miles / KM
                  </p>
                </div>
              </button>
              
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => mode !== 'edit' && setValue('type', 'hours')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  mode === 'edit' 
                    ? 'opacity-50 cursor-not-allowed border-slate-700 bg-slate-800/50' 
                    : selectedType === 'hours'
                      ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedType === 'hours' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-slate-500'
                  }`}>
                    {selectedType === 'hours' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <p className={`font-medium ${selectedType === 'hours' ? 'text-blue-400' : 'text-white'}`}>
                    Hours
                  </p>
                </div>
              </button>
            </div>
            {mode === 'edit' && (
              <p className="text-xs text-muted-foreground">Type cannot be changed after creation</p>
            )}
          </div>

          {/* Alert Threshold */}
          <div className="space-y-2">
            {selectedType === 'date' ? (
              <>
                <Label htmlFor="alert_threshold_days">
                  Alert Threshold (Days) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="alert_threshold_days"
                  type="number"
                  {...register('alert_threshold_days')}
                  placeholder="e.g., 30"
                  className="bg-input border-border text-white"
                />
                <p className="text-xs text-muted-foreground">
                  Show &quot;Due Soon&quot; alert when this many days before the due date
                </p>
                {errors.alert_threshold_days && (
                  <p className="text-sm text-red-400">{errors.alert_threshold_days.message}</p>
                )}
              </>
            ) : selectedType === 'mileage' ? (
              <>
                <Label htmlFor="alert_threshold_miles">
                  Alert Threshold ({distanceTypeLabel}) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="alert_threshold_miles"
                  type="number"
                  {...register('alert_threshold_miles')}
                  placeholder="e.g., 1000"
                  className="bg-input border-border text-white"
                />
                <p className="text-xs text-muted-foreground">
                  Show &quot;Due Soon&quot; alert when this many {distanceTypeLabel.toLowerCase()} before the due reading.
                </p>
                {errors.alert_threshold_miles && (
                  <p className="text-sm text-red-400">{errors.alert_threshold_miles.message}</p>
                )}
              </>
            ) : (
              <>
                <Label htmlFor="alert_threshold_hours">
                  Alert Threshold (Hours) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="alert_threshold_hours"
                  type="number"
                  {...register('alert_threshold_hours')}
                  placeholder="e.g., 50"
                  className="bg-input border-border text-white"
                />
                <p className="text-xs text-muted-foreground">
                  Show &quot;Due Soon&quot; alert when this many engine hours before the service is due
                </p>
                {errors.alert_threshold_hours && (
                  <p className="text-sm text-red-400">{errors.alert_threshold_hours.message}</p>
                )}
              </>
            )}
          </div>

          {/* Period (Due Interval) */}
          <div className="space-y-2">
            {selectedType === 'date' && (
              <div className="space-y-2">
                <Label>
                  Date Period Unit <span className="text-red-400">*</span>
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  {(['weeks', 'months'] as const).map((unit) => {
                    const isSelected = selectedPeriodUnit === unit;
                    return (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => setValue('period_unit', unit)}
                        className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                            : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                        }`}
                      >
                        <p className={`font-medium capitalize ${isSelected ? 'text-blue-400' : 'text-white'}`}>
                          {unit}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {unit === 'weeks' ? 'Use for recurring inspections like 6-week checks.' : 'Use for monthly or annual renewals.'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Label htmlFor="period_value">
              {selectedType === 'date'
                ? `Period (${selectedPeriodUnit === 'weeks' ? 'Weeks' : 'Months'})`
                : selectedType === 'mileage'
                ? `Period (${distanceTypeLabel})`
                : 'Period (Hours)'} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="period_value"
              type="number"
              {...register('period_value')}
              placeholder={
                selectedType === 'date'
                  ? selectedPeriodUnit === 'weeks'
                    ? 'e.g., 6'
                    : 'e.g., 12'
                  : selectedType === 'mileage'
                  ? 'e.g., 10000'
                  : 'e.g., 250'
              }
              className="bg-input border-border text-white"
            />
            <p className="text-xs text-muted-foreground">
              {selectedType === 'date'
                ? `How often this is due, in ${selectedPeriodUnit === 'weeks' ? 'weeks' : 'months'} (e.g. ${selectedPeriodUnit === 'weeks' ? formatPeriodValue(6, 'weeks') : formatPeriodValue(12, 'months')})`
                : selectedType === 'mileage'
                ? `How often this is due, in ${distanceTypeLabel.toLowerCase()} (e.g. 10,000 = every 10,000 ${distanceTypeLabel.toLowerCase()})`
                : 'How often this is due, in engine hours (e.g. 250 = every 250 hours)'}
            </p>
            {errors.period_value && (
              <p className="text-sm text-red-400">{errors.period_value.message}</p>
            )}
          </div>

          {/* Applies To Checkboxes */}
          <div className="space-y-3">
            <Label>Applies To <span className="text-red-400">*</span></Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="applies-vehicle"
                  checked={appliesTo?.includes('van') || false}
                  onCheckedChange={(checked) => {
                    const current = appliesTo || []; // ✅ Default to empty, not ['van']
                    if (checked) {
                      setValue('applies_to', [...current.filter(a => a !== 'van'), 'van']);
                    } else {
                      setValue('applies_to', current.filter(a => a !== 'van'));
                    }
                  }}
                  disabled={isSubmitting || selectedType === 'hours'}
                  className="border-slate-600"
                />
                <Label htmlFor="applies-vehicle" className="text-white cursor-pointer flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-400" />
                  Vans
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="applies-hgv"
                  checked={appliesTo?.includes('hgv') || false}
                  onCheckedChange={(checked) => {
                    const current = appliesTo || [];
                    if (checked) {
                      setValue('applies_to', [...current.filter(a => a !== 'hgv'), 'hgv']);
                    } else {
                      setValue('applies_to', current.filter(a => a !== 'hgv'));
                    }
                  }}
                  disabled={isSubmitting || selectedType === 'hours'}
                  className="border-slate-600"
                />
                <Label htmlFor="applies-hgv" className="text-white cursor-pointer flex items-center gap-2">
                  <Truck className="h-4 w-4 text-emerald-400" />
                  HGVs
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="applies-plant"
                  checked={appliesTo?.includes('plant') || false}
                  onCheckedChange={(checked) => {
                    const current = appliesTo || []; // ✅ Default to empty, not ['van']
                    if (checked) {
                      setValue('applies_to', [...current.filter(a => a !== 'plant'), 'plant']);
                    } else {
                      setValue('applies_to', current.filter(a => a !== 'plant'));
                    }
                  }}
                  disabled={isSubmitting || selectedType === 'mileage'}
                  className="border-slate-600"
                />
                <Label htmlFor="applies-plant" className="text-white cursor-pointer flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-orange-400" />
                  Plant Machinery
                </Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedType === 'mileage' && 'Distance-based categories apply to vans and HGVs. Vans display miles; HGVs display kilometres.'}
              {selectedType === 'hours' && 'Hours-based categories only apply to plant machinery.'}
              {selectedType === 'date' && 'Select which asset types this category applies to (at least one required).'}
            </p>
          </div>

              </div>
              <div className="space-y-5">
          {/* Divider */}
          <div className="border-b border-slate-700 pb-3">
            <h3 className="text-lg font-medium text-white">Duty & Notification Settings</h3>
          </div>

          {/* Responsibility */}
          <div className="space-y-3">
            <Label>
              Responsibility
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setValue('responsibility', 'workshop')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedResponsibility === 'workshop'
                    ? 'border-orange-500 bg-orange-500/20 ring-2 ring-orange-500/30'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedResponsibility === 'workshop' 
                      ? 'bg-orange-500' 
                      : 'bg-slate-700'
                  }`}>
                    <Wrench className={`h-5 w-5 ${
                      selectedResponsibility === 'workshop' ? 'text-white' : 'text-orange-400'
                    }`} />
                  </div>
                  <div>
                    <p className={`font-medium ${selectedResponsibility === 'workshop' ? 'text-orange-400' : 'text-white'}`}>
                      Workshop
                    </p>
                    <p className="text-xs text-muted-foreground">Create Task button</p>
                  </div>
                </div>
              </button>
              
              <button
                type="button"
                onClick={() => setValue('responsibility', 'office')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedResponsibility === 'office'
                    ? 'border-brand-yellow bg-brand-yellow/20 ring-2 ring-brand-yellow/30'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedResponsibility === 'office' 
                      ? 'bg-brand-yellow' 
                      : 'bg-slate-700'
                  }`}>
                    <Briefcase className={`h-5 w-5 ${
                      selectedResponsibility === 'office' ? 'text-slate-900' : 'text-brand-yellow'
                    }`} />
                  </div>
                  <div>
                    <p className={`font-medium ${selectedResponsibility === 'office' ? 'text-brand-yellow' : 'text-white'}`}>
                      Office
                    </p>
                    <p className="text-xs text-muted-foreground">Office Action button</p>
                  </div>
                </div>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedResponsibility === 'workshop' 
                ? 'Workshop tasks will show "Create Task" button for workshop staff.'
                : 'Office duties will show "Office Action" button with reminder and update options.'
              }
            </p>
          </div>

          {/* Show on Overview Toggle */}
          <div 
            className={`flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-all ${
              showOnOverview 
                ? 'border-green-500/50 bg-green-500/10' 
                : 'border-slate-600 bg-slate-800 hover:border-slate-500'
            }`}
            onClick={() => setValue('show_on_overview', !showOnOverview)}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                showOnOverview ? 'bg-green-500' : 'bg-slate-700'
              }`}>
                <Eye className={`h-5 w-5 ${showOnOverview ? 'text-white' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <Label htmlFor="show_on_overview" className={`text-sm font-medium cursor-pointer ${
                  showOnOverview ? 'text-green-400' : 'text-white'
                }`}>Show on Overview</Label>
                <p className="text-xs text-muted-foreground">
                  Display in Overdue/Due Soon sections
                </p>
              </div>
            </div>
            <Switch
              id="show_on_overview"
              checked={showOnOverview}
              onCheckedChange={(checked) => setValue('show_on_overview', checked)}
              className="data-[state=checked]:bg-green-500"
            />
          </div>

          {/* Reminder Settings (only for office responsibility) */}
          {selectedResponsibility === 'office' && (
            <div className="space-y-3 p-4 bg-slate-800/50 rounded-lg border border-border">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-400" />
                Reminder Notifications
              </h4>
              
              <div 
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  reminderInApp 
                    ? 'border-blue-500/50 bg-blue-500/10' 
                    : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                }`}
                onClick={() => setValue('reminder_in_app_enabled', !reminderInApp)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    reminderInApp ? 'bg-blue-500' : 'bg-slate-700'
                  }`}>
                    <Bell className={`h-4 w-4 ${reminderInApp ? 'text-white' : 'text-blue-400'}`} />
                  </div>
                  <div>
                    <Label htmlFor="reminder_in_app" className={`text-sm cursor-pointer ${
                      reminderInApp ? 'text-blue-400 font-medium' : 'text-white'
                    }`}>In-App Notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Send reminders to notification panel
                    </p>
                  </div>
                </div>
                <Switch
                  id="reminder_in_app"
                  checked={reminderInApp}
                  onCheckedChange={(checked) => setValue('reminder_in_app_enabled', checked)}
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>
              
              <div 
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  reminderEmail 
                    ? 'border-green-500/50 bg-green-500/10' 
                    : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                }`}
                onClick={() => setValue('reminder_email_enabled', !reminderEmail)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    reminderEmail ? 'bg-green-500' : 'bg-slate-700'
                  }`}>
                    <Mail className={`h-4 w-4 ${reminderEmail ? 'text-white' : 'text-green-400'}`} />
                  </div>
                  <div>
                    <Label htmlFor="reminder_email" className={`text-sm cursor-pointer ${
                      reminderEmail ? 'text-green-400 font-medium' : 'text-white'
                    }`}>Email Notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Send email reminders to configured recipients
                    </p>
                  </div>
                </div>
                <Switch
                  id="reminder_email"
                  checked={reminderEmail}
                  onCheckedChange={(checked) => setValue('reminder_email_enabled', checked)}
                  className="data-[state=checked]:bg-green-500"
                />
              </div>
              
              {(reminderInApp || reminderEmail) && (
                <p className="text-xs text-brand-yellow mt-2 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-yellow"></span>
                  Configure reminder recipients in Settings after saving.
                </p>
              )}
            </div>
          )}

          {/* Active Status (Only for edit) */}
          {mode === 'edit' && (
            <div className="flex items-center space-x-2">
              <input
                id="is_active"
                type="checkbox"
                {...register('is_active')}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <Label htmlFor="is_active" className="text-sm text-muted-foreground">
                Active (uncheck to disable this category)
              </Label>
            </div>
          )}

              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border bg-background/95">
            <Button
              type="button"
              variant="outline"
              onClick={discard}
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={isSubmitting}
            >
              {isFormDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
              className="bg-maintenance hover:bg-maintenance-dark"
            >
              {(isSubmitting || createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
