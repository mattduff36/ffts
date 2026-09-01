import { describe, expect, it } from 'vitest';
import {
  createOptimisticEntityId,
  operationsOverlap,
  projectSchedulingState,
  reconcileOptimisticOperations,
  removeOptimisticOperation,
  type SchedulingOptimisticOperation,
  type SchedulingProjection,
} from '@/app/(dashboard)/scheduling/components/scheduling-optimistic-ledger';
import type { SchedulingBoardPayload } from '@/types/scheduling';

const emptyProjection: SchedulingProjection = {
  board: undefined,
  quoteCandidates: [],
  projectCandidates: [],
  visitBacklog: [],
};

function operation(
  id: string,
  sequence: number,
  lockKeys: string[],
  apply: SchedulingOptimisticOperation['apply']
): SchedulingOptimisticOperation {
  return {
    id,
    sequence,
    kind: 'test',
    status: 'pending',
    lockKeys,
    queryKeys: ['quotes'],
    reconciledKeys: [],
    proofs: {},
    apply,
  };
}

describe('scheduling optimistic ledger', () => {
  it('OPT-REBASE-001 projects operations over every refreshed server base', () => {
    const addFirst = operation('one', 2, ['quote:one'], (state) => ({
      ...state,
      quoteCandidates: [
        ...(state.quoteCandidates || []),
        {
          id: 'one',
          quote_reference: 'ONE',
          base_quote_reference: 'ONE',
          title: 'One',
          customer_name: null,
          status: 'draft',
          start_date: null,
          end_date: null,
          estimated_duration_days: 1,
        },
      ],
    }));
    const addSecond = operation('two', 1, ['quote:two'], (state) => ({
      ...state,
      quoteCandidates: [
        ...(state.quoteCandidates || []),
        {
          id: 'two',
          quote_reference: 'TWO',
          base_quote_reference: 'TWO',
          title: 'Two',
          customer_name: null,
          status: 'draft',
          start_date: null,
          end_date: null,
          estimated_duration_days: 1,
        },
      ],
    }));

    const projected = projectSchedulingState(emptyProjection, [addFirst, addSecond]);
    expect(projected.quoteCandidates?.map((quote) => quote.id)).toEqual(['two', 'one']);

    const refreshed = projectSchedulingState(
      {
        ...emptyProjection,
        quoteCandidates: [{
          id: 'server',
          quote_reference: 'SERVER',
          base_quote_reference: 'SERVER',
          title: 'Server',
          customer_name: null,
          status: 'draft',
          start_date: null,
          end_date: null,
          estimated_duration_days: 1,
        }],
      },
      [addFirst, addSecond]
    );
    expect(refreshed.quoteCandidates?.map((quote) => quote.id)).toEqual([
      'server',
      'two',
      'one',
    ]);
  });

  it('OPT-ROLLBACK-001 rolls back one operation without removing concurrent work', () => {
    const first = operation('one', 1, ['quote:one'], (state) => ({
      ...state,
      quoteCandidates: [],
    }));
    const second = {
      ...operation('two', 2, ['quote:two'], (state) => ({
        ...state,
        projectCandidates: [{
          id: 'project',
          project_reference: 'PROJECT',
          manager_profile_id: 'manager',
          requester_initials: 'MD',
          title: 'Project',
          description: null,
          status: 'open',
        }],
      })),
      queryKeys: ['projects'],
    };

    const remaining = removeOptimisticOperation([first, second], first.id);
    expect(projectSchedulingState(emptyProjection, remaining).projectCandidates)
      .toHaveLength(1);
  });

  it('OPT-LOCK-001 and OPT-ALIAS-001 enforce related locks and scoped IDs', () => {
    const current = operation('one', 1, ['job-tree:job-1'], (state) => state);
    expect(operationsOverlap({ lockKeys: ['job-tree:job-1'] }, [current])).toBe(true);
    expect(operationsOverlap({ lockKeys: ['job-tree:job-2'] }, [current])).toBe(false);
    const visitTree = operation('visit', 2, ['visit-tree:visit-1'], (state) => state);
    expect(operationsOverlap({ lockKeys: ['visit:visit-1'] }, [visitTree])).toBe(true);
    expect(createOptimisticEntityId('operation', 'visit'))
      .toBe('optimistic:operation:visit');
  });

  it('OPT-SCOPE-001 never projects a pending week operation onto another week', () => {
    const board: SchedulingBoardPayload = {
      week: { start: '2026-08-17', end: '2026-08-23' },
      jobs: [],
      tags: [],
      visits: [],
      assignments: [],
      resources: { employees: [], plant: [] },
      employee_capacity: [],
      plant_unavailability: [],
      day_teams: [],
    };
    const weekAOperation = {
      ...operation('week-a', 1, ['job:one'], (state) => ({
        ...state,
        board: state.board
          ? {
              ...state.board,
              week: { start: 'wrong-week', end: 'wrong-week' },
            }
          : state.board,
      })),
      queryKeys: ['board:2026-08-10'],
    };

    const projected = projectSchedulingState(
      { ...emptyProjection, board },
      [weekAOperation],
      'board:2026-08-17'
    );
    expect(projected.board?.week.start).toBe('2026-08-17');
  });

  it('FOLLOWUP-RECON-001 retains an acknowledged overlay until server proof exists', () => {
    const acknowledged = {
      ...operation('acknowledged', 1, ['quote:one'], (state) => ({
        ...state,
        quoteCandidates: [
          ...(state.quoteCandidates || []),
          {
            id: 'one',
            quote_reference: 'ONE',
            base_quote_reference: 'ONE',
            title: 'One',
            customer_name: null,
            status: 'draft',
            start_date: null,
            end_date: null,
            estimated_duration_days: 1,
          },
        ],
      })),
      status: 'acknowledged' as const,
      proofs: {
        quotes: (base: SchedulingProjection) =>
          base.quoteCandidates?.some((quote) => quote.id === 'one') === true,
      },
    };

    expect(
      projectSchedulingState(emptyProjection, [acknowledged]).quoteCandidates
    ).toHaveLength(1);

    const provedBase = projectSchedulingState(
      {
        ...emptyProjection,
        quoteCandidates: acknowledged.apply(emptyProjection).quoteCandidates,
      },
      [acknowledged]
    );
    expect(provedBase.quoteCandidates).toHaveLength(1);
  });

  it('FOLLOWUP-UNCERTAIN-002 keeps an ambiguous overlay across stale bases', () => {
    const uncertain = {
      ...operation('uncertain', 1, ['quote:one'], (state) => ({
        ...state,
        quoteCandidates: [
          ...(state.quoteCandidates || []),
          {
            id: 'one',
            quote_reference: 'ONE',
            base_quote_reference: 'ONE',
            title: 'One',
            customer_name: null,
            status: 'draft',
            start_date: null,
            end_date: null,
            estimated_duration_days: 1,
          },
        ],
      })),
      status: 'uncertain' as const,
      proofs: {
        quotes: (base: SchedulingProjection) =>
          base.quoteCandidates?.some((quote) => quote.id === 'one') === true,
      },
    };

    const stale = projectSchedulingState(emptyProjection, [uncertain]);
    expect(stale.quoteCandidates?.map((quote) => quote.id)).toEqual(['one']);

    const stillUncertain = reconcileOptimisticOperations(
      [uncertain],
      'quotes',
      emptyProjection,
      new Set([uncertain.id])
    );
    expect(stillUncertain).toHaveLength(1);

    const authoritativeBase = {
      ...emptyProjection,
      quoteCandidates: uncertain.apply(emptyProjection).quoteCandidates,
    };
    const retired = reconcileOptimisticOperations(
      stillUncertain,
      'quotes',
      authoritativeBase,
      new Set([uncertain.id])
    );
    expect(retired).toEqual([]);
  });

  it('FOLLOWUP-LOCK-004 serializes job deletion with child mutations', () => {
    const deletingJob = operation(
      'delete-job',
      1,
      ['job-tree:job-1'],
      (state) => state
    );

    expect(
      operationsOverlap(
        { lockKeys: ['job-tree:job-1', 'visit:visit-7'] },
        [deletingJob]
      )
    ).toBe(true);
    expect(
      operationsOverlap(
        { lockKeys: ['job-tree:job-1', 'assignment:assignment-4'] },
        [deletingJob]
      )
    ).toBe(true);
    expect(
      operationsOverlap(
        { lockKeys: ['job-tree:job-2', 'visit:visit-7'] },
        [deletingJob]
      )
    ).toBe(false);
  });
});
