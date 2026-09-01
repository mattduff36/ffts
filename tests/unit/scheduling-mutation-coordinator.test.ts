import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assignmentCreateClaims,
  assignmentDeleteClaims,
  assignmentDuplicateKey,
  assignmentMoveClaims,
  assignmentMoveCoalesceGroup,
  claimsConflict,
  claimsFromLockKeys,
  dayTeamAssignClaims,
  exclusiveJobTreeClaim,
  exclusiveVisitTreeClaim,
} from '@/app/(dashboard)/scheduling/components/scheduling-mutation-claims';
import {
  findCoordinatorPersistTarget,
  SchedulingMutationCoordinator,
  isAmbiguousSchedulingFailure,
  type SchedulingCoordinatorOperation,
  type SchedulingPersistOutcome,
} from '@/app/(dashboard)/scheduling/components/scheduling-mutation-coordinator';
import { SchedulingApiError } from '@/lib/client/scheduling';
import type { SchedulingProjection } from '@/app/(dashboard)/scheduling/components/scheduling-optimistic-ledger';

function deferred<T = SchedulingPersistOutcome>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function applyMarker(id: string): (state: SchedulingProjection) => SchedulingProjection {
  return (state) => ({
    ...state,
    quoteCandidates: [
      ...(state.quoteCandidates || []).filter((item) => item.id !== id),
      {
        id,
        quote_reference: id,
        base_quote_reference: id,
        title: id,
        customer_name: null,
        status: 'draft',
        start_date: null,
        end_date: null,
        estimated_duration_days: 1,
      },
    ],
  });
}

function createCoordinator() {
  const seen: string[][] = [];
  const coordinator = new SchedulingMutationCoordinator({
    onChange: (operations) => {
      seen.push(operations.map((operation) => `${operation.id}:${operation.executionStatus}`));
    },
  });
  return { coordinator, seen };
}

