export type TrustedOperationalCommandId = 'fixerrors';

export type OperationalMutation = {
  schema: string;
  table: string;
  operation: 'delete' | 'update';
  identityColumn: string;
  purpose: 'primary-diagnostic' | 'dependent-diagnostic' | 'expired-archived-retention';
  updatedColumns?: readonly string[];
  targetPredicate?: string;
};

export type TrustedOperationalAction = {
  commandId: TrustedOperationalCommandId;
  safetyContract: string;
  trustedOperationalAction: true;
  allowedMutations: readonly OperationalMutation[];
};

export const ERROR_LOG_RETENTION_PREDICATE =
  "status = 'archived' AND archived_at < now() - interval '12 months'";

export const TRUSTED_OPERATIONAL_ACTIONS = {
  fixerrors: {
    commandId: 'fixerrors',
    safetyContract: 'fixerrors-exact-snapshot-v4',
    trustedOperationalAction: true,
    allowedMutations: [
      {
        schema: 'public',
        table: 'error_logs',
        operation: 'update',
        identityColumn: 'id',
        purpose: 'primary-diagnostic',
        updatedColumns: ['status', 'archived_at'],
        targetPredicate: "status = 'active'",
      },
      {
        schema: 'public',
        table: 'error_logs',
        operation: 'delete',
        identityColumn: 'id',
        purpose: 'expired-archived-retention',
        targetPredicate: ERROR_LOG_RETENTION_PREDICATE,
      },
    ],
  },
} as const satisfies Record<TrustedOperationalCommandId, TrustedOperationalAction>;

export type OperationalClassificationInput = {
  commandId: string;
  safetyContract: string;
  intent: 'execute' | 'modify';
  explicitlyRequested: boolean;
  confirmationBoundToSnapshot: boolean;
  retentionBoundToCandidateSet?: boolean;
  runtimeSafetyChecksPassed: boolean;
  requestedMutations: readonly OperationalMutation[];
};

export type OperationalClassification = {
  kind: 'operational_execution' | 'engineering_task';
  lane: 'critical' | null;
  trusted: boolean;
  trustSuspended: boolean;
  safetyContract: string | null;
  reason: string;
};

function mutationKey(mutation: OperationalMutation): string {
  return [
    mutation.schema,
    mutation.table,
    mutation.operation,
    mutation.identityColumn,
    mutation.purpose,
    (mutation.updatedColumns ?? []).join(','),
    mutation.targetPredicate ?? '',
  ].join(':');
}

function requestedMutationsAllowed(
  requested: readonly OperationalMutation[],
  allowed: readonly OperationalMutation[]
): boolean {
  if (requested.length === 0) return false;
  const allowedKeys = new Set(allowed.map(mutationKey));
  return requested.every((mutation) => allowedKeys.has(mutationKey(mutation)));
}

export function classifyOperationalAction(
  input: OperationalClassificationInput
): OperationalClassification {
  const registered =
    TRUSTED_OPERATIONAL_ACTIONS[input.commandId as TrustedOperationalCommandId];

  if (!registered) {
    return {
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      trustSuspended: false,
      safetyContract: null,
      reason: 'unregistered-production-mutation',
    };
  }

  if (input.intent === 'modify') {
    return {
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      trustSuspended: false,
      safetyContract: registered.safetyContract,
      reason: 'trusted-command-safety-contract-modification',
    };
  }

  const scopeMatches = requestedMutationsAllowed(
    input.requestedMutations,
    registered.allowedMutations
  );
  const needsSnapshotBind = input.requestedMutations.some(
    (mutation) => mutation.operation === 'update'
  );
  const needsRetentionBind = input.requestedMutations.some(
    (mutation) => mutation.purpose === 'expired-archived-retention'
  );
  const bindingHolds =
    (!needsSnapshotBind || input.confirmationBoundToSnapshot) &&
    (!needsRetentionBind || input.retentionBoundToCandidateSet === true);
  const eligible =
    input.safetyContract === registered.safetyContract &&
    input.explicitlyRequested &&
    bindingHolds &&
    input.runtimeSafetyChecksPassed &&
    scopeMatches;

  if (!eligible) {
    return {
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      trustSuspended: true,
      safetyContract: registered.safetyContract,
      reason: scopeMatches
        ? input.safetyContract === registered.safetyContract
          ? 'trusted-operational-precondition-failed'
          : 'trusted-operational-contract-mismatch'
        : 'trusted-operational-scope-mismatch',
    };
  }

  return {
    kind: 'operational_execution',
    lane: null,
    trusted: true,
    trustSuspended: false,
    safetyContract: registered.safetyContract,
    reason: 'registered-safeguarded-operational-execution',
  };
}
