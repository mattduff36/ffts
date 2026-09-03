import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
} from '@/scripts/automation/workflow-review-protocol';
import { assertManifestLintCoverage } from '@/scripts/automation/workflow-evidence-manifest';
import {
  assertReleaseDiffExcludesForbiddenPaths,
  assertReviewCandidateFrozen,
  inspectCandidateGitScope,
  listCandidateDiffPaths,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  computeGitProductTreeFingerprint,
  computeWorkingTreeProductFingerprint,
} from '@/scripts/automation/workflow-v24-disposition';
import { captureVerificationIdentity } from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  git,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writePassingManifest,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function gitAdd(repoRoot: string, fileName: string) {
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', fileName], {
    cwd: repoRoot,
    shell: false,
  });
}

describe('TEE V2.4 candidate Git scope matrix', { timeout: 60_000 }, () => {
  it('FD-VERIFY-SCOPE-INDEX-004 / TEE-V24-SCOPE-COMMITTED-001: committed-only candidate is listed', () => {
    const repoRoot = makeTempRoot('scope-committed');
    const baseline = initGitRepo(repoRoot);
    commitFile(repoRoot, 'runtime.ts', 'committed');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok).toBe(true);
    if (!scope.ok) throw new Error(scope.message);
    expect(scope.scope.committed).toContain('runtime.ts');
    expect(scope.scope.staged).toEqual([]);
  });

  it('TEE-V24-SCOPE-STAGED-MOD-002: staged modification only is detected', () => {
    const repoRoot = makeTempRoot('scope-staged-mod');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'README.md'), 'changed\n', 'utf8');
    gitAdd(repoRoot, 'README.md');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.staged).toContain('README.md');
    const listed = listCandidateDiffPaths(repoRoot, baseline);
    expect(listed.ok && listed.paths).toContain('README.md');
  });

  it('TEE-V24-SCOPE-STAGED-NEW-003: staged new file is detected', () => {
    const repoRoot = makeTempRoot('scope-staged-new');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'scripts-runtime.ts'), 'new\n', 'utf8');
    gitAdd(repoRoot, 'scripts-runtime.ts');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.staged).toContain('scripts-runtime.ts');
  });

  it('TEE-V24-SCOPE-STAGED-DEL-004: staged deletion is detected', () => {
    const repoRoot = makeTempRoot('scope-staged-del');
    const baseline = initGitRepo(repoRoot);
    spawnSync('git', ['rm', 'README.md'], { cwd: repoRoot, shell: false });
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.staged).toContain('README.md');
  });

  it('TEE-V24-SCOPE-UNSTAGED-005: unstaged modification is detected', () => {
    const repoRoot = makeTempRoot('scope-unstaged');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'README.md'), 'dirty\n', 'utf8');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.unstaged).toContain('README.md');
  });

  it('TEE-V24-SCOPE-UNTRACKED-006: untracked relevant file is detected', () => {
    const repoRoot = makeTempRoot('scope-untracked');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'runtime.ts'), 'untracked\n', 'utf8');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.untracked).toContain('runtime.ts');
  });

  it('TEE-V24-SCOPE-STAGED-UNSTAGED-007: staged plus unstaged same file is detected', () => {
    const repoRoot = makeTempRoot('scope-both');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'README.md'), 'staged\n', 'utf8');
    gitAdd(repoRoot, 'README.md');
    writeFileSync(path.join(repoRoot, 'README.md'), 'unstaged\n', 'utf8');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.staged).toContain('README.md');
    expect(scope.ok && scope.scope.unstaged).toContain('README.md');
  });

  it('TEE-V24-SCOPE-FORBIDDEN-STAGED-008: staged docs_private/automation file fails forbidden scope', () => {
    const repoRoot = makeTempRoot('scope-forbidden');
    const baseline = initGitRepo(repoRoot);
    const leaked = path.join(repoRoot, 'docs_private', 'automation', 'secret.json');
    mkdirSync(path.dirname(leaked), { recursive: true });
    writeFileSync(leaked, '{"leaked":true}\n', 'utf8');
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '-f', 'docs_private/automation/secret.json'],
      { cwd: repoRoot, shell: false }
    );
    const forbidden = assertReleaseDiffExcludesForbiddenPaths(repoRoot, baseline);
    expect(forbidden.ok).toBe(false);
    expect(forbidden.ok ? '' : forbidden.message).toMatch(/docs_private\/automation/i);
  });

  it('TEE-V24-SCOPE-FINGERPRINT-009: staged workflow/runtime file changes fingerprint and readiness', () => {
    const repoRoot = makeTempRoot('scope-fingerprint');
    initGitRepo(repoRoot);
    const before = computeWorkingTreeProductFingerprint(repoRoot);
    expect(typeof before).toBe('string');
    mkdirSync(path.join(repoRoot, 'scripts', 'automation'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'scripts', 'automation', 'runtime.ts'), 'changed\n', 'utf8');
    gitAdd(repoRoot, 'scripts/automation/runtime.ts');
    const after = computeWorkingTreeProductFingerprint(repoRoot);
    expect(after).not.toBe(before);
    const frozen = assertReviewCandidateFrozen(repoRoot);
    expect(frozen.ok).toBe(false);
    expect(frozen.ok ? '' : frozen.message).toMatch(/not ready|staged/i);
  });

  it('TEE-V24-SCOPE-FROZEN-010: clean frozen candidate passes', () => {
    const repoRoot = makeTempRoot('scope-frozen');
    const baseline = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_scope_frozen', baseline);
    writePassingManifest(repoRoot, 'ws_scope_frozen', 'preflight');
    expect(assertReviewCandidateFrozen(repoRoot).ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_scope_frozen',
        manifestPath: writePassingManifest(repoRoot, 'ws_scope_frozen', 'preflight'),
      }).ok
    ).toBe(true);
    const started = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_scope_frozen',
      pass: 'first',
    });
    expect(started.ok, started.message).toBe(true);
  });

  it('TEE-V24-SCOPE-IGNORED-011: ignored generated files follow exclusion rules', () => {
    const repoRoot = makeTempRoot('scope-ignored');
    writeFileSync(path.join(repoRoot, '.gitignore'), 'generated.log\n', 'utf8');
    const baseline = initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'generated.log'), 'ignored\n', 'utf8');
    const scope = inspectCandidateGitScope(repoRoot, baseline);
    expect(scope.ok && scope.scope.untracked.includes('generated.log')).toBe(false);
    expect(assertReviewCandidateFrozen(repoRoot).ok).toBe(true);
  });

  it('TEE-V24-SCOPE-CACHED-FAIL-012: git diff --cached failure fails closed', () => {
    const repoRoot = makeTempRoot('scope-cached-fail');
    const baseline = initGitRepo(repoRoot);
    git(repoRoot, ['update-ref', '-d', 'HEAD']);
    rmSyncSafe(path.join(repoRoot, '.git', 'index'));
    const listed = listCandidateDiffPaths(repoRoot, baseline);
    expect(listed.ok).toBe(false);
    expect(listed.ok ? '' : listed.message).toMatch(/git|cached|verification failed/i);
  });

  it('ARCH-GIT-ISOLATION-004: isolated successor does not contain the predecessor HEAD', () => {
    const repoRoot = makeTempRoot('arch-isolation');
    const baseline = initGitRepo(repoRoot);
    git(repoRoot, ['checkout', '-b', 'predecessor']);
    const predecessor = commitFile(repoRoot, 'pred.ts', 'exhausted');
    git(repoRoot, ['checkout', '-B', 'successor', baseline]);
    const successor = commitFile(repoRoot, 'succ.ts', 'isolated');
    const ancestor = spawnSync(
      'git',
      ['merge-base', '--is-ancestor', predecessor, successor],
      { cwd: repoRoot, shell: false }
    );
    expect(ancestor.status).toBe(1);
    const baselineOwned = spawnSync(
      'git',
      ['merge-base', '--is-ancestor', baseline, successor],
      { cwd: repoRoot, shell: false }
    );
    expect(baselineOwned.status).toBe(0);
  });

  it('ARCH-TRANSFER-EQUIVALENCE-005: identical product trees share one fingerprint', () => {
    const source = makeTempRoot('arch-eq-source');
    const dest = makeTempRoot('arch-eq-dest');
    initGitRepo(source);
    initGitRepo(dest);
    const sourceHead = commitFile(source, 'runtime.ts', 'same\n');
    const destHead = commitFile(dest, 'runtime.ts', 'same\n');
    const sourceFp = computeGitProductTreeFingerprint(source, sourceHead);
    const destFp = computeGitProductTreeFingerprint(dest, destHead);
    expect(typeof sourceFp).toBe('string');
    expect(sourceFp).toBe(destFp);
    expect(sourceHead).toMatch(/^[0-9a-f]{40}$/u);
    expect(destHead).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('FD-VERIFY-LINT-SCOPE-001: subset changed-file lint does not cover the candidate diff', () => {
    const repoRoot = makeTempRoot('lint-scope');
    const baseline = initGitRepo(repoRoot);
    commitFile(repoRoot, 'alpha.ts', 'export const alpha = 1;\n');
    commitFile(repoRoot, 'beta.ts', 'export const beta = 1;\n');
    const subset = assertManifestLintCoverage({
      repoRoot,
      baseCommit: baseline,
      commands: [
        {
          name: 'oxlint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'oxlint subset',
          command: 'npx oxlint -- alpha.ts',
        },
        {
          name: 'eslint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'eslint subset',
          command: 'npx eslint -- alpha.ts',
        },
      ],
    });
    expect(subset.ok).toBe(false);
    const complete = assertManifestLintCoverage({
      repoRoot,
      baseCommit: baseline,
      commands: [
        {
          name: 'oxlint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'oxlint complete',
          command: 'npx oxlint -- alpha.ts beta.ts',
        },
        {
          name: 'eslint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'eslint complete',
          command: 'npx eslint -- alpha.ts beta.ts',
        },
      ],
    });
    expect(complete.ok).toBe(true);
  });

  it('ARCH-VERIFY-BINDING-006: captured identity is HEAD plus product fingerprint', () => {
    const repoRoot = makeTempRoot('arch-binding');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    expect(identity.headCommit).toBe(git(repoRoot, ['rev-parse', 'HEAD']));
    const fingerprint = computeGitProductTreeFingerprint(repoRoot, identity.headCommit);
    expect(identity.productTreeFingerprint).toBe(fingerprint);
  });
});

function rmSyncSafe(target: string) {
  spawnSync('rm', ['-f', target], { shell: false });
}
