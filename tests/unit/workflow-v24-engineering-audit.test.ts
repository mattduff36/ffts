import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  loadCanonicalV24RequiredTestIds,
  loadCanonicalWorkflowSuiteManifest,
  requiredTestProofKind,
  titleContainsExactRequiredId,
} from '@/scripts/automation/workflow-verification-ledger';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function suiteAssertionTitles(): string[] {
  const titles: string[] = [];
  for (const relativePath of loadCanonicalWorkflowSuiteManifest().files) {
    const source = read(relativePath);
    const matches = source.matchAll(/^  it\(\s*(['"])((?:\\.|[^\n])*?)\1/gmu);
    for (const match of matches) {
      titles.push(match[2] ?? '');
    }
  }
  return titles;
}

describe('TEE V2.4 economical engineering audit', () => {
  it('contract symmetry: every proof consumer enforces producer security properties via verificationRunIsProofEligible', () => {
    const ledger = read('scripts/automation/workflow-verification-ledger.ts');
    const manifest = read('scripts/automation/workflow-evidence-manifest.ts');
    const protocol = read('scripts/automation/workflow-review-protocol.ts');
    expect(ledger).toMatch(/export function verificationRunIsProofEligible/);
    expect(ledger).toMatch(/typeof value === 'number' && Number\.isInteger\(value\)/);
    expect(ledger).not.toMatch(
      /if \(typeof row\.exitCode !== 'number'\) \{\s*return \{ ok: false, message: 'verification ledger exitCode is missing' \}/
    );
    expect(ledger).toContain('proveRequiredIdsAgainstCandidate');
    expect(ledger).toMatch(/verificationRunIsProofEligible\(/);
    expect(manifest).toContain("verificationRunIsProofEligible");
    expect(manifest).toMatch(/verification ledger is not proof-eligible/);
    expect(protocol).toContain('recomputeManifestProvenIds');
    expect(manifest).toContain('recomputeManifestProvenIds');
  });

  it('atomicity/order: authority-changing finish state cannot persist before C9 validation', () => {
    const logger = read('scripts/automation/logger.ts');
    const start = logger.indexOf('private commitPassedProtectedFinaliseAfterC9Validation');
    const end = logger.indexOf('assertC9BeforeRemoteMutation');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = logger.slice(start, end);
    const validateIndex = body.indexOf('assertPassedProtectedFinaliseC9Identity({');
    const persistIndex = body.indexOf('commitFinaliseCorrelationStateAndProtocols({');
    expect(validateIndex).toBeGreaterThan(0);
    expect(persistIndex).toBeGreaterThan(validateIndex);
    expect(body).toContain('recoverIncompleteFinalisePassedCommit');
    expect(body.indexOf('recoverIncompleteFinalisePassedCommit')).toBeLessThan(validateIndex);
    expect(logger).toContain('fromProtectedFinish: true');
    expect(logger).toContain(
      'passed finalise correlation cannot persist independently; use AutomationRun.finish after C9 validation'
    );
    expect(logger).toMatch(
      /workflowCorrelation = this\.commitPassedProtectedFinaliseAfterC9Validation\(\)/
    );
  });

  it('validation/mutation order: protected protocol transitions validate before persist helpers', () => {
    const protocol = read('scripts/automation/workflow-review-protocol.ts');
    const finaliseStart = protocol.slice(
      protocol.indexOf('export function reduceFinaliseStart'),
      protocol.indexOf('export function applyFinaliseProtocolOutcome')
    );
    expect(finaliseStart.indexOf('reviewAllowsFinaliseStart')).toBeGreaterThan(0);
    expect(finaliseStart.indexOf('assertProtocolGitBinding')).toBeGreaterThan(0);
    expect(finaliseStart.indexOf("succeed('finalise context activated'")).toBeGreaterThan(
      finaliseStart.indexOf('assertProtocolGitBinding')
    );
    const applyStart = protocol.indexOf('export function applyFinaliseProtocolOutcome');
    const applyEnd = protocol.indexOf('export function commitFinaliseCorrelationStateAndProtocols');
    const applyBody = protocol.slice(applyStart, applyEnd);
    expect(applyBody).toMatch(/Intentionally do not write protocol\.json yet/);
    expect(applyBody.indexOf("if (params.outcome !== 'passed')")).toBeGreaterThan(0);
    expect(applyBody.indexOf('writeJsonAtomic')).toBeGreaterThan(0);
    expect(applyBody.indexOf('writeJsonAtomic')).toBeLessThan(
      applyBody.indexOf('Intentionally do not write protocol.json yet')
    );
  });

  it('mutation/rehash, captured-vs-current, Git scope, fail-closed, and cross-binding remain wired', () => {
    const authenticity = read('tests/unit/workflow-v24-ledger-authenticity.test.ts');
    const swap = read('tests/unit/workflow-v24-c9-context-swap.test.ts');
    const scope = read('tests/unit/workflow-v24-git-scope.test.ts');
    const bound = read('tests/unit/workflow-v24-bound-provenance.test.ts');
    expect(authenticity).toContain('FD-VERIFY-UNTRUSTED-REHASH-004');
    expect(swap).toContain('FD-GIT-C9-PREPUSH-CONTEXT-SWAP-004');
    expect(scope).toContain('FD-VERIFY-SCOPE-INDEX-004');
    expect(bound).toContain('FD-LINEAGE-BOUND-INTEGRITY-004');
    expect(read('scripts/automation/workflow-verification-ledger.ts')).toContain(
      'POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED = false'
    );
  });

  it('contract symmetry: each required vitest_case ID maps to at most one suite assertion title', () => {
    const titles = suiteAssertionTitles();
    expect(titles.length).toBeGreaterThan(0);
    const duplicates: string[] = [];
    for (const id of loadCanonicalV24RequiredTestIds()) {
      if (requiredTestProofKind(id) !== 'vitest_case') continue;
      const hits = titles.filter((title) => titleContainsExactRequiredId(title, id));
      if (hits.length > 1) {
        duplicates.push(`${id} (${hits.length})`);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('sibling exported-authority: review/route/rehome reducers do not persist; passed finalise persist is guarded', () => {
    const protocol = read('scripts/automation/workflow-review-protocol.ts');
    const logger = read('scripts/automation/logger.ts');
    const reduceReview = protocol.slice(
      protocol.indexOf('export function reduceReviewRecord'),
      protocol.indexOf('export function reduceFixRecord')
    );
    const reduceRoute = protocol.slice(
      protocol.indexOf('export function reduceRoute'),
      protocol.indexOf('export function reduceRehomeBind')
    );
    const reduceRehome = protocol.slice(
      protocol.indexOf('export function reduceRehomeBind'),
      protocol.indexOf('export function reduceFinaliseStart')
    );
    expect(reduceReview).not.toContain('writeProtocolRecord(');
    expect(reduceReview).not.toContain('saveWorkflowReviewState(');
    expect(reduceRoute).not.toContain('writeProtocolRecord(');
    expect(reduceRoute).not.toContain('saveWorkflowReviewState(');
    expect(reduceRehome).not.toContain('writeProtocolRecord(');
    expect(reduceRehome).not.toContain('saveWorkflowReviewState(');
    expect(protocol).toContain('fromProtectedFinish !== true');
    expect(protocol).toContain('finalise-passed-commit.pending.json');
    expect(logger).toContain('export function computeFinaliseAutomationCorrelation');
    expect(logger).toContain('fromProtectedFinish: true');
  });
});
