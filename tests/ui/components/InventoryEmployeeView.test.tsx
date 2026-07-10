/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryEmployeeView } from '@/app/(dashboard)/inventory/components/InventoryEmployeeView';
import type { InventoryItem, InventoryLocation } from '@/app/(dashboard)/inventory/types';

vi.mock('@/app/(dashboard)/inventory/components/InventoryTable', () => ({
  InventoryTable: ({ items, tableLabel }: { items: InventoryItem[]; tableLabel?: string }) => (
    <div data-testid="inventory-table">
      {tableLabel}: {items.map((item) => item.name).join(', ')}
    </div>
  ),
}));

const primaryLocation: InventoryLocation = {
  id: 'van-location',
  name: 'Van - AB12 CDE',
  description: null,
  is_active: true,
  linked_van_id: 'van-1',
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'van',
  source_type: 'fleet',
  source_id: 'van-1',
  external_reference: null,
  sync_status: 'synced',
  source_synced_at: null,
  created_at: '2026-07-05T00:00:00.000Z',
  updated_at: '2026-07-05T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

const siteLocation: InventoryLocation = {
  id: 'site-location',
  name: 'Site - 12345 - Yard Entrance',
  description: 'Yard Entrance',
  is_active: true,
  linked_van_id: null,
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'site',
  source_type: 'quote',
  source_id: 'quote-1',
  external_reference: '12345',
  sync_status: 'synced',
  source_synced_at: null,
  created_at: '2026-07-05T00:00:00.000Z',
  updated_at: '2026-07-05T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

function makeItem(id: string, name: string, location: InventoryLocation): InventoryItem {
  return {
    id,
    item_number: id,
    item_number_normalized: id,
    name,
    category: 'tools',
    location_id: location.id,
    location,
    last_checked_at: null,
    check_interval_days: 30,
    status: 'active',
    retired_at: null,
    retire_reason: null,
    retired_by: null,
    source: null,
    source_reference: null,
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-05T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

describe('InventoryEmployeeView', () => {
  it('renders assigned Site locations as separate secondary sections', () => {
    render(
      <InventoryEmployeeView
        items={[
          makeItem('tool-1', 'Primary Drill', primaryLocation),
          makeItem('tool-2', 'Site Barrier', siteLocation),
        ]}
        locations={[primaryLocation]}
        userLocation={{
          user_id: 'user-1',
          location_id: primaryLocation.id,
          location: primaryLocation,
        }}
        secondarySiteLocations={[{
          user_id: 'user-1',
          location_id: siteLocation.id,
          assigned_by: 'supervisor-1',
          assigned_at: '2026-07-05T00:00:00.000Z',
          note: null,
          location: siteLocation,
        }]}
        currentFleetAssignment={null}
        onSetUserLocation={vi.fn()}
        onRequestLocation={vi.fn()}
        onOpenMoveDialog={vi.fn()}
        onChangeLocation={vi.fn()}
      />
    );

    expect(screen.getByText('Current inventory location: Van - AB12 CDE')).toBeInTheDocument();
    expect(screen.getByText('Site: Site - 12345 - Yard Entrance')).toBeInTheDocument();
    expect(screen.getByText('Secondary Location')).toBeInTheDocument();
    expect(screen.getByText(/site 12345: Site Barrier/)).toBeInTheDocument();
  });
});
