'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocation, InventoryUserLocation } from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';

interface ChangeInventoryLocationDialogProps {
  open: boolean;
  locations: InventoryLocation[];
  userLocation: InventoryUserLocation | null;
  allowUnset?: boolean;
  onClose: () => void;
  onSubmit: (payload: { locationId: string; reason: string }) => Promise<void>;
  onUnset?: () => Promise<void>;
}

export function ChangeInventoryLocationDialog({
  open,
  locations,
  userLocation,
  allowUnset = false,
  onClose,
  onSubmit,
  onUnset,
}: ChangeInventoryLocationDialogProps) {
  const hasSavedLocation = Boolean(userLocation?.location_id);
  const hasActiveExistingLocation = Boolean(userLocation?.location_id && userLocation.location?.is_active !== false);
  const [locationId, setLocationId] = useState(hasActiveExistingLocation ? userLocation?.location_id || '' : '');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUnsetting, setIsUnsetting] = useState(false);
  const isSameLocation = hasActiveExistingLocation && locationId === userLocation?.location_id;
  const selectedLocation = locations.find((location) => location.id === locationId) || null;
  const selectedFleetLabel = selectedLocation
    ? [selectedLocation.linked_asset_label, selectedLocation.linked_asset_nickname].filter(Boolean).join(' - ')
    : '';

  useEffect(() => {
    if (!open) return;
    setLocationId(userLocation?.location_id && userLocation.location?.is_active !== false ? userLocation.location_id : '');
    setReason('');
  }, [open, userLocation?.location?.is_active, userLocation?.location_id]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!locationId || isSameLocation || (hasActiveExistingLocation && !reason.trim())) return;

    setIsSaving(true);
    try {
      await onSubmit({ locationId, reason });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnsetLocation() {
    if (!allowUnset || !onUnset || !hasSavedLocation) return;

    setIsUnsetting(true);
    try {
      await onUnset();
      onClose();
    } finally {
      setIsUnsetting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isSaving && !isUnsetting) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-slate-700 bg-slate-900 text-white">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{hasActiveExistingLocation ? 'Change Inventory Location' : 'Set Inventory Location'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {hasActiveExistingLocation
                ? 'Choose your new location and explain why it needs to change.'
                : 'Choose the location you want to use when claiming inventory items.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>New Location</Label>
              <InventoryLocationSelect
                value={locationId}
                onValueChange={setLocationId}
                locations={locations}
              />
              {selectedLocation ? (
                <p className="text-xs text-muted-foreground">
                  {selectedLocation.linked_asset_type
                    ? `Saving this location will set your current fleet assignment to ${selectedLocation.linked_asset_type.toUpperCase()} ${selectedFleetLabel || selectedLocation.name}.`
                    : 'Saving this location will clear any current fleet asset assignment on your profile.'}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location_change_reason">
                Reason for changing location{hasActiveExistingLocation ? ' *' : ''}
              </Label>
              <Textarea
                id="location_change_reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="border-slate-600 bg-slate-800"
                rows={4}
                placeholder={hasActiveExistingLocation ? 'Example: I am now working from a different van/bin.' : 'Optional note'}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving || isUnsetting}>
              Cancel
            </Button>
            {allowUnset && hasSavedLocation ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleUnsetLocation}
                disabled={isSaving || isUnsetting}
                className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
              >
                Unset Location
              </Button>
            ) : null}
            <Button
              type="submit"
              className="bg-inventory text-white hover:bg-inventory-dark"
              disabled={isSaving || isUnsetting || !locationId || isSameLocation || (hasActiveExistingLocation && !reason.trim())}
            >
              Save Location
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
