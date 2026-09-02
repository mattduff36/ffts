export type SchedulingClaimMode = 'shared' | 'exclusive';

export type SchedulingClaimScope =
  | 'resource-day'
  | 'assignment'
  | 'job-tree'
  | 'visit-tree'
  | 'day-team'
  | string;

export interface SchedulingMutationClaim {
  scope: SchedulingClaimScope;
  id: string;
  mode: SchedulingClaimMode;
}

const SCOPE_ALIASES: Record<string, string> = {
  job: 'job-tree',
  'job-tree': 'job-tree',
  visit: 'visit-tree',
  'visit-tree': 'visit-tree',
};

export function normalizeClaimScope(scope: string): string {
  return SCOPE_ALIASES[scope] || scope;
}

export function resourceDayClaimId(
  resourceType: string,
  resourceId: string,
  workDate: string
): string {
  return `${resourceType}:${resourceId}:${workDate}`;
}

export function assignmentDuplicateKey(
  resourceType: string,
  resourceId: string,
  visitId: string
): string {
  return `assign:${resourceType}:${resourceId}:${visitId}`;
}

export function assignmentMoveCoalesceGroup(assignmentId: string): string {
  return `move:${assignmentId}`;
}

export function claimsConflict(
  left: readonly SchedulingMutationClaim[],
  right: readonly SchedulingMutationClaim[]
): boolean {
  for (const a of left) {
    const aScope = normalizeClaimScope(a.scope);
    for (const b of right) {
      if (aScope !== normalizeClaimScope(b.scope)) continue;
      if (a.id !== b.id) continue;
      if (a.mode === 'exclusive' || b.mode === 'exclusive') return true;
    }
  }
  return false;
}

export function splitLockKey(key: string): { kind: string; id: string } {
  const separator = key.indexOf(':');
  return separator === -1
    ? { kind: key, id: '' }
    : { kind: key.slice(0, separator), id: key.slice(separator + 1) };
}

export function claimsFromLockKeys(lockKeys: readonly string[]): SchedulingMutationClaim[] {
  return lockKeys.map((key) => {
    const { kind, id } = splitLockKey(key);
    return {
      scope: normalizeClaimScope(kind),
      id,
      mode: 'exclusive' as const,
    };
  });
}

export function claimsToLockKeys(claims: readonly SchedulingMutationClaim[]): string[] {
  return claims.map((claim) => `${claim.scope}:${claim.id}`);
}

export function assignmentCreateClaims(input: {
  resourceType: string;
  resourceId: string;
  workDate: string;
  jobId: string;
  visitId?: string | null;
}): SchedulingMutationClaim[] {
  const claims: SchedulingMutationClaim[] = [
    {
      scope: 'resource-day',
      id: resourceDayClaimId(input.resourceType, input.resourceId, input.workDate),
      mode: 'exclusive',
    },
    { scope: 'job-tree', id: input.jobId, mode: 'shared' },
  ];
  if (input.visitId) {
    claims.push({ scope: 'visit-tree', id: input.visitId, mode: 'shared' });
  }
  return claims;
}

export function assignmentMoveClaims(input: {
  assignmentId: string;
  resourceType: string;
  resourceId: string;
  sourceWorkDate: string;
  targetWorkDate: string;
  sourceJobId: string;
  targetJobId: string;
  sourceVisitId?: string | null;
  targetVisitId?: string | null;
}): SchedulingMutationClaim[] {
  const dates = Array.from(new Set([input.sourceWorkDate, input.targetWorkDate]));
  const claims: SchedulingMutationClaim[] = dates.map((workDate) => ({
    scope: 'resource-day' as const,
    id: resourceDayClaimId(input.resourceType, input.resourceId, workDate),
    mode: 'exclusive' as const,
  }));
  claims.push({ scope: 'assignment', id: input.assignmentId, mode: 'exclusive' });
  for (const jobId of new Set([input.sourceJobId, input.targetJobId])) {
    claims.push({ scope: 'job-tree', id: jobId, mode: 'shared' });
  }
  const visitIds = [input.sourceVisitId, input.targetVisitId].filter(
    (id): id is string => Boolean(id)
  );
  for (const visitId of new Set(visitIds)) {
    claims.push({ scope: 'visit-tree', id: visitId, mode: 'shared' });
  }
  return claims;
}

export function assignmentDeleteClaims(input: {
  assignmentId: string;
  resourceType: string;
  resourceId: string;
  workDate: string;
  jobId: string;
  visitId?: string | null;
}): SchedulingMutationClaim[] {
  const claims: SchedulingMutationClaim[] = [
    {
      scope: 'resource-day',
      id: resourceDayClaimId(input.resourceType, input.resourceId, input.workDate),
      mode: 'exclusive',
    },
    { scope: 'assignment', id: input.assignmentId, mode: 'exclusive' },
    { scope: 'job-tree', id: input.jobId, mode: 'shared' },
  ];
  if (input.visitId) {
    claims.push({ scope: 'visit-tree', id: input.visitId, mode: 'shared' });
  }
  return claims;
}

export function exclusiveJobTreeClaim(jobId: string): SchedulingMutationClaim {
  return { scope: 'job-tree', id: jobId, mode: 'exclusive' };
}

export function exclusiveVisitTreeClaim(visitId: string): SchedulingMutationClaim {
  return { scope: 'visit-tree', id: visitId, mode: 'exclusive' };
}

export function exclusiveVisitCreateClaim(jobId: string): SchedulingMutationClaim {
  return { scope: 'visit-create', id: jobId, mode: 'exclusive' };
}

export function visitTimesCoalesceGroup(visitId: string): string {
  return `visit-times:${visitId}`;
}

export function visitCreateClaims(jobId: string, visitId: string): SchedulingMutationClaim[] {
  return [
    exclusiveVisitCreateClaim(jobId),
    exclusiveVisitTreeClaim(visitId),
  ];
}

export function visitTimesClaims(jobId: string, visitId: string): SchedulingMutationClaim[] {
  return [
    { scope: 'job-tree', id: jobId, mode: 'shared' },
    exclusiveVisitTreeClaim(visitId),
  ];
}

export function visitReturnPlaceClaims(jobId: string, visitId: string): SchedulingMutationClaim[] {
  return visitTimesClaims(jobId, visitId);
}

export function exclusiveDayTeamDateClaim(workDate: string): SchedulingMutationClaim {
  return { scope: 'day-team', id: workDate, mode: 'exclusive' };
}

export function exclusiveDayTeamProfileClaim(
  workDate: string,
  profileId: string
): SchedulingMutationClaim {
  return { scope: 'day-team', id: `${workDate}:${profileId}`, mode: 'exclusive' };
}

export function dayTeamAssignClaims(input: {
  workDate: string;
  jobId: string;
  visitId: string;
  memberIds: readonly string[];
}): SchedulingMutationClaim[] {
  return [
    exclusiveDayTeamDateClaim(input.workDate),
    { scope: 'job-tree', id: input.jobId, mode: 'shared' },
    { scope: 'visit-tree', id: input.visitId, mode: 'shared' },
    ...input.memberIds.map((profileId) => ({
      scope: 'resource-day' as const,
      id: resourceDayClaimId('employee', profileId, input.workDate),
      mode: 'exclusive' as const,
    })),
  ];
}
