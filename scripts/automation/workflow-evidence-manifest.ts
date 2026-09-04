import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { writeJsonAtomic } from './workflow-events';
import { getProtocolDirectory } from './workflow-review-protocol';
import { assertNoForbiddenPayload, sanitizeEvidenceLabel } from './workflow-privacy';
import { computeWorkingTreeProductFingerprint } from './workflow-v24-disposition';
import {
  CANONICAL_SUITE_REQUIRED_TEST_ID,
  EXACT_COMMAND_REQUIRED_TEST_IDS,
  parseVitestJsonReporter,
  proveCanonicalWorkflowSuite,
  provenVitestCaseIds,
  readAndValidateVerificationLedger,
  requiredTestIdsForBlocker,
  loadCanonicalWorkflowSuiteManifest,
  loadCanonicalV24RequiredTestIds,
  inspectCandidateGitScope,
  listCandidateDiffPaths,
  runVitestJsonAndPersistLedger,
  verificationRunIsProofEligible,
} from './workflow-verification-ledger';

export type EvidenceManifestKind = 'preflight' | 'fix-delta';
export type EvidenceCommandStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface EvidenceCommandResult {
  name: string;
  status: EvidenceCommandStatus;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  command?: string;
  files?: string[];
  headCommit?: string;
  productTreeFingerprint?: string;
  outputHash?: string;
}

export interface EvidenceTestMapping {
  id: string;
  status: 'completed' | 'unresolved' | 'missing';
  behavioral: boolean;
  /** True only when a targeted test run executed this ID successfully. */
  executed: boolean;
  evidenceLabel: string;
}

export interface WorkflowEvidenceManifest {
  schemaVersion: '1';
  kind: EvidenceManifestKind;
  workstreamId: string;
  status: 'passed' | 'failed' | 'unknown';
  createdAt: string;
  baseCommit: string;
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  contentHash: string;
  bodyHash?: string;
  changedFiles: string[];
  baseHeadEvidence: {
    baseCommit: string;
    headCommit: string;
    changedFileCount: number;
    changedFilesSample: string[];
  };
  commands: EvidenceCommandResult[];
  requiredTests: EvidenceTestMapping[];
  liveVerification?: {
    profile: string;
    status: EvidenceCommandStatus;
    summary: string;
  };
  closedBlockerIds?: string[];
  blockerEvidence?: Array<{
    blockerId: string;
    evidenceLabel: string;
    commandName?: string;
  }>;
  productTreeFingerprint?: string;
  verificationLedgers?: Array<{
    relativePath: string;
    contentHash: string;
    commandType: string;
    reporterRelativePath?: string;
    reporterOutputHash?: string;
  }>;
  privacy: {
    redacted: true;
  };
}

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  // Do not trimStart: porcelain status lines can begin with a leading space
  // (e.g. " M path"). Trimming would shift slice offsets and corrupt paths.
  return (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, '');
}

function runGitChecked(
  repoRoot: string,
  args: string[]
): { ok: true; stdout: string } | { ok: false; message: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    return { ok: false, message: `git ${args.join(' ')} failed` };
  }
  return {
    ok: true,
    stdout: (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, ''),
  };
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  return hashText(readFileSync(filePath, 'utf8'));
}

function listDirtyPaths(
  repoRoot: string
): { ok: true; paths: string[] } | { ok: false; message: string } {
  const listed = runGitChecked(repoRoot, ['status', '--porcelain', '-uall', '-z']);
  if (!listed.ok) return listed;
  if (!listed.stdout) return { ok: true, paths: [] };
  const paths: string[] = [];
  const records = listed.stdout.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    // Porcelain -z entries are "XY path\0". Rename/copy adds a second path record.
    if (record.length < 3) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (!firstPath) continue;
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const renamedPath = records[index];
      if (renamedPath) paths.push(renamedPath);
      continue;
    }
    paths.push(firstPath);
  }
  return {
    ok: true,
    paths: [...new Set(paths)]
      .filter((relative) => !isWorkflowAutomationRelativePath(relative))
      .sort(),
  };
}

function isWorkflowAutomationRelativePath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  return (
    normalized === 'docs_private/automation' ||
    normalized.startsWith('docs_private/automation/')
  );
}

