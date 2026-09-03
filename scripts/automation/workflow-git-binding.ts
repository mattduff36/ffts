import { spawnSync } from 'child_process';
import type { WorkflowProtocolRecord } from './types';

export interface WorkflowGitBinding {
  branchName: string | null;
  headCommit: string | null;
  detached: boolean;
}

function runGit(repoRoot: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

export function readWorkflowGitBinding(repoRoot: string): WorkflowGitBinding {
  const branchName = runGit(repoRoot, ['branch', '--show-current']);
  const headCommit = runGit(repoRoot, ['rev-parse', 'HEAD']);
  return {
    branchName,
    headCommit,
    detached: !branchName,
  };
}

export function gitParentCommit(repoRoot: string, commit: string): string | null {
  if (!commit) return null;
  return runGit(repoRoot, ['rev-parse', `${commit}^`]);
}

export function assertProtocolGitBinding(params: {
  repoRoot: string;
  protocol?: Pick<WorkflowProtocolRecord, 'branchName' | 'headCommit' | 'reviewedTreeFingerprint'> | null;
  expectedHeadCommit?: string | null;
  expectedTreeFingerprint?: string | null;
  currentTreeFingerprint?: string | null;
  requireBranchMatch?: boolean;
}): { ok: true; binding: WorkflowGitBinding } | { ok: false; message: string } {
  const binding = readWorkflowGitBinding(params.repoRoot);
  if (binding.detached || !binding.branchName) {
    return {
      ok: false,
      message:
        'HEAD is detached or the current branch is missing; protocol operations that bind review/finalise state require a named branch. Do not silently rebind the workstream.',
    };
  }
  if (!binding.headCommit) {
    return { ok: false, message: 'unable to read git HEAD for protocol binding' };
  }

  const expectedBranch = params.protocol?.branchName ?? null;
  if (params.requireBranchMatch !== false) {
    if (!expectedBranch) {
      return {
        ok: false,
        message:
          'protocol has no bound branchName; refuse to silently rebind this workstream to the current branch',
      };
    }
    if (expectedBranch !== binding.branchName) {
      return {
        ok: false,
        message: `current branch ${binding.branchName} does not match protocol branch ${expectedBranch}; do not silently rebind`,
      };
    }
  }

  const expectedHead = params.expectedHeadCommit ?? null;
  if (expectedHead && expectedHead !== binding.headCommit) {
    return {
      ok: false,
      message: `HEAD has moved since the bound commit ${expectedHead}; current HEAD is ${binding.headCommit}. Do not rewrite review metadata to the current HEAD.`,
    };
  }

  const expectedTree = params.expectedTreeFingerprint ?? null;
  const currentTree = params.currentTreeFingerprint ?? null;
  if (expectedTree && currentTree && expectedTree !== currentTree) {
    return {
      ok: false,
      message:
        'working tree fingerprint moved since the bound review; re-run review-start. Do not rewrite review metadata to the current tree.',
    };
  }

  return { ok: true, binding };
}

export function assertNamedBranchForInit(
  repoRoot: string
): { ok: true; binding: WorkflowGitBinding } | { ok: false; message: string } {
  const binding = readWorkflowGitBinding(repoRoot);
  if (binding.detached || !binding.branchName) {
    return {
      ok: false,
      message:
        'init requires a named Git branch; detached HEAD cannot bind a workstream. Do not silently rebind.',
    };
  }
  if (!binding.headCommit) {
    return { ok: false, message: 'init requires a readable git HEAD' };
  }
  return { ok: true, binding };
}

export function lastOwnedCommit(
  ownedCommits: string[] | undefined,
  fallback: string | null
): string | null {
  if (ownedCommits && ownedCommits.length > 0) {
    return ownedCommits[ownedCommits.length - 1] ?? fallback;
  }
  return fallback;
}

export function appendOwnedCommit(params: {
  repoRoot: string;
  ownedCommits: string[];
  activatedHeadCommit: string;
}): { ok: true; ownedCommits: string[] } | { ok: false; message: string } {
  const binding = readWorkflowGitBinding(params.repoRoot);
  if (!binding.headCommit) {
    return { ok: false, message: 'unable to read HEAD while recording a finalise-owned commit' };
  }
  const expectedParent =
    params.ownedCommits[params.ownedCommits.length - 1] ?? params.activatedHeadCommit;
  if (binding.headCommit === expectedParent) {
    return { ok: true, ownedCommits: params.ownedCommits };
  }
  const parent = gitParentCommit(params.repoRoot, binding.headCommit);
  if (!parent || parent !== expectedParent) {
    return {
      ok: false,
      message: `HEAD ${binding.headCommit} is not a finalise-owned child of ${expectedParent}; refuse to authorise a newer Git state`,
    };
  }
  if (params.ownedCommits.includes(binding.headCommit)) {
    return { ok: true, ownedCommits: params.ownedCommits };
  }
  return { ok: true, ownedCommits: [...params.ownedCommits, binding.headCommit] };
}
