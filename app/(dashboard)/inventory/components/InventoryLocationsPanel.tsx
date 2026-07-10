'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link2, MapPin, Pencil, Trash2 } from 'lucide-react';
import type { FleetAssetOption, InventoryLocation } from '../types';
import { formatInventoryLocationTypeLabel } from '../utils';

interface InventoryLocationsPanelProps {
  locations: InventoryLocation[];
  fleetAssets: FleetAssetOption[];
  onEdit: (location: InventoryLocation) => void;
  onRemove: (location: InventoryLocation) => void;
}

function getLinkedAssetLabel(location: InventoryLocation, fleetAssets: FleetAssetOption[]): string | null {
  const linkedAssetId = location.linked_van_id || location.linked_hgv_id || location.linked_plant_id;
  if (!linkedAssetId) return null;
  return fleetAssets.find((asset) => asset.id === linkedAssetId)?.label || 'Linked fleet asset';
}

export function InventoryLocationsPanel({
  locations,
  fleetAssets,
  onEdit,
  onRemove,
}: InventoryLocationsPanelProps) {
  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardContent className="p-0">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Location</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Linked Asset</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Items</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {locations.map((location) => {
                const linkedAssetLabel = getLinkedAssetLabel(location, fleetAssets);
                return (
                  <tr key={location.id} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{location.name}</div>
                      {location.description ? (
                        <div className="text-xs text-muted-foreground">{location.description}</div>
                      ) : null}
                      {location.external_reference ? (
                        <div className="text-xs text-muted-foreground">Ref: {location.external_reference}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="border-slate-600 text-slate-200">
                        {formatInventoryLocationTypeLabel(location)}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground">{location.sync_status}</div>
                    </td>
                    <td className="px-4 py-3">
                      {linkedAssetLabel ? (
                        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                          <Link2 className="mr-1 h-3 w-3" />
                          {linkedAssetLabel}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">No linked asset</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{location.item_count || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onEdit(location)} className="border-slate-600">
                          <Pencil className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                        {location.location_type === 'manual' ? (
                          <Button size="sm" variant="outline" onClick={() => onRemove(location)} className="border-red-500/30 text-red-300 hover:bg-red-500/10">
                            <Trash2 className="mr-2 h-3 w-3" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-4 md:hidden">
          {locations.map((location) => {
            const linkedAssetLabel = getLinkedAssetLabel(location, fleetAssets);
            return (
              <div key={location.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <MapPin className="h-4 w-4 text-inventory" />
                      {location.name}
                    </div>
                    {location.description ? (
                      <div className="mt-1 text-xs text-muted-foreground">{location.description}</div>
                    ) : null}
                  </div>
                  <Badge variant="outline">{location.item_count || 0} items</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-slate-600 text-slate-200">
                    {formatInventoryLocationTypeLabel(location)}
                  </Badge>
                  <Badge variant="outline" className="border-slate-600 text-slate-200">
                    {location.sync_status}
                  </Badge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {linkedAssetLabel ? `Linked to ${linkedAssetLabel}` : 'No linked asset'}
                  {location.external_reference ? ` · Ref: ${location.external_reference}` : ''}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(location)} className="flex-1 border-slate-600">
                    Edit
                  </Button>
                  {location.location_type === 'manual' ? (
                    <Button size="sm" variant="outline" onClick={() => onRemove(location)} className="flex-1 border-red-500/30 text-red-300">
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
