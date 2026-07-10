import type { ModuleName } from '@/types/roles';

export function getReminderActionRequiredModule(assetType: string | null | undefined): ModuleName {
  if (assetType === 'van') return 'inspections';
  if (assetType === 'plant') return 'plant-inspections';
  if (assetType === 'hgv') return 'hgv-inspections';
  return 'reminders';
}
