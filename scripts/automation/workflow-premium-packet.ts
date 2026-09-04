import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { readProtocolRecord } from './workflow-review-protocol';
import { getArchitectureGateDecision, extractPlanContractMarker, resolvePlanPath } from './workflow-plan-contract';
import { getCurrentTreeFingerprint, readEvidenceManifest } from './workflow-evidence-manifest';
import { inspectCandidateGitScope } from './workflow-verification-ledger';
import { computeWorkingTreeProductFingerprint } from './workflow-v24-disposition';
import { assertReviewReadiness } from './workflow-v24-review-readiness';
import {
  runVerifyBatch,
  type VerifyCandidate,
  type VerifyStage,
} from './workflow-verify-runner';

export interface PremiumPacketEvidence {
  schemaVersion: '1';
  kind: 'premium-review-packet';
  workstreamId: string;
  headCommit: string;
  productTreeFingerprint: string;
  changedFiles: string[];
  gitScope: {
    committed: string[];
    staged: string[];
    unstaged: string[];
    untracked: string[];
  };
  verificationSummary?: {
    status: string;
    provenIds: string[];
    commandNames: string[];
  };
  typecheckLintSummary?: {
    typecheck: string;
    oxlint: string;
    eslint: string;
  };
  protocolPhase?: string;
  architectureDecision?: string;
  readiness?: string;
}

export async function collectPremiumPacketEvidence(params: {
  repoRoot: string;
  workstreamId: string;
  candidate: VerifyCandidate;
  jobs?: number;
}): Promise<
  | { ok: true; packet: PremiumPacketEvidence }
  | { ok: false; message: string }
> {
  const protocol = readProtocolRecord(params.repoRoot, params.workstreamId);
  const stages: VerifyStage<unknown>[] = [
    {
      id: 'git-scope',
      label: 'Git scope',
      weight: 2,
      kind: 'readonly',
      run: () => {
        const scoped = inspectCandidateGitScope(params.repoRoot, protocol?.baseCommit || 'HEAD');
        const tree = getCurrentTreeFingerprint(params.repoRoot);
        if (!scoped.ok) return { ok: false, message: scoped.message, candidate: params.candidate };
        return {
          ok: true,
          candidate: params.candidate,
          value: { scope: scoped.scope, changedFiles: tree.changedFiles },
        };
      },
    },
    {
      id: 'verification-summary',
      label: 'Verification summary',
      weight: 2,
      kind: 'readonly',
      run: () => {
        const manifestPath = protocol?.evidenceManifestPath || protocol?.fixDeltaManifestPath;
        if (!manifestPath) return { ok: true, value: null, candidate: params.candidate };
        const absolute = path.isAbsolute(manifestPath)
          ? manifestPath
          : path.join(params.repoRoot, manifestPath);
        const manifest = readEvidenceManifest(absolute);
        if (!manifest) return { ok: false, message: 'evidence manifest is unreadable', candidate: params.candidate };
        if (manifest.headCommit !== params.candidate.headCommit) {
          return { ok: false, message: 'verification summary is bound to a different candidate', candidate: params.candidate };
        }
        return {
          ok: true,
          candidate: params.candidate,
          value: {
            status: manifest.status,
            provenIds: manifest.requiredTests.filter((test) => test.executed).map((test) => test.id),
            commandNames: manifest.commands.map((command) => command.name),
            typecheck: manifest.commands.find((command) => command.name === 'typecheck')?.status,
            oxlint: manifest.commands.find((command) => command.name === 'oxlint-changed')?.status,
            eslint: manifest.commands.find((command) => command.name === 'eslint-changed')?.status,
          },
        };
      },
    },
    {
      id: 'protocol-readiness',
      label: 'Protocol readiness',
      weight: 2,
      kind: 'readonly',
      run: () => {
        if (!protocol) return { ok: true, value: { phase: undefined }, candidate: params.candidate };
        const readiness =
          protocol.phase === 'first_review' || protocol.phase === 'fix_recorded'
            ? assertReviewReadiness({
                repoRoot: params.repoRoot,
                record: protocol,
                pass: protocol.phase === 'fix_recorded' ? 'closure' : 'first',
              })
            : { ok: true as const };
        let architectureDecision: string | undefined;
        if (protocol.planPath) {
          const resolved = resolvePlanPath({ candidatePath: protocol.planPath, repoRoot: params.repoRoot });
          if (resolved.status === 'ok' && resolved.absolutePath && existsSync(resolved.absolutePath)) {
            const contract = extractPlanContractMarker(readFileSync(resolved.absolutePath, 'utf8'));
            if (contract.status === 'present' && contract.contract) {
              architectureDecision =
                getArchitectureGateDecision(contract.contract.architectureGate) ?? undefined;
            }
          }
        }
        return {
          ok: true,
          candidate: params.candidate,
          value: {
            phase: protocol.phase,
            architectureDecision,
            readiness: readiness.ok ? 'ready' : readiness.message,
          },
        };
      },
    },
  ];

  const batch = await runVerifyBatch({
    stages,
    candidate: params.candidate,
    jobs: params.jobs,
    readCandidate: () => {
      const fingerprint = computeWorkingTreeProductFingerprint(params.repoRoot);
      const tree = getCurrentTreeFingerprint(params.repoRoot);
      if (typeof fingerprint === 'object') return { error: fingerprint.error };
      if (tree.headCommit !== params.candidate.headCommit || fingerprint !== params.candidate.fingerprint) {
        return { drifted: true };
      }
      return params.candidate;
    },
  });
  if (batch.drifted) return { ok: false, message: 'candidate drift during packet evidence collection' };
  if (!batch.ok) {
    return {
      ok: false,
      message: batch.failures[0]?.message ?? 'premium packet evidence collection failed',
    };
  }

  const git = batch.results.find((row) => row.id === 'git-scope')?.value as
    | { scope: { committed: string[]; staged: string[]; unstaged: string[]; untracked: string[] }; changedFiles: string[] }
    | undefined;
  const verification = batch.results.find((row) => row.id === 'verification-summary')?.value as
    | {
        status: string;
        provenIds: string[];
        commandNames: string[];
        typecheck?: string;
        oxlint?: string;
        eslint?: string;
      }
    | null
    | undefined;
  const protocolInfo = batch.results.find((row) => row.id === 'protocol-readiness')?.value as
    | { phase?: string; architectureDecision?: string; readiness?: string }
    | undefined;

  return {
    ok: true,
    packet: {
      schemaVersion: '1',
      kind: 'premium-review-packet',
      workstreamId: params.workstreamId,
      headCommit: params.candidate.headCommit,
      productTreeFingerprint: params.candidate.fingerprint,
      changedFiles: git?.changedFiles ?? [],
      gitScope: git?.scope ?? { committed: [], staged: [], unstaged: [], untracked: [] },
      verificationSummary: verification
        ? {
            status: verification.status,
            provenIds: verification.provenIds,
            commandNames: verification.commandNames,
          }
        : undefined,
      typecheckLintSummary: verification
        ? {
            typecheck: verification.typecheck ?? 'missing',
            oxlint: verification.oxlint ?? 'missing',
            eslint: verification.eslint ?? 'missing',
          }
        : undefined,
      protocolPhase: protocolInfo?.phase,
      architectureDecision: protocolInfo?.architectureDecision,
      readiness: protocolInfo?.readiness,
    },
  };
}
