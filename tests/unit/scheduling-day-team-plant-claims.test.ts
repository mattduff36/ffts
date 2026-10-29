import { describe, expect, it } from 'vitest';
import {
  claimsConflict,
  dayTeamAssignClaims,
  resourceDayClaimId,
} from '@/app/(dashboard)/scheduling/components/scheduling-mutation-claims';

describe('day team plant assignment claims', () => {
  it('claims each plant as plant resource-day and leaves employee claims to members', () => {
    const claims = dayTeamAssignClaims({
      workDate: '2026-09-01',
      jobId: 'job-1',
      visitId: 'visit-1',
      memberIds: ['employee-1'],
      plantIds: ['plant-1'],
    });
    const resourceDays = claims
      .filter((claim) => claim.scope === 'resource-day')
      .map((claim) => claim.id);

    expect(resourceDays).toEqual([
      resourceDayClaimId('employee', 'employee-1', '2026-09-01'),
      resourceDayClaimId('plant', 'plant-1', '2026-09-01'),
    ]);
    expect(resourceDays.some((id) => id.startsWith('employee:plant-1'))).toBe(false);
  });

  it('isolates a plant claim from an employee claim on the same date', () => {
    const plantTeam = dayTeamAssignClaims({
      workDate: '2026-09-01',
      jobId: 'job-1',
      visitId: 'visit-1',
      memberIds: [],
      plantIds: ['plant-1'],
    });
    expect(claimsConflict(plantTeam, [{
      scope: 'resource-day',
      id: resourceDayClaimId('employee', 'employee-1', '2026-09-01'),
      mode: 'exclusive',
    }])).toBe(false);
    expect(claimsConflict(plantTeam, [{
      scope: 'resource-day',
      id: resourceDayClaimId('plant', 'plant-1', '2026-09-01'),
      mode: 'exclusive',
    }])).toBe(true);
  });
});
