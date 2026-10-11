import { createAdminClient } from '@/lib/supabase/admin';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';

export interface TrainingProfileOption {
  id: string;
  full_name: string;
  employee_id: string | null;
}

export interface ProfileCandidateRow extends TrainingProfileOption {
  is_placeholder?: boolean | null;
}

type TrainingProfileAdmin = ReturnType<typeof createAdminClient>;

function isDeletedProfileName(fullName: string | null | undefined): boolean {
  return Boolean(fullName?.includes('(Deleted User)'));
}

export function isSelectableProfile(row: ProfileCandidateRow): boolean {
  return row.is_placeholder !== true && !isDeletedProfileName(row.full_name);
}

export function toTrainingProfileOption(row: ProfileCandidateRow): TrainingProfileOption {
  return {
    id: row.id,
    full_name: row.full_name,
    employee_id: row.employee_id ?? null,
  };
}

export async function findEligibleTrainingProfile(
  admin: TrainingProfileAdmin,
  profileId: string
): Promise<TrainingProfileOption | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, employee_id, is_placeholder')
    .eq('id', profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !isSelectableProfile(data as ProfileCandidateRow)) return null;

  const visible = await filterHiddenSystemTestAccountProfiles(admin, [data as ProfileCandidateRow]);
  return visible[0] ? toTrainingProfileOption(visible[0]) : null;
}

