import { SchedulingApiError } from '@/lib/client/scheduling';
import type { SchedulingOptimisticOperation } from './scheduling-optimistic-ledger';
import {
  claimsConflict,
  claimsToLockKeys,
  splitLockKey,
  type SchedulingMutationClaim,
} from './scheduling-mutation-claims';
import { isOptimisticEntityId } from './scheduling-optimistic-ledger';

export type SchedulingExecutionStatus =
  | 'queued'
  | 'executing'
  | 'awaitingRetry'
  | 'completed';

export type SchedulingRetryPolicy = 'ambiguous' | 'none';
export type SchedulingCommandOutcomeKind = 'success' | 'failed' | 'uncertain';

export type SchedulingPersistOutcome =
  | {
      kind: 'success';
      proofs?: SchedulingOptimisticOperation['proofs'];
      apply?: SchedulingOptimisticOperation['apply'];
      identityAliases?: Record<string, string>;
    }
  | { kind: 'conflict'; error?: unknown }
  | { kind: 'failed'; error: unknown };

export interface SchedulingCoordinatorOperation extends SchedulingOptimisticOperation {
  claims: SchedulingMutationClaim[];
  requestId: string;
  duplicateKey?: string;
  coalesceGroup?: string;
  dependsOn?: string[];
  identityWaitKeys?: string[];
  retryPolicy?: SchedulingRetryPolicy;
  executionStatus: SchedulingExecutionStatus;
  retryCount: number;
}

export interface AdmitSchedulingCommandInput {
  id?: string;
  kind: string;
  claims: SchedulingMutationClaim[];
  lockKeys?: string[];
  duplicateKey?: string;
  coalesceGroup?: string;
  dependsOn?: string[];
  identityWaitKeys?: string[];
  retryPolicy?: SchedulingRetryPolicy;
  requestId?: string;
  queryKeys: string[];
  proofs?: SchedulingOptimisticOperation['proofs'];
  apply: SchedulingOptimisticOperation['apply'];
  persist: () => Promise<SchedulingPersistOutcome>;
}

export interface AdmitSchedulingCommandResult {
  operation: SchedulingCoordinatorOperation;
  duplicate: boolean;
  coalesced: boolean;
}

const RETRY_BACKOFF_MS = [250, 500, 1000, 2000];
const MAX_AMBIGUOUS_RETRIES = 4;

export function isAmbiguousSchedulingFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof SchedulingApiError) {
    if (error.payload.code === 'visit_queued') return false;
    return error.status >= 500;
  }
  return false;
}

export function toPersistOutcome(error: unknown): SchedulingPersistOutcome {
  if (error instanceof SchedulingApiError && error.status === 409) {
    return { kind: 'conflict', error };
  }
  if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
    return { kind: 'failed', error };
  }
  throw error;
}

export function rewriteIdentityToken(
  value: string,
  aliases: ReadonlyMap<string, string>
): string {
  let current = value;
  const seen = new Set<string>();
  while (aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = aliases.get(current)!;
  }
  return current;
}

export function rewriteLockOrGroupKey(
  key: string,
  aliases: ReadonlyMap<string, string>
): string {
  const { kind, id } = splitLockKey(key);
  if (!id) return rewriteIdentityToken(key, aliases);
  const nextId = rewriteIdentityToken(id, aliases);
  return nextId === id ? key : `${kind}:${nextId}`;
}

export function rewriteMutationClaims(
  claims: readonly SchedulingMutationClaim[],
  aliases: ReadonlyMap<string, string>
): SchedulingMutationClaim[] {
  return claims.map((claim) => {
    const nextId = rewriteIdentityToken(claim.id, aliases);
    return nextId === claim.id ? claim : { ...claim, id: nextId };
  });
}

function isActiveCommand(operation: SchedulingCoordinatorOperation): boolean {
  return operation.executionStatus !== 'completed';
}

export function findCoordinatorPersistTarget(
  operations: readonly SchedulingCoordinatorOperation[],
  operationId: string,
  coalesceGroup?: string
): SchedulingCoordinatorOperation | undefined {
  return operations.find((operation) => operation.id === operationId)
    ?? operations.find((operation) =>
      Boolean(coalesceGroup)
      && operation.coalesceGroup === coalesceGroup
      && operation.executionStatus !== 'completed'
    );
}

export class SchedulingMutationCoordinator {
  private operations: SchedulingCoordinatorOperation[] = [];
  private peers: SchedulingOptimisticOperation[] = [];
  private persistById = new Map<string, () => Promise<SchedulingPersistOutcome>>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private identityAliases = new Map<string, string>();
  private commandOutcomes = new Map<string, SchedulingCommandOutcomeKind>();
  private sequence = 0;
  private disposed = false;
  private readonly nextSequence: () => number;
  private readonly onChange: (operations: SchedulingCoordinatorOperation[]) => void;
  private readonly onSettled?: (
    operation: SchedulingCoordinatorOperation,
    outcome: SchedulingPersistOutcome | { kind: 'uncertain' }
  ) => void;
  private readonly logger?: (event: Record<string, unknown>) => void;

