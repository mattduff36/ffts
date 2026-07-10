'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, PackageSearch, Send, Truck } from 'lucide-react';
import type {
  CurrentFleetAssignment,
  InventoryItem,
  InventoryLocation,
  InventoryUserLocation,
  InventoryUserSiteLocation,
} from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';
import { InventoryTable } from './InventoryTable';

const LOCATION_NOT_SHOWN_VALUE = '__location_not_shown__';

interface InventoryEmployeeViewProps {
  items: InventoryItem[];
  locations: InventoryLocation[];
  categoryLabels?: Record<string, string>;
  userLocation: InventoryUserLocation | null;
  secondarySiteLocations?: InventoryUserSiteLocation[];
  currentFleetAssignment?: CurrentFleetAssignment | null;
  onSetUserLocation: (locationId: string) => Promise<void>;
  onRequestLocation: (payload: { suggested_name: string; note: string }) => Promise<void>;
  onOpenMoveDialog: (items: InventoryItem[]) => void;
  onChangeLocation: () => void;
}

export function InventoryEmployeeView({
  items,
  locations,
  categoryLabels,
  userLocation,
  secondarySiteLocations = [],
  currentFleetAssignment,
  onSetUserLocation,
  onRequestLocation,
  onOpenMoveDialog,
  onChangeLocation,
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

  const activeItemsByLocationId = useMemo(() => {
    const nextItemsByLocationId = new Map<string, InventoryItem[]>();
    items.forEach((item) => {
      if (item.status !== 'active') return;
      const locationItems = nextItemsByLocationId.get(item.location_id) || [];
      locationItems.push(item);
      nextItemsByLocationId.set(item.location_id, locationItems);
    });
    return nextItemsByLocationId;
  }, [items]);
  const locationItems = activeLocation ? activeItemsByLocationId.get(activeLocation.id) || [] : [];
  const activeSecondarySiteLocations = useMemo(
    () => secondarySiteLocations.filter((siteLocation) => (
      siteLocation.location?.is_active === true &&
      siteLocation.location.location_type === 'site'
    )),
    [secondarySiteLocations]
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

    onOpenMoveDialog([item]);
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
              <InventoryLocationSelect
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
                locations={locations}
                placeholder="Choose your location"
                extraOptions={[{
                  value: LOCATION_NOT_SHOWN_VALUE,
                  label: 'Location not shown',
                  className: 'mt-1 border-t border-amber-500/30 bg-amber-500/10 font-semibold text-amber-200 hover:bg-amber-500/20 focus:bg-amber-500/20',
                }]}
              />
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
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <MapPin className="h-4 w-4 text-inventory" />
              Current inventory location: {activeLocation.name}
            </div>
            {currentFleetAssignment ? (
              <div className="mt-2">
                <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                  <Truck className="mr-1 h-3 w-3" />
                  Linked {currentFleetAssignment.asset_type.toUpperCase()}: {[
                    currentFleetAssignment.asset_label,
                    currentFleetAssignment.asset_nickname,
                  ].filter(Boolean).join(' - ') || 'Fleet asset'}
                </Badge>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                This location is not linked to a current fleet asset assignment.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={onChangeLocation} className="border-slate-600">
            Change Location
          </Button>
        </CardContent>
      </Card>

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

      {activeSecondarySiteLocations.length > 0 ? (
        <div className="space-y-4">
          {activeSecondarySiteLocations.map((siteLocation) => {
            const site = siteLocation.location;
            if (!site) return null;
            const siteItems = activeItemsByLocationId.get(site.id) || [];

            return (
              <Card key={siteLocation.location_id} className="border-slate-700 bg-slate-900/70">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-white">
                    <MapPin className="h-5 w-5 text-inventory" />
                    Site: {site.name}
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                      Secondary Location
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {site.description ? (
                    <p className="mb-4 text-sm text-muted-foreground">{site.description}</p>
                  ) : null}
                  {siteItems.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No active inventory items are currently assigned to this Site location.</p>
                  ) : (
                    <InventoryTable
                      items={siteItems}
                      selectedItemIds={selectedItemIds}
                      onSelectedItemIdsChange={setSelectedItemIds}
                      onMove={onOpenMoveDialog}
                      categoryLabels={categoryLabels}
                      tableLabel={site.external_reference ? `site ${site.external_reference}` : site.name}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

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
