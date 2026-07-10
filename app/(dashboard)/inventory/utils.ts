import { addMonths, differenceInCalendarDays, format } from 'date-fns';
import type { InventoryCheckStatus, InventoryItem, InventoryLocation } from './types';

const DAYS_PER_INVENTORY_CHECK_MONTH = 30;

export const CHECK_INTERVAL_MONTHS = 1;
export const CHECK_INTERVAL_DAYS = CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;
export const DUE_SOON_DAYS = 7;
export const INVENTORY_UNKNOWN_LOCATION_NAME = 'Unknown';
export const INVENTORY_YARD_LOCATION_NAME = 'Yard';
export const INVENTORY_WORKSHOP_TEAM_ID = 'workshop_yard';

interface InventoryCheckScheduleItem {
  last_checked_at: string | null;
  check_interval_days?: number | null;
}

interface InventorySpecialStatusItem extends InventoryCheckScheduleItem {
  category?: string | null;
  location?: Pick<InventoryLocation, 'name' | 'location_type'> | null;
  unknown_location_entered_at?: string | null;
  created_at?: string | null;
}

interface InventoryTeamContext {
  teamId?: string | null;
  teamName?: string | null;
}

interface InventoryPrimaryLocationSelectionContext extends InventoryTeamContext {
  currentLocationId?: string | null;
}

export function getInventoryCheckIntervalDays(item: Pick<InventoryItem, 'check_interval_days'>): number {
  return checkIntervalMonthsToDays(getInventoryCheckIntervalMonths(item)) || CHECK_INTERVAL_DAYS;
}

export function getInventoryCheckIntervalMonths(item: Pick<InventoryItem, 'check_interval_days'>): number {
  if (!item.check_interval_days) return CHECK_INTERVAL_MONTHS;
  return Math.max(1, Math.round(item.check_interval_days / DAYS_PER_INVENTORY_CHECK_MONTH));
}

export function checkIntervalMonthsToDays(intervalMonths: number | null | undefined): number | null {
  if (!Number.isInteger(intervalMonths) || !intervalMonths || intervalMonths < 1) return null;
  return intervalMonths * DAYS_PER_INVENTORY_CHECK_MONTH;
}

export function formatInventoryCheckIntervalMonths(intervalMonths: number): string {
  return `${intervalMonths} ${intervalMonths === 1 ? 'month' : 'months'}`;
}

export function isUnknownInventoryLocationName(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === INVENTORY_UNKNOWN_LOCATION_NAME.toLowerCase();
}

export function isYardInventoryLocationName(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === INVENTORY_YARD_LOCATION_NAME.toLowerCase();
}

export function isInventoryUnknownLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (location?.location_type === 'unknown') return true;
  return isUnknownInventoryLocationName(location?.name);
}

export function isInventoryYardLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (location?.location_type === 'yard') return true;
  return isYardInventoryLocationName(location?.name);
}

export function isWorkshopInventoryTeam(context: InventoryTeamContext): boolean {
  const teamId = context.teamId?.trim().toLowerCase();
  const teamName = context.teamName?.trim().toLowerCase();

  return teamId === INVENTORY_WORKSHOP_TEAM_ID || teamName?.includes('workshop') === true;
}

export function canShareInventoryPrimaryLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined,
  context: InventoryTeamContext
): boolean {
  return isWorkshopInventoryTeam(context) && isInventoryYardLocation(location);
}

export function canSelectInventoryPrimaryLocation(
  location: Pick<InventoryLocation, 'id' | 'name' | 'is_active' | 'assigned_user_names'> & Partial<Pick<InventoryLocation, 'location_type'>>,
  context: InventoryPrimaryLocationSelectionContext
): boolean {
  if (location.is_active === false) return false;
  if (location.location_type === 'site') return false;
  if (location.id === context.currentLocationId) return true;
  if (canShareInventoryPrimaryLocation(location, context)) return true;

  return (location.assigned_user_names?.length || 0) === 0;
}

export function isInventoryCheckExempt(item: Partial<InventorySpecialStatusItem>): boolean {
  return isInventoryUnknownLocation(item.location);
}

export function getInventoryNormalCheckStatus(item: InventoryCheckScheduleItem): InventoryCheckStatus {
  if (!item.last_checked_at) return 'needs_check';

  const dueDate = addMonths(new Date(`${item.last_checked_at}T00:00:00`), getInventoryCheckIntervalMonths({
    check_interval_days: item.check_interval_days || null,
  }));
  const daysUntilDue = differenceInCalendarDays(dueDate, new Date());

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon';
  return 'ok';
}