  constructor(options: {
    nextSequence?: () => number;
    onChange: (operations: SchedulingCoordinatorOperation[]) => void;
    onSettled?: (
      operation: SchedulingCoordinatorOperation,
      outcome: SchedulingPersistOutcome | { kind: 'uncertain' }
    ) => void;
    logger?: (event: Record<string, unknown>) => void;
  }) {
    this.nextSequence = options.nextSequence || (() => ++this.sequence);
    this.onChange = options.onChange;
    this.onSettled = options.onSettled;
    this.logger = options.logger;
  }

  getOperations(): SchedulingCoordinatorOperation[] {
    return this.operations.slice();
  }

  resolveIdentity(id: string): string {
    return rewriteIdentityToken(id, this.identityAliases);
  }

  publishIdentityAliases(aliases: Record<string, string>) {
    this.applyIdentityAliases(aliases);
    this.emit();
    this.kick();
  }

  retire(operationId: string) {
    const live = this.operations.find((operation) => operation.id === operationId);
    if (!live || live.executionStatus !== 'completed') return;
    this.persistById.delete(operationId);
    this.operations = this.operations.filter((operation) => operation.id !== operationId);
    this.emit();
  }

  cancelWaiters(identityKey: string) {
    const resolved = this.resolveIdentity(identityKey);
    const waiters = this.operations.filter((operation) =>
      operation.executionStatus !== 'completed'
      && operation.identityWaitKeys?.some(
        (key) => key === identityKey || this.resolveIdentity(key) === resolved
      )
    );
    for (const waiter of waiters) this.fail(waiter);
  }

  replaceOperations(operations: SchedulingOptimisticOperation[]) {
    const retainedPersist = new Map(this.persistById);
    this.operations = operations.map((operation) => this.asCoordinatorOperation(operation));
    this.persistById = new Map(
      this.operations
        .filter((operation) => retainedPersist.has(operation.id))
        .map((operation) => [operation.id, retainedPersist.get(operation.id)!])
    );
    for (const [operationId, timer] of this.retryTimers) {
      if (!this.operations.some((operation) => operation.id === operationId)) {
        clearTimeout(timer);
        this.retryTimers.delete(operationId);
      }
    }
  }

  setPeerOperations(operations: SchedulingOptimisticOperation[]) {
    this.peers = operations;
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.persistById.clear();
    this.operations = [];
    this.peers = [];
  }

  admit(input: AdmitSchedulingCommandInput): AdmitSchedulingCommandResult {
    if (this.disposed) {
      throw new Error('Scheduling mutation coordinator has been disposed.');
    }

    if (input.duplicateKey) {
      const duplicate = this.operations.find(
        (operation) =>
          isActiveCommand(operation)
          && operation.duplicateKey === input.duplicateKey
      );
      if (duplicate) {
        this.log({ type: 'duplicate', operationId: duplicate.id, requestId: duplicate.requestId });
        return { operation: duplicate, duplicate: true, coalesced: false };
      }
    }

    if (input.coalesceGroup) {
      const existing = this.operations.find(
        (operation) =>
          operation.coalesceGroup === input.coalesceGroup
          && operation.executionStatus === 'queued'
          && isActiveCommand(operation)
      );
      if (existing) {
        existing.kind = input.kind;
        existing.claims = input.claims;
        existing.lockKeys = input.lockKeys || claimsToLockKeys(input.claims);
        existing.queryKeys = input.queryKeys;
        existing.proofs = input.proofs || {};
        existing.apply = input.apply;
        existing.dependsOn = input.dependsOn;
        existing.identityWaitKeys = input.identityWaitKeys;
        if (input.retryPolicy) existing.retryPolicy = input.retryPolicy;
        this.persistById.set(existing.id, input.persist);
        this.emit();
        this.kickAfterAdmit();
        this.log({
          type: 'coalesce',
          operationId: existing.id,
          requestId: existing.requestId,
        });
        return { operation: existing, duplicate: false, coalesced: true };
      }
    }

    const operation: SchedulingCoordinatorOperation = {
      id: input.id || crypto.randomUUID(),
      sequence: this.nextSequence(),
      kind: input.kind,
      status: 'pending',
      lockKeys: input.lockKeys || claimsToLockKeys(input.claims),
      claims: input.claims,
      queryKeys: input.queryKeys,
      reconciledKeys: [],
      proofs: input.proofs || {},
      apply: input.apply,
      requestId: input.requestId || crypto.randomUUID(),
      duplicateKey: input.duplicateKey,
      coalesceGroup: input.coalesceGroup,
      dependsOn: input.dependsOn,
      identityWaitKeys: input.identityWaitKeys,
      retryPolicy: input.retryPolicy || 'ambiguous',
      executionStatus: 'queued',
      retryCount: 0,
    };
    this.operations = [...this.operations, operation];
    this.persistById.set(operation.id, input.persist);
    this.emit();
    this.kickAfterAdmit();
    this.log({ type: 'admit', operationId: operation.id, requestId: operation.requestId });
    return { operation, duplicate: false, coalesced: false };
  }

