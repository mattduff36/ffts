import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import { assertReleaseDiffExcludesForbiddenPaths } from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function walkFiles(root: string, predicate: (file: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
        walk(full);
        continue;
      }
      if (predicate(full)) found.push(full);
    }
  };
  walk(root);
  return found;
}

describe('TEE V2.4 wording and compatibility', () => {
  it('TEE-V24-WORDING-001: generated CRITICAL contracts use V2.4 budget wording only', () => {
    const contract = createDefaultPlanContract({
      workstreamId: 'ws_ffts_wording',
      taskId: 'wording',
      taskType: 'change',
      lane: 'critical',
      rationale: 'wording',
      fallbackEscalation:
        'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
      requiredTests: [{ id: 'TEE-V24-WORDING-001', status: 'unresolved' }],
    });
    const rendered = renderPlanContractMarker(contract);
    expect(rendered).toContain(
      'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.'
    );
    expect(rendered).not.toContain('Do not launch a third premium review without routing or split.');
    expect(contract.recommendedBuildModel?.fallbackEscalation).toContain(
      'Routing or split does not reset this budget'
    );
  });

  it('TEE-V24-WORDING-DOC-001: tracked workflow docs do not emit the V2.3 third-review phrase as instruction', () => {
    const roots = [
      path.join(process.cwd(), '.cursor'),
      path.join(process.cwd(), 'scripts'),
      path.join(process.cwd(), 'docs'),
    ];
    const forbidden = 'Do not launch a third premium review without routing or split.';
    for (const root of roots) {
      if (!existsSync(root)) continue;
      for (const file of walkFiles(root, (candidate) => /\.(md|mdc|ts)$/u.test(candidate))) {
        const text = readFileSync(file, 'utf8');
        const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
        if (relative.endsWith('templates/critical-generated-wording.md')) {
          expect(text, relative).toContain(forbidden);
          continue;
        }
        expect(text, relative).not.toContain(forbidden);
      }
    }
  });

  it('TEE-V24-COMPAT-001: existing schema-v1 records remain readable without writes', () => {
    const before = getFinaliseProtocolReadiness(process.cwd());
    const after = getFinaliseProtocolReadiness(process.cwd());
    expect(after.currentHead).toBe(before.currentHead);
    expect(after.lineages.map((row) => `${row.workstreamId}:${row.phase}`).sort()).toEqual(
      before.lineages.map((row) => `${row.workstreamId}:${row.phase}`).sort()
    );
  });

  it('FD-VERIFY-SCOPE-002: scope proof fail-closes on git errors and committed automation paths', () => {
    const missingGit = makeTempRoot('scope-nogit');
    const failed = assertReleaseDiffExcludesForbiddenPaths(
      missingGit,
      '1ba32f3e49cef9edbe79b971833c9c11cc4112f1'
    );
    expect(failed.ok).toBe(false);
    expect(failed.ok ? '' : failed.message).toMatch(/git verification failed|git diff --cached failed/i);

    const repoRoot = makeTempRoot('scope-automation');
    initGitRepo(repoRoot);
    const leaked = path.join(repoRoot, 'docs_private', 'automation', 'secret.json');
    mkdirSync(path.dirname(leaked), { recursive: true });
    writeFileSync(leaked, '{"leaked":true}\n', 'utf8');
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '-f', 'docs_private/automation/secret.json'],
      { cwd: repoRoot, shell: false }
    );
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'leak'],
      { cwd: repoRoot, shell: false }
    );
    const leakedScope = assertReleaseDiffExcludesForbiddenPaths(repoRoot, 'HEAD~1');
    expect(leakedScope.ok).toBe(false);
    expect(leakedScope.ok ? '' : leakedScope.message).toMatch(/docs_private\/automation/i);
  });

  it('TEE-V24-SCOPE-001: unrelated scheduling dirty files and stashes are not part of this runtime change set', () => {
    const baseline = 'origin/main';
    const scope = assertReleaseDiffExcludesForbiddenPaths(process.cwd(), baseline);
    expect(scope.ok, scope.ok ? '' : scope.message).toBe(true);
    expect(
      scope.ok &&
        scope.paths.some((relative) => relative.startsWith('app/(dashboard)/scheduling/'))
    ).toBe(false);
    expect(
      scope.ok && scope.paths.some((relative) => relative.startsWith('docs_private/automation/'))
    ).toBe(false);
  });
});
