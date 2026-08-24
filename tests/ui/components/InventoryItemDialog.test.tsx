/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InventoryItemDialog } from '@/app/(dashboard)/inventory/components/InventoryItemDialog';
import type { InventoryLocation } from '@/app/(dashboard)/inventory/types';

const yardLocation: InventoryLocation = {
  id: 'loc-yard',
  name: 'Yard',
  description: null,
  is_active: true,
  linked_van_id: null,
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'yard',
  source_type: 'system',
  source_id: null,
  external_reference: null,
  sync_status: 'manual',
  source_synced_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: null,
  updated_by: null,
};

describe('InventoryItemDialog', () => {
  it('keeps dirty add-item values and requires discard after an outside close', () => {
    const onClose = vi.fn();

    render(
      <InventoryItemDialog
        open
        locations={[yardLocation]}
        categories={[]}
        onClose={onClose}
        onSubmit={vi.fn(async () => undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'Cordless drill' },
    });

    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name *')).toHaveValue('Cordless drill');

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