  private asCoordinatorOperation(
    operation: SchedulingOptimisticOperation
  ): SchedulingCoordinatorOperation {
    const current = this.operations.find((item) => item.id === operation.id);
    return {
      ...operation,
      claims: operation.claims || current?.claims || [],
      requestId: operation.requestId || current?.requestId || crypto.randomUUID(),
      duplicateKey: operation.duplicateKey || current?.duplicateKey,
      coalesceGroup: operation.coalesceGroup || current?.coalesceGroup,
      dependsOn: operation.dependsOn || current?.dependsOn,
      identityWaitKeys: operation.identityWaitKeys || current?.identityWaitKeys,
      retryPolicy: operation.retryPolicy || current?.retryPolicy || 'ambiguous',
      executionStatus: operation.executionStatus || current?.executionStatus || 'queued',
      retryCount: operation.retryCount ?? current?.retryCount ?? 0,
    };
  }

  private claimsFor(operation: SchedulingOptimisticOperation): SchedulingMutationClaim[] {
    return operation.claims || [];
  }

  private holders(): SchedulingOptimisticOperation[] {
    return [
      ...this.operations.filter(
        (operation) =>
          operation.status === 'uncertain'
          || operation.executionStatus === 'executing'
          || operation.executionStatus === 'awaitingRetry'
      ),
      ...this.peers.filter(
        (operation) => operation.status === 'pending' || operation.status === 'uncertain'
      ),
    ];
  }

  private operationsHoldConflictingExecution(
    candidate: SchedulingCoordinatorOperation
  ): boolean {
    const requested = candidate.claims;
    const earlierQueued = this.operations.filter((operation) =>
      operation.id !== candidate.id
      && operation.executionStatus === 'queued'
      && operation.sequence < candidate.sequence
    );
    return [...this.holders(), ...earlierQueued].some((holder) => {
      if (holder.id === candidate.id) return false;
      const holderClaims = this.claimsFor(holder);
      if (holderClaims.length === 0 || requested.length === 0) return false;
      return claimsConflict(requested, holderClaims);
    });
  }

  private dependencyKind(operationId: string): SchedulingCommandOutcomeKind | 'pending' {
    const recorded = this.commandOutcomes.get(operationId);
    if (recorded) return recorded;
    const live = this.operations.find((operation) => operation.id === operationId);
    if (!live) return 'failed';
    if (live.executionStatus === 'completed' && live.status === 'acknowledged') return 'success';
    if (live.status === 'uncertain') return 'uncertain';
    return 'pending';
  }

  private identityWaitsReady(operation: SchedulingCoordinatorOperation): boolean {
    return (operation.identityWaitKeys || []).every(
      (key) => !isOptimisticEntityId(this.resolveIdentity(key))
    );
  }

  private kickAfterAdmit() {
    queueMicrotask(() => this.kick());
  }

  private kick() {
    if (this.disposed) return;
    for (const operation of [...this.operations].sort((left, right) => left.sequence - right.sequence)) {
      if (operation.executionStatus !== 'queued') continue;
      const dependencyKinds = (operation.dependsOn || []).map((operationId) =>
        this.dependencyKind(operationId)
      );
      if (dependencyKinds.includes('failed')) {
        this.fail(operation);
        continue;
      }
      if (dependencyKinds.some((kind) => kind !== 'success')) continue;
      if (!this.identityWaitsReady(operation)) continue;
      if (this.operationsHoldConflictingExecution(operation)) continue;
      void this.runPersist(operation);
    }
  }

