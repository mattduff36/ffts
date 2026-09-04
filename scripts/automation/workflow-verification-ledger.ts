import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { writeJsonAtomic } from './workflow-events';
import { pathHasExistingSymlinkComponent } from './workflow-plan-contract';
import { consumeVitestProgressFile, type TestSuiteProgressEvent } from './workflow-verify-progress';
import {
  computeWorkingTreeProductFingerprint,
  gitHeadCommit,
  type GitCommandRunner,
} from './workflow-v24-disposition';

export const VERIFICATION_LEDGER_SCHEMA_VERSION = '1' as const;
export const VERIFICATION_LEDGER_COMMAND_TYPES = [
  'vitest_case',
  'vitest_suite',
  'changed_files',
] as const;
export type VerificationLedgerCommandType = (typeof VERIFICATION_LEDGER_COMMAND_TYPES)[number];

export type RequiredTestProofKind = 'vitest_case' | 'vitest_suite' | 'exact_command';
export type VerificationTestStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'todo'
  | 'pending'
  | 'unknown';

const REQUIRED_ID_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SHA_RE = /^[0-9a-f]{7,64}$/i;

export const EXACT_COMMAND_REQUIRED_TEST_IDS = {
  TYPECHECK: 'T-TYPECHECK',
  LINT: 'T-LINT',
} as const;

export const CANONICAL_SUITE_REQUIRED_TEST_ID = 'T-EXISTING-WORKFLOW-TESTS';

/** Stable Vitest flags for long canonical suite runs (avoids worker RPC timeouts on Windows). */
export const CANONICAL_VITEST_SUITE_EXTRA_ARGS = [
  '--testTimeout=120000',
  '--maxWorkers=1',
  '--no-file-parallelism',
  '--pool=threads',
  '--poolOptions.threads.singleThread=true',
] as const;

function flagKey(arg: string): string {
  return arg.split('=')[0] ?? arg;
}

/**
 * Suite defaults plus caller extras, without repeating a flag.
 * Duplicate `--poolOptions.threads.singleThread=true` crashes Vitest cac before a JSON reporter is written.
 */
export function resolveVitestLedgerExtraArgs(
  commandType: VerificationLedgerCommandType,
  extraArgs: readonly string[] = []
): string[] {
  const callerKeys = new Set(extraArgs.map(flagKey));
  const suiteDefaults =
    commandType === 'vitest_suite'
      ? CANONICAL_VITEST_SUITE_EXTRA_ARGS.filter((arg) => !callerKeys.has(flagKey(arg)))
      : [];
  return [...suiteDefaults, ...extraArgs];
}

const EXACT_COMMAND_ID_SET = new Set<string>(Object.values(EXACT_COMMAND_REQUIRED_TEST_IDS));

