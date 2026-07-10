'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Save, Truck, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Validation schema
const vehicleEditSchema = z.object({
  reg_number: z.string().min(1, 'Registration number is required'),
  nickname: z.string().max(100).optional().nullable(),
  category_id: z.string().min(1, 'Category is required'),
  status: z.enum(['active', 'inactive', 'sold', 'written_off']),
});

type VehicleEditData = z.infer<typeof vehicleEditSchema>;

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  category_id: string;
  van_categories?: { name: string; id: string } | null;
};

type Category = {
  id: string;
  name: string;
};

interface VrnComparisonDifference {
  key: string;
  label: string;
  source: 'DVLA' | 'MOT';
  oldValue: string | null;
  newValue: string | null;
}

interface VrnLookupWarning {
  registrationNumber: string;
  source: 'DVLA' | 'MOT';
  message: string;
}

interface VrnChangeComparison {
  oldRegistration: string;
  newRegistration: string;
  hasDifferences: boolean;
  differences: VrnComparisonDifference[];
  warnings: VrnLookupWarning[];
}

interface VrnChangeCheckResponse {
  success?: boolean;
  requiresConfirmation?: boolean;
  comparison?: VrnChangeComparison | null;
  error?: string;
}

interface FleetSyncResultRow {
  error?: string;
  errors?: string[];
}

interface FleetSyncSummaryResponse {
  total?: number;
  successful?: number;
  failed?: number;
  warning?: string;
  results?: FleetSyncResultRow[];
}

interface VanUpdateResponse {
  vehicle?: Vehicle;
  syncResult?: FleetSyncSummaryResponse | null;
  error?: string;
}

interface ExpandingVehicleCardProps {
  vehicle: Vehicle;
  categories: Category[];
  onUpdate: () => void;
  fromTab?: 'maintenance' | 'plant' | 'vans' | 'hgvs'; // Tab to return to on back navigation
}

