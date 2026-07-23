import { describe, expect, it } from 'vitest';
import {
  getSampleDataActionBlockers,
  getSchedulingCreateSteps,
  runManagedRemovalSequence,
} from '@/lib/server/sample-data/registry';
import type {
  SampleDataFixtureStatus,
  SampleDataState,
} from '@/lib/server/sample-data/types';

function schedulingStatus(
  base: SampleDataState,
  queue: SampleDataState,
  state: SampleDataState = base === 'installed' ? 'installed' : 'absent'
): SampleDataFixtureStatus {
  return {
    fixtureKey: 'scheduling-sample-v1',
    label: 'Scheduling',
    description: 'Fixture',
    toolingVersion: 'v1',
    state,
    available: true,
    expected: {},
    observed: {},
    blockers: [],
    availabilityReason: null,
    variants: {
      base: { state: base, expected: {}, observed: {} },
      queue: { state: queue, expected: {}, observed: {} },
    },
    lastOperation: null,
  };
}

function fleetStatus(state: SampleDataState): SampleDataFixtureStatus {
  return {
    fixtureKey: 'fleet-inventory-sample-v1',
    label: 'Fleet and Inventory',
    description: 'Fixture',
    toolingVersion: 'v1',
    state,
    available: true,
    expected: {},
    observed: {},
    blockers: state === 'blocked' ? ['inventory movements: 1'] : [],
    availabilityReason: null,
    lastOperation: null,
  };
}

describe('managed sample-data registry decisions', () => {
  it('plans Base then Queue for a complete absent Scheduling fixture', () => {
    expect(
      getSchedulingCreateSteps(
        schedulingStatus('absent', 'absent'),
        'create-complete'
      )
    ).toEqual(['base', 'queue']);
  });

  it('plans only Queue when Scheduling Base is already installed', () => {
    expect(
      getSchedulingCreateSteps(
        schedulingStatus('installed', 'absent'),
        'create-complete'
      )
    ).toEqual(['queue']);
  });

  it('treats an already complete Scheduling fixture as an idempotent no-op', () => {
    expect(
      getSchedulingCreateSteps(
        schedulingStatus('installed', 'installed'),
        'create-complete'
      )
    ).toEqual([]);
  });

  it('blocks Queue creation until Base is exactly installed', () => {
    expect(
      getSampleDataActionBlockers(
        schedulingStatus('absent', 'absent'),
        'create-queue'
      )
    ).toContain('Create the Scheduling Base before the Queue Extension.');
  });

  it('fails closed for drift and dependencies', () => {
    const status = schedulingStatus('installed', 'installed', 'blocked');
    status.blockers = ['plant assignments: 1'];
    expect(getSampleDataActionBlockers(status, 'remove')).toEqual([
      'plant assignments: 1',
    ]);
  });

  it('allows exact Fleet create/remove idempotency and blocks dependency-bearing cleanup', () => {
    expect(getSampleDataActionBlockers(fleetStatus('absent'), 'create')).toEqual([]);
    expect(getSampleDataActionBlockers(fleetStatus('installed'), 'create')).toEqual([]);
    expect(getSampleDataActionBlockers(fleetStatus('installed'), 'remove')).toEqual([]);
    expect(getSampleDataActionBlockers(fleetStatus('absent'), 'remove')).toEqual([]);
    expect(getSampleDataActionBlockers(fleetStatus('blocked'), 'remove')).toEqual([
      'inventory movements: 1',
    ]);
  });

  it('removes Scheduling before Fleet and Inventory', async () => {
    const calls: string[] = [];
    const result = await runManagedRemovalSequence(
      ['scheduling-sample-v1', 'fleet-inventory-sample-v1'],
      async (fixtureKey) => {
        calls.push(fixtureKey);
      }
    );

    expect(calls).toEqual([
      'scheduling-sample-v1',
      'fleet-inventory-sample-v1',
    ]);
    expect(result).toMatchObject({
      completedFixtures: [
        'scheduling-sample-v1',
        'fleet-inventory-sample-v1',
      ],
      failedFixture: null,
    });
  });

  it('stops after a later independently committed fixture fails', async () => {
    const calls: string[] = [];
    const result = await runManagedRemovalSequence(
      ['scheduling-sample-v1', 'fleet-inventory-sample-v1'],
      async (fixtureKey) => {
        calls.push(fixtureKey);
        if (fixtureKey === 'fleet-inventory-sample-v1') {
          throw new Error('Fleet dependency appeared');
        }
      }
    );

    expect(calls).toEqual([
      'scheduling-sample-v1',
      'fleet-inventory-sample-v1',
    ]);
    expect(result.completedFixtures).toEqual(['scheduling-sample-v1']);
    expect(result.failedFixture).toBe('fleet-inventory-sample-v1');
    expect(result.error).toEqual(expect.any(Error));
  });
});
