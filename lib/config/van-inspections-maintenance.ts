export const VAN_INSPECTIONS_MAINTENANCE_TITLE = 'Van Daily Checks are temporarily paused';

export const VAN_INSPECTIONS_MAINTENANCE_MESSAGE =
  'Van Daily Checks are currently paused while a daily-check update is being applied. Please do not create, edit, submit, or delete van checks until the update is complete.';

export function isVanInspectionsMaintenancePaused(): boolean {
  const value =
    process.env.NEXT_PUBLIC_VAN_INSPECTIONS_MAINTENANCE_LOCK ??
    process.env.VAN_INSPECTIONS_MAINTENANCE_LOCK ??
    '';

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
