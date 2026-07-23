import 'server-only';

import { randomUUID } from 'node:crypto';
import { withSampleDataClient } from './database';
import type {
  ManagedFixtureKey,
  SampleDataAction,
  SampleDataFixtureStatus,
  SampleDataOperationSummary,
  SampleDataRegistryStatus,
} from './types';

interface RecordOperationInput {
  operationGroupId?: string;
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  outcome: 'succeeded' | 'failed' | 'partial' | 'noop';
  actorProfileId: string;
  previewFingerprint?: string;
  beforeStatus: SampleDataFixtureStatus | SampleDataRegistryStatus;
  afterStatus?: SampleDataFixtureStatus | SampleDataRegistryStatus;
  metadata?: Record<string, unknown>;
  error?: string | null;
  recovery?: string | null;
}

export async function recordSampleDataOperation(
  input: RecordOperationInput
): Promise<string> {
  const operationGroupId = input.operationGroupId || randomUUID();
  await withSampleDataClient(async (client) => {
    await client.query(
      `
        INSERT INTO public.sample_data_operations (
          operation_group_id,
          fixture_key,
          action,
          outcome,
          actor_profile_id,
          preview_fingerprint,
          before_status,
          after_status,
          metadata,
          error,
          recovery
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::jsonb, $8::jsonb, $9::jsonb, $10, $11
        )
      `,
      [
        operationGroupId,
        input.fixtureKey,
        input.action,
        input.outcome,
        input.actorProfileId,
        input.previewFingerprint || null,
        JSON.stringify(input.beforeStatus),
        JSON.stringify(input.afterStatus || input.beforeStatus),
        JSON.stringify(input.metadata || {}),
        input.error || null,
        input.recovery || null,
      ]
    );
  });
  return operationGroupId;
}

export async function getLastSampleDataOperations(): Promise<
  Map<ManagedFixtureKey, SampleDataOperationSummary>
> {
  return withSampleDataClient(async (client) => {
    const result = await client.query<{
      id: string;
      fixture_key: ManagedFixtureKey;
      action: SampleDataAction;
      outcome: 'succeeded' | 'failed' | 'partial' | 'noop';
      actor_profile_id: string | null;
      created_at: string;
      error: string | null;
      recovery: string | null;
    }>(
      `
        SELECT DISTINCT ON (fixture_key)
          id,
          fixture_key,
          action,
          outcome,
          actor_profile_id,
          created_at,
          error,
          recovery
        FROM public.sample_data_operations
        WHERE fixture_key IN (
          'scheduling-sample-v1',
          'fleet-inventory-sample-v1'
        )
        ORDER BY fixture_key, created_at DESC
      `
    );

    return new Map(
      result.rows.map((row) => [
        row.fixture_key,
        {
          id: row.id,
          fixtureKey: row.fixture_key,
          action: row.action,
          outcome: row.outcome,
          actorProfileId: row.actor_profile_id,
          createdAt: row.created_at,
          error: row.error,
          recovery: row.recovery,
        },
      ])
    );
  });
}