  private async runPersist(operation: SchedulingCoordinatorOperation) {
    if (this.disposed) return;
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live || live.executionStatus !== 'queued') return;
    live.executionStatus = 'executing';
    this.emit();
    try {
      const persist = this.persistById.get(live.id);
      if (!persist) {
        this.complete(live, { kind: 'success' });
        return;
      }
      const outcome = await persist();
      if (this.disposed) return;
      this.complete(live, outcome);
    } catch (error) {
      if (this.disposed) return;
      if (isAmbiguousSchedulingFailure(error) && live.retryPolicy !== 'none') {
        this.scheduleRetry(live, error);
      } else if (isAmbiguousSchedulingFailure(error)) {
        this.markUncertain(live);
      } else {
        this.fail(live);
      }
    } finally {
      this.kick();
    }
  }

  private complete(
    operation: SchedulingCoordinatorOperation,
    outcome: SchedulingPersistOutcome
  ) {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    if (outcome.kind === 'success') {
      live.status = 'acknowledged';
      live.executionStatus = 'completed';
      if (outcome.proofs) live.proofs = outcome.proofs;
      if (outcome.apply) live.apply = outcome.apply;
      this.commandOutcomes.set(live.id, 'success');
      this.applyIdentityAliases(outcome.identityAliases || {});
      this.persistById.delete(live.id);
      this.emit();
      this.onSettled?.(live, outcome);
      return;
    }
    this.fail(live, outcome.kind === 'failed' || outcome.kind === 'conflict' ? outcome : undefined);
  }

  private fail(
    operation: SchedulingCoordinatorOperation,
    outcome?: Extract<SchedulingPersistOutcome, { kind: 'failed' } | { kind: 'conflict' }>
  ) {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) {
      this.commandOutcomes.set(operation.id, 'failed');
      return;
    }
    const timer = this.retryTimers.get(live.id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(live.id);
    }
    this.persistById.delete(live.id);
    this.commandOutcomes.set(live.id, 'failed');
    const dependents = this.operations.filter(
      (item) => item.id !== live.id && item.dependsOn?.includes(live.id)
    );
    this.operations = this.operations.filter((item) => item.id !== live.id);
    this.emit();
    this.onSettled?.(live, outcome || { kind: 'failed', error: undefined as unknown });
    for (const dependent of dependents) this.fail(dependent);
  }

  private markUncertain(operation: SchedulingCoordinatorOperation) {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    const timer = this.retryTimers.get(live.id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(live.id);
    }
    live.status = 'uncertain';
    live.executionStatus = 'completed';
    this.commandOutcomes.set(live.id, 'uncertain');
    this.persistById.delete(live.id);
    this.emit();
    this.onSettled?.(live, { kind: 'uncertain' });
  }

  private scheduleRetry(operation: SchedulingCoordinatorOperation, error: unknown) {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    live.status = 'uncertain';
    live.executionStatus = 'awaitingRetry';
    live.retryCount += 1;
    if (live.retryCount > MAX_AMBIGUOUS_RETRIES) {
      this.log({ type: 'retry-exhausted', operationId: live.id, requestId: live.requestId });
      this.markUncertain(live);
      return;
    }
    const delay = RETRY_BACKOFF_MS[Math.min(live.retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
    this.log({
      type: 'retry',
      operationId: live.id,
      requestId: live.requestId,
      delay,
      error: error instanceof Error ? error.message : String(error),
    });
    const timer = setTimeout(() => {
      this.retryTimers.delete(live.id);
      const current = this.operations.find((item) => item.id === live.id);
      if (!current || this.disposed) return;
      current.executionStatus = 'queued';
      this.emit();
      this.kick();
    }, delay);
    this.retryTimers.set(live.id, timer);
    this.emit();
  }

  private applyIdentityAliases(aliases: Record<string, string>) {
    let changed = false;
    for (const [from, to] of Object.entries(aliases)) {
      if (!from || !to || from === to) continue;
      if (this.identityAliases.get(from) === to) continue;
      this.identityAliases.set(from, to);
      changed = true;
    }
    if (!changed && this.identityAliases.size === 0) return;
    this.rewriteQueuedIdentities();
  }

  private rewriteQueuedIdentities() {
    const aliases = this.identityAliases;
    if (aliases.size === 0) return;
    for (const operation of this.operations) {
      if (operation.executionStatus === 'executing') continue;
      operation.claims = rewriteMutationClaims(operation.claims, aliases);
      operation.lockKeys = operation.lockKeys.map((key) => rewriteLockOrGroupKey(key, aliases));
      if (operation.coalesceGroup) {
        operation.coalesceGroup = rewriteLockOrGroupKey(operation.coalesceGroup, aliases);
      }
      if (operation.duplicateKey) {
        operation.duplicateKey = rewriteLockOrGroupKey(operation.duplicateKey, aliases);
      }
      if (operation.identityWaitKeys) {
        operation.identityWaitKeys = operation.identityWaitKeys.map((key) =>
          rewriteIdentityToken(key, aliases)
        );
      }
    }
  }

  private emit() {
    this.onChange(this.getOperations());
  }

  private log(event: Record<string, unknown>) {
    this.logger?.(event);
  }
}