export const BLOCKER_REQUIRED_TEST_IDS: Readonly<Record<string, readonly string[]>> = {
  'FD-LINEAGE-INIT-001': [
    'FD-LINEAGE-INIT-001',
    'TEE-V24-REINIT-PLANPATH-001',
    'TEE-V24-REINIT-REHOME-002',
    'TEE-V24-REINIT-BOTH-003',
    'TEE-V24-REINIT-COUNTS-004',
    'TEE-V24-REINIT-CONFLICT-PLAN-005',
    'TEE-V24-REINIT-CONFLICT-REHOME-006',
    'TEE-V24-REINIT-NO-UNBIND-007',
    'TEE-V24-REINIT-NO-MINT-008',
    'TEE-V24-REINIT-IDEMPOTENT-009',
    'TEE-V24-REINIT-MALFORMED-010',
  ],
  'FD-GIT-C9-001': [
    'FD-GIT-C9-001',
    'TEE-V24-C9-FINISH-VALID-001',
    'TEE-V24-C9-FINISH-MISSING-002',
    'TEE-V24-C9-FINISH-MISMATCH-003',
    'TEE-V24-C9-FINISH-BRANCH-004',
    'TEE-V24-C9-FINISH-HEAD-005',
    'TEE-V24-C9-FINISH-OWNED-006',
    'TEE-V24-C9-FINISH-GIT-ERROR-007',
    'TEE-V24-C9-FINISH-MALFORMED-008',
    'TEE-V24-C9-FINISH-NO-DOWNGRADE-009',
    'TEE-V24-C9-FINISH-NONC9-010',
    'TEE-V24-LANE-C9-STD-001',
    'TEE-V24-LANE-C9-FAST-002',
    'TEE-V24-LANE-C9-NO-FAKE-WS-003',
    'TEE-V24-LANE-C9-NO-FAKE-C9-004',
    'TEE-V24-LANE-C9-FINISH-STD-005',
    'TEE-V24-LANE-C9-UNKNOWN-010',
    'TEE-V24-LANE-C9-NO-MUTATE-011',
    'TEE-V24-LANE-C9-NO-INHERIT-013',
    'TEE-V24-LANE-C9-RETRY-014',
    'TEE-V24-LANE-C9-EXIT0-015',
    'TEE-V24-LANE-C9-VERSION-016',
    'TEE-V24-LANE-C9-PREMUTATE-017',
    'TEE-V24-LANE-C9-CONSUMER-SYMMETRY-018',
    'TEE-V24-LANE-C9-NO-CONTAMINATION-019',
    'TEE-V24-LANE-C9-PUSH-POLICY-020',
    'TEE-V24-LANE-C9-BOUND-CONTEXT-021',
    'TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-022',
    'TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-REVIEW-023',
    'TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-CLOSED-024',
    'TEE-V24-LANE-C9-PREMUTATE-IDENTITY-025',
    'TEE-V24-LANE-C9-PREMUTATE-SWAP-026',
  ],
  'FD-VERIFY-REQUIRED-001': [
    'FD-VERIFY-REQUIRED-001',
    'TEE-V24-VERIFY-MANIFEST-001',
    'TEE-V24-SCOPE-001',
  ],
  'FD-LINEAGE-BOUND-MALFORMED-002': ['FD-LINEAGE-BOUND-MALFORMED-002'],
  'FD-GIT-C9-STATE-LOSS-002': ['FD-GIT-C9-STATE-LOSS-002'],
  'FD-GIT-C9-PREPUSH-003': ['FD-GIT-C9-PREPUSH-003'],
  'FD-GIT-C9-PREPUSH-CONTEXT-SWAP-004': [
    'FD-GIT-C9-PREPUSH-CONTEXT-SWAP-004',
    'TEE-V24-C9-SWAP-VALID-001',
    'TEE-V24-C9-SWAP-CURRENT-B-002',
    'TEE-V24-C9-SWAP-B-WOULD-PASS-003',
    'TEE-V24-C9-SWAP-DELETED-004',
    'TEE-V24-C9-SWAP-CORRUPT-005',
    'TEE-V24-C9-SWAP-OTHER-WS-006',
    'TEE-V24-C9-SWAP-HEAD-007',
    'TEE-V24-C9-SWAP-BRANCH-008',
    'TEE-V24-C9-SWAP-OWNED-009',
    'TEE-V24-C9-SWAP-BUMP-010',
    'TEE-V24-C9-SWAP-HIJACK-011',
    'TEE-V24-C9-SWAP-CLEANUP-012',
  ],
  'FD-VERIFY-SCOPE-002': ['FD-VERIFY-SCOPE-002'],
  'FD-VERIFY-SCOPE-INDEX-004': [
    'FD-VERIFY-SCOPE-INDEX-004',
    'TEE-V24-SCOPE-COMMITTED-001',
    'TEE-V24-SCOPE-STAGED-MOD-002',
    'TEE-V24-SCOPE-STAGED-NEW-003',
    'TEE-V24-SCOPE-STAGED-DEL-004',
    'TEE-V24-SCOPE-UNSTAGED-005',
    'TEE-V24-SCOPE-UNTRACKED-006',
    'TEE-V24-SCOPE-STAGED-UNSTAGED-007',
    'TEE-V24-SCOPE-FORBIDDEN-STAGED-008',
    'TEE-V24-SCOPE-FINGERPRINT-009',
    'TEE-V24-SCOPE-FROZEN-010',
    'TEE-V24-SCOPE-IGNORED-011',
    'TEE-V24-SCOPE-CACHED-FAIL-012',
  ],
  'FD-VERIFY-UNTRUSTED-003': ['FD-VERIFY-UNTRUSTED-003'],
  'FD-LINEAGE-BOUND-INTEGRITY-004': [
    'FD-LINEAGE-BOUND-INTEGRITY-004',
    'TEE-V24-BOUND-VALID-001',
    'TEE-V24-BOUND-HASH-TAMPER-002',
    'TEE-V24-BOUND-GENERIC-REHASH-003',
    'TEE-V24-BOUND-SOURCE-BRANCH-004',
    'TEE-V24-BOUND-SOURCE-HEAD-005',
    'TEE-V24-BOUND-BASELINE-006',
    'TEE-V24-BOUND-PRED-HEAD-007',
    'TEE-V24-BOUND-COMMITS-008',
    'TEE-V24-BOUND-FINGERPRINT-009',
    'TEE-V24-BOUND-ANCESTOR-TRUE-010',
    'TEE-V24-BOUND-ANCESTOR-MISSING-011',
    'TEE-V24-BOUND-FALSE-FLAG-GIT-ANCESTOR-012',
    'TEE-V24-BOUND-CROSSBIND-013',
    'TEE-V24-BOUND-RANGE-014',
    'TEE-V24-BOUND-REINIT-RETAIN-015',
    'TEE-V24-BOUND-REINIT-CONFLICT-016',
  ],
  'FD-VERIFY-UNTRUSTED-REHASH-004': [
    'FD-VERIFY-UNTRUSTED-REHASH-004',
    'TEE-V24-LEDGER-AUTH-VALID-001',
    'TEE-V24-LEDGER-AUTH-NO-REHASH-002',
    'TEE-V24-LEDGER-AUTH-REHASH-003',
    'TEE-V24-LEDGER-AUTH-ADD-004',
    'TEE-V24-LEDGER-AUTH-REMOVE-005',
    'TEE-V24-LEDGER-AUTH-SKIP-PASS-006',
    'TEE-V24-LEDGER-AUTH-RUNNER-007',
    'TEE-V24-LEDGER-AUTH-HEAD-008',
    'TEE-V24-LEDGER-AUTH-FINGERPRINT-009',
    'TEE-V24-LEDGER-AUTH-REPORTER-HASH-010',
    'TEE-V24-LEDGER-AUTH-ROWS-011',
    'TEE-V24-LEDGER-AUTH-RELOAD-012',
    'TEE-V24-LEDGER-AUTH-MEMORY-013',
    'TEE-V24-LEDGER-AUTH-DRYRUN-014',
    'TEE-V24-LEDGER-AUTH-EXIT-016',
  ],
  'FD-VERIFY-EXIT-STATUS-001': [
    'FD-VERIFY-EXIT-STATUS-001',
    'TEE-V24-LEDGER-AUTH-EXIT-016',
    'TEE-V24-EXIT-PROOF-0-001',
    'TEE-V24-EXIT-FAIL-TESTS-002',
    'TEE-V24-EXIT-REPORTER-FAIL-003',
    'TEE-V24-EXIT-REPORTER-MISSING-004',
    'TEE-V24-EXIT-SUCCESS-LOOKING-005',
    'TEE-V24-EXIT-NUMERIC-NOT-ENOUGH-006',
    'TEE-V24-EXIT-CODE-2-007',
    'TEE-V24-EXIT-SIGNAL-008',
    'TEE-V24-EXIT-TIMEOUT-009',
    'TEE-V24-EXIT-SPAWN-010',
    'TEE-V24-EXIT-TAMPER-REHASH-011',
    'TEE-V24-EXIT-PROCESS-DRIFT-012',
    'TEE-V24-EXIT-PREFLIGHT-013',
    'TEE-V24-EXIT-FIXDELTA-014',
    'TEE-V24-EXIT-REQUIRED-ID-015',
    'TEE-V24-EXIT-READINESS-016',
    'TEE-V24-EXIT-POST-REPORT-POS-017',
    'TEE-V24-EXIT-POST-REPORT-NEG-018',
  ],
  'FD-C9-FINISH-ATOMICITY-004': [
    'FD-C9-FINISH-ATOMICITY-004',
    'TEE-V24-FINISH-ATOMIC-VALID-001',
    'TEE-V24-FINISH-ATOMIC-MISSING-002',
    'TEE-V24-FINISH-ATOMIC-CORRUPT-003',
    'TEE-V24-FINISH-ATOMIC-BRANCH-004',
    'TEE-V24-FINISH-ATOMIC-HEAD-005',
    'TEE-V24-FINISH-ATOMIC-WS-006',
    'TEE-V24-FINISH-ATOMIC-OWNED-007',
    'TEE-V24-FINISH-ATOMIC-GIT-008',
    'TEE-V24-FINISH-ATOMIC-CORR-009',
    'TEE-V24-FINISH-ATOMIC-C9-AFTER-MEM-010',
    'TEE-V24-FINISH-ATOMIC-PROTO-FAIL-011',
    'TEE-V24-FINISH-ATOMIC-STATE-FAIL-012',
    'TEE-V24-FINISH-ATOMIC-RUN-013',
    'TEE-V24-FINISH-ATOMIC-MARKER-014',
    'TEE-V24-FINISH-ATOMIC-DIAG-015',
    'TEE-V24-FINISH-ATOMIC-CLEAR-016',
    'TEE-V24-FINISH-ATOMIC-RETRY-017',
  ],
  'FD-FINALISE-AUTHORITY-005': [
    'FD-FINALISE-AUTHORITY-005',
    'TEE-V24-BYPASS-FINISH-VALID-001',
    'TEE-V24-BYPASS-DIRECT-HELPER-002',
    'TEE-V24-BYPASS-STATUS-PASSED-003',
    'TEE-V24-BYPASS-MISSING-C9-004',
    'TEE-V24-BYPASS-CORRUPT-C9-005',
    'TEE-V24-BYPASS-COMPUTE-ONLY-006',
    'TEE-V24-BYPASS-FAILED-COMPAT-007',
    'TEE-V24-BYPASS-COMMIT-GUARD-008',
  ],
  'FD-FINALISE-CRASH-006': [
    'FD-FINALISE-CRASH-006',
    'TEE-V24-CRASH-BEFORE-WRITE-001',
    'TEE-V24-CRASH-AFTER-STATE-002',
    'TEE-V24-CRASH-AFTER-PROTOCOL-003',
    'TEE-V24-CRASH-BEFORE-RUN-LOG-004',
    'TEE-V24-CRASH-C9-NOT-AUTHORITY-005',
    'TEE-V24-CRASH-RECOVER-RETRY-006',
    'TEE-V24-CRASH-RUN-LOG-NOT-AUTHORITY-007',
  ],
  'FD-LEDGER-PROVER-001': [
    'T-LEDGER-SRC-NOT-EXECUTED',
    'T-LEDGER-FILTERED-NOT-PROVEN',
    'T-LEDGER-SKIP-NOT-PROVEN',
    'T-LEDGER-TODO-NOT-PROVEN',
    'T-LEDGER-FAIL-NOT-PROVEN',
    'T-LEDGER-EXACT-PASS-PROVEN',
    'T-LEDGER-SIMILAR-TITLE-NO-CROSS',
    'T-LEDGER-DUPLICATE-ID-FAIL-CLOSED',
    'T-LEDGER-FORGED-PROJECTION',
  ],
  'FD-LEDGER-002': [
    'T-LEDGER-CHANGED-NOT-SUITE',
    'T-LEDGER-PARTIAL-SUITE-NOT-PROVEN',
    'T-LEDGER-FULL-SUITE-PROVEN',
    'T-LEDGER-ZERO-TESTS-NOT-SUITE',
    'T-TYPECHECK-NAME-ONLY-NOT-PROVEN',
    'T-LINT-NAME-ONLY-NOT-PROVEN',
  ],
  'FD-FIXDELTA-001': [
    'T-FIXDELTA-NO-LEDGER',
    'T-FIXDELTA-UNRELATED-TESTS',
    'T-FIXDELTA-VALID-LEDGER',
    'T-FIXDELTA-WRONG-FINGERPRINT',
    'T-FIXDELTA-STALE-AFTER-CHANGE',
    'T-FIXDELTA-TAMPER-HASH',
  ],
  'FD-DRIFT-001': [
    'T-DRIFT-GIT-THROW',
    'T-DRIFT-GIT-NONZERO',
    'T-DRIFT-GIT-MALFORMED',
    'T-DRIFT-GIT-SUCCESS',
    'T-DRIFT-DESCENDANT-MISSING-NOT-ISOLATION',
    'T-DRIFT-PREDECESSOR-MISSING-ISOLATION',
    'T-DRIFT-ANCESTOR-REJECTS-ISOLATION',
    'T-DRIFT-NON-ANCESTOR-ISOLATION-OK',
    'T-DRIFT-COLLIDING-PREFIX-MISSING-DESCENDANT',
    'T-DRIFT-COLLIDING-PREFIX-MISSING-PREDECESSOR',
    'T-DRIFT-BOTH-MISSING-SAME-PREFIX',
    'T-DRIFT-MALFORMED-SAME-PREFIX',
    'T-DRIFT-AMBIGUOUS-SHA',
    'T-DRIFT-NON-COMMIT-OBJECT',
    'T-DRIFT-MERGE-BASE-EXIT-2',
    'T-DRIFT-SPAWN-FAILURE',
    'T-DRIFT-TIMEOUT',
    'T-DRIFT-UNEXPECTED-SIGNAL',
    'T-DRIFT-STDERR-CONTAINS-SHA-STILL-ERROR',
    'T-DRIFT-STDERR-EMPTY-STILL-ERROR',
    'T-DRIFT-EXIT-1-BOTH-VERIFIED',
    'T-DRIFT-FULL-SHA-IN-EVIDENCE',
    'T-DRIFT-ABBREV-DISPLAY-DOES-NOT-DECIDE',
  ],
};