describe('scheduling mutation coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('COORD-CLAIM-001 exclusive conflicts with shared or exclusive on the same scope+id', () => {
    const resourceDay = {
      scope: 'resource-day' as const,
      id: 'employee:e1:2026-07-14',
      mode: 'exclusive' as const,
    };
    const sharedJob = { scope: 'job-tree' as const, id: 'job-1', mode: 'shared' as const };
    const exclusiveJob = exclusiveJobTreeClaim('job-1');
    expect(claimsConflict([resourceDay], [resourceDay])).toBe(true);
    expect(claimsConflict([sharedJob], [sharedJob])).toBe(false);
    expect(claimsConflict([sharedJob], [exclusiveJob])).toBe(true);
    expect(claimsConflict([exclusiveJob], [sharedJob])).toBe(true);
    expect(claimsConflict(
      [sharedJob],
      [{ scope: 'job-tree', id: 'job-2', mode: 'exclusive' }]
    )).toBe(false);
  });

  it('COORD-ALIAS-001 treats job/job-tree and visit/visit-tree as the same barrier', () => {
    const fromJobLock = claimsFromLockKeys(['job:job-1']);
    const fromJobTreeLock = claimsFromLockKeys(['job-tree:job-1']);
    expect(claimsConflict(fromJobLock, [{ ...exclusiveJobTreeClaim('job-1'), mode: 'shared' }])).toBe(true);
    expect(claimsConflict(fromJobTreeLock, assignmentCreateClaims({
      resourceType: 'employee',
      resourceId: 'e1',
      workDate: '2026-07-14',
      jobId: 'job-1',
      visitId: 'visit-1',
    }))).toBe(true);
    expect(claimsConflict(
      claimsFromLockKeys(['visit:visit-1']),
      [exclusiveVisitTreeClaim('visit-1')]
    )).toBe(true);
  });

  it('COORD-001 admits two employees on the same job and persists them concurrently', async () => {
    const { coordinator } = createCoordinator();
    const first = deferred();
    const second = deferred();
    let started = 0;
    coordinator.admit({
      kind: 'create-assignment',
      requestId: 'req-a',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('e1'),
      persist: async () => {
        started += 1;
        return first.promise;
      },
    });
    coordinator.admit({
      kind: 'create-assignment',
      requestId: 'req-b',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e2',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('e2'),
      persist: async () => {
        started += 1;
        return second.promise;
      },
    });
    expect(coordinator.getOperations()).toHaveLength(2);
    await flush();
    expect(started).toBe(2);
    first.resolve({ kind: 'success' });
    second.resolve({ kind: 'success' });
    await flush();
    expect(coordinator.getOperations().every((op) => op.executionStatus === 'completed')).toBe(true);
    coordinator.dispose();
  });

  it('COORD-002 projects both same-employee same-day commands and serializes persist', async () => {
    const { coordinator } = createCoordinator();
    const first = deferred();
    const second = deferred();
    let started = 0;
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('visit-1'),
      persist: async () => {
        started += 1;
        return first.promise;
      },
    });
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-2',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('visit-2'),
      persist: async () => {
        started += 1;
        return second.promise;
      },
    });
    expect(coordinator.getOperations()).toHaveLength(2);
    await flush();
    expect(started).toBe(1);
    first.resolve({ kind: 'success' });
    await flush();
    expect(started).toBe(2);
    second.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-003 persists the same employee on different days concurrently', async () => {
    const { coordinator } = createCoordinator();
    let started = 0;
    const first = deferred();
    const second = deferred();
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('d1'),
      persist: async () => {
        started += 1;
        return first.promise;
      },
    });
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-15',
        jobId: 'job-1',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('d2'),
      persist: async () => {
        started += 1;
        return second.promise;
      },
    });
    await flush();
    expect(started).toBe(2);
    first.resolve({ kind: 'success' });
    second.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-004 does not exclusive-lock a visit for two plant creates', async () => {
    const { coordinator } = createCoordinator();
    let started = 0;
    const first = deferred();
    const second = deferred();
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'plant',
        resourceId: 'p1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('p1'),
      persist: async () => {
        started += 1;
        return first.promise;
      },
    });
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'plant',
        resourceId: 'p2',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('p2'),
      persist: async () => {
        started += 1;
        return second.promise;
      },
    });
    await flush();
    expect(started).toBe(2);
    first.resolve({ kind: 'success' });
    second.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-005 waits job deletion exclusive behind a shared child assignment', async () => {
    const { coordinator } = createCoordinator();
    const child = deferred();
    const deletion = deferred();
    let started = 0;
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('child'),
      persist: async () => {
        started += 1;
        return child.promise;
      },
    });
    coordinator.admit({
      kind: 'remove-job',
      claims: [exclusiveJobTreeClaim('job-1')],
      queryKeys: ['board:week'],
      apply: applyMarker('delete-job'),
      persist: async () => {
        started += 1;
        return deletion.promise;
      },
    });
    await flush();
    expect(started).toBe(1);
    child.resolve({ kind: 'success' });
    await flush();
    expect(started).toBe(2);
    deletion.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-006 serializes visit structural exclusive with a child assignment', async () => {
    const { coordinator } = createCoordinator();
    const child = deferred();
    const visitDelete = deferred();
    let started = 0;
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('child'),
      persist: async () => {
        started += 1;
        return child.promise;
      },
    });
    coordinator.admit({
      kind: 'delete-visit',
      claims: [exclusiveVisitTreeClaim('visit-1')],
      queryKeys: ['board:week'],
      apply: applyMarker('delete-visit'),
      persist: async () => {
        started += 1;
        return visitDelete.promise;
      },
    });
    await flush();
    expect(started).toBe(1);
    child.resolve({ kind: 'success' });
    await flush();
    expect(started).toBe(2);
    visitDelete.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-007 reuses one command and request ID for an exact repeated gesture', async () => {
    const { coordinator } = createCoordinator();
    const persist = deferred();
    const first = coordinator.admit({
      kind: 'create-assignment',
      requestId: 'req-dup',
      duplicateKey: assignmentDuplicateKey('employee', 'e1', 'visit-1'),
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('e1'),
      persist: async () => persist.promise,
    });
    const second = coordinator.admit({
      kind: 'create-assignment',
      requestId: 'req-dup-other',
      duplicateKey: assignmentDuplicateKey('employee', 'e1', 'visit-1'),
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('e1-again'),
      persist: async () => persist.promise,
    });
    expect(second.duplicate).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    expect(second.operation.requestId).toBe('req-dup');
    expect(coordinator.getOperations()).toHaveLength(1);
    persist.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-008 does not collapse additive creates onto different visits', async () => {
    const { coordinator } = createCoordinator();
    const first = deferred();
    const second = deferred();
    coordinator.admit({
      kind: 'create-assignment',
      duplicateKey: assignmentDuplicateKey('employee', 'e1', 'visit-1'),
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('visit-1'),
      persist: async () => first.promise,
    });
    coordinator.admit({
      kind: 'create-assignment',
      duplicateKey: assignmentDuplicateKey('employee', 'e1', 'visit-2'),
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('visit-2'),
      persist: async () => second.promise,
    });
    expect(coordinator.getOperations()).toHaveLength(2);
    first.resolve({ kind: 'success' });
    second.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-009 coalesces unsent move A→B→C onto C with the original request ID', async () => {
    const { coordinator } = createCoordinator();
    const persistCalls: string[] = [];
    const gate = deferred();
    const waitToStart = deferred<void>();
    const first = coordinator.admit({
      kind: 'move-assignment',
      requestId: 'req-move',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      claims: assignmentMoveClaims({
        assignmentId: 'asg-1',
        resourceType: 'employee',
        resourceId: 'e1',
        sourceWorkDate: '2026-07-14',
        targetWorkDate: '2026-07-14',
        sourceJobId: 'job-1',
        targetJobId: 'job-1',
        sourceVisitId: 'visit-a',
        targetVisitId: 'visit-b',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('B'),
      persist: async () => {
        persistCalls.push('B');
        await waitToStart;
        return gate.promise;
      },
    });
    const second = coordinator.admit({
      kind: 'move-assignment',
      requestId: 'req-move-2',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      claims: assignmentMoveClaims({
        assignmentId: 'asg-1',
        resourceType: 'employee',
        resourceId: 'e1',
        sourceWorkDate: '2026-07-14',
        targetWorkDate: '2026-07-14',
        sourceJobId: 'job-1',
        targetJobId: 'job-1',
        sourceVisitId: 'visit-a',
        targetVisitId: 'visit-c',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('C'),
      persist: async () => {
        persistCalls.push('C');
        return { kind: 'success' };
      },
    });
    expect(second.coalesced).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    expect(second.operation.requestId).toBe('req-move');
    expect(coordinator.getOperations()).toHaveLength(1);
    await flush();
    waitToStart.resolve();
    gate.resolve({ kind: 'success' });
    await flush();
    expect(persistCalls).toEqual(['C']);
    coordinator.dispose();
  });

  it('COORD-010 keeps C visible and queued when B is already executing', async () => {
    const { coordinator } = createCoordinator();
    const executing = deferred();
    const queued = deferred();
    let started = 0;
    const b = coordinator.admit({
      kind: 'move-assignment',
      requestId: 'req-b',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      claims: assignmentMoveClaims({
        assignmentId: 'asg-1',
        resourceType: 'employee',
        resourceId: 'e1',
        sourceWorkDate: '2026-07-14',
        targetWorkDate: '2026-07-14',
        sourceJobId: 'job-1',
        targetJobId: 'job-1',
        sourceVisitId: 'visit-a',
        targetVisitId: 'visit-b',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('B'),
      persist: async () => {
        started += 1;
        return executing.promise;
      },
    });
    await flush();
    expect(started).toBe(1);
    const c = coordinator.admit({
      kind: 'move-assignment',
      requestId: 'req-c',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      claims: assignmentMoveClaims({
        assignmentId: 'asg-1',
        resourceType: 'employee',
        resourceId: 'e1',
        sourceWorkDate: '2026-07-14',
        targetWorkDate: '2026-07-14',
        sourceJobId: 'job-1',
        targetJobId: 'job-1',
        sourceVisitId: 'visit-a',
        targetVisitId: 'visit-c',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('C'),
      persist: async () => {
        started += 1;
        return queued.promise;
      },
    });
    expect(c.coalesced).toBe(false);
    expect(c.operation.id).not.toBe(b.operation.id);
    expect(coordinator.getOperations()).toHaveLength(2);
    expect(started).toBe(1);
    executing.resolve({ kind: 'success' });
    await flush();
    expect(started).toBe(2);
    queued.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('COORD-011 treats a 409 then override as a new request ID', async () => {
    const { coordinator } = createCoordinator();
    const first = coordinator.admit({
      kind: 'create-assignment',
      requestId: 'req-original',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('create'),
      persist: async () => ({ kind: 'conflict' }),
    });
    await flush();
    expect(coordinator.getOperations()).toHaveLength(0);
    const override = coordinator.admit({
      kind: 'override-assignment-conflict',
      requestId: 'req-override',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('override'),
      persist: async () => ({ kind: 'success' }),
    });
    expect(override.operation.requestId).toBe('req-override');
    expect(override.operation.requestId).not.toBe(first.operation.requestId);
    await flush();
    coordinator.dispose();
  });

  it('COORD-012 keeps a completed ack while a later exclusive command is still queued', async () => {
    const { coordinator } = createCoordinator();
    const first = deferred();
    const second = deferred();
    coordinator.admit({
      id: 'first',
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('first'),
      persist: async () => first.promise,
    });
    coordinator.admit({
      id: 'second',
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-2',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('second'),
      persist: async () => second.promise,
    });
    await flush();
    first.resolve({ kind: 'success' });
    await flush();
    const operations = coordinator.getOperations();
    expect(operations.find((op) => op.id === 'first')?.executionStatus).toBe('completed');
    expect(operations.find((op) => op.id === 'first')?.status).toBe('acknowledged');
    expect(operations.find((op) => op.id === 'second')?.executionStatus).toBe('executing');
    second.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('retries an ambiguous TypeError with the same request ID', async () => {
    vi.useFakeTimers();
    const { coordinator } = createCoordinator();
    let attempts = 0;
    const requestId = 'req-retry';
    coordinator.admit({
      kind: 'create-assignment',
      requestId,
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('retry'),
      persist: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('network lost');
        return { kind: 'success' };
      },
    });
    await flush();
    expect(attempts).toBe(1);
    expect(coordinator.getOperations()[0]?.status).toBe('uncertain');
    expect(coordinator.getOperations()[0]?.requestId).toBe(requestId);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(attempts).toBe(2);
    expect(coordinator.getOperations()[0]?.requestId).toBe(requestId);
    expect(coordinator.getOperations()[0]?.executionStatus).toBe('completed');
    coordinator.dispose();
  });

  it('does not treat visit_queued as an ambiguous retry', () => {
    const error = new SchedulingApiError('queued', 409, { code: 'visit_queued' });
    expect(isAmbiguousSchedulingFailure(error)).toBe(false);
    expect(isAmbiguousSchedulingFailure(new TypeError('fail'))).toBe(true);
    expect(isAmbiguousSchedulingFailure(new SchedulingApiError('boom', 500, {}))).toBe(true);
  });

  it('TEAM-COORD-001 exclusive-locks each snapshot member resource-day', async () => {
    const { coordinator } = createCoordinator();
    const team = deferred();
    const employee = deferred();
    let started = 0;
    coordinator.admit({
      kind: 'assign-day-team',
      claims: dayTeamAssignClaims({
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
        memberIds: ['e1', 'e2'],
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('team'),
      persist: async () => {
        started += 1;
        return team.promise;
      },
    });
    coordinator.admit({
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-2',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('e1'),
      persist: async () => {
        started += 1;
        return employee.promise;
      },
    });
    await flush();
    expect(started).toBe(1);
    team.resolve({ kind: 'success' });
    await flush();
    expect(started).toBe(2);
    employee.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('UI-STRESS-001 keeps 16 mixed operations admitted under deferred persistence', async () => {
    const { coordinator } = createCoordinator();
    const gates = Array.from({ length: 16 }, () => deferred());
    let started = 0;
    for (let index = 0; index < 16; index += 1) {
      const employeeId = `e${index % 4}`;
      const visitId = `visit-${index}`;
      const workDate = index % 2 === 0 ? '2026-07-14' : '2026-07-15';
      coordinator.admit({
        kind: 'create-assignment',
        claims: assignmentCreateClaims({
          resourceType: 'employee',
          resourceId: employeeId,
          workDate,
          jobId: 'job-1',
          visitId,
        }),
        queryKeys: ['board:week'],
        apply: applyMarker(visitId),
        persist: async () => {
          started += 1;
          return gates[index].promise;
        },
      });
    }
    expect(coordinator.getOperations()).toHaveLength(16);
    await flush();
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThan(16);
    for (const gate of gates) gate.resolve({ kind: 'success' });
    for (let attempt = 0; attempt < 16; attempt += 1) {
      await flush();
      if (coordinator.getOperations().every((op) => op.executionStatus === 'completed')) break;
    }
    expect(coordinator.getOperations().every((op) => op.executionStatus === 'completed')).toBe(true);
    coordinator.dispose();
  });

  it('uses delete claims that exclusive-lock the assignment and resource-day', () => {
    const claims = assignmentDeleteClaims({
      assignmentId: 'asg-1',
      resourceType: 'employee',
      resourceId: 'e1',
      workDate: '2026-07-14',
      jobId: 'job-1',
      visitId: 'visit-1',
    });
    expect(claimsConflict(claims, assignmentCreateClaims({
      resourceType: 'employee',
      resourceId: 'e1',
      workDate: '2026-07-14',
      jobId: 'job-1',
      visitId: 'visit-2',
    }))).toBe(true);
  });

  it('does not let a later exclusive command overtake an earlier queued conflict', async () => {
    const { coordinator } = createCoordinator();
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const started: string[] = [];
    coordinator.admit({
      id: 'a',
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('a'),
      persist: async () => {
        started.push('a');
        return first.promise;
      },
    });
    coordinator.admit({
      id: 'b',
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-2',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('b'),
      persist: async () => {
        started.push('b');
        return second.promise;
      },
    });
    coordinator.admit({
      id: 'c',
      kind: 'create-assignment',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-3',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('c'),
      persist: async () => {
        started.push('c');
        return third.promise;
      },
    });
    await flush();
    expect(started).toEqual(['a']);
    first.resolve({ kind: 'success' });
    await flush();
    expect(started).toEqual(['a', 'b']);
    second.resolve({ kind: 'success' });
    await flush();
    expect(started).toEqual(['a', 'b', 'c']);
    third.resolve({ kind: 'success' });
    await flush();
    coordinator.dispose();
  });

  it('prefers the exact persist target over a completed coalesce peer', () => {
    const completed = {
      id: 'move-b',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      executionStatus: 'completed',
      requestId: 'req-b',
    } as SchedulingCoordinatorOperation;
    const later = {
      id: 'move-c',
      coalesceGroup: assignmentMoveCoalesceGroup('asg-1'),
      executionStatus: 'queued',
      requestId: 'req-c',
    } as SchedulingCoordinatorOperation;
    expect(
      findCoordinatorPersistTarget([completed, later], 'move-c', assignmentMoveCoalesceGroup('asg-1'))
        ?.requestId
    ).toBe('req-c');
  });

  it('keeps an uncertain projection after ambiguous retries are exhausted', async () => {
    vi.useFakeTimers();
    const { coordinator } = createCoordinator();
    coordinator.admit({
      id: 'retry-op',
      kind: 'create-assignment',
      requestId: 'req-retry',
      claims: assignmentCreateClaims({
        resourceType: 'employee',
        resourceId: 'e1',
        workDate: '2026-07-14',
        jobId: 'job-1',
        visitId: 'visit-1',
      }),
      queryKeys: ['board:week'],
      apply: applyMarker('retry'),
      persist: async () => {
        throw new TypeError('network lost');
      },
    });
    await flush();
    for (const delay of [250, 500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(delay);
      await flush();
    }
    const live = coordinator.getOperations().find((operation) => operation.id === 'retry-op');
    expect(live?.status).toBe('uncertain');
    expect(live?.executionStatus).toBe('completed');
    expect(live?.requestId).toBe('req-retry');
    coordinator.dispose();
  });
});
