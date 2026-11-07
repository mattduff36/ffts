import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

export const WORKFLOW_EVIDENCE_REF_PREFIX = 'refs/ffts/workflow-evidence/';
const COMMIT_FIELDS = new Set([
  'baseCommit', 'headCommit', 'baselineCommit', 'releaseHeadCommit',
  'implementationCommits', 'revertCommit', 'supersedeCommit', 'successorBaseline',
  'predecessorHead', 'latestLegalReviewCandidateHead', 'createdAtHeadCommit',
  'predecessorHeadCommit', 'successorBaselineCommit', 'sourceHeadCommit',
  'sourceBaselineCommit', 'sourceImplementationCommits', 'predecessorBranchResolvedSha',
  'currentHead', 'finaliseCommit', 'activatedHeadCommit', 'ownedCommits', 'resultingCommit',
  'terminalHeadCommit',
]);

export function evidenceGit(repoRoot: string, args: string[], input?: string): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024, input,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`workflow evidence Git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function collectWorkflowEvidenceCommits(value: unknown): string[] {
  const commits = new Set<string>();
  const visit = (node: unknown, field = ''): void => {
    if (typeof node === 'string' && COMMIT_FIELDS.has(field)) {
      if (!/^[0-9a-f]{7,64}$/iu.test(node)) {
        throw new Error(`invalid workflow evidence commit in ${field}`);
      }
      commits.add(node.toLowerCase());
    } else if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, field));
    } else if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, entry]) => visit(entry, key));
    }
  };
  visit(value);
  return [...commits].sort();
}

export interface WorkflowEvidencePinAudit {
  available: string[];
  missing: string[];
  unpinned: string[];
}

export function inspectWorkflowEvidencePins(repoRoot: string, value: unknown): WorkflowEvidencePinAudit {
  const available: string[] = [];
  const missing: string[] = [];
  const tokens = collectWorkflowEvidenceCommits(value);
  const output = tokens.length
    ? evidenceGit(repoRoot, ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      `${tokens.map((token) => `${token}^{commit}`).join('\n')}\n`).split(/\r?\n/u)
    : [];
  if (output.length !== tokens.length) throw new Error('incomplete Git evidence object inspection');
  output.forEach((line, index) => {
    if (line === `${tokens[index]}^{commit} missing`) missing.push(tokens[index]);
    else if (/^[0-9a-f]{40,64} commit$/u.test(line)) available.push(line.split(' ')[0]);
    else throw new Error(`invalid Git evidence object inspection: ${line}`);
  });
  const unique = [...new Set(available)].sort();
  const refs = evidenceGit(repoRoot, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)', WORKFLOW_EVIDENCE_REF_PREFIX]);
  const byRef = new Map(refs.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [name, sha, symbolic] = line.split(' ');
    if (symbolic) throw new Error(`symbolic workflow evidence ref is unsafe: ${name}`);
    return [name, sha];
  }));
  const unpinned = unique.filter((sha) => {
    const actual = byRef.get(`${WORKFLOW_EVIDENCE_REF_PREFIX}${sha}`);
    if (actual && actual !== sha) throw new Error(`workflow evidence ref collision for ${sha}`);
    return !actual;
  });
  return { available: unique, missing, unpinned };
}

export function pinWorkflowEvidence(repoRoot: string, value: unknown): WorkflowEvidencePinAudit {
  const audit = inspectWorkflowEvidencePins(repoRoot, value);
  const unpinned = new Set(audit.unpinned);
  if (audit.available.length > 0) {
    const commands = audit.available.map((sha) =>
      `${unpinned.has(sha) ? 'create' : 'verify'} ${WORKFLOW_EVIDENCE_REF_PREFIX}${sha} ${sha}`
    );
    evidenceGit(repoRoot, ['update-ref', '--stdin'], `start\noption no-deref\n${commands.join('\n')}\nprepare\ncommit\n`);
  }
  return audit;
}

/** Retain objects before publishing records; legacy missing objects remain explicit, never invented. */
export function retainWorkflowEvidenceBeforeWrite(repoRoot: string, value: unknown): void {
  // Non-Git collector/test fixtures have no objects to retain.
  if (!existsSync(path.join(repoRoot, '.git'))) return;
  const audit = pinWorkflowEvidence(repoRoot, value);
  if (audit.missing.length > 0) {
    process.stderr.write(`workflow evidence missing (not retained): ${audit.missing.join(', ')}\n`);
  }
}
