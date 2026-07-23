export const MANAGED_FIXTURE_KEYS = [
  'scheduling-sample-v1',
  'fleet-inventory-sample-v1',
] as const;

export type ManagedFixtureKey = (typeof MANAGED_FIXTURE_KEYS)[number];

export type SampleDataState =
  | 'absent'
  | 'installed'
  | 'partial'
  | 'drifted'
  | 'blocked'
  | 'unavailable';

export type SampleDataAction =
  | 'create-base'
  | 'create-queue'
  | 'create-complete'
  | 'create'
  | 'remove'
  | 'clear-all';

export interface SampleDataVariantStatus {
  state: SampleDataState;
  expected: Record<string, number>;
  observed: Record<string, number>;
}

export interface SampleDataOperationSummary {
  id: string;
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  outcome: 'succeeded' | 'failed' | 'partial' | 'noop';
  actorProfileId: string | null;
  createdAt: string;
  error: string | null;
  recovery: string | null;
}

export interface SampleDataFixtureStatus {
  fixtureKey: ManagedFixtureKey;
  label: string;
  description: string;
  toolingVersion: string;
  state: SampleDataState;
  available: boolean;
  expected: Record<string, number>;
  observed: Record<string, number>;
  blockers: string[];
  availabilityReason: string | null;
  variants?: Record<string, SampleDataVariantStatus>;
  lastOperation: SampleDataOperationSummary | null;
}

export interface SampleDataRegistryStatus {
  generatedAt: string;
  fixtures: SampleDataFixtureStatus[];
  clearAll: {
    canRemove: boolean;
    blockers: string[];
    fixtureKeys: ManagedFixtureKey[];
  };
}

export interface SampleDataPreview {
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  confirmationPhrase: string;
  fingerprint: string;
  expiresAt: string;
  status: SampleDataFixtureStatus | SampleDataRegistryStatus;
  blockers: string[];
  canExecute: boolean;
}

export interface SampleDataMutationInput {
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  confirmation: string;
  fingerprint: string;
  actorProfileId: string;
}

export interface SampleDataMutationResult {
  success: boolean;
  outcome: 'succeeded' | 'failed' | 'partial' | 'noop';
  fixtureKey: ManagedFixtureKey | 'all-managed';
  action: SampleDataAction;
  message: string;
  completedFixtures: ManagedFixtureKey[];
  failedFixture: ManagedFixtureKey | null;
  recovery: string | null;
  status: SampleDataRegistryStatus;
}