export function getInventoryCheckStatus(item: InventorySpecialStatusItem): InventoryCheckStatus {
  if (isInventoryCheckExempt(item)) return 'not_required';
  return getInventoryNormalCheckStatus(item);
}

export function hasInventoryCheckLapsed(item: InventoryCheckScheduleItem): boolean {
  const status = getInventoryNormalCheckStatus(item);
  return status === 'needs_check' || status === 'overdue';
}

export function isInventoryYardExitBlocked(
  item: InventoryCheckScheduleItem & { location?: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null },
  destinationLocation: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (!isInventoryYardLocation(item.location)) return false;
  if (isInventoryYardLocation(destinationLocation)) return false;
  return hasInventoryCheckLapsed(item);
}

export function isInventoryMoveCheckBlocked(
  item: InventorySpecialStatusItem,
  destinationLocation: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (isInventoryYardExitBlocked(item, destinationLocation)) return true;
  if (isInventoryYardLocation(destinationLocation)) return false;
  return getInventoryCheckStatus(item) === 'overdue';
}

export function shouldMuteInventoryCheckBadge(
  item: Partial<InventorySpecialStatusItem>
): boolean {
  return isInventoryYardLocation(item.location) || isInventoryCheckExempt(item);
}

export function getInventoryDueDate(lastCheckedAt: string | null, intervalMonths = CHECK_INTERVAL_MONTHS): string {
  if (!lastCheckedAt) return 'Not checked';
  return format(addMonths(new Date(`${lastCheckedAt}T00:00:00`), intervalMonths), 'dd MMM yyyy');
}

export function formatInventoryDate(value: string | null): string {
  if (!value) return 'Not checked';
  const parsedDate = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return 'Not checked';
  return format(parsedDate, 'dd MMM yyyy');
}

export function getCheckStatusLabel(status: InventoryCheckStatus): string {
  if (status === 'not_required') return 'No Check Required';
  if (status === 'due_soon') return 'Due Soon';
  if (status === 'needs_check') return 'Needs Check';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function getInventoryUnknownLocationEnteredAt(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>
): string | null {
  if (!isInventoryUnknownLocation(item.location)) return null;
  return item.unknown_location_entered_at || item.created_at || null;
}

export function getInventoryUnknownLocationAgeDays(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>,
  now = new Date()
): number | null {
  const enteredAt = getInventoryUnknownLocationEnteredAt(item);
  if (!enteredAt) return null;
  const parsedDate = new Date(enteredAt.includes('T') ? enteredAt : `${enteredAt}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return Math.max(0, differenceInCalendarDays(now, parsedDate));
}

export function formatInventoryUnknownLocationAge(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>,
  now = new Date()
): string | null {
  const days = getInventoryUnknownLocationAgeDays(item, now);
  if (days === null) return null;
  if (days === 0) return 'In Unknown today';
  return `In Unknown for ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function formatInventoryLocationOptionLabel(location: InventoryLocation): string {
  const assignedUserLabel = location.assigned_user_names?.length
    ? location.assigned_user_names.join(', ')
    : 'Unassigned';
  const linkedVanLabel = [location.linked_asset_label, location.linked_asset_nickname]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' - ');
  const linkedAssetLabel = location.linked_asset_type && linkedVanLabel
    ? `[${linkedVanLabel}]`
    : null;
  const siteReferenceLabel = location.location_type === 'site' && location.external_reference
    ? location.source_type === 'legacy_quote'
      ? `[Legacy ${location.external_reference}]`
      : `[${location.external_reference}]`
    : null;
  const locationLabel = linkedAssetLabel || siteReferenceLabel || location.name;

  return `${locationLabel} - ${assignedUserLabel}`;
}

export function getInventoryLocationsWithYardFirst<TLocation extends Pick<InventoryLocation, 'name'>>(
  locations: readonly TLocation[]
): TLocation[] {
  const yardLocations: TLocation[] = [];
  const otherLocations: TLocation[] = [];

  locations.forEach((location) => {
    if (isInventoryYardLocation(location)) yardLocations.push(location);
    else otherLocations.push(location);
  });

  return [...yardLocations, ...otherLocations];
}

function getInventoryLocationTypeLabel(location: Pick<InventoryLocation, 'location_type'>): string {
  if (location.location_type === 'yard') return 'Yard';
  if (location.location_type === 'unknown') return 'Unknown';
  if (location.location_type === 'van') return 'Van';
  if (location.location_type === 'hgv') return 'HGV';
  if (location.location_type === 'plant') return 'Plant';
  if (location.location_type === 'site') return 'Site';
  return 'Manual';
}

export function formatInventoryLocationTypeLabel(location: Pick<InventoryLocation, 'location_type'>): string {
  return getInventoryLocationTypeLabel(location);
}