export function ExpandingVehicleCard({ vehicle, categories, onUpdate, fromTab = 'vans' }: ExpandingVehicleCardProps) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isCheckingVrn, setIsCheckingVrn] = useState(false);
  const [isSavingUpdate, setIsSavingUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<VehicleEditData | null>(null);
  const [vrnComparison, setVrnComparison] = useState<VrnChangeComparison | null>(null);
  const [vrnConfirmOpen, setVrnConfirmOpen] = useState(false);
  
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<VehicleEditData>({
    resolver: zodResolver(vehicleEditSchema),
    defaultValues: {
      reg_number: vehicle.reg_number,
      nickname: vehicle.nickname || '',
      category_id: vehicle.category_id,
      status: vehicle.status as 'active' | 'inactive' | 'sold' | 'written_off',
    },
  });

  const selectedCategoryId = watch('category_id');
  const selectedStatus = watch('status');
  const isBusy = isSubmitting || isCheckingVrn || isSavingUpdate;

  const handleExpand = () => {
    if (!isExpanded) {
      // Reset form when expanding
      reset({
        reg_number: vehicle.reg_number,
        nickname: vehicle.nickname || '',
        category_id: vehicle.category_id,
        status: vehicle.status as 'active' | 'inactive' | 'sold' | 'written_off',
      });
    }
    setIsExpanded(!isExpanded);
    setIsEditing(false);
  };

  const handleEditToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditing && isDirty) {
      // Confirm discard changes
      if (confirm('You have unsaved changes. Discard them?')) {
        reset();
        setIsEditing(false);
      }
    } else {
      setIsEditing(!isEditing);
    }
  };

  const performUpdate = async (data: VehicleEditData) => {
    try {
      setIsSavingUpdate(true);
      const response = await fetch(`/api/admin/vans/${vehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_number: data.reg_number.trim(),
          nickname: data.nickname?.trim() || null,
          category_id: data.category_id,
          status: data.status,
        }),
      });

      const updateResult = (await response.json()) as VanUpdateResponse;
      if (!response.ok) {
        throw new Error(updateResult.error || 'Failed to update vehicle');
      }

      const syncWarning = getSyncWarning(updateResult.syncResult);
      if (syncWarning) {
        toast.warning('Vehicle updated, but DVLA/MOT refresh needs attention', {
          description: syncWarning,
        });
      } else if (hasRegistrationChanged(vehicle.reg_number, data.reg_number)) {
        toast.success('Vehicle updated and DVLA/MOT refreshed');
      } else {
        toast.success('Vehicle updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'history', vehicle.id] });
      setIsEditing(false);
      setPendingUpdate(null);
      setVrnComparison(null);
      setVrnConfirmOpen(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating vehicle:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update vehicle');
    } finally {
      setIsSavingUpdate(false);
    }
  };

  const onSubmit = async (data: VehicleEditData) => {
    if (!hasRegistrationChanged(vehicle.reg_number, data.reg_number)) {
      await performUpdate(data);
      return;
    }

    try {
      setIsCheckingVrn(true);
      const response = await fetch(`/api/admin/vans/${vehicle.id}/vrn-change-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_reg_number: data.reg_number.trim() }),
      });
      const checkResult = (await response.json()) as VrnChangeCheckResponse;

      if (!response.ok) {
        throw new Error(checkResult.error || 'Failed to compare registration details');
      }

      if (checkResult.requiresConfirmation && checkResult.comparison) {
        setPendingUpdate(data);
        setVrnComparison(checkResult.comparison);
        setVrnConfirmOpen(true);
        return;
      }

      await performUpdate(data);
    } catch (error) {
      console.error('Error checking VRN change:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to compare registration details');
    } finally {
      setIsCheckingVrn(false);
    }
  };

  const handleConfirmVrnChange = async () => {
    if (!pendingUpdate) return;
    await performUpdate(pendingUpdate);
  };

  const handleVrnConfirmOpenChange = (open: boolean) => {
    if (isSavingUpdate) return;
    setVrnConfirmOpen(open);
    if (!open) {
      setPendingUpdate(null);
      setVrnComparison(null);
    }
  };

  return (
    <>
    <Card className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-all">
      <CardContent className="p-4">
        {/* Collapsed View - Always Visible */}
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={handleExpand}
        >
          <div className="flex items-center gap-4 flex-1">
            <div className="bg-blue-500/10 p-3 rounded-lg">
              <Truck className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                {vehicle.reg_number}
                {vehicle.nickname && (
                  <span className="text-sm text-slate-400 font-normal">({vehicle.nickname})</span>
                )}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>{vehicle.van_categories?.name || 'No Category'}</span>
                <span>•</span>
                <Badge 
                  variant={vehicle.status === 'active' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {vehicle.status}
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Link 
              href={`/fleet/vans/${vehicle.id}/history?fromTab=${fromTab}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                History
              </Button>
            </Link>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Expanded View - Edit Form */}
        {isExpanded && (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 pt-6 border-t border-slate-700 space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Vehicle Details
              </h4>
              {!isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleEditToggle}
                  className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
                >
                  Edit Details
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleEditToggle}
                    disabled={isBusy}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!isDirty || isBusy}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isCheckingVrn ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Checking VRN...
                      </>
                    ) : isSavingUpdate || isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-1" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Registration Number */}
              <div className="space-y-2">
                <Label htmlFor={`reg-${vehicle.id}`} className="text-white">
                  Registration Number
                </Label>
                <Input
                  id={`reg-${vehicle.id}`}
                  {...register('reg_number')}
                  disabled={!isEditing}
                  className="bg-input border-border text-white disabled:opacity-70"
                />
                {errors.reg_number && (
                  <p className="text-sm text-red-400">{errors.reg_number.message}</p>
                )}
              </div>

              {/* Nickname */}
              <div className="space-y-2">
                <Label htmlFor={`nickname-${vehicle.id}`} className="text-white">
                  Nickname <span className="text-slate-400 text-xs">(Optional)</span>
                </Label>
                <Input
                  id={`nickname-${vehicle.id}`}
                  {...register('nickname')}
                  disabled={!isEditing}
                  placeholder="e.g., Andy's Van, Main Truck"
                  className="bg-input border-border text-white disabled:opacity-70"
                />
                {errors.nickname && (
                  <p className="text-sm text-red-400">{errors.nickname.message}</p>
                )}
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor={`category-${vehicle.id}`} className="text-white">
                  Category
                </Label>
                <Select
                  value={selectedCategoryId}
                  onValueChange={(value) => setValue('category_id', value, { shouldDirty: true })}
                  disabled={!isEditing}
                >
                  <SelectTrigger 
                    id={`category-${vehicle.id}`}
                    className="bg-input border-border text-white disabled:opacity-70"
                  >
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="bg-input border-border dark:text-slate-100 text-slate-900">
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category_id && (
                  <p className="text-sm text-red-400">{errors.category_id.message}</p>
                )}
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor={`status-${vehicle.id}`} className="text-white">
                  Status
                </Label>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => setValue('status', value as 'active' | 'inactive' | 'sold' | 'written_off', { shouldDirty: true })}
                  disabled={!isEditing}
                >
                  <SelectTrigger 
                    id={`status-${vehicle.id}`}
                    className="bg-input border-border text-white disabled:opacity-70"
                  >
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="bg-input border-border dark:text-slate-100 text-slate-900">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                    <SelectItem value="written_off">Written Off</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && (
                  <p className="text-sm text-red-400">{errors.status.message}</p>
                )}
              </div>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
    <AlertDialog open={vrnConfirmOpen} onOpenChange={handleVrnConfirmOpenChange}>
      <AlertDialogContent className="border-border text-white sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Registration details differ
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Live DVLA/MOT checks for {vrnComparison?.oldRegistration} and {vrnComparison?.newRegistration} did not return exactly the same details. You can still continue if this private plate change is expected.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {vrnComparison?.warnings.length ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            {vrnComparison.warnings.map((warning) => (
              <p key={`${warning.registrationNumber}-${warning.source}-${warning.message}`}>
                {warning.source} check for {warning.registrationNumber}: {warning.message}
              </p>
            ))}
          </div>
        ) : null}

        {vrnComparison?.differences.length ? (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {vrnComparison.differences.map((difference) => (
              <div
                key={difference.key}
                className="grid gap-2 rounded-md border border-slate-700 bg-slate-950/50 p-3 text-sm md:grid-cols-[140px_1fr_1fr]"
              >
                <div>
                  <p className="font-medium text-white">{difference.label}</p>
                  <p className="text-xs text-slate-400">{difference.source}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Old VRN</p>
                  <p className="text-slate-200">{difference.oldValue || 'Not returned'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">New VRN</p>
                  <p className="text-slate-200">{difference.newValue || 'Not returned'}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSavingUpdate}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isSavingUpdate}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirmVrnChange();
            }}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {isSavingUpdate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Continue and Update
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function normalizeRegistration(registrationNumber: string): string {
  return registrationNumber.replace(/\s+/g, '').trim().toUpperCase();
}

function hasRegistrationChanged(oldRegistration: string, newRegistration: string): boolean {
  return normalizeRegistration(oldRegistration) !== normalizeRegistration(newRegistration);
}

function getSyncWarning(syncResult: FleetSyncSummaryResponse | null | undefined): string | null {
  if (!syncResult) return null;
  if (syncResult.warning) return syncResult.warning;
  if (!syncResult.failed || syncResult.failed <= 0) return null;

  const firstFailedResult = syncResult.results?.find((result) => result.error || result.errors?.length);
  return firstFailedResult?.error || firstFailedResult?.errors?.[0] || 'DVLA/MOT refresh failed';
}