export interface CanonicalWorkflowSuiteManifest {
  schemaVersion: '1';
  id: string;
  files: string[];
}

export interface VerificationLedgerExecutedTest {
  canonicalId: string | null;
  file: string;
  fullName: string;
  title: string;
  status: VerificationTestStatus;
}

export type VerificationProcessTerminationKind = 'exit' | 'signal' | 'timeout' | 'spawn_error';

export interface VerificationProcessTermination {
  kind: VerificationProcessTerminationKind;
  exitCode: number | null;
  signal: string | null;
}

/**
 * Non-zero process + successful reporter is not proof unless this is true AND
 * classifyPostReportInfrastructureException proves an allow-listed post-report
 * condition. FFTS currently fail-closes: a clean rerun with exit 0 is required.
 */
export const POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED = false as const;

export type VerificationProofEligibilityReason = 'process_success' | 'post_report_infrastructure';

export interface VerificationLedgerRecord {
  schemaVersion: '1';
  runId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  processTermination?: VerificationProcessTermination;
  headCommit: string;
  productTreeFingerprint: string;
  runnerName: string;
  runnerVersion: string;
  reporterOutputHash: string;
  expectedSuiteManifestHash?: string;
  mappedRequiredIds: string[];
  executedTests: VerificationLedgerExecutedTest[];
  contentHash: string;
}

export interface VerificationLedgerReference {
  relativePath: string;
  contentHash: string;
  commandType: VerificationLedgerCommandType;
  reporterRelativePath: string;
  reporterOutputHash: string;
}

export interface ProvenRequiredTests {
  ok: true;
  provenIds: string[];
  suiteProven: boolean;
  mappingError?: undefined;
}

export interface ProvenRequiredTestsFailure {
  ok: false;
  message: string;
  provenIds: string[];
  suiteProven: boolean;
}

type JsonObject = Record<string, unknown>;

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function posixRelative(repoRoot: string, absolutePath: string): string | { error: string } {
  const repo = path.resolve(repoRoot);
  const absolute = path.resolve(absolutePath);
  const relative = path.relative(repo, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: `path is outside the repository: ${absolutePath}` };
  }
  return relative;
}

export function requiredTestProofKind(id: string): RequiredTestProofKind {
  if (id === CANONICAL_SUITE_REQUIRED_TEST_ID) return 'vitest_suite';
  if (EXACT_COMMAND_ID_SET.has(id)) return 'exact_command';
  return 'vitest_case';
}

export function titleContainsExactRequiredId(text: string, id: string): boolean {
  if (!REQUIRED_ID_TOKEN_RE.test(id)) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'u').test(text);
}

export function loadCanonicalWorkflowSuiteManifest(): CanonicalWorkflowSuiteManifest {
  const manifestPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'workflow-suite-manifest.json'
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('canonical workflow suite manifest is unreadable');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('canonical workflow suite manifest is malformed');
  }
  const suiteManifestJson = parsed as { schemaVersion?: unknown; id?: unknown; files?: unknown };
  const files = Array.isArray(suiteManifestJson.files)
    ? suiteManifestJson.files.map((file) => String(file).replace(/\\/g, '/'))
    : [];
  const unique = [...new Set(files)].sort();
  if (unique.length === 0 || unique.length !== files.length) {
    throw new Error('canonical workflow suite manifest must enumerate unique files');
  }
  if (suiteManifestJson.schemaVersion !== '1' || typeof suiteManifestJson.id !== 'string') {
    throw new Error('canonical workflow suite manifest is malformed');
  }
  return {
    schemaVersion: '1',
    id: suiteManifestJson.id,
    files: unique,
  };
}

export interface CanonicalV24RequiredIdManifest {
  schemaVersion: '1';
  id: string;
  ids: string[];
}

export function loadCanonicalV24RequiredTestIds(): string[] {
  const manifestPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'workflow-v24-required-ids.json'
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('canonical V2.4 required-id manifest is unreadable');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('canonical V2.4 required-id manifest is malformed');
  }
  const manifest = parsed as { schemaVersion?: unknown; id?: unknown; ids?: unknown };
  const ids = Array.isArray(manifest.ids)
    ? manifest.ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const unique = [...new Set(ids)];
  if (
    manifest.schemaVersion !== '1' ||
    typeof manifest.id !== 'string' ||
    unique.length === 0 ||
    unique.length !== ids.length
  ) {
    throw new Error('canonical V2.4 required-id manifest is malformed');
  }
  for (const id of unique) {
    if (!REQUIRED_ID_TOKEN_RE.test(id)) {
      throw new Error(`canonical V2.4 required-id is malformed: ${id}`);
    }
  }
  return unique;
}

function isTrustedVitestRunnerMetadata(
  record: Pick<VerificationLedgerRecord, 'command' | 'args' | 'runnerName'>
): boolean {
  if (record.runnerName !== 'vitest') return false;
  const args = Array.isArray(record.args) ? record.args : [];
  if (!args.includes('run')) return false;
  if (record.command === 'vitest') return true;
  if (record.command !== process.execPath) return false;
  return args.some((arg) => {
    const normalized = arg.replace(/\\/g, '/');
    return (
      normalized.endsWith('/vitest.mjs') ||
      normalized.endsWith('/vitest/dist/cli.js') ||
      /(^|\/)node_modules\/vitest(\/|$)/u.test(normalized)
    );
  });
}

const PROCESS_TERMINATION_KINDS = new Set<VerificationProcessTerminationKind>([
  'exit',
  'signal',
  'timeout',
  'spawn_error',
]);

export function isIntegerProcessExitCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function classifySpawnSyncTermination(result: {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}): VerificationProcessTermination {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT' || /timed out/iu.test(result.error.message)) {
      return { kind: 'timeout', exitCode: result.status, signal: result.signal ?? null };
    }
    return { kind: 'spawn_error', exitCode: result.status, signal: result.signal ?? null };
  }
  if (result.signal) {
    return { kind: 'signal', exitCode: result.status, signal: result.signal };
  }
  if (isIntegerProcessExitCode(result.status)) {
    return { kind: 'exit', exitCode: result.status, signal: null };
  }
  return { kind: 'spawn_error', exitCode: null, signal: null };
}

export function assertProcessTerminationConsistent(
  record: Pick<VerificationLedgerRecord, 'exitCode' | 'processTermination'>
): { ok: true } | { ok: false; message: string } {
  if (!isIntegerProcessExitCode(record.exitCode)) {
    return { ok: false, message: 'verification ledger exitCode is not an integer process status' };
  }
  const termination = record.processTermination;
  if (!termination) return { ok: true };
  if (!PROCESS_TERMINATION_KINDS.has(termination.kind)) {
    return { ok: false, message: 'verification ledger processTermination.kind is unsupported' };
  }
  if (termination.exitCode != null && !isIntegerProcessExitCode(termination.exitCode)) {
    return { ok: false, message: 'verification ledger processTermination.exitCode is malformed' };
  }
  if (termination.signal != null && typeof termination.signal !== 'string') {
    return { ok: false, message: 'verification ledger processTermination.signal is malformed' };
  }
  if (termination.kind === 'exit') {
    if (termination.exitCode !== record.exitCode) {
      return {
        ok: false,
        message: 'verification ledger exitCode does not match processTermination.exitCode',
      };
    }
    if (termination.signal != null) {
      return { ok: false, message: 'verification ledger processTermination signal is inconsistent' };
    }
  } else if (record.exitCode === 0) {
    return {
      ok: false,
      message: 'verification ledger cannot claim exit 0 for a non-exit process termination',
    };
  }
  return { ok: true };
}

/**
 * Canonical process-outcome gate. Reporter success never launders a non-zero
 * process into proof. A post-report infrastructure exception is defined but
 * disabled: it cannot be proven robustly from stored reporter bytes alone.
 */
export function processOutcomeIsProofEligible(
  record: Pick<VerificationLedgerRecord, 'exitCode' | 'processTermination'>
):
  | { ok: true; reason: VerificationProofEligibilityReason }
  | { ok: false; message: string } {
  const consistent = assertProcessTerminationConsistent(record);
  if (!consistent.ok) return consistent;
  const termination = record.processTermination;
  if (termination && termination.kind !== 'exit') {
    return {
      ok: false,
      message: `verification process ${termination.kind} is not proof-eligible`,
    };
  }
  if (record.exitCode === 0) {
    return { ok: true, reason: 'process_success' };
  }
  if (
    POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED &&
    termination?.kind === 'exit' &&
    termination.exitCode === 1 &&
    termination.signal == null
  ) {
    return {
      ok: false,
      message: 'post-report infrastructure exception is not proven; require a clean rerun',
    };
  }
  return {
    ok: false,
    message: 'verification process exitCode is not a successful suite run',
  };
}

