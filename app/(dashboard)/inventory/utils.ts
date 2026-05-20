import { addDays, differenceInCalendarDays, format } from 'date-fns';
import type { InventoryCheckStatus, InventoryItem } from './types';

export const CHECK_INTERVAL_DAYS = 42;
export const DUE_SOON_DAYS = 7;

export function getInventoryCheckIntervalDays(item: Pick<InventoryItem, 'check_interval_days'>): number {
  return item.check_interval_days || CHECK_INTERVAL_DAYS;
}

export function getInventoryCheckStatus(
  item: Pick<InventoryItem, 'last_checked_at'> & Partial<Pick<InventoryItem, 'check_interval_days'>>
): InventoryCheckStatus {
  if (!item.last_checked_at) return 'needs_check';

  const dueDate = addDays(new Date(`${item.last_checked_at}T00:00:00`), item.check_interval_days || CHECK_INTERVAL_DAYS);
  const daysUntilDue = differenceInCalendarDays(dueDate, new Date());

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon';
  return 'ok';
}

export function getInventoryDueDate(lastCheckedAt: string | null, intervalDays = CHECK_INTERVAL_DAYS): string {
  if (!lastCheckedAt) return 'Not checked';
  return format(addDays(new Date(`${lastCheckedAt}T00:00:00`), intervalDays), 'dd MMM yyyy');
}

export function formatInventoryDate(value: string | null): string {
  if (!value) return 'Not checked';
  return format(new Date(`${value}T00:00:00`), 'dd MMM yyyy');
}

export function getCheckStatusLabel(status: InventoryCheckStatus): string {
  if (status === 'due_soon') return 'Due Soon';
  if (status === 'needs_check') return 'Needs Check';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