export function getCurrentTreeFingerprint(repoRoot: string): {
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  changedFiles: string[];
} {
  const head = runGitChecked(repoRoot, ['rev-parse', 'HEAD']);
  const dirty = listDirtyPaths(repoRoot);
  if (!head.ok || !dirty.ok) {
    const message = !head.ok ? head.message : !dirty.ok ? dirty.message : 'git verification failed';
    return {
      headCommit: 'unknown',
      dirtyTreeHash: 'git-status-failed',
      inputFingerprint: `git-error:${message}`,
      changedFiles: ['__GIT_STATUS_FAILED__'],
    };
  }
  return {
    headCommit: head.stdout || 'unknown',
    dirtyTreeHash: hashText(dirty.paths.join('\n')),
    inputFingerprint: fingerprintInputs(repoRoot, dirty.paths),
    changedFiles: dirty.paths,
  };
}

export function listBaseToHeadChangedFiles(
  repoRoot: string,
  baseCommit: string,
  headCommit: string
): string[] {
  if (!baseCommit || !headCommit || baseCommit === 'unknown' || headCommit === 'unknown') {
    return [];
  }
  const output = runGit(repoRoot, ['diff', '--name-only', `${baseCommit}...${headCommit}`]);
  if (!output) return [];
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function fingerprintInputs(repoRoot: string, dirtyPaths: string[]): string {
  const parts = [
    `lock:${hashFile(path.join(repoRoot, 'package-lock.json'))}`,
    `pkg:${hashFile(path.join(repoRoot, 'package.json'))}`,
    `tsconfig:${hashFile(path.join(repoRoot, 'tsconfig.json'))}`,
    `vitest:${hashFile(path.join(repoRoot, 'vitest.config.ts'))}`,
    `node:${process.version}`,
  ];
  for (const relative of dirtyPaths) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      parts.push(`${relative}:absent`);
      continue;
    }
    parts.push(`${relative}:${hashFile(absolute)}`);
  }
  const migrationsDir = path.join(repoRoot, 'supabase');
  if (existsSync(migrationsDir)) {
    const migrationFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of migrationFiles) {
      parts.push(`migration:${name}:${hashFile(path.join(migrationsDir, name))}`);
    }
  }
  return hashText(parts.join('\n'));
}

function resolveCommandExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s|&<>^()"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(
  repoRoot: string,
  name: string,
  command: string,
  args: string[]
): EvidenceCommandResult {
  const started = Date.now();
  const executable = resolveCommandExecutable(command);
  // Prefer shell:false so patterns containing `|` (vitest -t id1|id2) are not
  // interpreted as Windows shell pipes. Fall back to a quoted shell command if needed.
  let result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (result.error && process.platform === 'win32') {
    const cmdline = [executable, ...args.map(quoteWindowsArg)].join(' ');
    result = spawnSync(cmdline, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
  }
  const durationMs = Date.now() - started;
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const rawSummary =
    exitCode === 0 ? 'ok' : (result.stderr || result.stdout || 'failed').trim().slice(0, 2_000);
  return {
    name,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs,
    summary: sanitizeEvidenceLabel(rawSummary),
    command: sanitizeEvidenceLabel([command, ...args].join(' ')),
  };
}

export type EvidenceCommandRunner = typeof runCommand;

function isLintableFile(relativePath: string): boolean {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(relativePath);
}

function discoverBehavioralTestIds(
  repoRoot: string,
  ids: string[],
  executedIds: Set<string>
): EvidenceTestMapping[] {
  const testRoots = [
    path.join(repoRoot, 'tests'),
    path.join(repoRoot, 'testsuite'),
  ].filter((dir) => existsSync(dir));

  const fileContents: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(test|spec)\.(ts|tsx|js|mjs)$/u.test(entry.name)) continue;
      try {
        fileContents.push(readFileSync(full, 'utf8'));
      } catch {
        // ignore unreadable
      }
    }
  };
  for (const root of testRoots) walk(root);
  const corpus = fileContents.join('\n');

  const exactCommandIds = new Set<string>(Object.values(EXACT_COMMAND_REQUIRED_TEST_IDS));

  return ids.map((id) => {
    const executed = executedIds.has(id);
    if (exactCommandIds.has(id)) {
      return {
        id,
        status: executed ? 'completed' : 'unresolved',
        behavioral: true,
        executed,
        evidenceLabel: executed ? `exact-command-executed:${id}` : `exact-command-unexecuted:${id}`,
      };
    }
    const present = corpus.includes(id);
    // Behavioral if the ID appears in an it()/test() title, not only as a source string.
    const behavioral =
      present &&
      new RegExp(
        `(?:it|test|describe)\\(\\s*['\`"][^'\`"]*${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
        'u'
      ).test(corpus);
    return {
      id,
      status: behavioral && executed ? 'completed' : present ? 'unresolved' : 'missing',
      behavioral,
      executed,
      evidenceLabel:
        behavioral && executed
          ? `behavioral-executed:${id}`
          : behavioral
            ? `behavioral-unexecuted:${id}`
            : present
              ? `source-only:${id}`
              : `missing:${id}`,
    };
  });
}

export function buildEvidenceManifest(params: {
  repoRoot: string;
  workstreamId: string;
  kind: EvidenceManifestKind;
  baseCommit: string;
  requiredTestIds?: string[];
  runChecks?: boolean;
  runRequiredTests?: boolean;
  liveVerification?: WorkflowEvidenceManifest['liveVerification'];
  closedBlockerIds?: string[];
  blockerEvidence?: WorkflowEvidenceManifest['blockerEvidence'];
  commandResults?: EvidenceCommandResult[];
  executedTestIds?: string[];
  verificationLedgerRefs?: WorkflowEvidenceManifest['verificationLedgers'];
  commandRunner?: EvidenceCommandRunner;
  frozenCandidate?: {
    headCommit: string;
    productTreeFingerprint: string;
    dirtyTreeHash?: string;
    inputFingerprint?: string;
  };
}): { manifest: WorkflowEvidenceManifest; relativePath: string; absolutePath: string } {
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const headCommit = params.frozenCandidate?.headCommit ?? tree.headCommit;
  const dirtyFiles = tree.changedFiles;
  const baseHeadFiles = listBaseToHeadChangedFiles(
    params.repoRoot,
    params.baseCommit,
    headCommit
  );
  const scoped = inspectCandidateGitScope(params.repoRoot, params.baseCommit || 'HEAD');
  const scopedPaths = scoped.ok ? scoped.scope.all : [];
  const changedFiles = [...new Set([...baseHeadFiles, ...dirtyFiles, ...scopedPaths])].sort();
  const gitScopeFailed = !scoped.ok || dirtyFiles.includes('__GIT_STATUS_FAILED__');
  const dirtyTreeHash = params.frozenCandidate?.dirtyTreeHash ?? tree.dirtyTreeHash;
  const inputFingerprint = params.frozenCandidate?.inputFingerprint ?? tree.inputFingerprint;
  const executedIds = new Set<string>();
  const verificationLedgerRefs = [...(params.verificationLedgerRefs ?? [])];
  const currentProductTree = computeWorkingTreeProductFingerprint(params.repoRoot);
  const productTreeAtBuild = params.frozenCandidate?.productTreeFingerprint ?? currentProductTree;
  const frozenDrifted =
    params.frozenCandidate != null &&
    (tree.headCommit !== params.frozenCandidate.headCommit ||
      typeof currentProductTree === 'object' ||
      currentProductTree !== params.frozenCandidate.productTreeFingerprint);
  if (typeof productTreeAtBuild === 'string') {
    for (const ref of verificationLedgerRefs) {
      const validated = readAndValidateVerificationLedger({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        relativePath: ref.relativePath,
        expectedFingerprint: productTreeAtBuild,
        expectedHeadCommit: headCommit,
      });
      if (!validated.ok) continue;
      const eligible = verificationRunIsProofEligible({
        record: validated.record,
        reporterRaw: validated.reporterRaw,
        expectedHeadCommit: headCommit,
        expectedFingerprint: productTreeAtBuild,
        requiredIds: params.requiredTestIds ?? [],
      });
      if (!eligible.ok) continue;
      const caseProof = provenVitestCaseIds({
        records: [validated.record],
        requiredIds: params.requiredTestIds ?? [],
      });
      if (caseProof.ok) {
        for (const id of caseProof.provenIds) executedIds.add(id);
      }
    }
  }
  const sanitizeCommand = (command: EvidenceCommandResult): EvidenceCommandResult => ({
    ...command,
    summary: sanitizeEvidenceLabel(command.summary ?? ''),
    command: command.command ? sanitizeEvidenceLabel(command.command) : undefined,
    files: command.files?.map((file) => sanitizeEvidenceLabel(file)),
  });
  const commands: EvidenceCommandResult[] = (params.commandResults ?? []).map(sanitizeCommand);
  const liveVerification = params.liveVerification
    ? {
        ...params.liveVerification,
        summary: sanitizeEvidenceLabel(params.liveVerification.summary ?? ''),
        profile: sanitizeEvidenceLabel(params.liveVerification.profile ?? ''),
      }
    : undefined;
  const liveViolations = liveVerification ? assertNoForbiddenPayload(liveVerification) : [];
  if (liveViolations.length > 0) {
    throw new Error(`liveVerification privacy violations: ${liveViolations.join('; ')}`);
  }
  const execute = params.commandRunner ?? runCommand;
  if (params.runChecks) {
    commands.push(execute(params.repoRoot, 'typecheck', 'npm', ['run', 'typecheck']));
    const lintableFiles = changedFiles.filter(
      (relativePath) =>
        isLintableFile(relativePath) && existsSync(path.join(params.repoRoot, relativePath))
    );
    if (lintableFiles.length === 0) {
      commands.push(
        {
          name: 'oxlint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx oxlint --',
          files: [],
        },
        {
          name: 'eslint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx eslint --',
          files: [],
        }
      );
    } else {
      const oxlint = execute(params.repoRoot, 'oxlint-changed', 'npx', [
        'oxlint',
        '--',
        ...lintableFiles,
      ]);
      oxlint.files = lintableFiles;
      commands.push(oxlint);
      const eslint = execute(params.repoRoot, 'eslint-changed', 'npx', [
        'eslint',
        '--',
        ...lintableFiles,
      ]);
      eslint.files = lintableFiles;
      commands.push(eslint);
    }
  }
  if (params.runRequiredTests && (params.requiredTestIds?.length ?? 0) > 0) {
    const ids = params.requiredTestIds ?? [];
    const proveCanonicalSet = ids.includes('TEE-V24-VERIFY-MANIFEST-001');
    const requiredIds = proveCanonicalSet
      ? [...new Set([...ids, ...loadCanonicalV24RequiredTestIds()])]
      : ids;
    const started = Date.now();
    const persisted = runVitestJsonAndPersistLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      commandId: 'preflight-required-tests',
      commandType: proveCanonicalSet ? 'vitest_suite' : 'vitest_case',
      files: loadCanonicalWorkflowSuiteManifest().files,
      extraArgs: proveCanonicalSet
        ? []
        : [
            '-t',
            ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|'),
            '--testTimeout=60000',
          ],
      requiredIds,
    });
    const proofEligible = persisted.ok
      ? verificationRunIsProofEligible({
          record: persisted.record,
          reporterRaw: readFileSync(
            path.join(params.repoRoot, persisted.reference.reporterRelativePath)
          ),
          expectedHeadCommit: headCommit,
          expectedFingerprint: typeof productTreeAtBuild === 'string' ? productTreeAtBuild : '',
          requiredIds,
        })
      : { ok: false as const, message: persisted.message };
    commands.push({
      name: 'required-tests',
      status: persisted.ok && proofEligible.ok ? 'passed' : 'failed',
      exitCode: persisted.ok && proofEligible.ok ? 0 : 1,
      durationMs: Date.now() - started,
      summary: persisted.ok
        ? proofEligible.ok
          ? `vitest ledger ${persisted.reference.contentHash}`
          : proofEligible.message
        : persisted.message,
      command: 'vitest run --reporter=json',
    });
    if (persisted.ok && proofEligible.ok) {
      verificationLedgerRefs.push(persisted.reference);
      const caseProof = provenVitestCaseIds({
        records: [persisted.record],
        requiredIds,
      });
      if (caseProof.ok) {
        for (const id of caseProof.provenIds) executedIds.add(id);
      }
    }
  }

  for (const id of exactCommandProvenIds(commands, params.requiredTestIds ?? [])) {
    executedIds.add(id);
  }

  const requiredTests = discoverBehavioralTestIds(
    params.repoRoot,
    params.requiredTestIds ?? [],
    executedIds
  );

  const checksPassed =
    commands.length > 0 &&
    commands.every((command) => command.status === 'passed' || command.status === 'skipped');
  const testsReady =
    requiredTests.length === 0 ||
    requiredTests.every(
      (test) => test.status === 'completed' && test.behavioral && test.executed
    );
  const sanitizedCommands = commands.map((command) => {
    const cleaned = sanitizeCommand(command);
    return typeof productTreeAtBuild === 'string'
      ? bindEvidenceCommandToCandidate(cleaned, headCommit, productTreeAtBuild)
      : cleaned;
  });
  const commandViolations = assertNoForbiddenPayload(sanitizedCommands);
  if (commandViolations.length > 0) {
    throw new Error(`commandResults privacy violations: ${commandViolations.join('; ')}`);
  }
  const rawBlockerPayload = {
    closedBlockerIds: params.closedBlockerIds,
    blockerEvidence: params.blockerEvidence,
  };
  const blockerInputViolations = assertNoForbiddenPayload(rawBlockerPayload);
  if (blockerInputViolations.length > 0) {
    throw new Error(
      `blocker evidence privacy violations: ${blockerInputViolations.join('; ')}`
    );
  }
  const sanitizedClosedBlockerIds = params.closedBlockerIds?.map((id) =>
    sanitizeEvidenceLabel(id)
  );
  const sanitizedBlockerEvidence = params.blockerEvidence?.map((entry) => ({
    blockerId: sanitizeEvidenceLabel(entry.blockerId),
    evidenceLabel: sanitizeEvidenceLabel(entry.evidenceLabel),
    commandName: entry.commandName
      ? sanitizeEvidenceLabel(entry.commandName)
      : undefined,
  }));
  const sanitizedRequiredTests = requiredTests.map((test) => ({
    ...test,
    evidenceLabel: sanitizeEvidenceLabel(test.evidenceLabel),
  }));
  const liveOk =
    !liveVerification ||
    liveVerification.status === 'passed' ||
    liveVerification.status === 'skipped';
  const fixEvidenceReady =
    params.kind !== 'fix-delta' ||
    ((sanitizedClosedBlockerIds?.length ?? 0) > 0 &&
      (sanitizedBlockerEvidence?.length ?? 0) > 0);

  let status: WorkflowEvidenceManifest['status'] = 'passed';
  if (!checksPassed || !testsReady || !liveOk || !fixEvidenceReady) status = 'failed';
  if (sanitizedCommands.some((command) => command.status === 'unknown')) status = 'unknown';
  if (gitScopeFailed || frozenDrifted || typeof productTreeAtBuild === 'object') status = 'failed';

  const draft: Omit<WorkflowEvidenceManifest, 'contentHash' | 'bodyHash'> = {
    schemaVersion: '1',
    kind: params.kind,
    workstreamId: params.workstreamId,
    status,
    createdAt: new Date().toISOString(),
    baseCommit: params.baseCommit,
    headCommit,
    dirtyTreeHash,
    inputFingerprint,
    changedFiles: changedFiles.slice(0, 500).map((file) => sanitizeEvidenceLabel(file)),
    baseHeadEvidence: {
      baseCommit: params.baseCommit,
      headCommit,
      changedFileCount: baseHeadFiles.length,
      changedFilesSample: baseHeadFiles.slice(0, 50).map((file) => sanitizeEvidenceLabel(file)),
    },
    commands: sanitizedCommands,
    requiredTests: sanitizedRequiredTests,
    liveVerification,
    closedBlockerIds: sanitizedClosedBlockerIds,
    blockerEvidence: sanitizedBlockerEvidence,
    productTreeFingerprint: params.frozenCandidate
      ? params.frozenCandidate.productTreeFingerprint
      : (() => {
          const fingerprint = computeWorkingTreeProductFingerprint(params.repoRoot);
          return typeof fingerprint === 'string' ? fingerprint : undefined;
        })(),
    verificationLedgers: verificationLedgerRefs,
    privacy: { redacted: true },
  };

  const manifestViolations = assertNoForbiddenPayload(draft);
  if (manifestViolations.length > 0) {
    throw new Error(`manifest privacy violations: ${manifestViolations.join('; ')}`);
  }

  const bodyHash = hashText(JSON.stringify(draft));
  const manifest: WorkflowEvidenceManifest = {
    ...draft,
    contentHash: bodyHash,
    bodyHash,
  };

  const directory = getProtocolDirectory(params.repoRoot, params.workstreamId);
  mkdirSync(directory, { recursive: true });
  const fileName = `${params.kind}-${manifest.contentHash}.json`;
  const absolutePath = path.join(directory, fileName);
  writeJsonAtomic(absolutePath, manifest);
  return {
    manifest,
    absolutePath,
    relativePath: path.relative(params.repoRoot, absolutePath).replace(/\\/g, '/'),
  };
}

export function readEvidenceManifest(filePath: string): WorkflowEvidenceManifest | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as WorkflowEvidenceManifest;
  } catch {
    return null;
  }
}

function exactTypecheckCommand(command: EvidenceCommandResult): boolean {
  const recorded = command.command ?? '';
  return (
    command.name === 'typecheck' &&
    command.status === 'passed' &&
    command.exitCode === 0 &&
    (recorded === 'npm run typecheck' ||
      recorded === 'npx tsc --noEmit' ||
      recorded === 'tsc --noEmit')
  );
}

export function bindEvidenceCommandToCandidate(
  command: EvidenceCommandResult,
  headCommit: string,
  productTreeFingerprint: string
): EvidenceCommandResult {
  return {
    ...command,
    headCommit,
    productTreeFingerprint,
    outputHash: hashText(`${command.command ?? ''}\n${command.exitCode}\n${command.summary}`),
  };
}

function commandBoundToCandidate(
  command: EvidenceCommandResult,
  headCommit: string,
  productTreeFingerprint: string
): boolean {
  return (
    command.headCommit === headCommit &&
    command.productTreeFingerprint === productTreeFingerprint &&
    typeof command.outputHash === 'string' &&
    command.outputHash.length > 0
  );
}

export function assertCandidateTypecheckLintEvidence(params: {
  repoRoot: string;
  baseCommit: string;
  headCommit: string;
  productTreeFingerprint: string;
  commands: EvidenceCommandResult[];
}): { ok: true } | { ok: false; message: string } {
  const typecheck = params.commands.find((command) => command.name === 'typecheck');
  if (!typecheck || !exactTypecheckCommand(typecheck)) {
    return { ok: false, message: 'candidate typecheck evidence is missing or invalid' };
  }
  if (!commandBoundToCandidate(typecheck, params.headCommit, params.productTreeFingerprint)) {
    return { ok: false, message: 'typecheck evidence is stale vs current HEAD/fingerprint' };
  }
  const oxlint = params.commands.find((command) => command.name === 'oxlint-changed');
  const eslint = params.commands.find((command) => command.name === 'eslint-changed');
  if (!oxlint || !eslint) {
    return { ok: false, message: 'candidate lint evidence is missing; oxlint and eslint are required' };
  }
  if (
    !commandBoundToCandidate(oxlint, params.headCommit, params.productTreeFingerprint) ||
    !commandBoundToCandidate(eslint, params.headCommit, params.productTreeFingerprint)
  ) {
    return { ok: false, message: 'lint evidence is stale vs current HEAD/fingerprint' };
  }
  return assertManifestLintCoverage({
    repoRoot: params.repoRoot,
    baseCommit: params.baseCommit,
    commands: params.commands,
  });
}

function exactLintCommand(command: EvidenceCommandResult, kind: 'oxlint' | 'eslint'): boolean {
  const expectedName = kind === 'oxlint' ? 'oxlint-changed' : 'eslint-changed';
  const expectedPrefix = kind === 'oxlint' ? 'npx oxlint --' : 'npx eslint --';
  if (command.name !== expectedName) return false;
  if (typeof command.command !== 'string' || !command.command.startsWith(expectedPrefix)) {
    return false;
  }
  if (command.status === 'skipped') {
    return command.exitCode === null && command.summary === 'no changed lintable files';
  }
  return command.status === 'passed' && command.exitCode === 0;
}

function lintFilesClaimedByCommand(
  command: EvidenceCommandResult,
  kind: 'oxlint' | 'eslint'
): string[] {
  const prefix = kind === 'oxlint' ? 'npx oxlint --' : 'npx eslint --';
  const fromFiles = (command.files ?? []).map((file) => file.replace(/\\/g, '/'));
  const argv =
    typeof command.command === 'string' && command.command.startsWith(prefix)
      ? command.command
          .slice(prefix.length)
          .trim()
          .split(/\s+/u)
          .filter(Boolean)
          .map((file) => file.replace(/\\/g, '/'))
      : [];
  return [...new Set([...fromFiles, ...argv])];
}

export function assertManifestLintCoverage(params: {
  repoRoot: string;
  baseCommit: string;
  commands: EvidenceCommandResult[];
}): { ok: true } | { ok: false; message: string } {
  const oxlint = params.commands.find((command) => command.name === 'oxlint-changed');
  const eslint = params.commands.find((command) => command.name === 'eslint-changed');
  if (!oxlint && !eslint) {
    return {
      ok: false,
      message: 'candidate lint evidence missing; oxlint and eslint are required',
    };
  }
  if (!oxlint || !eslint) {
    return {
      ok: false,
      message: 'changed-file lint claim is incomplete; both oxlint and eslint are required',
    };
  }
  const listed = listCandidateDiffPaths(params.repoRoot, params.baseCommit);
  if (!listed.ok) return listed;
  const scoped = inspectCandidateGitScope(params.repoRoot, params.baseCommit);
  if (!scoped.ok) return scoped;
  const lintable = [
    ...new Set([...listed.paths, ...scoped.scope.committed, ...scoped.scope.staged]),
  ]
    .filter((relative) => isLintableFile(relative))
    .sort();
  if (lintable.length === 0) {
    if (!exactLintCommand(oxlint, 'oxlint') || !exactLintCommand(eslint, 'eslint')) {
      return { ok: false, message: 'changed-file lint commands are invalid' };
    }
    return { ok: true };
  }
  if (
    !exactLintCommand(oxlint, 'oxlint') ||
    !exactLintCommand(eslint, 'eslint') ||
    oxlint.status === 'skipped' ||
    eslint.status === 'skipped'
  ) {
    return { ok: false, message: 'changed-file lint did not pass for the candidate diff' };
  }
  const oxlintFiles = new Set(lintFilesClaimedByCommand(oxlint, 'oxlint'));
  const eslintFiles = new Set(lintFilesClaimedByCommand(eslint, 'eslint'));
  if (
    lintable.some((relative) => !oxlintFiles.has(relative) || !eslintFiles.has(relative))
  ) {
    return {
      ok: false,
      message: 'changed-file lint does not cover the complete lintable candidate diff',
    };
  }
  return { ok: true };
}

function exactCommandProvenIds(commands: EvidenceCommandResult[], requiredIds: string[]): string[] {
  const proven: string[] = [];
  if (requiredIds.includes(EXACT_COMMAND_REQUIRED_TEST_IDS.TYPECHECK)) {
    if (commands.some(exactTypecheckCommand)) {
      proven.push(EXACT_COMMAND_REQUIRED_TEST_IDS.TYPECHECK);
    }
  }
  if (requiredIds.includes(EXACT_COMMAND_REQUIRED_TEST_IDS.LINT)) {
    const oxlint = commands.find((command) => command.name === 'oxlint-changed');
    const eslint = commands.find((command) => command.name === 'eslint-changed');
    if (
      oxlint &&
      eslint &&
      exactLintCommand(oxlint, 'oxlint') &&
      exactLintCommand(eslint, 'eslint')
    ) {
      proven.push(EXACT_COMMAND_REQUIRED_TEST_IDS.LINT);
    }
  }
  return proven;
}

export function recomputeManifestProvenIds(params: {
  repoRoot: string;
  workstreamId: string;
  parsed: Record<string, unknown>;
  extraRequiredIds?: string[];
}): { ok: true; executedIds: Set<string> } | { ok: false; message: string } {
  type VerificationLedgerRecord =
    import('./workflow-verification-ledger').VerificationLedgerRecord;

  const productTree = computeWorkingTreeProductFingerprint(params.repoRoot);
  if (typeof productTree === 'object') return { ok: false, message: productTree.error };
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  if (
    typeof params.parsed.productTreeFingerprint === 'string' &&
    params.parsed.productTreeFingerprint !== productTree
  ) {
    return { ok: false, message: 'manifest productTreeFingerprint is stale vs current tree' };
  }
  const refs = Array.isArray(params.parsed.verificationLedgers)
    ? params.parsed.verificationLedgers
    : [];
  const records: VerificationLedgerRecord[] = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, message: 'verification ledger reference is malformed' };
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.relativePath !== 'string' || typeof row.contentHash !== 'string') {
      return { ok: false, message: 'verification ledger reference is incomplete' };
    }
    const validated = readAndValidateVerificationLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      relativePath: row.relativePath,
      expectedFingerprint: productTree,
      expectedHeadCommit: tree.headCommit,
    });
    if (!validated.ok) return validated;
    if (validated.record.contentHash !== row.contentHash) {
      return { ok: false, message: 'verification ledger reference hash mismatch' };
    }
    const eligible = verificationRunIsProofEligible({
      record: validated.record,
      reporterRaw: validated.reporterRaw,
      expectedHeadCommit: tree.headCommit,
      expectedFingerprint: productTree,
    });
    if (!eligible.ok) {
      return {
        ok: false,
        message: `verification ledger is not proof-eligible: ${eligible.message}`,
      };
    }
    records.push(validated.record);
  }
  const requiredIds = Array.isArray(params.parsed.requiredTests)
    ? params.parsed.requiredTests
        .map((entry) =>
          entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : null
        )
        .filter((id): id is string => typeof id === 'string')
    : [];
  const closed = Array.isArray(params.parsed.closedBlockerIds)
    ? params.parsed.closedBlockerIds.filter((id): id is string => typeof id === 'string')
    : [];
  const idsToProve = [
    ...new Set([
      ...requiredIds,
      ...(params.extraRequiredIds ?? []),
      ...closed.flatMap((id) => requiredTestIdsForBlocker(id)),
    ]),
  ];
  const caseProof = provenVitestCaseIds({ records, requiredIds: idsToProve });
  if (!caseProof.ok) return caseProof;
  const executedIds = new Set(caseProof.provenIds);
  const commands = Array.isArray(params.parsed.commands)
    ? (params.parsed.commands as EvidenceCommandResult[])
    : [];
  for (const id of exactCommandProvenIds(commands, idsToProve)) executedIds.add(id);
  if (requiredIds.includes(CANONICAL_SUITE_REQUIRED_TEST_ID)) {
    const suiteRecord = records.find((record) => record.commandType === 'vitest_suite');
    const suiteRef = refs.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).contentHash === suiteRecord?.contentHash
    ) as Record<string, unknown> | undefined;
    if (!suiteRecord || typeof suiteRef?.relativePath !== 'string') {
      return { ok: false, message: 'canonical workflow suite ledger is missing' };
    }
    const reporter = readAndValidateVerificationLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      relativePath: suiteRef.relativePath,
      expectedFingerprint: productTree,
      expectedHeadCommit: tree.headCommit,
    });
    if (!reporter.ok) return reporter;
    const parsedReporter = parseVitestJsonReporter(reporter.reporterRaw);
    if (!parsedReporter.ok) return parsedReporter;
    const suiteEligible = verificationRunIsProofEligible({
      record: suiteRecord,
      reporterRaw: reporter.reporterRaw,
      expectedHeadCommit: tree.headCommit,
      expectedFingerprint: productTree,
    });
    if (!suiteEligible.ok) return suiteEligible;
    const suiteProof = proveCanonicalWorkflowSuite({
      record: suiteRecord,
      reporterSuccess: parsedReporter.success,
    });
    if (!suiteProof.ok) return suiteProof;
    executedIds.add(CANONICAL_SUITE_REQUIRED_TEST_ID);
  }
  return { ok: true, executedIds };
}