export function verificationRunIsProofEligible(params: {
  record: VerificationLedgerRecord;
  reporterRaw: Buffer;
  expectedHeadCommit?: string;
  expectedFingerprint?: string;
  requiredIds?: string[];
}):
  | { ok: true; reason: VerificationProofEligibilityReason }
  | { ok: false; message: string } {
  const authentic = assertAuthenticLedgerProjection({
    record: params.record,
    reporterRaw: params.reporterRaw,
    expectedHeadCommit: params.expectedHeadCommit,
    expectedFingerprint: params.expectedFingerprint,
  });
  if (!authentic.ok) return authentic;
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.record.cwd,
    reporterRaw: params.reporterRaw,
    requiredIds: params.record.mappedRequiredIds,
  });
  if (!projected.ok) return projected;
  if (projected.reporterSuccess !== true) {
    return { ok: false, message: 'verification reporter did not record suite success' };
  }
  if (params.record.executedTests.length === 0) {
    return { ok: false, message: 'verification run executed zero tests' };
  }
  if (
    params.record.executedTests.some(
      (test) => test.status === 'failed' || test.status === 'unknown'
    )
  ) {
    return { ok: false, message: 'verification run contains failed tests and is not proof-eligible' };
  }
  const requiredIds = params.requiredIds ?? params.record.mappedRequiredIds;
  const requiredSet = new Set(
    requiredIds.filter((id) => requiredTestProofKind(id) === 'vitest_case')
  );
  for (const test of params.record.executedTests) {
    const mapped =
      test.canonicalId && requiredSet.has(test.canonicalId)
        ? test.canonicalId
        : requiredIds.find(
            (id) =>
              requiredTestProofKind(id) === 'vitest_case' &&
              (titleContainsExactRequiredId(test.fullName, id) ||
                titleContainsExactRequiredId(test.title, id))
          );
    if (
      mapped &&
      (test.status === 'skipped' || test.status === 'todo' || test.status === 'pending')
    ) {
      return {
        ok: false,
        message: `required ID ${mapped} has ${test.status} status and is not proven`,
      };
    }
  }
  return processOutcomeIsProofEligible(params.record);
}

export function assertLedgerIntegrity(
  record: VerificationLedgerRecord
): { ok: true } | { ok: false; message: string } {
  if (record.schemaVersion !== VERIFICATION_LEDGER_SCHEMA_VERSION) {
    return { ok: false, message: 'verification ledger schemaVersion is unsupported' };
  }
  if (!isIntegerProcessExitCode(record.exitCode)) {
    return { ok: false, message: 'verification ledger exitCode is not an integer process status' };
  }
  const termination = assertProcessTerminationConsistent(record);
  if (!termination.ok) return termination;
  if (typeof record.reporterOutputHash !== 'string' || !SHA256_RE.test(record.reporterOutputHash)) {
    return { ok: false, message: 'verification ledger reporterOutputHash is missing' };
  }
  if (!VERIFICATION_LEDGER_COMMAND_TYPES.includes(record.commandType)) {
    return { ok: false, message: 'verification ledger commandType is unsupported' };
  }
  if (record.commandType === 'vitest_suite') {
    if (
      typeof record.expectedSuiteManifestHash !== 'string' ||
      !SHA256_RE.test(record.expectedSuiteManifestHash)
    ) {
      return { ok: false, message: 'verification ledger suite identity is missing' };
    }
    if (record.expectedSuiteManifestHash !== hashCanonicalWorkflowSuiteManifest()) {
      return { ok: false, message: 'verification ledger suite identity does not match the canonical suite' };
    }
  }
  const { contentHash, ...body } = record;
  if (typeof contentHash !== 'string' || !SHA256_RE.test(contentHash)) {
    return { ok: false, message: 'verification ledger contentHash is missing' };
  }
  if (hashVerificationLedgerBody(body) !== contentHash) {
    return { ok: false, message: 'verification ledger contentHash does not match canonical body' };
  }
  return { ok: true };
}

export function assertAuthenticLedgerProjection(params: {
  record: VerificationLedgerRecord;
  reporterRaw: Buffer;
  expectedHeadCommit?: string;
  expectedFingerprint?: string;
}): { ok: true } | { ok: false; message: string } {
  const integrity = assertLedgerIntegrity(params.record);
  if (!integrity.ok) return integrity;
  if (sha256Hex(params.reporterRaw) !== params.record.reporterOutputHash) {
    return { ok: false, message: 'verification reporter projection hash mismatch' };
  }
  if (
    (params.record.commandType === 'vitest_case' || params.record.commandType === 'vitest_suite') &&
    !isTrustedVitestRunnerMetadata(params.record)
  ) {
    return { ok: false, message: 'verification ledger runner command metadata is not the trusted vitest runner' };
  }
  if (
    params.expectedHeadCommit &&
    params.record.headCommit !== params.expectedHeadCommit
  ) {
    return {
      ok: false,
      message: `ledger ${params.record.runId} is bound to HEAD ${params.record.headCommit}, not candidate ${params.expectedHeadCommit}`,
    };
  }
  if (
    params.expectedFingerprint &&
    params.record.productTreeFingerprint !== params.expectedFingerprint
  ) {
    return {
      ok: false,
      message: `ledger ${params.record.runId} fingerprint does not match the candidate product tree`,
    };
  }
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.record.cwd,
    reporterRaw: params.reporterRaw,
    requiredIds: params.record.mappedRequiredIds,
  });
  if (!projected.ok) return projected;
  if (canonicalJson(projected.executedTests) !== canonicalJson(params.record.executedTests)) {
    return {
      ok: false,
      message: 'verification ledger executedTests does not match the reporter projection',
    };
  }
  return { ok: true };
}

function loadTrustedReporterRaw(params: {
  record: VerificationLedgerRecord;
  reporterRawByRunId?: Record<string, Buffer>;
  repoRoot?: string;
  workstreamId?: string;
}): { ok: true; reporterRaw: Buffer } | { ok: false; message: string } {
  const fromMap = params.reporterRawByRunId?.[params.record.runId];
  if (fromMap) return { ok: true, reporterRaw: fromMap };
  if (!params.repoRoot || !params.workstreamId) {
    return {
      ok: false,
      message: 'untrusted in-memory ledger; reporter projection required',
    };
  }
  const reporterRelative = `docs_private/automation/workstreams/${params.workstreamId}/verification-reporter-${params.record.reporterOutputHash}.json`;
  const reporterPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: reporterRelative,
  });
  if (!reporterPath.ok) return reporterPath;
  if (!existsSync(reporterPath.absolutePath)) {
    return { ok: false, message: 'verification reporter projection is missing' };
  }
  const reporterRaw = readFileSync(reporterPath.absolutePath);
  if (sha256Hex(reporterRaw) !== params.record.reporterOutputHash) {
    return { ok: false, message: 'verification reporter projection hash mismatch' };
  }
  return { ok: true, reporterRaw };
}

export function proveRequiredIdsAgainstCandidate(params: {
  records: VerificationLedgerRecord[];
  requiredIds: string[];
  expectedHeadCommit: string;
  expectedFingerprint: string;
  reporterRawByRunId?: Record<string, Buffer>;
  repoRoot?: string;
  workstreamId?: string;
}):
  | { ok: true; provenIds: string[] }
  | { ok: false; message: string } {
  if (!SHA_RE.test(params.expectedHeadCommit) || !SHA256_RE.test(params.expectedFingerprint)) {
    return { ok: false, message: 'candidate identity is malformed' };
  }
  if (params.records.length === 0) {
    return { ok: false, message: 'no verification ledger records bound to the candidate' };
  }
  const eligibleRecords: VerificationLedgerRecord[] = [];
  for (const record of params.records) {
    const reporter = loadTrustedReporterRaw({
      record,
      reporterRawByRunId: params.reporterRawByRunId,
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
    });
    if (!reporter.ok) return reporter;
    const authentic = assertAuthenticLedgerProjection({
      record,
      reporterRaw: reporter.reporterRaw,
      expectedHeadCommit: params.expectedHeadCommit,
      expectedFingerprint: params.expectedFingerprint,
    });
    if (!authentic.ok) return authentic;
    const eligible = verificationRunIsProofEligible({
      record,
      reporterRaw: reporter.reporterRaw,
      expectedHeadCommit: params.expectedHeadCommit,
      expectedFingerprint: params.expectedFingerprint,
      requiredIds: params.requiredIds,
    });
    if (!eligible.ok) {
      continue;
    }
    eligibleRecords.push(record);
  }
  if (eligibleRecords.length === 0) {
    return { ok: false, message: 'no proof-eligible verification run is bound to the candidate' };
  }
  const proof = provenVitestCaseIds({
    records: eligibleRecords,
    requiredIds: params.requiredIds,
  });
  if (!proof.ok) return proof;
  const missing = params.requiredIds.filter((id) => !proof.provenIds.includes(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `required IDs are not proven against the candidate: ${missing.join(', ')}`,
    };
  }
  return { ok: true, provenIds: [...proof.provenIds].sort() };
}

