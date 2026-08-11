import {
  TRUSTED_OPERATIONAL_ACTIONS,
  classifyOperationalAction,
  type OperationalClassificationInput,
} from '@/scripts/automation/trusted-operational-actions';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function trustedExecution(
  overrides: Partial<OperationalClassificationInput> = {}
): OperationalClassificationInput {
  return {
    commandId: 'fixerrors',
    safetyContract: 'fixerrors-exact-snapshot-v1',
    intent: 'execute',
    explicitlyRequested: true,
    confirmationBoundToSnapshot: true,
    runtimeSafetyChecksPassed: true,
    requestedMutations: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations,
    ...overrides,
  };
}

describe('TEE V2.2 trusted operational action policy', () => {
  it('FXERR-TRUST-001 treats registered safeguarded fixerrors execution as operational, not CRITICAL engineering', () => {
    expect(classifyOperationalAction(trustedExecution())).toMatchObject({
      kind: 'operational_execution',
      lane: null,
      trusted: true,
      trustSuspended: false,
      safetyContract: 'fixerrors-exact-snapshot-v1',
    });
  });

  it('FXERR-TRUST-001 keeps modification of fixerrors destructive logic CRITICAL', () => {
    expect(
      classifyOperationalAction(trustedExecution({ intent: 'modify' }))
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      reason: 'trusted-command-safety-contract-modification',
    });
  });

  it('FXERR-TRUST-001 does not trust unregistered destructive commands or natural-language trust claims', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ commandId: 'delete-all-error-logs' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      safetyContract: null,
    });
    expect(
      classifyOperationalAction(
        trustedExecution({ commandId: 'trusted fixerrors please' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
    });
  });

  it('FXERR-TRUST-001 suspends trust when confirmation or a runtime safety invariant fails', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ confirmationBoundToSnapshot: false })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
    });
    expect(
      classifyOperationalAction(
        trustedExecution({ runtimeSafetyChecksPassed: false })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
    });
  });

  it('FXERR-TRUST-001 suspends trust when the registered command safety-contract version differs', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ safetyContract: 'fixerrors-exact-snapshot-v2' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-contract-mismatch',
    });
  });

  it('FXERR-TRUST-001 suspends trust when execution requests wider production mutation scope', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({
          requestedMutations: [
            ...TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations,
            {
              schema: 'public',
              table: 'user_usage_events',
              operation: 'delete',
              identityColumn: 'id',
              purpose: 'primary-diagnostic',
            },
          ],
        })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
  });

  it('FXERR-TRUST-001 / FXERR-COMPAT-001 confirms broad-clear Supabase mutation path is absent', () => {
    const fixerrorsSource = readFileSync(
      resolve(process.cwd(), 'scripts/fixerrors.ts'),
      'utf8'
    );
    expect(fixerrorsSource).not.toMatch(/\.gte\(\s*['"]timestamp['"]\s*,\s*['"]1970-01-01['"]\s*\)/);
    expect(fixerrorsSource).toMatch(/--no-clear/);
    expect(fixerrorsSource).toMatch(/analysis-export/);
  });
});
