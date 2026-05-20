'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, PackageSearch, Send } from 'lucide-react';
import type { InventoryItem, InventoryLocation, InventoryMovePayload, InventoryUserLocation } from '../types';
import { InventoryTable } from './InventoryTable';

const LOCATION_NOT_SHOWN_VALUE = '__location_not_shown__';

interface InventoryEmployeeViewProps {
  items: InventoryItem[];
  locations: InventoryLocation[];
  categoryLabels?: Record<string, string>;
  userLocation: InventoryUserLocation | null;
  onSetUserLocation: (locationId: string) => Promise<void>;
  onRequestLocation: (payload: { suggested_name: string; note: string }) => Promise<void>;
  onMoveItems: (items: InventoryItem[], payload: InventoryMovePayload) => Promise<void>;
  onOpenMoveDialog: (items: InventoryItem[]) => void;
}

export function InventoryEmployeeView({
  items,
  locations,
  categoryLabels,
  userLocation,
  onSetUserLocation,
  onRequestLocation,
  onMoveItems,
  onOpenMoveDialog,
}: InventoryEmployeeViewProps) {
  const initialLocationId = userLocation?.location?.is_active === false ? '' : userLocation?.location_id || '';
  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId);
  const [suggestedName, setSuggestedName] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [claimSearch, setClaimSearch] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const activeLocation = userLocation?.location?.is_active === false ? null : userLocation?.location || null;
  const isRequestingMissingLocation = selectedLocationId === LOCATION_NOT_SHOWN_VALUE;

  useEffect(() => {
    setSelectedLocationId(userLocation?.location?.is_active === false ? '' : userLocation?.location_id || '');
  }, [userLocation?.location?.is_active, userLocation?.location_id]);

  const locationItems = useMemo(
    () => items.filter((item) => item.status === 'active' && item.location_id === activeLocation?.id),
    [activeLocation?.id, items]
  );
  const claimableItems = useMemo(() => {
    const query = claimSearch.trim().toLowerCase();
    if (!activeLocation || !query) return [];

    return items
      .filter((item) => item.status === 'active' && item.location_id !== activeLocation.id)
      .filter((item) => (
        item.item_number.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        (item.location?.name || '').toLowerCase().includes(query)
      ))
      .slice(0, 8);
  }, [activeLocation, claimSearch, items]);

  async function handleSetLocation() {
    if (!selectedLocationId || isRequestingMissingLocation) return;
    setIsSavingLocation(true);
    try {
      await onSetUserLocation(selectedLocationId);
    } finally {
      setIsSavingLocation(false);
    }
  }

  async function handleRequestLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!suggestedName.trim()) return;

    setIsRequestingLocation(true);
    try {
      await onRequestLocation({ suggested_name: suggestedName, note: requestNote });
      setSuggestedName('');
      setRequestNote('');
    } finally {
      setIsRequestingLocation(false);
    }
  }

  function renderLocationOptions() {
    return (
      <>
        {locations.map((location) => (
          <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
        ))}
        <SelectItem
          value={LOCATION_NOT_SHOWN_VALUE}
          className="mt-1 border-t border-amber-500/30 bg-amber-500/10 font-semibold text-amber-200 focus:bg-amber-500/20 focus:text-amber-100"
        >
          Location not shown
        </SelectItem>
      </>
    );
  }

  function renderLocationRequestCard() {
    if (!isRequestingMissingLocation) return null;

    return (
      <Card className="border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="text-white">Request Admin To Add My Location</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleRequestLocation}>
            <div className="space-y-2">
              <Label htmlFor="suggested_location">Suggested location name</Label>
              <Input
                id="suggested_location"
                value={suggestedName}
                onChange={(event) => setSuggestedName(event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location_request_note">Note</Label>
              <Textarea
                id="location_request_note"
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                className="bg-slate-800 border-slate-600"
                rows={3}
              />
            </div>
            <Button
              type="submit"
              disabled={!suggestedName.trim() || isRequestingLocation}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              <Send className="mr-2 h-4 w-4" />
              Send Request
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  async function handleClaim(item: InventoryItem) {
    if (!activeLocation) return;
    if (item.group) {
      onOpenMoveDialog([item]);
      return;
    }

    await onMoveItems([item], {
      location_id: activeLocation.id,
      note: 'Claimed from employee inventory view',
      scope: 'claim',
      group_id: null,
    });
    setClaimSearch('');
  }

  if (!activeLocation) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <Card className="border-slate-700 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <MapPin className="h-5 w-5 text-inventory" />
              Set Your Inventory Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the location or bin you are working from. Inventory items assigned to that location will appear here.
            </p>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger className="bg-slate-800 border-slate-600">
                  <SelectValue placeholder="Choose your location" />
                </SelectTrigger>
                <SelectContent>
                  {renderLocationOptions()}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSetLocation}
              disabled={!selectedLocationId || isRequestingMissingLocation || isSavingLocation}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              Save Location
            </Button>
          </CardContent>
        </Card>

        {renderLocationRequestCard()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <PackageSearch className="h-5 w-5 text-inventory" />
            My Inventory Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          {locationItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No active inventory items are currently assigned to this location.</p>
          ) : (
            <InventoryTable
              items={locationItems}
              selectedItemIds={selectedItemIds}
              onSelectedItemIdsChange={setSelectedItemIds}
              onMove={onOpenMoveDialog}
              categoryLabels={categoryLabels}
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="text-white">Claim An Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={claimSearch}
            onChange={(event) => setClaimSearch(event.target.value)}
            placeholder="Search item name, ID, or current location"
            className="bg-slate-800 border-slate-600"
          />
          {claimableItems.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-white">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.item_number} · Currently at {item.location?.name || 'No location assigned'}</div>
              </div>
              <Button size="sm" className="bg-inventory text-white hover:bg-inventory-dark" onClick={() => handleClaim(item)}>
                Claim
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
