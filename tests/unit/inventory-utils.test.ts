import { describe, expect, it, vi } from 'vitest';
import {
  canSelectInventoryPrimaryLocation,
  canShareInventoryPrimaryLocation,
  CHECK_INTERVAL_DAYS,
  CHECK_INTERVAL_MONTHS,
  formatInventoryCheckIntervalMonths,
  formatInventoryLocationOptionLabel,
  formatInventoryLocationTypeLabel,
  formatInventoryUnknownLocationAge,
  formatInventoryDate,
  getInventoryCheckIntervalDays,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
  hasInventoryCheckLapsed,
  isInventoryUnknownLocation,
  isInventoryMoveCheckBlocked,
  isInventoryYardExitBlocked,
  isWorkshopInventoryTeam,
} from '@/app/(dashboard)/inventory/utils';

describe('inventory utils', () => {
  it('falls back to the default check interval', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: null })).toBe(CHECK_INTERVAL_DAYS);
    expect(getInventoryCheckIntervalMonths({ check_interval_days: null })).toBe(CHECK_INTERVAL_MONTHS);
  });

  it('uses an item-specific check interval when present', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: 90 })).toBe(90);
    expect(getInventoryCheckIntervalMonths({ check_interval_days: 90 })).toBe(3);
    expect(formatInventoryCheckIntervalMonths(3)).toBe('3 months');
    expect(getInventoryDueDate('2026-01-01', 3)).toBe('01 Apr 2026');
  });

  it('formats date-only and timestamp inventory dates', () => {
    expect(formatInventoryDate('2026-06-01')).toBe('01 Jun 2026');
    expect(formatInventoryDate('2026-06-01T14:08:25.330Z')).toBe('01 Jun 2026');
    expect(formatInventoryDate('not-a-date')).toBe('Not checked');
  });

  it('calculates due soon and overdue against per-item intervals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(getInventoryCheckStatus({ last_checked_at: '2026-04-25', check_interval_days: 30 })).toBe('due_soon');
    expect(getInventoryCheckStatus({ last_checked_at: '2026-04-01', check_interval_days: 30 })).toBe('overdue');
    expect(getInventoryCheckStatus({ last_checked_at: null, check_interval_days: 30 })).toBe('needs_check');

    vi.useRealTimers();
  });

  it('keeps Yard on the normal check status while Unknown remains exempt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(getInventoryCheckStatus({
      category: 'van_stock',
      location: { name: 'Yard' },
      last_checked_at: '2026-01-01',
      check_interval_days: 30,
    })).toBe('overdue');

    expect(getInventoryCheckStatus({
      category: 'tools',
      location: { name: 'Unknown' },
      last_checked_at: null,
      check_interval_days: null,
    })).toBe('not_required');

    vi.useRealTimers();
  });

  it('uses typed Yard and Unknown locations before name fallbacks', () => {
    expect(isInventoryUnknownLocation({ name: 'Holding', location_type: 'unknown' })).toBe(true);
    expect(isInventoryUnknownLocation({ name: 'Unknown' })).toBe(true);
    expect(canShareInventoryPrimaryLocation(
      { name: 'Main depot', location_type: 'yard' },
      { teamId: 'workshop_yard' }
    )).toBe(true);
  });

  it('allows only workshop team members to share Yard as a primary location', () => {
    const yardLocation = {
      id: 'yard-location',
      name: 'Yard',
      is_active: true,
      assigned_user_names: ['Workshop One'],
    };
    const storesLocation = {
      id: 'stores-location',
      name: 'Stores',
      is_active: true,
      assigned_user_names: ['Stores One'],
    };

    expect(isWorkshopInventoryTeam({ teamId: 'workshop_yard', teamName: null })).toBe(true);
    expect(isWorkshopInventoryTeam({ teamId: 'transport', teamName: 'Transport' })).toBe(false);
    expect(canShareInventoryPrimaryLocation(yardLocation, { teamId: 'workshop_yard' })).toBe(true);
    expect(canShareInventoryPrimaryLocation(yardLocation, { teamId: 'transport' })).toBe(false);
    expect(canSelectInventoryPrimaryLocation(yardLocation, { teamId: 'workshop_yard' })).toBe(true);
    expect(canSelectInventoryPrimaryLocation(yardLocation, { teamId: 'transport' })).toBe(false);
    expect(canSelectInventoryPrimaryLocation(storesLocation, {
      currentLocationId: 'stores-location',
      teamId: 'transport',
    })).toBe(true);
    expect(canSelectInventoryPrimaryLocation(storesLocation, { teamId: 'workshop_yard' })).toBe(false);
    expect(canSelectInventoryPrimaryLocation({
      id: 'site-location',
      name: 'Site - 12345',
      is_active: true,
      assigned_user_names: [],
      location_type: 'site',
    }, { teamId: 'transport' })).toBe(false);
  });

  it('calculates unknown-location age from movement or created date fallback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));

    expect(formatInventoryUnknownLocationAge({
      location: { name: 'Unknown' },
      unknown_location_entered_at: '2026-06-17T08:00:00Z',
      created_at: '2026-06-01T08:00:00Z',
    })).toBe('In Unknown for 2 days');

    expect(formatInventoryUnknownLocationAge({
      location: { name: 'Unknown' },
      unknown_location_entered_at: null,
      created_at: '2026-06-18T08:00:00Z',
    })).toBe('In Unknown for 1 day');

    vi.useRealTimers();
  });

  it('detects lapsed inventory checks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(hasInventoryCheckLapsed({ last_checked_at: '2026-04-01', check_interval_days: 30 })).toBe(true);
    expect(hasInventoryCheckLapsed({ last_checked_at: null, check_interval_days: 30 })).toBe(true);
    expect(hasInventoryCheckLapsed({ last_checked_at: '2026-04-25', check_interval_days: 30 })).toBe(false);

    vi.useRealTimers();
  });

  it('blocks Yard exits only when the normal check has lapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    const yardLocation = { name: 'Yard' };
    const vanLocation = { name: 'Van 1' };

    expect(isInventoryYardExitBlocked({
      location: yardLocation,
      last_checked_at: '2026-04-01',
      check_interval_days: 30,
    }, vanLocation)).toBe(true);

    expect(isInventoryYardExitBlocked({
      location: yardLocation,
      last_checked_at: null,
      check_interval_days: 30,
    }, vanLocation)).toBe(true);

    expect(isInventoryYardExitBlocked({
      location: yardLocation,
      last_checked_at: '2026-04-25',
      check_interval_days: 30,
    }, vanLocation)).toBe(false);

    expect(isInventoryYardExitBlocked({
      location: yardLocation,
      last_checked_at: null,
      check_interval_days: 30,
    }, yardLocation)).toBe(false);

    vi.useRealTimers();
  });

  it('blocks overdue non-Yard moves unless the destination is Yard', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    const storesLocation = { name: 'Stores' };
    const vanLocation = { name: 'Van 1' };
    const yardLocation = { name: 'Yard' };

    expect(isInventoryMoveCheckBlocked({
      location: storesLocation,
      last_checked_at: '2026-04-01',
      check_interval_days: 30,
    }, vanLocation)).toBe(true);

    expect(isInventoryMoveCheckBlocked({
      location: storesLocation,
      last_checked_at: '2026-04-01',
      check_interval_days: 30,
    }, yardLocation)).toBe(false);

    expect(isInventoryMoveCheckBlocked({
      location: storesLocation,
      last_checked_at: null,
      check_interval_days: 30,
    }, vanLocation)).toBe(false);

    vi.useRealTimers();
  });

  it('formats typed site and asset-backed location labels', () => {
    expect(formatInventoryLocationTypeLabel({ location_type: 'site' })).toBe('Site');
    expect(formatInventoryLocationOptionLabel({
      id: 'site-location',
      name: 'Site - 12345-AB',
      description: null,
      is_active: true,
      linked_van_id: null,
      linked_hgv_id: null,
      linked_plant_id: null,
      location_type: 'site',
      source_type: 'quote',
      source_id: 'quote-id',
      external_reference: '12345-AB',
      sync_status: 'synced',
      source_synced_at: null,
      created_at: '2026-07-02T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      created_by: null,
      updated_by: null,
      assigned_user_names: [],
    })).toBe('[12345-AB] - Unassigned');
  });
});
