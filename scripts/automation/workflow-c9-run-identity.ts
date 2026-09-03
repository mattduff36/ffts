import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { WorkflowActiveFinaliseContext } from './types';
import { lastOwnedCommit, readWorkflowGitBinding } from './workflow-git-binding';
import { canonicalizeEvidence, hashCanonicalEvidence } from './workflow-v24-disposition';

export const PROTECTED_C9_RUN_IDENTITY_SCHEMA = 'tee-v24-c9-run-identity-v1' as const;

export interface ProtectedC9RunIdentity {
  schemaVersion: typeof PROTECTED_C9_RUN_IDENTITY_SCHEMA;
  runId: string;
  workstreamId: string;
  checkpointId: string;
  branchName: string;
  activatedHeadCommit: string;
  ownedCommits: string[];
  activatedTreeFingerprint: string | null;
  capturedAt: string;
  identityHash: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function protectedC9IdentityPath(runDirectory: string, runId: string): string {
  return path.join(runDirectory, `${runId}.c9-identity.json`);
}

export function cloneActiveFinaliseContext(
  context: WorkflowActiveFinaliseContext
): WorkflowActiveFinaliseContext {
  return structuredClone(context);
}

export function canonicalProtectedC9IdentityBody(
  identity: Omit<ProtectedC9RunIdentity, 'identityHash'> | ProtectedC9RunIdentity
): Omit<ProtectedC9RunIdentity, 'identityHash'> {
  return {
    schemaVersion: PROTECTED_C9_RUN_IDENTITY_SCHEMA,
    runId: identity.runId,
    workstreamId: identity.workstreamId,
    checkpointId: identity.checkpointId,
    branchName: identity.branchName,
    activatedHeadCommit: identity.activatedHeadCommit,
    ownedCommits: [...(identity.ownedCommits ?? [])],
    activatedTreeFingerprint: identity.activatedTreeFingerprint ?? null,
    capturedAt: identity.capturedAt,
  };
}

export function hashProtectedC9RunIdentity(
  identity: Omit<ProtectedC9RunIdentity, 'identityHash'> | ProtectedC9RunIdentity
): string {
  return hashCanonicalEvidence(canonicalProtectedC9IdentityBody(identity));
}

export function buildProtectedC9RunIdentity(params: {
  runId: string;
  context: WorkflowActiveFinaliseContext;
  capturedAt?: string;
}): { ok: true; identity: ProtectedC9RunIdentity } | { ok: false; message: string } {
  const workstreamId = params.context.workstreamId;
  const checkpointId = params.context.checkpointId;
  const branchName = params.context.activatedBranchName;
  const activatedHeadCommit = params.context.activatedHeadCommit;
  if (typeof workstreamId !== 'string' || !workstreamId) {
    return { ok: false, message: 'protected C9 identity is missing workstreamId' };
  }
  if (typeof checkpointId !== 'string' || !checkpointId) {
    return { ok: false, message: 'protected C9 identity is missing checkpointId' };
  }
  if (typeof branchName !== 'string' || !branchName) {
    return { ok: false, message: 'protected C9 identity is missing branch' };
  }
  if (typeof activatedHeadCommit !== 'string' || !activatedHeadCommit) {
    return { ok: false, message: 'protected C9 identity is missing activated HEAD' };
  }
  if (params.context.ownedCommits != null && !Array.isArray(params.context.ownedCommits)) {
    return { ok: false, message: 'protected C9 identity owned chain is malformed' };
  }
  const body = canonicalProtectedC9IdentityBody({
    schemaVersion: PROTECTED_C9_RUN_IDENTITY_SCHEMA,
    runId: params.runId,
    workstreamId,
    checkpointId,
    branchName,
    activatedHeadCommit,
    ownedCommits: params.context.ownedCommits ?? [activatedHeadCommit],
    activatedTreeFingerprint:
      typeof params.context.activatedTreeFingerprint === 'string'
        ? params.context.activatedTreeFingerprint
        : null,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
  });
  return {
    ok: true,
    identity: {
      ...body,
      identityHash: hashProtectedC9RunIdentity(body),
    },
  };
}

export function persistProtectedC9RunIdentity(params: {
  runDirectory: string;
  identity: ProtectedC9RunIdentity;
}): { ok: true; absolutePath: string } | { ok: false; message: string } {
  const expectedHash = hashProtectedC9RunIdentity(params.identity);
  if (expectedHash !== params.identity.identityHash) {
    return { ok: false, message: 'protected C9 identity hash does not match canonical body' };
  }
  mkdirSync(params.runDirectory, { recursive: true });
  const absolutePath = protectedC9IdentityPath(params.runDirectory, params.identity.runId);
  writeFileSync(absolutePath, `${JSON.stringify(canonicalizeEvidence(params.identity), null, 2)}\n`, 'utf8');
  return { ok: true, absolutePath };
}

export function readProtectedC9RunIdentity(params: {
  runDirectory: string;
  runId: string;
}): { ok: true; identity: ProtectedC9RunIdentity } | { ok: false; message: string } {
  const absolutePath = protectedC9IdentityPath(params.runDirectory, params.runId);
  if (!existsSync(absolutePath)) {
    return { ok: false, message: 'protected finalise C9 identity is missing; refuse remote mutation' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return { ok: false, message: 'protected finalise C9 identity evidence is malformed; refuse remote mutation' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'protected finalise C9 identity evidence is malformed; refuse remote mutation' };
  }
  const row = parsed as Partial<ProtectedC9RunIdentity>;
  if (row.schemaVersion !== PROTECTED_C9_RUN_IDENTITY_SCHEMA) {
    return { ok: false, message: 'protected finalise C9 identity evidence is malformed; refuse remote mutation' };
  }
  if (row.runId !== params.runId) {
    return { ok: false, message: 'protected finalise C9 identity belongs to another run; refuse remote mutation' };
  }
  if (
    typeof row.workstreamId !== 'string' ||
    !row.workstreamId ||
    typeof row.checkpointId !== 'string' ||
    !row.checkpointId ||
    typeof row.branchName !== 'string' ||
    !row.branchName ||
    typeof row.activatedHeadCommit !== 'string' ||
    !row.activatedHeadCommit ||
    !Array.isArray(row.ownedCommits) ||
    typeof row.identityHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(row.identityHash)
  ) {
    return { ok: false, message: 'protected finalise C9 identity evidence is malformed; refuse remote mutation' };
  }
  const identity = row as ProtectedC9RunIdentity;
  if (hashProtectedC9RunIdentity(identity) !== identity.identityHash) {
    return { ok: false, message: 'protected finalise C9 identity evidence is malformed; refuse remote mutation' };
  }
  return { ok: true, identity };
}

export function capturedContextFromIdentity(
  identity: ProtectedC9RunIdentity
): WorkflowActiveFinaliseContext {
  return {
    workstreamId: identity.workstreamId,
    checkpointId: identity.checkpointId,
    activatedAt: identity.capturedAt,
    activatedHeadCommit: identity.activatedHeadCommit,
    activatedBranchName: identity.branchName,
    activatedTreeFingerprint: identity.activatedTreeFingerprint,
    ownedCommits: [...identity.ownedCommits],
  };
}

const SUPPORTED_C9_RELEASE_BUMP_PATHS = new Set(['VERSION']);

function listCommitChangedPaths(
  repoRoot: string,
  fromCommit: string,
  toCommit: string
): { ok: true; paths: string[] } | { ok: false; message: string } {
  const listed = spawnSync('git', ['diff', '--name-only', fromCommit, toCommit, '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (listed.status !== 0 && listed.status !== 1) {
    return { ok: false, message: 'protected finalise C9 cannot list the HEAD progression; refuse remote mutation' };
  }
  return {
    ok: true,
    paths: (listed.stdout ?? '')
      .split(/\r?\n/u)
      .map((entry) => entry.replace(/\\/g, '/').trim())
      .filter(Boolean),
  };
}

function assertSupportedC9HeadProgression(params: {
  repoRoot: string;
  ownedCommits: string[];
  activatedHeadCommit: string;
  currentHead: string;
}): { ok: true; expectedHead: string } | { ok: false; message: string } {
  if (!params.ownedCommits.includes(params.activatedHeadCommit)) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  const lastOwned = lastOwnedCommit(params.ownedCommits, params.activatedHeadCommit);
  if (!lastOwned) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  if (params.currentHead === lastOwned) {
    return { ok: true, expectedHead: lastOwned };
  }
  const parent = spawnSync('git', ['rev-parse', `${params.currentHead}^`], {
    cwd: params.repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (parent.status !== 0 || (parent.stdout ?? '').trim() !== lastOwned) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  const changed = listCommitChangedPaths(params.repoRoot, lastOwned, params.currentHead);
  if (!changed.ok) return changed;
  if (
    changed.paths.length === 0 ||
    changed.paths.some((relative) => !SUPPORTED_C9_RELEASE_BUMP_PATHS.has(relative))
  ) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  return { ok: true, expectedHead: params.currentHead };
}

export function assertGitMatchesCapturedC9Identity(params: {
  repoRoot: string;
  identity: ProtectedC9RunIdentity;
  expectedWorkstreamId?: string;
}): { ok: true; expectedHead: string } | { ok: false; message: string } {
  if (params.expectedWorkstreamId && params.identity.workstreamId !== params.expectedWorkstreamId) {
    return {
      ok: false,
      message: 'protected finalise C9 identity belongs to another workstream; refuse remote mutation',
    };
  }
  const git = readWorkflowGitBinding(params.repoRoot);
  if (git.detached || !git.branchName || !git.headCommit) {
    return { ok: false, message: 'protected finalise C9 git identity cannot be verified; refuse remote mutation' };
  }
  if (git.branchName !== params.identity.branchName) {
    return { ok: false, message: 'protected finalise C9 branch mismatch; refuse remote mutation' };
  }
  return assertSupportedC9HeadProgression({
    repoRoot: params.repoRoot,
    ownedCommits: params.identity.ownedCommits,
    activatedHeadCommit: params.identity.activatedHeadCommit,
    currentHead: git.headCommit,
  });
}

function liveOwnedChainExtendsCaptured(
  captured: string[],
  live: unknown
): boolean {
  if (!Array.isArray(live) || live.length < captured.length || captured.length === 0) {
    return false;
  }
  if (live.some((entry) => typeof entry !== 'string' || !entry)) {
    return false;
  }
  return captured.every((sha, index) => live[index] === sha);
}

const PROTOCOL_SHA_RE = /^[0-9a-f]{40}$/iu;

export function assertLiveFinaliseContextMatchesCaptured(params: {
  identity: ProtectedC9RunIdentity;
  live: WorkflowActiveFinaliseContext | null;
  protocolPhase?: string | null;
  protocolCheckpointId?: string | null;
  protocolWorkstreamId?: string | null;
  protocolBranchName?: string | null;
  protocolHeadCommit?: string | null;
  protocolBaseCommit?: string | null;
  protocolReviewedTreeFingerprint?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (!params.live) {
    return {
      ok: false,
      message: 'live finalise context is missing; refuse remote mutation',
    };
  }
  if (params.live.workstreamId !== params.identity.workstreamId) {
    return {
      ok: false,
      message: 'live finalise owner does not match captured workstream; refuse remote mutation',
    };
  }
  if (params.live.checkpointId !== params.identity.checkpointId) {
    return {
      ok: false,
      message: 'live finalise checkpoint does not match captured identity; refuse remote mutation',
    };
  }
  if (
    typeof params.live.activatedBranchName !== 'string' ||
    !params.live.activatedBranchName
  ) {
    return {
      ok: false,
      message: 'live finalise branch is missing; refuse remote mutation',
    };
  }
  if (params.live.activatedBranchName !== params.identity.branchName) {
    return { ok: false, message: 'live finalise branch does not match captured identity; refuse remote mutation' };
  }
  if (
    typeof params.live.activatedHeadCommit !== 'string' ||
    !params.live.activatedHeadCommit
  ) {
    return {
      ok: false,
      message: 'live finalise HEAD is missing; refuse remote mutation',
    };
  }
  if (params.live.activatedHeadCommit !== params.identity.activatedHeadCommit) {
    return {
      ok: false,
      message: 'live finalise HEAD does not match captured identity; refuse remote mutation',
    };
  }
  if (!liveOwnedChainExtendsCaptured(params.identity.ownedCommits, params.live.ownedCommits)) {
    return {
      ok: false,
      message: 'live finalise owned chain does not match captured identity; refuse remote mutation',
    };
  }
  if (
    typeof params.protocolWorkstreamId !== 'string' ||
    !params.protocolWorkstreamId ||
    params.protocolWorkstreamId !== params.identity.workstreamId
  ) {
    return {
      ok: false,
      message: 'live finalise protocol workstream does not match captured identity; refuse remote mutation',
    };
  }
  if (params.protocolPhase !== 'finalise_ready') {
    return {
      ok: false,
      message: 'live finalise protocol is not finalise_ready; refuse remote mutation',
    };
  }
  if (params.protocolCheckpointId !== params.identity.checkpointId) {
    return {
      ok: false,
      message: 'live finalise protocol checkpoint does not match captured identity; refuse remote mutation',
    };
  }
  if (
    typeof params.protocolBranchName !== 'string' ||
    !params.protocolBranchName ||
    params.protocolBranchName !== params.identity.branchName
  ) {
    return {
      ok: false,
      message: 'live finalise protocol branch does not match captured identity; refuse remote mutation',
    };
  }
  if (
    typeof params.protocolHeadCommit !== 'string' ||
    !params.protocolHeadCommit ||
    params.protocolHeadCommit !== params.identity.activatedHeadCommit
  ) {
    return {
      ok: false,
      message: 'live finalise protocol HEAD does not match captured identity; refuse remote mutation',
    };
  }
  if (
    typeof params.protocolBaseCommit !== 'string' ||
    !PROTOCOL_SHA_RE.test(params.protocolBaseCommit)
  ) {
    return {
      ok: false,
      message: 'live finalise protocol baseline is missing; refuse remote mutation',
    };
  }
  if (params.identity.activatedTreeFingerprint) {
    if (params.protocolReviewedTreeFingerprint !== params.identity.activatedTreeFingerprint) {
      return {
        ok: false,
        message:
          'live finalise protocol fingerprint does not match captured identity; refuse remote mutation',
      };
    }
  }
  return { ok: true };
}

export function assertCapturedIdentityMatchesRunMemory(params: {
  identity: ProtectedC9RunIdentity;
  runId: string;
  capturedContext: WorkflowActiveFinaliseContext | null;
  capturedWorkstreamId: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (params.identity.runId !== params.runId) {
    return { ok: false, message: 'protected finalise C9 identity belongs to another run; refuse remote mutation' };
  }
  if (
    params.capturedWorkstreamId &&
    params.identity.workstreamId !== params.capturedWorkstreamId
  ) {
    return {
      ok: false,
      message: 'protected finalise C9 identity belongs to another workstream; refuse remote mutation',
    };
  }
  if (!params.capturedContext) {
    return { ok: true };
  }
  if (params.identity.workstreamId !== params.capturedContext.workstreamId) {
    return {
      ok: false,
      message: 'protected finalise C9 identity belongs to another workstream; refuse remote mutation',
    };
  }
  if (params.identity.checkpointId !== params.capturedContext.checkpointId) {
    return {
      ok: false,
      message: 'protected finalise C9 checkpoint/workstream mismatch; refuse remote mutation',
    };
  }
  if (
    params.capturedContext.activatedBranchName &&
    params.identity.branchName !== params.capturedContext.activatedBranchName
  ) {
    return { ok: false, message: 'protected finalise C9 branch mismatch; refuse remote mutation' };
  }
  if (
    params.capturedContext.activatedHeadCommit &&
    params.identity.activatedHeadCommit !== params.capturedContext.activatedHeadCommit
  ) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  const expectedOwned = params.capturedContext.ownedCommits ?? [
    params.capturedContext.activatedHeadCommit,
  ];
  if (JSON.stringify(params.identity.ownedCommits) !== JSON.stringify(expectedOwned)) {
    return { ok: false, message: 'protected finalise C9 HEAD/owned-chain mismatch; refuse remote mutation' };
  }
  return { ok: true };
}

export function diagnosticC9ContextMismatch(
  captured: ProtectedC9RunIdentity,
  current: WorkflowActiveFinaliseContext | null
): string | null {
  if (!current) return null;
  const currentJson = JSON.stringify(canonicalizeEvidence({
    workstreamId: current.workstreamId,
    checkpointId: current.checkpointId,
    branchName: current.activatedBranchName ?? null,
    activatedHeadCommit: current.activatedHeadCommit ?? null,
  }));
  const capturedJson = JSON.stringify(canonicalizeEvidence({
    workstreamId: captured.workstreamId,
    checkpointId: captured.checkpointId,
    branchName: captured.branchName,
    activatedHeadCommit: captured.activatedHeadCommit,
  }));
  if (currentJson === capturedJson) return null;
  return sha256Hex(`${capturedJson}\n${currentJson}`);
}

export const PROTECTED_C9_PUSH_AUTH_SCHEMA = 'tee-v24-c9-push-auth-v1' as const;
export const FFTS_PROTECTED_PUSH_REMOTE = 'origin';
export const FFTS_PROTECTED_PUSH_DESTINATION_REF = 'refs/heads/main';
const FULL_SHA_RE = /^[0-9a-f]{40}$/iu;

export interface ProtectedC9PushAuthorization {
  schemaVersion: typeof PROTECTED_C9_PUSH_AUTH_SCHEMA;
  workstreamId: string;
  checkpointId: string;
  branchName: string;
  sourceCommit: string;
  remoteName: typeof FFTS_PROTECTED_PUSH_REMOTE;
  destinationRef: typeof FFTS_PROTECTED_PUSH_DESTINATION_REF;
  identityHash: string;
  authorizedAt: string;
}

export function buildProtectedC9PushAuthorization(params: {
  identity: ProtectedC9RunIdentity;
  sourceCommit: string;
  authorizedAt?: string;
}): { ok: true; authorization: ProtectedC9PushAuthorization } | { ok: false; message: string } {
  if (!FULL_SHA_RE.test(params.sourceCommit)) {
    return { ok: false, message: 'protected C9 push source commit must be a full SHA; refuse remote mutation' };
  }
  if (!FULL_SHA_RE.test(params.identity.activatedHeadCommit)) {
    return { ok: false, message: 'protected C9 push identity HEAD is not a full SHA; refuse remote mutation' };
  }
  return {
    ok: true,
    authorization: {
      schemaVersion: PROTECTED_C9_PUSH_AUTH_SCHEMA,
      workstreamId: params.identity.workstreamId,
      checkpointId: params.identity.checkpointId,
      branchName: params.identity.branchName,
      sourceCommit: params.sourceCommit.toLowerCase(),
      remoteName: FFTS_PROTECTED_PUSH_REMOTE,
      destinationRef: FFTS_PROTECTED_PUSH_DESTINATION_REF,
      identityHash: params.identity.identityHash,
      authorizedAt: params.authorizedAt ?? new Date().toISOString(),
    },
  };
}

export function buildExplicitProtectedPushArgv(
  authorization: ProtectedC9PushAuthorization
): ['push', string, string] {
  if (authorization.remoteName !== FFTS_PROTECTED_PUSH_REMOTE) {
    throw new Error('protected C9 push remote is not the authorised origin; refuse remote mutation');
  }
  if (authorization.destinationRef !== FFTS_PROTECTED_PUSH_DESTINATION_REF) {
    throw new Error('protected C9 push destination is not refs/heads/main; refuse remote mutation');
  }
  if (!FULL_SHA_RE.test(authorization.sourceCommit)) {
    throw new Error('protected C9 push source commit must be a full SHA; refuse remote mutation');
  }
  const refspec = `${authorization.sourceCommit}:${authorization.destinationRef}`;
  if (refspec.includes('HEAD') || refspec.includes('@{') || authorization.sourceCommit.includes('HEAD')) {
    throw new Error('protected C9 push refspec must not use mutable HEAD; refuse remote mutation');
  }
  return ['push', authorization.remoteName, refspec];
}

export function assertProtectedPushAuthorizationCurrent(params: {
  authorization: ProtectedC9PushAuthorization;
  headCommit: string | null;
  branchName: string | null;
  identity: ProtectedC9RunIdentity;
  live: WorkflowActiveFinaliseContext | null;
  protocolPhase?: string | null;
  protocolCheckpointId?: string | null;
  protocolWorkstreamId?: string | null;
  protocolBranchName?: string | null;
  protocolHeadCommit?: string | null;
  protocolBaseCommit?: string | null;
  protocolReviewedTreeFingerprint?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (params.authorization.schemaVersion !== PROTECTED_C9_PUSH_AUTH_SCHEMA) {
    return { ok: false, message: 'protected C9 push authorization schema is invalid; refuse remote mutation' };
  }
  if (params.authorization.identityHash !== params.identity.identityHash) {
    return { ok: false, message: 'protected C9 push authorization does not match captured identity; refuse remote mutation' };
  }
  if (params.authorization.workstreamId !== params.identity.workstreamId) {
    return { ok: false, message: 'protected C9 push authorization workstream drifted; refuse remote mutation' };
  }
  if (params.authorization.checkpointId !== params.identity.checkpointId) {
    return { ok: false, message: 'protected C9 push authorization checkpoint drifted; refuse remote mutation' };
  }
  if (!params.headCommit || params.headCommit.toLowerCase() !== params.authorization.sourceCommit.toLowerCase()) {
    return { ok: false, message: 'HEAD drifted after C9 push authorization; refuse remote mutation' };
  }
  if (!params.branchName || params.branchName !== params.authorization.branchName) {
    return { ok: false, message: 'branch drifted after C9 push authorization; refuse remote mutation' };
  }
  const liveMatch = assertLiveFinaliseContextMatchesCaptured({
    identity: params.identity,
    live: params.live,
    protocolPhase: params.protocolPhase,
    protocolCheckpointId: params.protocolCheckpointId,
    protocolWorkstreamId: params.protocolWorkstreamId,
    protocolBranchName: params.protocolBranchName,
    protocolHeadCommit: params.protocolHeadCommit,
    protocolBaseCommit: params.protocolBaseCommit,
    protocolReviewedTreeFingerprint: params.protocolReviewedTreeFingerprint,
  });
  if (!liveMatch.ok) {
    return { ok: false, message: liveMatch.message };
  }
  const argv = buildExplicitProtectedPushArgv(params.authorization);
  if (argv[0] !== 'push' || argv[1] !== FFTS_PROTECTED_PUSH_REMOTE) {
    return { ok: false, message: 'protected C9 push argv is not an exact origin refspec; refuse remote mutation' };
  }
  if (argv[2] !== `${params.authorization.sourceCommit}:${FFTS_PROTECTED_PUSH_DESTINATION_REF}`) {
    return { ok: false, message: 'protected C9 push argv drifted from authorised SHA:ref; refuse remote mutation' };
  }
  if (argv.includes('HEAD') || argv.includes('-u') || argv.includes('--force') || argv.includes('-f')) {
    return { ok: false, message: 'protected C9 push argv contains mutable or force flags; refuse remote mutation' };
  }
  return { ok: true };
}
