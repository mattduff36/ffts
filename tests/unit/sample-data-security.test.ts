import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPreviewFingerprint,
  getConfirmationPhrase,
  isValidConfirmation,
  verifyPreviewFingerprint,
} from '@/lib/server/sample-data/security';
import type { SampleDataFixtureStatus } from '@/lib/server/sample-data/types';

function fixtureStatus(
  state: SampleDataFixtureStatus['state'] = 'absent'
): SampleDataFixtureStatus {
  return {
    fixtureKey: 'scheduling-sample-v1',
    label: 'Scheduling',
    description: 'Fixture',
    toolingVersion: 'v1',
    state,
    available: true,
    expected: { quotes: 22 },
    observed: { quotes: state === 'installed' ? 22 : 0 },
    blockers: [],
    availabilityReason: null,
    lastOperation: null,
  };
}

describe('sample-data mutation security', () => {
  beforeEach(() => {
    process.env.APP_SESSION_HASH_SECRET = 'test-preview-signing-secret';
  });

  it('uses exact fixture-specific destructive phrases', () => {
    expect(
      getConfirmationPhrase('scheduling-sample-v1', 'remove')
    ).toBe('REMOVE SCHEDULING SAMPLE DATA');
    expect(
      getConfirmationPhrase('fleet-inventory-sample-v1', 'remove')
    ).toBe('REMOVE FLEET INVENTORY SAMPLE DATA');
    expect(
      getConfirmationPhrase('all-managed', 'clear-all')
    ).toBe('CLEAR ALL MANAGED SAMPLE DATA');
    expect(
      isValidConfirmation(
        'scheduling-sample-v1',
        'remove',
        'remove scheduling sample data'
      )
    ).toBe(false);
  });

  it('accepts only an unexpired fingerprint for the same status and action', () => {
    const now = new Date('2026-07-23T19:00:00.000Z');
    const status = fixtureStatus();
    const preview = createPreviewFingerprint({
      fixtureKey: 'scheduling-sample-v1',
      action: 'create-base',
      status,
      now,
    });

    expect(
      verifyPreviewFingerprint({
        fingerprint: preview.fingerprint,
        fixtureKey: 'scheduling-sample-v1',
        action: 'create-base',
        status,
        now: new Date('2026-07-23T19:04:59.000Z'),
      })
    ).toBe(true);
    expect(
      verifyPreviewFingerprint({
        fingerprint: preview.fingerprint,
        fixtureKey: 'scheduling-sample-v1',
        action: 'create-base',
        status,
        now: new Date('2026-07-23T19:05:01.000Z'),
      })
    ).toBe(false);
  });

  it('rejects a preview after fixture state changes', () => {
    const now = new Date('2026-07-23T19:00:00.000Z');
    const preview = createPreviewFingerprint({
      fixtureKey: 'scheduling-sample-v1',
      action: 'create-base',
      status: fixtureStatus('absent'),
      now,
    });

    expect(
      verifyPreviewFingerprint({
        fingerprint: preview.fingerprint,
        fixtureKey: 'scheduling-sample-v1',
        action: 'create-base',
        status: fixtureStatus('installed'),
        now,
      })
    ).toBe(false);
  });
});
