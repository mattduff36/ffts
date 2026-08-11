import type {
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisitBacklogItem,
  SchedulingBoardPayload,
} from '@/types/scheduling';

export interface SchedulingProjection {
  board: SchedulingBoardPayload | undefined;
  quoteCandidates: ScheduleQuoteCandidate[] | undefined;
  projectCandidates: ScheduleProjectCandidate[] | undefined;
  visitBacklog: ScheduleVisitBacklogItem[] | undefined;
}

export type SchedulingOptimisticStatus = 'pending' | 'acknowledged' | 'uncertain';

export interface SchedulingOptimisticOperation {
  id: string;
  sequence: number;
  kind: string;
  status: SchedulingOptimisticStatus;
  lockKeys: string[];
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

function splitLockKey(key: string): { kind: string; id: string } {
  const separator = key.indexOf(':');
  return separator === -1
    ? { kind: key, id: '' }
    : { kind: key.slice(0, separator), id: key.slice(separator + 1) };
}

function lockKeysConflict(left: string, right: string): boolean {
  if (left === right) return true;
  const a = splitLockKey(left);
  const b = splitLockKey(right);
  if (a.id !== b.id) return false;
  const relatedKinds: Record<string, string[]> = {
    job: ['job-tree'],
    'job-tree': ['job'],
    visit: ['visit-tree'],
    'visit-tree': ['visit'],
  };
  return relatedKinds[a.kind]?.includes(b.kind) === true;
}

export function operationsOverlap(
  operation: Pick<SchedulingOptimisticOperation, 'lockKeys'>,
  operations: SchedulingOptimisticOperation[]
): boolean {
  const requested = new Set(operation.lockKeys);
  return operations.some((current) =>
    current.lockKeys.some((currentKey) =>
      Array.from(requested).some((requestedKey) =>
        lockKeysConflict(currentKey, requestedKey)
      )
    )
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
