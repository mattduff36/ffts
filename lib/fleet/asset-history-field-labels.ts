import type { AssetHistoryAssetType } from './asset-history-events';

const VAN_HISTORY_FIELD_LABELS: Record<string, string> = {
  mot_expiry_date: 'MOT Expiry',
  tax_due_date: 'Tax Due Date',
  service_due_date: 'Service Due',
  service_due_mileage: 'Service Due Mileage',
  last_service_date: 'Last Service',
  last_service_mileage: 'Last Service Mileage',
  notes: 'Notes',
};

const HGV_HISTORY_FIELD_LABELS: Record<string, string> = {
  mot_expiry_date: 'MOT Expiry',
  tax_due_date: 'Tax Due Date',
  service_due_date: 'Service Due',
  service_due_mileage: 'Service Due KM',
  last_service_date: 'Last Service',
  last_service_mileage: 'Last Service KM',
  notes: 'Notes',
};

const PLANT_HISTORY_FIELD_LABELS: Record<string, string> = {
  nickname: 'Nickname',
  reg_number: 'Registration Number',
  serial_number: 'Serial Number',
  current_hours: 'Current Hours',
  last_service_hours: 'Last Service Hours',
  next_service_hours: 'Next Service Hours',
  tax_due_date: 'Tax Due Date',
  mot_due_date: 'MOT Due Date',
  current_mileage: 'Current Mileage',
  loler_due_date: 'LOLER THOROUGH EXAMINATION Due Date',
  loler_last_inspection_date: 'LOLER THOROUGH EXAMINATION Last Inspection',
  loler_certificate_number: 'LOLER THOROUGH EXAMINATION Certificate',
  loler_inspection_interval_months: 'LOLER THOROUGH EXAMINATION Interval',
  tracker_id: 'GPS Tracker',
  no_changes: 'Update (No Field Changes)',
};

function toSimpleFieldLabel(fieldName: string): string {
  return fieldName.replace(/_/g, ' ');
}

function toTitleCaseFieldLabel(fieldName: string): string {
  return toSimpleFieldLabel(fieldName).replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getAssetHistoryFieldLabel(assetType: AssetHistoryAssetType, fieldName: string): string {
  if (assetType === 'van') {
    return VAN_HISTORY_FIELD_LABELS[fieldName] ?? toSimpleFieldLabel(fieldName);
  }

  if (assetType === 'hgv') {
    return HGV_HISTORY_FIELD_LABELS[fieldName] ?? toSimpleFieldLabel(fieldName);
  }

  return PLANT_HISTORY_FIELD_LABELS[fieldName] ?? toTitleCaseFieldLabel(fieldName);
}
