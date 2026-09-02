import type {
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisitBacklogItem,
  SchedulingBoardPayload,
} from '@/types/scheduling';
import {
  claimsConflict,
  claimsFromLockKeys,
  type SchedulingMutationClaim,
} from './scheduling-mutation-claims';

export interface SchedulingProjection {
  board: SchedulingBoardPayload | undefined;
  quoteCandidates: ScheduleQuoteCandidate[] | undefined;
  projectCandidates: ScheduleProjectCandidate[] | undefined;
  visitBacklog: ScheduleVisitBacklogItem[] | undefined;
}

export type SchedulingOptimisticStatus = 'pending' | 'acknowledged' | 'uncertain';

export type SchedulingExecutionStatus =
  | 'queued'
  | 'executing'
  | 'awaitingRetry'
  | 'completed';

export interface SchedulingOptimisticOperation {
  id: string;
  sequence: number;
  kind: string;
  status: SchedulingOptimisticStatus;
  lockKeys: string[];
  claims?: SchedulingMutationClaim[];
  requestId?: string;
  duplicateKey?: string;
  coalesceGroup?: string;
  dependsOn?: string[];
  identityWaitKeys?: string[];
  retryPolicy?: 'ambiguous' | 'none';
  executionStatus?: SchedulingExecutionStatus;
  retryCount?: number;
  queryKeys: string[];
  reconciledKeys: string[];
  proofs: Record<string, (base: SchedulingProjection) => boolean>;
  apply: (state: SchedulingProjection) => SchedulingProjection;
}

export function createOptimisticEntityId(
  operationId: string,
  entityKind: string
): string {
  return `optimistic:${operationId}:${entityKind}`;
}

export function isOptimisticEntityId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith('optimistic:'));
}

export function projectSchedulingState(
  base: SchedulingProjection,
  operations: SchedulingOptimisticOperation[],
  activeBoardKey?: string
): SchedulingProjection {
  return [...operations]
    .sort((a, b) => a.sequence - b.sequence)
    .reduce((state, operation) => {
      const applied = operation.apply(state);
      const shouldApply = (key: string) =>
        operation.proofs[key]?.(base) !== true;
      return {
        board:
          activeBoardKey
            && operation.queryKeys.includes(activeBoardKey)
            && shouldApply(activeBoardKey)
            ? applied.board
            : state.board,
        quoteCandidates:
          operation.queryKeys.includes('quotes') && shouldApply('quotes')
            ? applied.quoteCandidates
            : state.quoteCandidates,
        projectCandidates:
          operation.queryKeys.includes('projects') && shouldApply('projects')
            ? applied.projectCandidates
            : state.projectCandidates,
        visitBacklog:
          operation.queryKeys.includes('backlog') && shouldApply('backlog')
            ? applied.visitBacklog
            : state.visitBacklog,
      };
    }, base);
}

export function operationsOverlap(
  operation: Pick<SchedulingOptimisticOperation, 'lockKeys' | 'claims'>,
  operations: SchedulingOptimisticOperation[]
): boolean {
  const requested = operation.claims || claimsFromLockKeys(operation.lockKeys);
  return operations.some((current) =>
    claimsConflict(requested, current.claims || claimsFromLockKeys(current.lockKeys))
  );
}

export function replaceOptimisticOperation(
  operations: SchedulingOptimisticOperation[],
  operationId: string,
  replacement:
    | SchedulingOptimisticOperation
    | ((current: SchedulingOptimisticOperation) => SchedulingOptimisticOperation)
): SchedulingOptimisticOperation[] {
  return operations.map((operation) => {
    if (operation.id !== operationId) return operation;
    return typeof replacement === 'function'
      ? replacement(operation)
      : replacement;
  });
}

export function removeOptimisticOperation(
  operations: SchedulingOptimisticOperation[],
  operationId: string
): SchedulingOptimisticOperation[] {
  return operations.filter((operation) => operation.id !== operationId);
}

export function reconcileOptimisticOperations(
  operations: SchedulingOptimisticOperation[],
  key: string,
  base: SchedulingProjection,
  eligibleOperationIds: ReadonlySet<string>
): SchedulingOptimisticOperation[] {
  return operations
    .map((operation) =>
      eligibleOperationIds.has(operation.id)
        && operation.proofs[key]?.(base) === true
        ? {
            ...operation,
            reconciledKeys: operation.reconciledKeys.includes(key)
              ? operation.reconciledKeys
              : [...operation.reconciledKeys, key],
          }
        : operation
    )
    .filter(
      (operation) =>
        operation.status === 'pending'
        || operation.queryKeys.some(
          (queryKey) => !operation.reconciledKeys.includes(queryKey)
        )
    );
}
