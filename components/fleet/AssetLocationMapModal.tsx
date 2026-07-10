'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import { formatTrackerTimestamp } from '@/lib/utils/tracker-dates';
import { buildTrackerPopupHtml } from '@/lib/utils/tracker-popup';
import type { TrackerLocationData } from '@/types/fleet-tracker';

interface AssetLocationMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetLabel: string;
  location: TrackerLocationData | null;
  locationProvider?: 'fleetsmart' | 'velocityfleet';
}

function getAllLocationsEndpoint(locationProvider: 'fleetsmart' | 'velocityfleet'): string {
  return locationProvider === 'velocityfleet'
    ? '/api/velocityfleet/all-locations'
    : '/api/fleetsmart/all-locations';
}

/** Extract a short display label from a FleetSmart vehicle name */
function extractLabel(name: string, vrn: string): string {
  const slashIdx = name.lastIndexOf('/');
  if (slashIdx !== -1) {
    return name.substring(slashIdx + 1).trim();
  }
  if (vrn) return vrn;
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx !== -1) {
    return name.substring(dashIdx + 3).trim();
  }
  return name;
}

export function AssetLocationMapModal({
  open,
  onOpenChange,
  assetLabel,
  location,
  locationProvider = 'fleetsmart',
}: AssetLocationMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [otherVehicles, setOtherVehicles] = useState<TrackerLocationData[]>([]);
  const [fetchDone, setFetchDone] = useState(false);

  // Fetch all vehicle locations when modal opens.
  // The server fetches per-vehicle locations in the background.
  // We poll until the server reports loading=false (all fetched).
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setFetchDone(false);
        setOtherVehicles([]);
      });
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchAll() {
      try {
        const res = await fetch(getAllLocationsEndpoint(locationProvider));
        if (!res.ok) {
          if (!cancelled) setFetchDone(true);
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        const vehicles = data.vehicles ?? [];
        setOtherVehicles(vehicles);

        // If the server is still loading (background fetch in progress),
        // poll every 5 seconds to get updated data
        if (data.loading && !data.cached) {
          pollTimer = setTimeout(fetchAll, 30_000);
        } else {
          setFetchDone(true);
        }
      } catch {
        if (!cancelled) setFetchDone(true);
      }
    }

    // Start immediately — even partial data is useful
    queueMicrotask(() => setFetchDone(true)); // allow map to render with whatever we have
    fetchAll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [open, locationProvider]);

  // Initialize map ONLY after fetch is done (or at least attempted)
  useEffect(() => {
    if (!open || !fetchDone || !location) return;

    function initMap() {
      if (!mapContainerRef.current) return;

      // Clean up previous
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
      if (!apiKey) return;

      const rect = mapContainerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTimeout(initMap, 150);
        return;
      }

      maptilersdk.config.apiKey = apiKey;

      const map = new maptilersdk.Map({
        container: mapContainerRef.current,
        style: '019c5e68-f020-7497-955c-16a05a3779b3',
        center: [location!.lng, location!.lat],
        zoom: 15,
        interactive: true,
      });

      // Add other vehicle markers (blue) with labels
      let otherCount = 0;
      for (const v of otherVehicles) {
        if (String(v.vehicleId) === String(location!.vehicleId)) continue;
        if (isNaN(v.lat) || isNaN(v.lng)) continue;

        const label = v.vrn || extractLabel(v.name, v.vrn);
        const lastSeen = formatTrackerTimestamp(v.updatedAt);
        otherCount++;

        new maptilersdk.Marker({ color: '#3b82f6' })
          .setLngLat([v.lng, v.lat])
          .setPopup(
            new maptilersdk.Popup({ offset: 25 }).setHTML(
              buildTrackerPopupHtml({
                regLabel: label,
                vrn: v.vrn,
                nickname: v.nickname,
                speed: v.speed,
                lastSeen,
              })
            )
          )
          .addTo(map);
      }

      console.log(`[MapModal] Added ${otherCount} other vehicle markers`);

      // Add main asset marker (red) – on top
      const assetLastSeen = formatTrackerTimestamp(location!.updatedAt);
      const assetRegLabel = location!.vrn || assetLabel;
      const marker = new maptilersdk.Marker({ color: '#ef4444' })
        .setLngLat([location!.lng, location!.lat])
        .setPopup(
          new maptilersdk.Popup({ offset: 25 }).setHTML(
            buildTrackerPopupHtml({
              regLabel: assetRegLabel,
              vrn: location!.vrn,
              nickname: location!.nickname,
              speed: location!.speed,
              lastSeen: assetLastSeen,
            })
          )
        )
        .addTo(map);

      marker.togglePopup();
      mapRef.current = map;
    }

    // Delay to allow dialog animation + DOM layout
    const timer = setTimeout(initMap, 300);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [open, fetchDone, location, assetLabel, otherVehicles]);

  const lastReported = formatTrackerTimestamp(location?.updatedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[85vh] p-0 gap-0 flex flex-col [&>button:last-of-type]:hidden">
        {/* Custom larger close button */}
        <DialogClose className="absolute right-4 top-4 z-10 h-10 w-10 flex items-center justify-center rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-5 w-5 text-slate-100" />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader className="px-6 pt-6 pb-3 flex-shrink-0 pr-16">
          <DialogTitle>Location – {assetLabel}</DialogTitle>
          <DialogDescription>
            {location
              ? `Last reported: ${lastReported} · Speed: ${location.speed ?? 0} mph`
              : 'No location data available'}
          </DialogDescription>
          <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500 border border-red-400" />
              Current asset
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-blue-500 border border-blue-400" />
              Other vans / plant
            </span>
          </div>
        </DialogHeader>
        <div className="flex-1 px-6 pb-6 min-h-0">
          <div
            ref={mapContainerRef}
            className="w-full rounded-lg overflow-hidden"
            style={{ height: 'calc(85vh - 150px)', minHeight: '400px' }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