const FORBIDDEN_AUTOMATION_PREFIX = 'docs_private/automation/';
const SCHEDULING_PRODUCT_PREFIXES = [
  'app/(dashboard)/scheduling/',
  'tests/ui/components/Scheduling',
  'tests/unit/scheduling-',
];
const WORKFLOW_RUNTIME_PREFIXES = [
  'scripts/automation/',
  'scripts/finalise.ts',
  'scripts/review-preflight.ts',
  'scripts/workflow-protocol.ts',
  'tests/unit/workflow-',
];

function pathHasPrefix(relative: string, prefix: string): boolean {
  return prefix.endsWith('/') || prefix.endsWith('-')
    ? relative.startsWith(prefix)
    : relative === prefix;
}

function isSchedulingProductPath(relative: string): boolean {
  return SCHEDULING_PRODUCT_PREFIXES.some((prefix) => pathHasPrefix(relative, prefix));
}

function isWorkflowRuntimePath(relative: string): boolean {
  return WORKFLOW_RUNTIME_PREFIXES.some((prefix) => pathHasPrefix(relative, prefix));
}

export interface CandidateGitScope {
  committed: string[];
  staged: string[];
  stagedStatus: string[];
  unstaged: string[];
  untracked: string[];
  all: string[];
}

function normalizeGitNames(output: string, separator: RegExp | string): string[] {
  return output
    .split(separator)
    .map((entry) => entry.replace(/\\/g, '/').trim())
    .filter(Boolean);
}

export function inspectCandidateGitScope(
  repoRoot: string,
  baselineCommit: string
): { ok: true; scope: CandidateGitScope } | { ok: false; message: string } {
  const baselineObject = spawnSync('git', ['cat-file', '-t', baselineCommit], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  const committed = spawnSync(
    'git',
    ['diff', '--name-only', baselineCommit, 'HEAD', '--', '.'],
    { cwd: repoRoot, encoding: 'utf8', shell: false }
  );
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  const stagedStatus = spawnSync('git', ['diff', '--cached', '--name-status', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  const unstaged = spawnSync('git', ['diff', '--name-only', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  const untracked = spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (staged.status !== 0 && staged.status !== 1) {
    return {
      ok: false,
      message: 'unable to list staged candidate paths; git diff --cached failed',
    };
  }
  if (stagedStatus.status !== 0 && stagedStatus.status !== 1) {
    return {
      ok: false,
      message: 'unable to list staged candidate status; git diff --cached failed',
    };
  }
  const baselineIsCommit = baselineObject.status === 0 && (baselineObject.stdout ?? '').trim() === 'commit';
  if (unstaged.status !== 0 || untracked.status !== 0) {
    return {
      ok: false,
      message: 'unable to list candidate release paths; git verification failed',
    };
  }
  if (committed.status !== 0 && baselineIsCommit) {
    return {
      ok: false,
      message: 'unable to list candidate release paths; git verification failed',
    };
  }
  const committedPaths = baselineIsCommit
    ? normalizeGitNames(committed.stdout ?? '', /\r?\n/u)
    : [];
  const stagedPaths = normalizeGitNames(staged.stdout ?? '', /\r?\n/u);
  const unstagedPaths = normalizeGitNames(unstaged.stdout ?? '', /\r?\n/u);
  const untrackedPaths = normalizeGitNames(untracked.stdout ?? '', '\0');
  const all = [...new Set([...committedPaths, ...stagedPaths, ...unstagedPaths, ...untrackedPaths])].sort();
  return {
    ok: true,
    scope: {
      committed: committedPaths,
      staged: stagedPaths,
      stagedStatus: normalizeGitNames(stagedStatus.stdout ?? '', /\r?\n/u),
      unstaged: unstagedPaths,
      untracked: untrackedPaths,
      all,
    },
  };
}

export function listCandidateDiffPaths(
  repoRoot: string,
  baselineCommit: string
): { ok: true; paths: string[] } | { ok: false; message: string } {
  const inspected = inspectCandidateGitScope(repoRoot, baselineCommit);
  if (!inspected.ok) return inspected;
  return { ok: true, paths: inspected.scope.all };
}

export function assertReviewCandidateFrozen(
  repoRoot: string
): { ok: true } | { ok: false; message: string } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (head.status !== 0) {
    return { ok: false, message: 'review candidate is not ready; unable to read HEAD' };
  }
  const inspected = inspectCandidateGitScope(repoRoot, (head.stdout ?? '').trim() || 'HEAD');
  if (!inspected.ok) return inspected;
  const dirty = [
    ...inspected.scope.staged,
    ...inspected.scope.unstaged,
    ...inspected.scope.untracked,
  ].filter((relative) => {
    const normalized = relative.replace(/\\/g, '/');
    return !(
      normalized === 'docs_private/automation' ||
      normalized.startsWith('docs_private/automation/')
    );
  });
  if (dirty.length > 0) {
    return {
      ok: false,
      message: `review candidate is not ready; staged/unstaged/untracked product files exist: ${[...new Set(dirty)].sort().join(', ')}`,
    };
  }
  return { ok: true };
}

export function assertReleaseDiffExcludesForbiddenPaths(
  repoRoot: string,
  baselineCommit: string
): { ok: true; paths: string[] } | { ok: false; message: string } {
  const listed = listCandidateDiffPaths(repoRoot, baselineCommit);
  if (!listed.ok) return listed;
  const leakedAutomation = listed.paths.filter((relative) =>
    relative.startsWith(FORBIDDEN_AUTOMATION_PREFIX)
  );
  if (leakedAutomation.length > 0) {
    return {
      ok: false,
      message: `candidate diff includes forbidden paths: ${leakedAutomation.join(', ')}`,
    };
  }
  const scheduling = listed.paths.filter((relative) => isSchedulingProductPath(relative));
  const workflowRuntime = listed.paths.filter((relative) => isWorkflowRuntimePath(relative));
  if (scheduling.length > 0 && workflowRuntime.length > 0) {
    return {
      ok: false,
      message: `candidate diff mixes workflow-runtime and unrelated scheduling product paths: ${[...workflowRuntime, ...scheduling].join(', ')}`,
    };
  }
  return { ok: true, paths: listed.paths };
}

export function hashCanonicalWorkflowSuiteManifest(
  manifest: CanonicalWorkflowSuiteManifest = loadCanonicalWorkflowSuiteManifest()
): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      files: [...manifest.files].sort(),
    })
  );
}

function workstreamEvidenceDirectory(repoRoot: string, workstreamId: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'workstreams', workstreamId);
}

export function assertTrustedWorkstreamEvidencePath(params: {
  repoRoot: string;
  workstreamId: string;
  candidatePath: string;
}): { ok: true; absolutePath: string; relativePath: string } | { ok: false; message: string } {
  if (!params.workstreamId || /[^A-Za-z0-9_-]/u.test(params.workstreamId)) {
    return { ok: false, message: 'workstreamId is not a valid evidence directory name' };
  }
  const repoRoot = path.resolve(params.repoRoot);
  const absolute = path.resolve(
    path.isAbsolute(params.candidatePath)
      ? params.candidatePath
      : path.join(repoRoot, params.candidatePath)
  );
  if (
    pathHasExistingSymlinkComponent(absolute) ||
    pathHasExistingSymlinkComponent(path.dirname(absolute))
  ) {
    return { ok: false, message: 'verification evidence path must not contain symlinks' };
  }
  const relative = posixRelative(repoRoot, absolute);
  if (typeof relative === 'object') return { ok: false, message: relative.error };
  const expectedPrefix = `docs_private/automation/workstreams/${params.workstreamId}/`;
  if (!relative.startsWith(expectedPrefix) || relative.includes('..')) {
    return {
      ok: false,
      message: 'verification evidence must stay under the workstream automation directory',
    };
  }
  const base = path.basename(relative);
  if (!/^(verification-ledger|verification-reporter)-[0-9a-f]{64}\.json$/u.test(base)) {
    return { ok: false, message: 'verification evidence filename is not content-addressed' };
  }
  return { ok: true, absolutePath: absolute, relativePath: relative };
}

function parseStatus(value: unknown): VerificationTestStatus {
  if (value === 'passed' || value === 'failed' || value === 'skipped' || value === 'todo') {
    return value;
  }
  if (value === 'pending' || value === 'disabled') return 'pending';
  return 'unknown';
}

