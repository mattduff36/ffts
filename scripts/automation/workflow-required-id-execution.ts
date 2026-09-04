import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import {
  loadCanonicalV24RequiredTestIds,
  loadCanonicalWorkflowSuiteManifest,
  provenVitestCaseIds,
  requiredTestProofKind,
  runVitestJsonAndPersistLedgerAsync,
  titleContainsExactRequiredId,
  verificationRunIsProofEligible,
  type VerificationLedgerRecord,
  type VerificationLedgerReference,
} from './workflow-verification-ledger';
import type { EvidenceCommandResult } from './workflow-evidence-manifest';
import type { VerifyCandidate } from './workflow-verify-runner';
import type { VerifyProgressReporter } from './workflow-verify-progress';

export const TRUSTED_REQUIRED_ID_TEST_ROOTS = ['tests', 'testsuite'] as const;
export const LEFTOVER_REQUIRED_TESTS_COMMAND = 'required-tests-leftover';
export const LEFTOVER_COMMAND_ID = 'preflight-leftover-required-tests';

const TITLE_CALL_RE =
  /(?:^|[^\w$])((?:it|test|describe)(?:\.(?:skip|only|todo|concurrent|fails))*)\(\s*(['"`])((?:\\.|[^\n])*?)\2/gmu;
const SKIP_WALK_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage']);
const TESTSUITE_API_VITEST_CONFIG = 'testsuite/config/vitest.config.ts';

export type LeftoverExecutionMode = 'none' | 'serial' | 'bounded-parallel';

export interface RequiredIdOwner {
  id: string;
  file: string;
  title: string;
  kind: 'assertion' | 'describe';
}

export type RequiredIdDiscovery =
  | { ok: true; leftoverIds: string[]; owners: RequiredIdOwner[]; files: string[] }
  | {
      ok: false;
      code: 'missing_owner' | 'ambiguous_owner';
      message: string;
      leftoverIds: string[];
      ids: string[];
      files: string[];
    };

export type LeftoverVitestRunResult =
  | {
      ok: true;
      record: VerificationLedgerRecord;
      reference: VerificationLedgerReference;
    }
  | { ok: false; message: string };

export type LeftoverVitestRunner = (params: {
  repoRoot: string;
  workstreamId: string;
  files: string[];
  requiredIds: string[];
  extraArgs: string[];
  vitestProject?: string | false;
  configFile?: string;
}) => Promise<LeftoverVitestRunResult> | LeftoverVitestRunResult;

export type LeftoverIsolation = 'uncertain' | 'proven';

export type LeftoverVitestRunOptions =
  | { ok: true; vitestProject?: string | false; configFile?: string }
  | { ok: false; message: string };

export interface LeftoverExecutionResult {
  ok: boolean;
  launchedProcess: boolean;
  leftoverIds: string[];
  files: string[];
  completedIds: string[];
  mode: LeftoverExecutionMode;
  command?: EvidenceCommandResult;
  verificationLedgerRefs: VerificationLedgerReference[];
  message?: string;
  maxConcurrent: number;
}

function posixRelative(repoRoot: string, absolutePath: string): string | null {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(absolutePath)).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function isTrustedTestFile(relativePosix: string): boolean {
  return (
    TRUSTED_REQUIRED_ID_TEST_ROOTS.some(
      (root) => relativePosix === root || relativePosix.startsWith(`${root}/`)
    ) && /\.(test|spec)\.(ts|tsx|js|mjs)$/u.test(relativePosix)
  );
}

function extractTitledCalls(source: string): Array<{ kind: 'assertion' | 'describe'; title: string }> {
  const found: Array<{ kind: 'assertion' | 'describe'; title: string }> = [];
  TITLE_CALL_RE.lastIndex = 0;
  for (const match of source.matchAll(TITLE_CALL_RE)) {
    const callee = match[1] ?? '';
    const title = (match[3] ?? '').replace(/\\(['"`])/gu, '$1');
    if (!title) continue;
    found.push({
      kind: callee.startsWith('describe') ? 'describe' : 'assertion',
      title,
    });
  }
  return found;
}

export function resolvePreflightExecutionRequiredIds(planOrUnionIds: readonly string[]): string[] {
  const ids = [...planOrUnionIds];
  if (ids.includes('TEE-V24-VERIFY-MANIFEST-001')) {
    return [...new Set([...ids, ...loadCanonicalV24RequiredTestIds()])].sort();
  }
  return [...new Set(ids)].sort();
}

export function leftoverRequiredCaseIds(params: {
  requiredIds: readonly string[];
  completedIds: readonly string[];
}): string[] {
  const completed = new Set(params.completedIds);
  return params.requiredIds.filter(
    (id) => requiredTestProofKind(id) === 'vitest_case' && !completed.has(id)
  );
}

export function listTrustedRequiredIdTestFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.' && SKIP_WALK_DIRS.has(entry.name)) {
        continue;
      }
      if (SKIP_WALK_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = posixRelative(repoRoot, full);
      if (!relative || !isTrustedTestFile(relative)) continue;
      files.push(relative);
    }
  };
  for (const root of TRUSTED_REQUIRED_ID_TEST_ROOTS) {
    const absolute = path.join(repoRoot, root);
    if (existsSync(absolute)) walk(absolute);
  }
  return [...new Set(files)].sort();
}

export function discoverRequiredIdOwners(params: {
  repoRoot: string;
  ids: readonly string[];
}): RequiredIdDiscovery {
  const leftoverIds = [...params.ids];
  if (leftoverIds.length === 0) {
    return { ok: true, leftoverIds, owners: [], files: [] };
  }
  const matches = new Map<string, RequiredIdOwner[]>();
  for (const id of leftoverIds) matches.set(id, []);

  for (const relative of listTrustedRequiredIdTestFiles(params.repoRoot)) {
    let source = '';
    try {
      source = readFileSync(path.join(params.repoRoot, relative), 'utf8');
    } catch {
      continue;
    }
    const titles = extractTitledCalls(source);
    for (const id of leftoverIds) {
      const assertionHits = titles.filter(
        (row) => row.kind === 'assertion' && titleContainsExactRequiredId(row.title, id)
      );
      const describeHits =
        assertionHits.length > 0
          ? []
          : titles.filter(
              (row) => row.kind === 'describe' && titleContainsExactRequiredId(row.title, id)
            );
      for (const hit of assertionHits.length > 0 ? assertionHits : describeHits) {
        matches.get(id)?.push({
          id,
          file: relative,
          title: hit.title,
          kind: hit.kind,
        });
      }
    }
  }

  const missing: string[] = [];
  const ambiguous: string[] = [];
  const owners: RequiredIdOwner[] = [];
  for (const id of leftoverIds) {
    const hits = matches.get(id) ?? [];
    const unique = [
      ...new Map(hits.map((hit) => [`${hit.file}::${hit.kind}::${hit.title}`, hit])).values(),
    ];
    if (unique.length === 0) {
      missing.push(id);
      continue;
    }
    const files = new Set(unique.map((hit) => hit.file));
    if (unique.length > 1 || files.size > 1) {
      ambiguous.push(id);
      continue;
    }
    owners.push(unique[0]!);
  }

  if (ambiguous.length > 0) {
    return {
      ok: false,
      code: 'ambiguous_owner',
      message: `required test ID ${ambiguous.join(', ')} maps to multiple assertions; fail closed`,
      leftoverIds,
      ids: ambiguous,
      files: [...new Set(owners.map((owner) => owner.file))].sort(),
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing_owner',
      message: `required IDs have no trusted test owner: ${missing.join(', ')}`,
      leftoverIds,
      ids: missing,
      files: [],
    };
  }
  return {
    ok: true,
    leftoverIds,
    owners,
    files: [...new Set(owners.map((owner) => owner.file))].sort(),
  };
}

export function filesForLeftoverExecution(params: {
  ownerFiles: readonly string[];
  canonicalSuiteFiles?: readonly string[];
}): string[] {
  const suite = new Set(
    (params.canonicalSuiteFiles ?? loadCanonicalWorkflowSuiteManifest().files).map((file) =>
      file.replace(/\\/g, '/')
    )
  );
  return params.ownerFiles.filter((file) => !suite.has(file.replace(/\\/g, '/')));
}

export function leftoverVitestRunOptions(file: string): LeftoverVitestRunOptions {
  const relative = file.replace(/\\/g, '/');
  if (relative.startsWith('testsuite/ui/') || /\.spec\.(ts|tsx|js|mjs)$/u.test(relative)) {
    return {
      ok: false,
      message: `required ID owner is Playwright and cannot be executed by leftover Vitest: ${relative}`,
    };
  }
  if (relative.startsWith('testsuite/api/') && relative.endsWith('.test.ts')) {
    return {
      ok: true,
      vitestProject: false,
      configFile: TESTSUITE_API_VITEST_CONFIG,
    };
  }
  if (relative.startsWith('tests/ui/')) {
    return { ok: true, vitestProject: 'ui' };
  }
  if (
    relative.startsWith('tests/unit/') ||
    relative.startsWith('tests/integration/') ||
    relative.startsWith('tests/regression/')
  ) {
    return { ok: true, vitestProject: 'integration' };
  }
  return {
    ok: false,
    message: `required ID owner is not leftover-executable: ${relative}`,
  };
}

export function selectLeftoverExecutionMode(params: {
  files: readonly string[];
  jobs: number;
  isolation?: LeftoverIsolation;
}): LeftoverExecutionMode {
  if (params.files.length === 0) return 'none';
  if (params.jobs <= 1 || params.files.length === 1 || params.isolation !== 'proven') {
    return 'serial';
  }
  return 'bounded-parallel';
}

function escapeTitleFilter(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function mapBound<T>(
  items: readonly T[],
  bound: number,
  worker: (item: T) => Promise<void>
): Promise<number> {
  const pending = new Set<Promise<void>>();
  let maxConcurrent = 0;
  for (const item of items) {
    const task = Promise.resolve()
      .then(() => worker(item))
      .finally(() => {
        pending.delete(task);
      });
    pending.add(task);
    maxConcurrent = Math.max(maxConcurrent, pending.size);
    if (pending.size >= Math.max(1, bound)) {
      await Promise.race(pending);
    }
  }
  await Promise.all(pending);
  return maxConcurrent;
}

function defaultLeftoverRunner(): LeftoverVitestRunner {
  return async (params) => {
    const persisted = await runVitestJsonAndPersistLedgerAsync({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      commandId: LEFTOVER_COMMAND_ID,
      commandType: 'vitest_case',
      files: params.files,
      extraArgs: params.extraArgs,
      requiredIds: params.requiredIds,
      vitestProject: params.vitestProject,
      configFile: params.configFile,
    });
    if (!persisted.ok) return persisted;
    return {
      ok: true,
      record: persisted.record,
      reference: persisted.reference,
    };
  };
}

function candidateFromReader(
  readCandidate: (() => VerifyCandidate | { drifted: true } | { error: string }) | undefined,
  fallback: VerifyCandidate
): VerifyCandidate | { drifted: true } | { error: string } {
  return readCandidate ? readCandidate() : fallback;
}

function candidatesEqual(left: VerifyCandidate, right: VerifyCandidate): boolean {
  return left.headCommit === right.headCommit && left.fingerprint === right.fingerprint;
}

export async function proveAndExecuteLeftoverRequiredIds(params: {
  repoRoot: string;
  workstreamId: string;
  requiredIds: readonly string[];
  completedIds: readonly string[];
  candidate: VerifyCandidate;
  jobs: number;
  progress?: VerifyProgressReporter;
  readCandidate?: () => VerifyCandidate | { drifted: true } | { error: string };
  runner?: LeftoverVitestRunner;
  canonicalSuiteFiles?: readonly string[];
  isolation?: LeftoverIsolation;
}): Promise<LeftoverExecutionResult> {
  const started = Date.now();
  const leftoverIds = leftoverRequiredCaseIds({
    requiredIds: params.requiredIds,
    completedIds: params.completedIds,
  });
  const empty = (): LeftoverExecutionResult => ({
    ok: true,
    launchedProcess: false,
    leftoverIds,
    files: [],
    completedIds: [],
    mode: 'none',
    verificationLedgerRefs: [],
    maxConcurrent: 0,
  });

  params.progress?.updateStage('required-id-discovery', {
    status: 'running',
    measure: 'count',
    completed: 0,
    total: leftoverIds.length,
  });

  if (leftoverIds.length === 0) {
    params.progress?.updateStage('required-id-discovery', {
      status: 'pass',
      measure: 'count',
      completed: 0,
      total: 0,
    });
    params.progress?.updateStage('leftover-tests', {
      status: 'pass',
      measure: 'count',
      completed: 0,
      total: 0,
    });
    return empty();
  }

  const discovered = discoverRequiredIdOwners({
    repoRoot: params.repoRoot,
    ids: leftoverIds,
  });
  if (!discovered.ok) {
    params.progress?.updateStage('required-id-discovery', {
      status: 'fail',
      measure: 'count',
      completed: leftoverIds.length - discovered.ids.length,
      total: leftoverIds.length,
    });
    params.progress?.updateStage('leftover-tests', {
      status: 'skipped',
      measure: 'count',
      completed: 0,
      total: leftoverIds.length,
    });
    return {
      ok: false,
      launchedProcess: false,
      leftoverIds,
      files: discovered.files,
      completedIds: [],
      mode: 'none',
      message: discovered.message,
      verificationLedgerRefs: [],
      maxConcurrent: 0,
      command: {
        name: LEFTOVER_REQUIRED_TESTS_COMMAND,
        status: 'failed',
        exitCode: 1,
        durationMs: Date.now() - started,
        summary: discovered.message,
        command: 'vitest run --reporter=json',
      },
    };
  }

  const files = filesForLeftoverExecution({
    ownerFiles: discovered.files,
    canonicalSuiteFiles: params.canonicalSuiteFiles,
  });
  params.progress?.updateStage('required-id-discovery', {
    status: 'pass',
    measure: 'count',
    completed: leftoverIds.length,
    total: leftoverIds.length,
  });

  const unsupported = files
    .map((file) => leftoverVitestRunOptions(file))
    .filter((row): row is Extract<LeftoverVitestRunOptions, { ok: false }> => !row.ok);
  if (unsupported.length > 0) {
    const message = unsupported[0]!.message;
    params.progress?.updateStage('leftover-tests', {
      status: 'fail',
      measure: 'count',
      completed: 0,
      total: leftoverIds.length,
    });
    return {
      ok: false,
      launchedProcess: false,
      leftoverIds,
      files,
      completedIds: [],
      mode: 'none',
      message,
      verificationLedgerRefs: [],
      maxConcurrent: 0,
      command: {
        name: LEFTOVER_REQUIRED_TESTS_COMMAND,
        status: 'failed',
        exitCode: 1,
        durationMs: Date.now() - started,
        summary: message,
        command: 'vitest run --reporter=json',
        files,
      },
    };
  }

  const mode = selectLeftoverExecutionMode({
    files,
    jobs: params.jobs,
    isolation: params.isolation,
  });
  if (mode === 'none') {
    params.progress?.updateStage('leftover-tests', {
      status: 'pass',
      measure: 'count',
      completed: 0,
      total: leftoverIds.length,
    });
    return {
      ok: true,
      launchedProcess: false,
      leftoverIds,
      files,
      completedIds: [],
      mode,
      verificationLedgerRefs: [],
      maxConcurrent: 0,
    };
  }

  params.progress?.updateStage('leftover-tests', {
    status: 'running',
    measure: 'count',
    completed: 0,
    total: leftoverIds.length,
  });

  const seen = candidateFromReader(params.readCandidate, params.candidate);
  if ('drifted' in seen || 'error' in seen || !candidatesEqual(params.candidate, seen)) {
    const message =
      'error' in seen
        ? seen.error
        : 'candidate drift during leftover required-ID execution; evidence was not aggregated';
    params.progress?.updateStage('leftover-tests', {
      status: 'fail',
      measure: 'count',
      completed: 0,
      total: leftoverIds.length,
    });
    return {
      ok: false,
      launchedProcess: false,
      leftoverIds,
      files,
      completedIds: [],
      mode,
      message,
      verificationLedgerRefs: [],
      maxConcurrent: 0,
      command: {
        name: LEFTOVER_REQUIRED_TESTS_COMMAND,
        status: 'failed',
        exitCode: 1,
        durationMs: Date.now() - started,
        summary: message,
        command: 'vitest run --reporter=json',
      },
    };
  }

  const ownersByFile = new Map<string, string[]>();
  for (const owner of discovered.owners) {
    if (!files.includes(owner.file)) continue;
    const list = ownersByFile.get(owner.file) ?? [];
    list.push(owner.id);
    ownersByFile.set(owner.file, list);
  }

  const runner = params.runner ?? defaultLeftoverRunner();
  const completed = new Set<string>();
  const refs: VerificationLedgerReference[] = [];
  const failures: string[] = [];
  let launchedProcess = false;

  const runFile = async (file: string): Promise<void> => {
    const ids = ownersByFile.get(file) ?? [];
    launchedProcess = true;
    const runOptions = leftoverVitestRunOptions(file);
    if (!runOptions.ok) {
      failures.push(runOptions.message);
      return;
    }
    const run = await runner({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      files: [file],
      requiredIds: ids,
      extraArgs: [
        '-t',
        ids.map(escapeTitleFilter).join('|'),
        '--testTimeout=60000',
      ],
      vitestProject: runOptions.vitestProject,
      configFile: runOptions.configFile,
    });
    const current = candidateFromReader(params.readCandidate, params.candidate);
    if ('drifted' in current || 'error' in current || !candidatesEqual(params.candidate, current)) {
      failures.push(
        'error' in current
          ? current.error
          : 'candidate drift during leftover required-ID execution; evidence was not aggregated'
      );
      return;
    }
    if (!run.ok) {
      failures.push(run.message);
      return;
    }
    if (
      run.record.headCommit !== params.candidate.headCommit ||
      run.record.productTreeFingerprint !== params.candidate.fingerprint
    ) {
      failures.push('leftover verification ledger is bound to a different HEAD or fingerprint');
      return;
    }
    const reporterRaw = existsSync(
      path.join(params.repoRoot, run.reference.reporterRelativePath)
    )
      ? readFileSync(path.join(params.repoRoot, run.reference.reporterRelativePath))
      : Buffer.alloc(0);
    const eligible = verificationRunIsProofEligible({
      record: run.record,
      reporterRaw,
      expectedHeadCommit: params.candidate.headCommit,
      expectedFingerprint: params.candidate.fingerprint,
      requiredIds: ids,
    });
    if (!eligible.ok) {
      failures.push(eligible.message);
      return;
    }
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: ids,
    });
    if (!proof.ok) {
      failures.push(proof.message);
      return;
    }
    refs.push(run.reference);
    for (const id of proof.provenIds) completed.add(id);
    params.progress?.updateStage('leftover-tests', {
      status: 'running',
      measure: 'count',
      completed: completed.size,
      total: leftoverIds.length,
    });
  };

  let maxConcurrent = 1;
  try {
    if (mode === 'bounded-parallel') {
      maxConcurrent = await mapBound(files, params.jobs, runFile);
    } else {
      for (const file of files) {
        await runFile(file);
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const executableIds = leftoverIds.filter((id) => {
    const owner = discovered.owners.find((row) => row.id === id);
    return owner != null && files.includes(owner.file);
  });
  const executableOk = failures.length === 0 && executableIds.every((id) => completed.has(id));

  params.progress?.updateStage('leftover-tests', {
    status: executableOk ? 'pass' : 'fail',
    measure: 'count',
    completed: completed.size,
    total: leftoverIds.length,
    failures: failures.slice(0, 5),
  });

  const message = failures[0];
  return {
    ok: executableOk,
    launchedProcess,
    leftoverIds,
    files,
    completedIds: [...completed].sort(),
    mode,
    message,
    verificationLedgerRefs: refs,
    maxConcurrent,
    command: {
      name: LEFTOVER_REQUIRED_TESTS_COMMAND,
      status: executableOk ? 'passed' : 'failed',
      exitCode: executableOk ? 0 : 1,
      durationMs: Date.now() - started,
      summary: executableOk
        ? `leftover required IDs ${completed.size}/${executableIds.length}`
        : (message ?? 'leftover required-ID execution failed'),
      command: 'vitest run --reporter=json',
      files,
    },
  };
}

export async function runLeftoverRequiredIdStage(params: {
  repoRoot: string;
  workstreamId: string;
  requiredTestIds: readonly string[];
  completedIds: readonly string[];
  candidate: VerifyCandidate;
  jobs: number;
  progress?: VerifyProgressReporter;
  readCandidate?: () => VerifyCandidate | { drifted: true } | { error: string };
  runner?: LeftoverVitestRunner;
  canonicalSuiteFiles?: readonly string[];
  isolation?: LeftoverIsolation;
}): Promise<LeftoverExecutionResult> {
  return proveAndExecuteLeftoverRequiredIds({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    requiredIds: resolvePreflightExecutionRequiredIds(params.requiredTestIds),
    completedIds: params.completedIds,
    candidate: params.candidate,
    jobs: params.jobs,
    progress: params.progress,
    readCandidate: params.readCandidate,
    runner: params.runner,
    canonicalSuiteFiles: params.canonicalSuiteFiles ?? loadCanonicalWorkflowSuiteManifest().files,
    isolation: params.isolation,
  });
}
