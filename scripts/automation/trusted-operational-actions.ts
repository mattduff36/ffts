export type TrustedOperationalCommandId = 'fixerrors';

export type OperationalMutation = {
  schema: string;
  table: string;
  operation: 'delete';
  identityColumn: string;
  purpose: 'primary-diagnostic' | 'dependent-diagnostic';
};

export type TrustedOperationalAction = {
  commandId: TrustedOperationalCommandId;
  safetyContract: string;
  trustedOperationalAction: true;
  allowedMutations: readonly OperationalMutation[];
};

export const TRUSTED_OPERATIONAL_ACTIONS = {
  fixerrors: {
    commandId: 'fixerrors',
    safetyContract: 'fixerrors-exact-snapshot-v1',
    trustedOperationalAction: true,
    allowedMutations: [
      {
        schema: 'public',
        table: 'error_logs',
        operation: 'delete',
        identityColumn: 'id',
        purpose: 'primary-diagnostic',
      },
      {
        schema: 'public',
        table: 'error_log_alerts',
        operation: 'delete',
        identityColumn: 'error_log_id',
        purpose: 'dependent-diagnostic',
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

function mutationsMatch(
  requested: readonly OperationalMutation[],
  allowed: readonly OperationalMutation[]
): boolean {
  if (requested.length !== allowed.length) return false;

  const mutationKey = (mutation: OperationalMutation) =>
    [
      mutation.schema,
      mutation.table,
      mutation.operation,
      mutation.identityColumn,
      mutation.purpose,
    ].join(':');
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

  const scopeMatches = mutationsMatch(
    input.requestedMutations,
    registered.allowedMutations
  );
  const eligible =
    input.safetyContract === registered.safetyContract &&
    input.explicitlyRequested &&
    input.confirmationBoundToSnapshot &&
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
