import type { Database } from '@/types/database';

export type TrainingImportBatch = Database['public']['Tables']['training_import_batches']['Row'];
export type TrainingPerson = Database['public']['Tables']['training_people']['Row'];
export type TrainingQualification = Database['public']['Tables']['training_qualifications']['Row'];
export type TrainingRecord = Database['public']['Tables']['training_records']['Row'];
export type TrainingWorkbookNote = Database['public']['Tables']['training_workbook_notes']['Row'];

export type TrainingRecordUpdate = Database['public']['Tables']['training_records']['Update'];
export type TrainingPersonUpdate = Database['public']['Tables']['training_people']['Update'];
export type TrainingQualificationUpdate = Database['public']['Tables']['training_qualifications']['Update'];

export type TrainingValidationStatus = TrainingRecord['qualification_validation_status'];
export type TrainingRecordStatus = TrainingRecord['record_status'];
export type TrainingProfileMatchStatus = TrainingPerson['profile_match_status'];
export type TrainingWorkbookNoteType = TrainingWorkbookNote['note_type'];

export interface TrainingRecordWithRelations extends TrainingRecord {
  person?: Pick<TrainingPerson, 'id' | 'employee_key' | 'employee_name_raw' | 'profile_id' | 'profile_match_status'> | null;
  qualification?: Pick<TrainingQualification, 'id' | 'qualification_key' | 'canonical_name' | 'validation_status'> | null;
}

export interface TrainingSummary {
  totalRecords: number;
  activeRecords: number;
  archivedRecords: number;
  expiredRecords: number;
  expiringSoonRecords: number;
  noExpiryRecords: number;
  needsNvqRecords: number;
  awaitingCardRecords: number;
  trainingBookedRecords: number;
  manualReviewRecords: number;
  unlinkedPeople: number;
}

export interface TrainingRecordFormData {
  employee_name_raw: string;
  qualification_raw: string;
  qualification_canonical_proposed: string;
  qualification_validation_status: TrainingValidationStatus;
  qualification_group: string;
  relationship: string;
  card_number: string;
  card_type_or_status: string;
  approved: string;
  issue_date: string;
  issue_raw: string;
  expiry_date: string;
  expiry_raw: string;
  date_of_birth: string;
  date_of_birth_raw: string;
  comments: string;
  record_status: TrainingRecordStatus;
  next_review_at: string;
}

export interface TrainingPersonFormData {
  employee_name_raw: string;
  profile_id: string;
  profile_match_status: TrainingProfileMatchStatus;
  profile_match_notes: string;
  date_of_births: string;
  source_sheets: string;
}

export interface TrainingQualificationFormData {
  canonical_name: string;
  validation_status: TrainingValidationStatus;
  validation_notes: string;
}

export const TRAINING_VALIDATION_STATUS_OPTIONS: Array<{ value: TrainingValidationStatus; label: string }> = [
  { value: 'needs_manual_review', label: 'Needs Manual Review' },
  { value: 'plant_category_or_card_scheme', label: 'Plant/Card Category' },
  { value: 'standardised_or_spelling_corrected', label: 'Standardised / Spelling Corrected' },
  { value: 'note_or_status_mixed_with_qualification', label: 'Note Mixed With Qualification' },
];

export const TRAINING_VALIDATION_STATUSES = TRAINING_VALIDATION_STATUS_OPTIONS.map((option) => option.value);

export const TRAINING_RECORD_STATUS_OPTIONS: Array<{ value: TrainingRecordStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export const TRAINING_RECORD_STATUSES = TRAINING_RECORD_STATUS_OPTIONS.map((option) => option.value);

export const TRAINING_PROFILE_MATCH_STATUS_OPTIONS: Array<{ value: TrainingProfileMatchStatus; label: string }> = [
  { value: 'matched', label: 'Matched' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'not_attempted', label: 'Not Attempted' },
];

export const TRAINING_PROFILE_MATCH_STATUSES = TRAINING_PROFILE_MATCH_STATUS_OPTIONS.map((option) => option.value);

export function isTrainingValidationStatus(value: unknown): value is TrainingValidationStatus {
  return typeof value === 'string' && TRAINING_VALIDATION_STATUSES.includes(value as TrainingValidationStatus);
}

export function isTrainingRecordStatus(value: unknown): value is TrainingRecordStatus {
  return typeof value === 'string' && TRAINING_RECORD_STATUSES.includes(value as TrainingRecordStatus);
}

export function isTrainingProfileMatchStatus(value: unknown): value is TrainingProfileMatchStatus {
  return typeof value === 'string' && TRAINING_PROFILE_MATCH_STATUSES.includes(value as TrainingProfileMatchStatus);
}
