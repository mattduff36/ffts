import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  acquireFixtureTransactionLock,
  createSampleDataDbClient,
  withSampleDataClient,
} from './database';
import {
  createSchedulingAuthUser,
  deleteSchedulingAuthUser,
  insertSchedulingBase,
  insertSchedulingQueue,
  inspectSchedulingFixture,
  removeSchedulingRows,
  SCHEDULING_FIXTURE_KEY,
} from './scheduling-fixture';
import {
  FLEET_INVENTORY_FIXTURE_KEY,
  insertFleetInventoryFixture,
  inspectFleetInventoryFixture,
  removeFleetInventoryRows,
} from './fleet-inventory-fixture';
import {
  createPreviewFingerprint,
  getConfirmationPhrase,
  isValidConfirmation,
  verifyPreviewFingerprint,
} from './security';
import {
  getLastSampleDataOperations,
  recordSampleDataOperation,
} from './audit';
import type {
  ManagedFixtureKey,
  SampleDataAction,
  SampleDataFixtureStatus,
  SampleDataMutationInput,
  SampleDataMutationResult,
  SampleDataPreview,
  SampleDataRegistryStatus,
} from './types';

const REMOVE_ORDER: ManagedFixtureKey[] = [
  SCHEDULING_FIXTURE_KEY,
  FLEET_INVENTORY_FIXTURE_KEY,
];

export async function runManagedRemovalSequence(
  fixtureKeys: ManagedFixtureKey[],
  removeFixture: (fixtureKey: ManagedFixtureKey) => Promise<void>
): Promise<{
  completedFixtures: ManagedFixtureKey[];
  failedFixture: ManagedFixtureKey | null;
  error: unknown;
}> {
  const completedFixtures: ManagedFixtureKey[] = [];
  for (const fixtureKey of fixtureKeys) {
    try {
      await removeFixture(fixtureKey);
      completedFixtures.push(fixtureKey);
    } catch (error) {
      return { completedFixtures, failedFixture: fixtureKey, error };
    }
  }
  return { completedFixtures, failedFixture: null, error: null };
}

function unavailableFixture(
  fixtureKey: ManagedFixtureKey,
  message: string
): SampleDataFixtureStatus {
  return {
    fixtureKey,
    label:
      fixtureKey === SCHEDULING_FIXTURE_KEY
        ? 'Scheduling Sample Data'
        : 'Fleet and Inventory Sample Data',
    description: 'Managed production sample fixture.',
    toolingVersion: 'unavailable',
    state: 'unavailable',
    available: false,
    expected: {},
    observed: {},
    blockers: [message],
    availabilityReason: message,
    lastOperation: null,
  };
}

async function inspectFixture(
  fixtureKey: ManagedFixtureKey
): Promise<SampleDataFixtureStatus> {
  try {
    return await withSampleDataClient((client) =>
      fixtureKey === SCHEDULING_FIXTURE_KEY
        ? inspectSchedulingFixture(client)
        : inspectFleetInventoryFixture(client)
    );
  } catch (error) {
    return unavailableFixture(
      fixtureKey,
      error instanceof Error ? error.message : 'Fixture inspection failed.'
    );
  }
}