export function parseVitestJsonReporter(raw: Buffer): {
  ok: true;
  success: boolean;
  startTime: number | null;
  tests: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }>;
} | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, message: 'vitest JSON reporter output is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'vitest JSON reporter output is not an object' };
  }
  const report = parsed as JsonObject;
  if (typeof report.success !== 'boolean') {
    return { ok: false, message: 'vitest JSON reporter is missing success' };
  }
  if (!Array.isArray(report.testResults)) {
    return { ok: false, message: 'vitest JSON reporter is missing testResults' };
  }
  const tests: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }> = [];
  for (const fileEntry of report.testResults) {
    if (!fileEntry || typeof fileEntry !== 'object' || Array.isArray(fileEntry)) {
      return { ok: false, message: 'vitest JSON reporter file entry is malformed' };
    }
    const file = fileEntry as JsonObject;
    if (typeof file.name !== 'string' || !file.name) {
      return { ok: false, message: 'vitest JSON reporter file name is missing' };
    }
    if (!Array.isArray(file.assertionResults)) {
      return { ok: false, message: `vitest JSON reporter assertions missing for ${file.name}` };
    }
    for (const assertion of file.assertionResults) {
      if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
        return { ok: false, message: `vitest JSON reporter assertion is malformed in ${file.name}` };
      }
      const row = assertion as JsonObject;
      if (typeof row.title !== 'string' || typeof row.fullName !== 'string') {
        return { ok: false, message: `vitest JSON reporter assertion identity is missing in ${file.name}` };
      }
      const status = parseStatus(row.status);
      if (status === 'unknown') {
        return {
          ok: false,
          message: `unrecognised vitest assertion status in ${file.name}: ${String(row.status)}`,
        };
      }
      tests.push({
        file: file.name.replace(/\\/g, '/'),
        fullName: row.fullName,
        title: row.title,
        status,
      });
    }
  }
  return {
    ok: true,
    success: report.success,
    startTime: typeof report.startTime === 'number' ? report.startTime : null,
    tests,
  };
}

function remapReporterTests(
  repoRoot: string,
  tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }>
):
  | { ok: true; tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }> }
  | { ok: false; message: string } {
  const remapped: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }> = [];
  for (const test of tests) {
    const absolute = path.isAbsolute(test.file) ? test.file : path.join(repoRoot, test.file);
    const relative = posixRelative(repoRoot, absolute);
    if (typeof relative === 'object') return { ok: false, message: relative.error };
    if (relative.includes('\\') || path.isAbsolute(relative) || relative.startsWith('..')) {
      return { ok: false, message: `executed test file is not repo-relative: ${relative}` };
    }
    remapped.push({ ...test, file: relative });
  }
  return { ok: true, tests: remapped };
}

export function projectExecutedTestsFromReporter(params: {
  repoRoot: string;
  reporterRaw: Buffer;
  requiredIds: string[];
}):
  | { ok: true; executedTests: VerificationLedgerExecutedTest[]; reporterSuccess: boolean }
  | { ok: false; message: string } {
  const parsed = parseVitestJsonReporter(params.reporterRaw);
  if (!parsed.ok) return parsed;
  const remapped = remapReporterTests(params.repoRoot, parsed.tests);
  if (!remapped.ok) return remapped;
  const mapped = mapCanonicalIds({ tests: remapped.tests, requiredIds: params.requiredIds });
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    executedTests: mapped.executedTests,
    reporterSuccess: parsed.success,
  };
}

function mapCanonicalIds(params: {
  tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }>;
  requiredIds: string[];
}):
  | { ok: true; executedTests: VerificationLedgerExecutedTest[] }
  | { ok: false; message: string } {
  const requiredCaseIds = params.requiredIds.filter(
    (id) => requiredTestProofKind(id) === 'vitest_case'
  );
  const matchesById = new Map<string, number[]>();
  for (const id of requiredCaseIds) {
    matchesById.set(id, []);
  }
  const executedTests: VerificationLedgerExecutedTest[] = params.tests.map((test, index) => {
    const matchedIds = requiredCaseIds.filter(
      (id) =>
        titleContainsExactRequiredId(test.fullName, id) ||
        titleContainsExactRequiredId(test.title, id)
    );
    for (const id of matchedIds) {
      matchesById.get(id)?.push(index);
    }
    return {
      canonicalId: matchedIds.length === 1 ? matchedIds[0]! : null,
      file: test.file,
      fullName: test.fullName,
      title: test.title,
      status: test.status,
    };
  });
  for (const [id, indexes] of matchesById) {
    if (indexes.length > 1) {
      return {
        ok: false,
        message: `required test ID ${id} maps to multiple assertions; fail closed`,
      };
    }
    if (indexes.length === 1) {
      executedTests[indexes[0]!]!.canonicalId = id;
    }
  }
  return { ok: true, executedTests };
}

function captureCandidateIdentity(
  repoRoot: string,
  git?: GitCommandRunner
): { ok: true; headCommit: string; productTreeFingerprint: string } | { ok: false; message: string } {
  const headCommit = gitHeadCommit(repoRoot, git);
  if (!headCommit || !SHA_RE.test(headCommit)) {
    return { ok: false, message: 'unable to read git HEAD for verification ledger binding' };
  }
  const fingerprint = computeWorkingTreeProductFingerprint(repoRoot, git);
  if (typeof fingerprint === 'object') {
    return { ok: false, message: fingerprint.error };
  }
  return { ok: true, headCommit, productTreeFingerprint: fingerprint };
}

function ledgerBody(record: Omit<VerificationLedgerRecord, 'contentHash'>): string {
  return canonicalJson(record);
}

export function hashVerificationLedgerBody(
  record: Omit<VerificationLedgerRecord, 'contentHash'>
): string {
  return sha256Hex(ledgerBody(record));
}

export function deriveTrustedReporterExitCode(params: {
  reporterRaw: Buffer;
  processExitCode: number;
  processTermination?: VerificationProcessTermination;
}): { ok: true; exitCode: number; processTermination: VerificationProcessTermination } | { ok: false; message: string } {
  const parsed = parseVitestJsonReporter(params.reporterRaw);
  if (!parsed.ok) return parsed;
  if (!isIntegerProcessExitCode(params.processExitCode)) {
    return { ok: false, message: 'verification process exitCode is not an integer process status' };
  }
  const processTermination =
    params.processTermination ??
    ({ kind: 'exit', exitCode: params.processExitCode, signal: null } satisfies VerificationProcessTermination);
  // Honest process status: reporter success must not rewrite a non-zero exit into 0.
  return { ok: true, exitCode: params.processExitCode, processTermination };
}

export function persistVerificationLedgerFromReporterFile(params: {
  repoRoot: string;
  workstreamId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  processTermination?: VerificationProcessTermination;
  runnerName: string;
  runnerVersion: string;
  reporterAbsolutePath: string;
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
  git?: GitCommandRunner;
  beforeIdentity: { headCommit: string; productTreeFingerprint: string };
  afterIdentity: { headCommit: string; productTreeFingerprint: string };
}):
  | {
      ok: true;
      record: VerificationLedgerRecord;
      reference: VerificationLedgerReference;
    }
  | { ok: false; message: string } {
  if (params.beforeIdentity.headCommit !== params.afterIdentity.headCommit) {
    return { ok: false, message: 'git HEAD moved during verification; ledger is unbound' };
  }
  if (params.beforeIdentity.productTreeFingerprint !== params.afterIdentity.productTreeFingerprint) {
    return {
      ok: false,
      message: 'product tree fingerprint moved during verification; ledger is unbound',
    };
  }
  if (
    !SHA_RE.test(params.beforeIdentity.headCommit) ||
    !SHA256_RE.test(params.beforeIdentity.productTreeFingerprint)
  ) {
    return { ok: false, message: 'verification identity is malformed' };
  }
  if (!existsSync(params.reporterAbsolutePath)) {
    return { ok: false, message: 'vitest JSON reporter output is missing' };
  }
  const raw = readFileSync(params.reporterAbsolutePath);
  const mappedRequiredIds = [...(params.requiredIds ?? [])].sort();
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.repoRoot,
    reporterRaw: raw,
    requiredIds: mappedRequiredIds,
  });
  if (!projected.ok) return projected;
  const trustedExit = deriveTrustedReporterExitCode({
    reporterRaw: raw,
    processExitCode: params.exitCode,
    processTermination: params.processTermination,
  });
  if (!trustedExit.ok) return trustedExit;
  const reporterOutputHash = sha256Hex(raw);
  const runId = randomBytes(8).toString('hex');
  const draft: Omit<VerificationLedgerRecord, 'contentHash'> = {
    schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
    runId,
    commandId: params.commandId,
    commandType: params.commandType,
    command: params.command,
    args: [...params.args],
    cwd: params.cwd,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    exitCode: trustedExit.exitCode,
    processTermination: trustedExit.processTermination,
    headCommit: params.beforeIdentity.headCommit,
    productTreeFingerprint: params.beforeIdentity.productTreeFingerprint,
    runnerName: params.runnerName,
    runnerVersion: params.runnerVersion,
    reporterOutputHash,
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    mappedRequiredIds,
    executedTests: projected.executedTests,
  };
  const contentHash = hashVerificationLedgerBody(draft);
  const record: VerificationLedgerRecord = { ...draft, contentHash };
  const relativeLedger = `docs_private/automation/workstreams/${params.workstreamId}/verification-ledger-${contentHash}.json`;
  const relativeReporter = `docs_private/automation/workstreams/${params.workstreamId}/verification-reporter-${reporterOutputHash}.json`;
  const ledgerPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: relativeLedger,
  });
  const reporterPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: relativeReporter,
  });
  if (!ledgerPath.ok) return ledgerPath;
  if (!reporterPath.ok) return reporterPath;
  if (params.persist !== false) {
    mkdirSync(workstreamEvidenceDirectory(params.repoRoot, params.workstreamId), {
      recursive: true,
    });
    writeFileSync(reporterPath.absolutePath, raw);
    writeJsonAtomic(ledgerPath.absolutePath, record);
  }
  return {
    ok: true,
    record,
    reference: {
      relativePath: ledgerPath.relativePath,
      contentHash,
      commandType: params.commandType,
      reporterRelativePath: reporterPath.relativePath,
      reporterOutputHash,
    },
  };
}

