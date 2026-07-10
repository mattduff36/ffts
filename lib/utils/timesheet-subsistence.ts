export const SUBSISTENCE_REMARK = 'Stayed away - subsistence payment required';

interface SubsistenceEntryLike {
  time_started?: string | null;
  time_finished?: string | null;
  did_not_work?: boolean | null;
  subsistence_payment_required?: boolean | null;
  remarks?: string | null;
}

function getRemarkLines(remarks: string | null | undefined): string[] {
  return (remarks || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function hasSubsistenceRemark(remarks: string | null | undefined): boolean {
  return getRemarkLines(remarks).some(
    (line) => line.toLowerCase() === SUBSISTENCE_REMARK.toLowerCase()
  );
}

export function addSubsistenceRemark(remarks: string | null | undefined): string {
  const lines = getRemarkLines(remarks);
  if (hasSubsistenceRemark(remarks)) return lines.join('\n');
  return [...lines, SUBSISTENCE_REMARK].join('\n');
}

export function removeSubsistenceRemark(remarks: string | null | undefined): string {
  return getRemarkLines(remarks)
    .filter((line) => line.toLowerCase() !== SUBSISTENCE_REMARK.toLowerCase())
    .join('\n');
}

export function syncSubsistenceRemark(
  remarks: string | null | undefined,
  isRequired: boolean
): string {
  return isRequired ? addSubsistenceRemark(remarks) : removeSubsistenceRemark(remarks);
}

export function hasWorkedTimesForSubsistence(entry: SubsistenceEntryLike): boolean {
  return Boolean(entry.time_started && entry.time_finished && !entry.did_not_work);
}

export function isSubsistencePaymentRequired(entry: SubsistenceEntryLike): boolean {
  return Boolean(entry.subsistence_payment_required || hasSubsistenceRemark(entry.remarks));
}