export async function getManagedSampleDataStatus(): Promise<SampleDataRegistryStatus> {
  const fixtures = await Promise.all(REMOVE_ORDER.map(inspectFixture));
  if (fixtures.every((fixture) => fixture.available)) {
    try {
      const operations = await getLastSampleDataOperations();
      fixtures.forEach((fixture) => {
        fixture.lastOperation = operations.get(fixture.fixtureKey) || null;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Operation audit is unavailable.';
      fixtures.forEach((fixture) => {
        fixture.available = false;
        fixture.state = 'unavailable';
        fixture.availabilityReason = message;
        fixture.blockers = [message];
      });
    }
  }

  const clearBlockers = fixtures.flatMap((fixture) => {
    if (!fixture.available) return [`${fixture.label}: unavailable`];
    if (['partial', 'drifted', 'blocked'].includes(fixture.state)) {
      return fixture.blockers.map((blocker) => `${fixture.label}: ${blocker}`);
    }
    return [];
  });
  return {
    generatedAt: new Date().toISOString(),
    fixtures,
    clearAll: {
      canRemove: clearBlockers.length === 0,
      blockers: clearBlockers,
      fixtureKeys: REMOVE_ORDER,
    },
  };
}

function getFixture(
  registry: SampleDataRegistryStatus,
  fixtureKey: ManagedFixtureKey
): SampleDataFixtureStatus {
  const fixture = registry.fixtures.find((entry) => entry.fixtureKey === fixtureKey);
  if (!fixture) throw new Error('Managed fixture is not registered.');
  return fixture;
}

export function getSampleDataActionBlockers(
  fixture: SampleDataFixtureStatus,
  action: SampleDataAction
): string[] {
  if (!fixture.available) return fixture.blockers;
  if (['partial', 'drifted', 'blocked'].includes(fixture.state)) {
    return fixture.blockers.length > 0
      ? fixture.blockers
      : [`Fixture is ${fixture.state}.`];
  }

  if (fixture.fixtureKey === SCHEDULING_FIXTURE_KEY) {
    const baseState = fixture.variants?.base?.state;
    const queueState = fixture.variants?.queue?.state;
    if (action === 'create-base') {
      return baseState === 'absent' || baseState === 'installed'
        ? []
        : ['Scheduling Base is not safely creatable.'];
    }
    if (action === 'create-queue') {
      if (baseState !== 'installed') {
        return ['Create the Scheduling Base before the Queue Extension.'];
      }
      return queueState === 'absent' || queueState === 'installed'
        ? []
        : ['Scheduling Queue is not safely creatable.'];
    }
    if (action === 'create-complete') {
      const valid =
        (baseState === 'absent' && queueState === 'absent')
        || (baseState === 'installed'
          && (queueState === 'absent' || queueState === 'installed'));
      return valid ? [] : ['Complete Scheduling sample is not safely creatable.'];
    }
    if (action === 'remove') {
      return fixture.state === 'absent' || fixture.state === 'installed'
        ? []
        : ['Scheduling fixture is not safely removable.'];
    }
  }

  if (fixture.fixtureKey === FLEET_INVENTORY_FIXTURE_KEY) {
    if (action === 'create' || action === 'remove') {
      return fixture.state === 'absent' || fixture.state === 'installed'
        ? []
        : ['Fleet and Inventory fixture is not safely mutable.'];
    }
  }
  return ['Action is not allowlisted for this fixture.'];
}

export function getSchedulingCreateSteps(
  fixture: SampleDataFixtureStatus,
  action: Extract<
    SampleDataAction,
    'create-base' | 'create-queue' | 'create-complete'
  >
): Array<'base' | 'queue'> {
  const baseState = fixture.variants?.base?.state;
  const queueState = fixture.variants?.queue?.state;
  if (action === 'create-base') return baseState === 'absent' ? ['base'] : [];
  if (action === 'create-queue') return queueState === 'absent' ? ['queue'] : [];
  const steps: Array<'base' | 'queue'> = [];
  if (baseState === 'absent') steps.push('base');
  if (queueState === 'absent') steps.push('queue');
  return steps;
}

export async function previewSampleDataOperation(params: {
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
}): Promise<SampleDataPreview> {
  const registry = await getManagedSampleDataStatus();
  const status =
    params.fixtureKey === 'all-managed'
      ? registry
      : getFixture(registry, params.fixtureKey);
  const blockers =
    params.fixtureKey === 'all-managed'
      ? params.action === 'clear-all'
        ? registry.clearAll.blockers
        : ['Only Clear All is allowlisted for the managed registry.']
      : getSampleDataActionBlockers(status as SampleDataFixtureStatus, params.action);
  const signed = createPreviewFingerprint({
    fixtureKey: params.fixtureKey,
    action: params.action,
    status,
  });

  return {
    fixtureKey: params.fixtureKey,
    action: params.action,
    confirmationPhrase: getConfirmationPhrase(params.fixtureKey, params.action),
    fingerprint: signed.fingerprint,
    expiresAt: signed.expiresAt,
    status,
    blockers,
    canExecute: blockers.length === 0,
  };
}

function noopResult(
  fixtureKey: ManagedFixtureKey,
  action: SampleDataAction,
  message: string
): Omit<SampleDataMutationResult, 'status'> {
  return {
    success: true,
    outcome: 'noop',
    fixtureKey,
    action,
    message,
    completedFixtures: [],
    failedFixture: null,
    recovery: null,
  };
}

async function executeScheduling(
  action: SampleDataAction,
  before: SampleDataFixtureStatus
): Promise<Omit<SampleDataMutationResult, 'status'>> {
  const baseState = before.variants?.base?.state;
  const queueState = before.variants?.queue?.state;
  if (action === 'create-base' && baseState === 'installed') {
    return noopResult(SCHEDULING_FIXTURE_KEY, action, 'Scheduling Base is already installed.');
  }
  if (action === 'create-queue' && queueState === 'installed') {
    return noopResult(SCHEDULING_FIXTURE_KEY, action, 'Scheduling Queue is already installed.');
  }
  if (
    action === 'create-complete'
    && baseState === 'installed'
    && queueState === 'installed'
  ) {
    return noopResult(SCHEDULING_FIXTURE_KEY, action, 'Complete Scheduling sample is already installed.');
  }
  if (action === 'remove' && before.state === 'absent') {
    return noopResult(SCHEDULING_FIXTURE_KEY, action, 'Scheduling sample is already absent.');
  }

  const client = createSampleDataDbClient();
  let createdAuthUserId: string | null = null;
  let committedProfileId: string | null = null;
  await client.connect();
  try {
    await client.query('BEGIN');
    await acquireFixtureTransactionLock(client, SCHEDULING_FIXTURE_KEY);
    const lockedStatus = await inspectSchedulingFixture(client);
    const blockers = getSampleDataActionBlockers(lockedStatus, action);
    if (blockers.length > 0) throw new Error(blockers.join(' '));

    if (action === 'remove') {
      committedProfileId = await removeSchedulingRows(client);
    } else if (action === 'create-queue') {
      await insertSchedulingQueue(client);
    } else if (action === 'create-base' || action === 'create-complete') {
      const steps = getSchedulingCreateSteps(
        lockedStatus,
        action as 'create-base' | 'create-complete'
      );
      if (steps.includes('base')) {
        createdAuthUserId = await createSchedulingAuthUser();
        await insertSchedulingBase(client, createdAuthUserId);
      }
      if (steps.includes('queue')) {
        await insertSchedulingQueue(client);
      }
    } else {
      throw new Error('Scheduling action is not allowlisted.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (createdAuthUserId) {
      try {
        await deleteSchedulingAuthUser(createdAuthUserId);
      } catch (authCleanupError) {
        const message =
          authCleanupError instanceof Error
            ? authCleanupError.message
            : String(authCleanupError);
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} `
          + `Database rollback completed, but remove auth user ${createdAuthUserId}: ${message}`
        );
      }
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  if (action === 'remove' && committedProfileId) {
    try {
      await deleteSchedulingAuthUser(committedProfileId);
    } catch (error) {
      return {
        success: false,
        outcome: 'partial',
        fixtureKey: SCHEDULING_FIXTURE_KEY,
        action,
        message: 'Scheduling database rows were removed, but Auth cleanup failed.',
        completedFixtures: [SCHEDULING_FIXTURE_KEY],
        failedFixture: SCHEDULING_FIXTURE_KEY,
        recovery:
          `Verify and delete only auth user ${SAMPLE_AUTH_RECOVERY_LABEL} (${committedProfileId}). `
          + `${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    success: true,
    outcome: 'succeeded',
    fixtureKey: SCHEDULING_FIXTURE_KEY,
    action,
    message:
      action === 'remove'
        ? 'Scheduling sample data removed.'
        : 'Scheduling sample data created.',
    completedFixtures: [SCHEDULING_FIXTURE_KEY],
    failedFixture: null,
    recovery: null,
  };
}

const SAMPLE_AUTH_RECOVERY_LABEL = 'scheduling-sample-v1@example.test';

async function executeFleetInventory(
  action: SampleDataAction,
  before: SampleDataFixtureStatus
): Promise<Omit<SampleDataMutationResult, 'status'>> {
  if (action === 'create' && before.state === 'installed') {
    return noopResult(
      FLEET_INVENTORY_FIXTURE_KEY,
      action,
      'Fleet and Inventory sample is already installed.'
    );
  }
  if (action === 'remove' && before.state === 'absent') {
    return noopResult(
      FLEET_INVENTORY_FIXTURE_KEY,
      action,
      'Fleet and Inventory sample is already absent.'
    );
  }

  await withSampleDataClient(async (client) => {
    await client.query('BEGIN');
    try {
      await acquireFixtureTransactionLock(client, FLEET_INVENTORY_FIXTURE_KEY);
      const lockedStatus = await inspectFleetInventoryFixture(client);
      const blockers = getSampleDataActionBlockers(lockedStatus, action);
      if (blockers.length > 0) throw new Error(blockers.join(' '));
      if (action === 'create') await insertFleetInventoryFixture(client);
      else if (action === 'remove') await removeFleetInventoryRows(client);
      else throw new Error('Fleet action is not allowlisted.');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });

  return {
    success: true,
    outcome: 'succeeded',
    fixtureKey: FLEET_INVENTORY_FIXTURE_KEY,
    action,
    message:
      action === 'remove'
        ? 'Fleet and Inventory sample data removed.'
        : 'Fleet and Inventory sample data created.',
    completedFixtures: [FLEET_INVENTORY_FIXTURE_KEY],
    failedFixture: null,
    recovery: null,
  };
}

async function recordResult(params: {
  operationGroupId?: string;
  actorProfileId: string;
  fingerprint: string;
  before: SampleDataFixtureStatus | SampleDataRegistryStatus;
  result: Omit<SampleDataMutationResult, 'status'>;
  after: SampleDataFixtureStatus | SampleDataRegistryStatus;
  error?: string;
}): Promise<void> {
  await recordSampleDataOperation({
    operationGroupId: params.operationGroupId,
    fixtureKey: params.result.fixtureKey,
    action: params.result.action,
    outcome: params.result.outcome,
    actorProfileId: params.actorProfileId,
    previewFingerprint: params.fingerprint,
    beforeStatus: params.before,
    afterStatus: params.after,
    error: params.error || null,
    recovery: params.result.recovery,
    metadata: {
      completed_fixtures: params.result.completedFixtures,
      failed_fixture: params.result.failedFixture,
    },
  });
}

async function executeSingle(
  input: SampleDataMutationInput,
  beforeRegistry: SampleDataRegistryStatus,
  operationGroupId?: string
): Promise<SampleDataMutationResult> {
  if (input.fixtureKey === 'all-managed') {
    throw new Error('Use Clear All for the managed registry.');
  }
  const before = getFixture(beforeRegistry, input.fixtureKey);
  const blockers = getSampleDataActionBlockers(before, input.action);
  if (blockers.length > 0) throw new Error(blockers.join(' '));

  let mutationResult: Omit<SampleDataMutationResult, 'status'>;
  try {
    mutationResult =
      input.fixtureKey === SCHEDULING_FIXTURE_KEY
        ? await executeScheduling(input.action, before)
        : await executeFleetInventory(input.action, before);
  } catch (error) {
    const afterRegistry = await getManagedSampleDataStatus();
    const failed: Omit<SampleDataMutationResult, 'status'> = {
      success: false,
      outcome: 'failed',
      fixtureKey: input.fixtureKey,
      action: input.action,
      message: error instanceof Error ? error.message : 'Sample-data operation failed.',
      completedFixtures: [],
      failedFixture: input.fixtureKey,
      recovery: 'Refresh status and investigate the recorded operation before retrying.',
    };
    await recordResult({
      operationGroupId,
      actorProfileId: input.actorProfileId,
      fingerprint: input.fingerprint,
      before,
      result: failed,
      after: getFixture(afterRegistry, input.fixtureKey),
      error: failed.message,
    }).catch(() => undefined);
    throw error;
  }

  const afterRegistry = await getManagedSampleDataStatus();
  const after = getFixture(afterRegistry, input.fixtureKey);
  try {
    await recordResult({
      operationGroupId,
      actorProfileId: input.actorProfileId,
      fingerprint: input.fingerprint,
      before,
      result: mutationResult,
      after,
    });
  } catch (error) {
    const committed = mutationResult.completedFixtures.length > 0;
    return {
      ...mutationResult,
      success: false,
      outcome: committed ? 'partial' : 'failed',
      message: committed
        ? `${mutationResult.message} The immutable audit record could not be written.`
        : 'The operation audit record could not be written.',
      failedFixture: input.fixtureKey,
      recovery:
        'Database state may already be committed. Refresh status and investigate the audit-table error before retrying. '
        + (error instanceof Error ? error.message : String(error)),
      status: afterRegistry,
    };
  }
  return { ...mutationResult, status: await getManagedSampleDataStatus() };
}

async function executeClearAll(
  input: SampleDataMutationInput,
  before: SampleDataRegistryStatus
): Promise<SampleDataMutationResult> {
  if (!before.clearAll.canRemove) {
    throw new Error(before.clearAll.blockers.join(' '));
  }

  const coordinator = createSampleDataDbClient();
  const operationGroupId = randomUUID();
  const completedFixtures: ManagedFixtureKey[] = [];
  await coordinator.connect();
  try {
    const lockResult = await coordinator.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      ['ffts:sample-data:all-managed']
    );
    if (!lockResult.rows[0]?.locked) {
      throw new Error('Another Clear All operation is already running.');
    }

    const lockedRegistry = await getManagedSampleDataStatus();
    if (!lockedRegistry.clearAll.canRemove) {
      throw new Error(lockedRegistry.clearAll.blockers.join(' '));
    }

    const installedFixtureKeys = REMOVE_ORDER.filter(
      (fixtureKey) => getFixture(lockedRegistry, fixtureKey).state !== 'absent'
    );
    const failedStep = {
      result: null as SampleDataMutationResult | null,
    };
    const sequence = await runManagedRemovalSequence(
      installedFixtureKeys,
      async (fixtureKey) => {
        const result = await executeSingle(
          {
            ...input,
            fixtureKey,
            action: 'remove',
          },
          await getManagedSampleDataStatus(),
          operationGroupId
        );
        if (!result.success || result.outcome === 'partial') {
          failedStep.result = result;
          throw new Error(result.message);
        }
      }
    );
    completedFixtures.push(...sequence.completedFixtures);
    if (sequence.failedFixture) {
      const after =
        failedStep.result?.status || await getManagedSampleDataStatus();
      const partial: Omit<SampleDataMutationResult, 'status'> = {
        success: false,
        outcome: completedFixtures.length > 0
          || (failedStep.result?.completedFixtures.length || 0) > 0
          ? 'partial'
          : 'failed',
        fixtureKey: 'all-managed',
        action: 'clear-all',
        message: `Clear All stopped at ${sequence.failedFixture}.`,
        completedFixtures: [
          ...completedFixtures,
          ...(failedStep.result?.completedFixtures || []),
        ],
        failedFixture: sequence.failedFixture,
        recovery:
          failedStep.result?.recovery
          || 'Refresh status and resolve the failed fixture before retrying.',
      };
      await recordResult({
        operationGroupId,
        actorProfileId: input.actorProfileId,
        fingerprint: input.fingerprint,
        before,
        result: partial,
        after,
        error:
          sequence.error instanceof Error
            ? sequence.error.message
            : partial.message,
      });
      return { ...partial, status: after };
    }

    const after = await getManagedSampleDataStatus();
    const success: Omit<SampleDataMutationResult, 'status'> = {
      success: true,
      outcome: completedFixtures.length > 0 ? 'succeeded' : 'noop',
      fixtureKey: 'all-managed',
      action: 'clear-all',
      message:
        completedFixtures.length > 0
          ? 'All managed sample data removed.'
          : 'All managed sample data was already absent.',
      completedFixtures,
      failedFixture: null,
      recovery: null,
    };
    await recordResult({
      operationGroupId,
      actorProfileId: input.actorProfileId,
      fingerprint: input.fingerprint,
      before,
      result: success,
      after,
    });
    return { ...success, status: after };
  } catch (error) {
    const after = await getManagedSampleDataStatus();
    const failed: Omit<SampleDataMutationResult, 'status'> = {
      success: false,
      outcome: completedFixtures.length > 0 ? 'partial' : 'failed',
      fixtureKey: 'all-managed',
      action: 'clear-all',
      message: error instanceof Error ? error.message : 'Clear All failed.',
      completedFixtures,
      failedFixture:
        REMOVE_ORDER.find((key) => !completedFixtures.includes(key)) || null,
      recovery:
        completedFixtures.length > 0
          ? 'Earlier fixture removals are committed. Refresh and resolve the remaining fixture; do not recreate automatically.'
          : 'No fixture removal completed.',
    };
    await recordResult({
      operationGroupId,
      actorProfileId: input.actorProfileId,
      fingerprint: input.fingerprint,
      before,
      result: failed,
      after,
      error: failed.message,
    }).catch(() => undefined);
    if (completedFixtures.length > 0) return { ...failed, status: after };
    throw error;
  } finally {
    await coordinator
      .query('SELECT pg_advisory_unlock(hashtext($1))', [
        'ffts:sample-data:all-managed',
      ])
      .catch(() => undefined);
    await coordinator.end().catch(() => undefined);
  }
}

export async function executeSampleDataOperation(
  input: SampleDataMutationInput
): Promise<SampleDataMutationResult> {
  if (!isValidConfirmation(input.fixtureKey, input.action, input.confirmation)) {
    throw new Error('Typed confirmation does not match the required phrase.');
  }

  const before = await getManagedSampleDataStatus();
  const previewStatus =
    input.fixtureKey === 'all-managed'
      ? before
      : getFixture(before, input.fixtureKey);
  if (
    !verifyPreviewFingerprint({
      fingerprint: input.fingerprint,
      fixtureKey: input.fixtureKey,
      action: input.action,
      status: previewStatus,
    })
  ) {
    throw new Error('Preview is stale or invalid. Generate a fresh preview.');
  }

  return input.fixtureKey === 'all-managed'
    ? executeClearAll(input, before)
    : executeSingle(input, before);
}