export function readAndValidateVerificationLedger(params: {
  repoRoot: string;
  workstreamId: string;
  relativePath: string;
  expectedFingerprint: string;
  expectedHeadCommit: string;
}):
  | { ok: true; record: VerificationLedgerRecord; reporterRaw: Buffer }
  | { ok: false; message: string } {
  const ledgerPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: params.relativePath,
  });
  if (!ledgerPath.ok) return ledgerPath;
  if (!existsSync(ledgerPath.absolutePath)) {
    return { ok: false, message: `verification ledger missing: ${params.relativePath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ledgerPath.absolutePath, 'utf8'));
  } catch {
    return { ok: false, message: 'verification ledger is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'verification ledger is malformed' };
  }
  const row = parsed as JsonObject;
  if (row.schemaVersion !== VERIFICATION_LEDGER_SCHEMA_VERSION) {
    return { ok: false, message: 'verification ledger schemaVersion is unsupported' };
  }
  if (typeof row.contentHash !== 'string' || !SHA256_RE.test(row.contentHash)) {
    return { ok: false, message: 'verification ledger contentHash is missing' };
  }
  const expectedName = `verification-ledger-${row.contentHash}.json`;
  if (path.basename(ledgerPath.relativePath) !== expectedName) {
    return { ok: false, message: 'verification ledger filename does not match contentHash' };
  }
  const { contentHash: _ignored, ...body } = row;
  const recomputed = hashVerificationLedgerBody(
    body as Omit<VerificationLedgerRecord, 'contentHash'>
  );
  if (recomputed !== row.contentHash) {
    return { ok: false, message: 'verification ledger contentHash does not match canonical body' };
  }
  if (typeof row.reporterOutputHash !== 'string' || !SHA256_RE.test(row.reporterOutputHash)) {
    return { ok: false, message: 'verification ledger reporterOutputHash is missing' };
  }
  const reporterRelative = `docs_private/automation/workstreams/${params.workstreamId}/verification-reporter-${row.reporterOutputHash}.json`;
  const reporterPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: reporterRelative,
  });
  if (!reporterPath.ok) return reporterPath;
  if (!existsSync(reporterPath.absolutePath)) {
    return { ok: false, message: 'verification reporter projection is missing' };
  }
  const reporterRaw = readFileSync(reporterPath.absolutePath);
  if (sha256Hex(reporterRaw) !== row.reporterOutputHash) {
    return { ok: false, message: 'verification reporter projection hash mismatch' };
  }
  if (row.headCommit !== params.expectedHeadCommit) {
    return { ok: false, message: 'verification ledger HEAD does not match the candidate tree' };
  }
  if (row.productTreeFingerprint !== params.expectedFingerprint) {
    return {
      ok: false,
      message: 'verification ledger product fingerprint does not match the candidate tree',
    };
  }
  if (!isIntegerProcessExitCode(row.exitCode)) {
    return { ok: false, message: 'verification ledger exitCode is not an integer process status' };
  }
  const parsedRecord = parsed as VerificationLedgerRecord;
  const termination = assertProcessTerminationConsistent(parsedRecord);
  if (!termination.ok) return termination;
  if (!Array.isArray(row.executedTests)) {
    return { ok: false, message: 'verification ledger executedTests is missing' };
  }
  if (!Array.isArray(row.mappedRequiredIds) || row.mappedRequiredIds.some((id) => typeof id !== 'string')) {
    return { ok: false, message: 'verification ledger mappedRequiredIds is missing' };
  }
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.repoRoot,
    reporterRaw,
    requiredIds: row.mappedRequiredIds as string[],
  });
  if (!projected.ok) return projected;
  if (canonicalJson(projected.executedTests) !== canonicalJson(row.executedTests)) {
    return {
      ok: false,
      message: 'verification ledger executedTests does not match the reporter projection',
    };
  }
  const integrity = assertLedgerIntegrity(parsedRecord);
  if (!integrity.ok) return integrity;
  return { ok: true, record: parsedRecord, reporterRaw };
}

export function proveCanonicalWorkflowSuite(params: {
  record: VerificationLedgerRecord;
  reporterSuccess: boolean;
  manifest?: CanonicalWorkflowSuiteManifest;
}): { ok: true } | { ok: false; message: string } {
  const manifest = params.manifest ?? loadCanonicalWorkflowSuiteManifest();
  const expectedHash = hashCanonicalWorkflowSuiteManifest(manifest);
  if (params.record.expectedSuiteManifestHash !== expectedHash) {
    return { ok: false, message: 'canonical suite manifest hash is missing or mismatched' };
  }
  if (params.record.commandType !== 'vitest_suite') {
    return { ok: false, message: 'canonical suite proof requires commandType vitest_suite' };
  }
  const processOutcome = processOutcomeIsProofEligible(params.record);
  if (!processOutcome.ok) return processOutcome;
  if (params.reporterSuccess !== true) {
    return { ok: false, message: 'canonical suite run did not succeed' };
  }
  if (params.record.executedTests.length === 0) {
    return { ok: false, message: 'canonical suite selected zero tests' };
  }
  const actualFiles = [...new Set(params.record.executedTests.map((test) => test.file))].sort();
  const expectedFiles = [...manifest.files].sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    return {
      ok: false,
      message: 'executed file set does not equal the canonical workflow suite manifest',
    };
  }
  for (const file of expectedFiles) {
    const assertions = params.record.executedTests.filter((test) => test.file === file);
    if (assertions.length === 0) {
      return { ok: false, message: `canonical suite file produced no assertions: ${file}` };
    }
    if (!assertions.some((test) => test.status === 'passed')) {
      return { ok: false, message: `canonical suite file has no passed assertion: ${file}` };
    }
    if (assertions.some((test) => test.status === 'failed' || test.status === 'unknown')) {
      return { ok: false, message: `canonical suite file is not fully successful: ${file}` };
    }
  }
  return { ok: true };
}

export function provenVitestCaseIds(params: {
  records: VerificationLedgerRecord[];
  requiredIds: string[];
}): ProvenRequiredTests | ProvenRequiredTestsFailure {
  // Mapper only. Callers that grant release/review proof MUST first apply
  // verificationRunIsProofEligible to every contributing record.
  const requiredCaseIds = params.requiredIds.filter(
    (id) => requiredTestProofKind(id) === 'vitest_case'
  );
  const proven = new Set<string>();
  for (const id of requiredCaseIds) {
    const matches: VerificationLedgerExecutedTest[] = [];
    for (const record of params.records) {
      for (const test of record.executedTests) {
        const identity = `${test.fullName}\n${test.title}`;
        if (titleContainsExactRequiredId(identity, id) || test.canonicalId === id) {
          matches.push(test);
        }
      }
    }
    const uniqueAssertions = [
      ...new Map(matches.map((test) => [`${test.file}::${test.fullName}`, test])).values(),
    ];
    if (uniqueAssertions.length > 1) {
      return {
        ok: false,
        message: `required test ID ${id} maps to multiple assertions; fail closed`,
        provenIds: [...proven].sort(),
        suiteProven: false,
      };
    }
    const only = uniqueAssertions[0];
    if (only && only.status === 'passed') {
      proven.add(id);
    }
  }
  return { ok: true, provenIds: [...proven].sort(), suiteProven: false };
}

export function requiredTestIdsForBlocker(blockerId: string): string[] {
  const mapped = BLOCKER_REQUIRED_TEST_IDS[blockerId];
  if (mapped && mapped.length > 0) return [...mapped];
  return [blockerId];
}

export function installedVitestVersion(repoRoot: string): string | { error: string } {
  const packagePath = path.join(repoRoot, 'node_modules', 'vitest', 'package.json');
  if (!existsSync(packagePath)) {
    return { error: 'installed vitest package.json is missing' };
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    if (typeof parsed.version !== 'string' || !parsed.version) {
      return { error: 'installed vitest version is missing' };
    }
    return parsed.version;
  } catch {
    return { error: 'installed vitest package.json is unreadable' };
  }
}

export function resolveVitestExecutable(repoRoot: string): string | { error: string } {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    path.join(repoRoot, 'node_modules', 'vitest', 'dist', 'cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return { error: 'installed vitest CLI is missing' };
}

export function captureVerificationIdentity(
  repoRoot: string,
  git?: GitCommandRunner
): { ok: true; headCommit: string; productTreeFingerprint: string } | { ok: false; message: string } {
  return captureCandidateIdentity(repoRoot, git);
}

type VitestLedgerRunParams = {
  repoRoot: string;
  workstreamId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  files: string[];
  extraArgs?: string[];
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
  git?: GitCommandRunner;
  vitestInstallRoot?: string;
  onTestProgress?: (event: TestSuiteProgressEvent) => void;
};

type VitestLedgerRunResult =
  | {
      ok: true;
      record: VerificationLedgerRecord;
      reference: VerificationLedgerReference;
      reporterSuccess: boolean;
    }
  | { ok: false; message: string };

const VITEST_PROGRESS_REPORTER = fileURLToPath(
  new URL('./workflow-vitest-progress-reporter.cjs', import.meta.url)
);

function prepareVitestLedgerRun(params: VitestLedgerRunParams):
  | {
      ok: true;
      before: { headCommit: string; productTreeFingerprint: string };
      runnerVersion: string;
      reporterTemp: string;
      args: string[];
      childEnv: NodeJS.ProcessEnv;
    }
  | { ok: false; message: string } {
  const before = captureCandidateIdentity(params.repoRoot, params.git);
  if (!before.ok) return before;
  const installRoot = params.vitestInstallRoot ?? params.repoRoot;
  const vitestPath = resolveVitestExecutable(installRoot);
  if (typeof vitestPath === 'object') return { ok: false, message: vitestPath.error };
  const runnerVersion = installedVitestVersion(installRoot);
  if (typeof runnerVersion === 'object') return { ok: false, message: runnerVersion.error };
  const runToken = randomBytes(8).toString('hex');
  const outputDir =
    params.persist === false
      ? mkdtempSync(path.join(tmpdir(), 'ffts-verification-ledger-'))
      : workstreamEvidenceDirectory(params.repoRoot, params.workstreamId);
  if (params.persist !== false) {
    mkdirSync(outputDir, { recursive: true });
  }
  const reporterTemp = path.join(outputDir, `verification-reporter-temp-${runToken}.json`);
  const extraArgs = resolveVitestLedgerExtraArgs(params.commandType, params.extraArgs ?? []);
  const args = [
    vitestPath,
    'run',
    ...params.files,
    '--reporter=json',
    `--outputFile=${reporterTemp}`,
    '--passWithNoTests=false',
    '--globals',
    '--no-cache',
    ...(existsSync(path.join(params.repoRoot, 'vitest.workspace.ts'))
      ? ['--project=integration']
      : []),
    ...extraArgs,
  ];
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key === 'VITEST' || key.startsWith('VITEST_') || key.startsWith('VITE_TEST')) {
      delete childEnv[key];
    }
  }
  return { ok: true, before, runnerVersion, reporterTemp, args, childEnv };
}

function finishVitestLedgerRun(params: {
  run: VitestLedgerRunParams;
  before: { headCommit: string; productTreeFingerprint: string };
  runnerVersion: string;
  reporterTemp: string;
  args: string[];
  startedAt: string;
  completedAt: string;
  result: {
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  };
}): VitestLedgerRunResult {
  const after = captureCandidateIdentity(params.run.repoRoot, params.run.git);
  if (!after.ok) return after;
  if (params.result.error) {
    return { ok: false, message: `vitest spawn failed: ${params.result.error.message}` };
  }
  const processTermination = classifySpawnSyncTermination(params.result);
  if (processTermination.kind !== 'exit') {
    return {
      ok: false,
      message: `vitest process ${processTermination.kind} is not proof-eligible`,
    };
  }
  const persisted = persistVerificationLedgerFromReporterFile({
    repoRoot: params.run.repoRoot,
    workstreamId: params.run.workstreamId,
    commandId: params.run.commandId,
    commandType: params.run.commandType,
    command: process.execPath,
    args: params.args,
    cwd: params.run.repoRoot,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    exitCode: processTermination.exitCode ?? 1,
    processTermination,
    runnerName: 'vitest',
    runnerVersion: params.runnerVersion,
    reporterAbsolutePath: params.reporterTemp,
    requiredIds: params.run.requiredIds,
    expectedSuiteManifestHash:
      params.run.expectedSuiteManifestHash ??
      (params.run.commandType === 'vitest_suite' ? hashCanonicalWorkflowSuiteManifest() : undefined),
    persist: params.run.persist,
    git: params.run.git,
    beforeIdentity: params.before,
    afterIdentity: after,
  });
  const reporterRaw = existsSync(params.reporterTemp) ? readFileSync(params.reporterTemp) : null;
  if (existsSync(params.reporterTemp)) {
    try {
      unlinkSync(params.reporterTemp);
    } catch {
      /* the hashed reporter copy is the durable artifact */
    }
  }
  if (!persisted.ok) return persisted;
  const parsed = parseVitestJsonReporter(
    params.run.persist === false
      ? reporterRaw ?? Buffer.alloc(0)
      : readFileSync(path.join(params.run.repoRoot, persisted.reference.reporterRelativePath))
  );
  return {
    ...persisted,
    reporterSuccess: parsed.ok ? parsed.success : false,
  };
}

export function runVitestJsonAndPersistLedger(params: {
  repoRoot: string;
  workstreamId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  files: string[];
  extraArgs?: string[];
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
  git?: GitCommandRunner;
  spawn?: typeof spawnSync;
  vitestInstallRoot?: string;
}): VitestLedgerRunResult {
  const prepared = prepareVitestLedgerRun(params);
  if (!prepared.ok) return prepared;
  const startedAt = new Date().toISOString();
  const spawnImpl = params.spawn ?? spawnSync;
  const result = spawnImpl(process.execPath, prepared.args, {
    cwd: params.repoRoot,
    encoding: 'utf8',
    shell: false,
    env: prepared.childEnv,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return finishVitestLedgerRun({
    run: params,
    before: prepared.before,
    runnerVersion: prepared.runnerVersion,
    reporterTemp: prepared.reporterTemp,
    args: prepared.args,
    startedAt,
    completedAt: new Date().toISOString(),
    result,
  });
}

export async function runVitestJsonAndPersistLedgerAsync(
  params: VitestLedgerRunParams
): Promise<VitestLedgerRunResult> {
  const prepared = prepareVitestLedgerRun(params);
  if (!prepared.ok) return prepared;
  const startedAt = new Date().toISOString();
  const progressTemp =
    params.onTestProgress != null
      ? path.join(tmpdir(), `ffts-vitest-progress-${randomBytes(8).toString('hex')}.ndjson`)
      : null;
  const childEnv = { ...prepared.childEnv };
  const spawnArgs = [...prepared.args];
  if (progressTemp) {
    childEnv.TEE_VITEST_PROGRESS_FILE = progressTemp;
    spawnArgs.push(`--reporter=${VITEST_PROGRESS_REPORTER}`);
    writeFileSync(progressTemp, '', 'utf8');
  }
  const result = await new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>((resolve) => {
    const child = spawn(process.execPath, spawnArgs, {
      cwd: params.repoRoot,
      env: childEnv,
      shell: false,
      windowsHide: true,
    });
    let seenProgressLines = 0;
    const drain = (): void => {
      if (!progressTemp || !params.onTestProgress) return;
      seenProgressLines = consumeVitestProgressFile(progressTemp, seenProgressLines, params.onTestProgress);
    };
    const timer = progressTemp ? setInterval(drain, 200) : null;
    timer?.unref?.();
    child.stdout?.resume();
    child.stderr?.resume();
    child.on('error', (error) => {
      if (timer) clearInterval(timer);
      drain();
      resolve({ status: null, signal: null, error });
    });
    child.on('close', (code, signal) => {
      if (timer) clearInterval(timer);
      drain();
      resolve({
        status: typeof code === 'number' ? code : null,
        signal: signal ?? null,
      });
    });
  });
  if (progressTemp) {
    try {
      unlinkSync(progressTemp);
    } catch {
      /* display sidecar */
    }
  }
  return finishVitestLedgerRun({
    run: params,
    before: prepared.before,
    runnerVersion: prepared.runnerVersion,
    reporterTemp: prepared.reporterTemp,
    args: prepared.args,
    startedAt,
    completedAt: new Date().toISOString(),
    result,
  });
}
